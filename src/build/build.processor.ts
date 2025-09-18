import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost
} from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { GithubService } from 'src/github/github.service';
import { Supabase } from 'src/supabase/supabase.service';
import { Logger } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import * as short from 'short-uuid';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { DEPLOY_QUEUE_NAME } from 'src/queue/queue.module';

@Processor('build-queue')
export class BuildProcessor extends WorkerHost {
  private readonly logger = new Logger(BuildProcessor.name);
  private readonly kc: k8s.KubeConfig;
  private readonly k8sCoreApi: k8s.CoreV1Api;
  private readonly k8sBatchApi: k8s.BatchV1Api;
  private readonly k8sNetworkApi: k8s.NetworkingV1Api;

  constructor(
    private readonly db: Supabase,
    private readonly githubAppService: GithubService,
    @InjectQueue(DEPLOY_QUEUE_NAME) private readonly deployQueue: Queue
  ) {
    super();
    this.kc = new k8s.KubeConfig();
    if (process.env.KUBERNETES_SERVICE_HOST) {
      this.kc.loadFromCluster();
    } else {
      this.kc.loadFromDefault();
    }
    this.k8sCoreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.k8sBatchApi = this.kc.makeApiClient(k8s.BatchV1Api);
    this.k8sNetworkApi = this.kc.makeApiClient(k8s.NetworkingV1Api);
  }

  async process(
    job: Job<
      {
        build_id: string;
        repo_name: string;
        branch: string;
        installation_id: number;
        deployment_id: string;
      },
      any,
      string
    >
  ): Promise<any> {
    const { build_id, repo_name, branch, installation_id, deployment_id } =
      job.data;
    const buildNamespace = `build-${short.generate()}`.toLowerCase();
    let logs = '';

    try {
      await this.updateBuildStatus(build_id, 'building');
      await this.updateDeploymentStatus(deployment_id, 'building');

      const octokit =
        await this.githubAppService.getInstallationOctokit(installation_id);
      const token = ((await octokit.auth({ type: 'installation' })) as any)
        .token;
      const cloneUrl = `https://x-access-token:${token}@github.com/${repo_name}.git`;

      const namespacedObject: k8s.V1Namespace = {
        metadata: { name: buildNamespace }
      };
      await this.k8sCoreApi.createNamespace({
        body: namespacedObject
      });
      await this.createRegistrySecret(buildNamespace);

      const jobManifest = this.createJobManifest(
        build_id,
        cloneUrl,
        branch,
        repo_name
      );
      await this.k8sBatchApi.createNamespacedJob({
        body: jobManifest,
        namespace: buildNamespace
      });

      const jobResult = await this.monitorJob(
        buildNamespace,
        `build-job-${build_id}`
      );
      logs = jobResult.logs;

      if (!jobResult.succeeded) {
        throw new Error('Kubernetes Job failed.');
      }

      const imageUri = `${process.env.REGISTRY_URL}/${process.env.REGISTRY_USER}/${repo_name.split('/')[1]}:${branch}`;
      await this.updateBuildStatus(build_id, 'success', imageUri, logs);
      this.logger.log(
        `[${build_id}] Build successful in namespace ${buildNamespace}.`
      );

      await this.deployQueue.add('new-deployment', {
        build_id,
        image_uri: imageUri
      });
    } catch (error) {
      this.logger.error(`[${build_id}] Build failed:`, error.message);
      await this.updateBuildStatus(
        build_id,
        'failed',
        undefined,
        logs || error.message
      );
      throw error;
    } finally {
      this.logger.log(
        `[${build_id}] Cleaning up namespace ${buildNamespace}...`
      );
      await this.k8sCoreApi.deleteNamespace({ name: buildNamespace });
    }
  }

  private async updateDeploymentStatus(
    id: string,
    status: string,
    details?: object
  ) {
    await this.db
      .from('deployments')
      .update({ status, ...details })
      .eq('id', id);
  }

  private async createRegistrySecret(namespace: string) {
    const authString = Buffer.from(
      `${process.env.REGISTRY_USER}:${process.env.REGISTRY_PASSWORD}`
    ).toString('base64');
    const dockerConfig = {
      auths: { [process.env.REGISTRY_URL as string]: { auth: authString } }
    };
    const dockerConfigJson = Buffer.from(JSON.stringify(dockerConfig)).toString(
      'base64'
    );

    const secret: k8s.V1Secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'registry-secret' },
      type: 'kubernetes.io/dockerconfigjson',
      data: { '.dockerconfigjson': dockerConfigJson }
    };
    await this.k8sCoreApi.createNamespacedSecret({
      namespace: namespace,
      body: secret
    });
  }

  private createJobManifest(
    buildId: string,
    cloneUrl: string,
    branch: string,
    repo_full_name: string
  ): k8s.V1Job {
    this.logger.log(`[${buildId}] Creating Job manifest...`);
    this.logger.log(`[${buildId}] Creating Buildah Job manifest...`);

    const templatePath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      'builder/job-template.yaml'
    );
    const templateContent = fs.readFileSync(templatePath, 'utf8');

    const targetImage = `${process.env.REGISTRY_URL}/${process.env.REGISTRY_USER}/${repo_full_name.split('/')[1]}:${branch}`;
    const builderImage = `${process.env.REGISTRY_URL}/${process.env.REGISTRY_USER}/capsule-builder:latest`;

    const finalManifestContent = templateContent
      .replace(/{{BUILD_ID}}/g, buildId)
      .replace(/{{BUILDER_IMAGE}}/g, builderImage)
      .replace(/{{TARGET_IMAGE}}/g, targetImage)
      .replace(/{{GIT_BRANCH}}/g, branch)
      .replace(/{{GIT_CLONE_URL}}/g, cloneUrl);

    const jobManifest = yaml.load(finalManifestContent) as k8s.V1Job;
    jobManifest.apiVersion = 'batch/v1';
    jobManifest.kind = 'Job';

    this.logger.log(
      `[${buildId}] Buildah Job manifest created for target image: ${targetImage}`
    );
    return jobManifest;
  }

  private async monitorJob(
    namespace: string,
    jobName: string
  ): Promise<{ succeeded: boolean; logs: string }> {
    return new Promise((resolve, reject) => {
      this.logger.log(
        `[${jobName}] Starting to monitor job in namespace ${namespace}...`
      );

      const timeout = setTimeout(() => {
        clearInterval(checkInterval);
        reject(
          new Error(
            `Timeout: Job ${jobName} did not complete within 10 minutes.`
          )
        );
      }, 600000);

      const checkInterval = setInterval(async () => {
        try {
          const job = await this.k8sBatchApi.readNamespacedJobStatus({
            name: jobName,
            namespace
          });

          if (job.status?.succeeded) {
            this.logger.log(`[${jobName}] Job succeeded.`);
            clearInterval(checkInterval);
            clearTimeout(timeout);
            const podLogs = await this.getPodLogsForJob(namespace, jobName);
            resolve({ succeeded: true, logs: podLogs });
            return;
          }

          if (job.status?.failed) {
            this.logger.error(`[${jobName}] Job failed.`);
            clearInterval(checkInterval);
            clearTimeout(timeout);
            const podLogs = await this.getPodLogsForJob(namespace, jobName);
            resolve({ succeeded: false, logs: `Job failed.\n\n${podLogs}` });
            return;
          }

          this.logger.log(`[${jobName}] Job is still running...`);
        } catch (error) {
          if (error.statusCode === 404) {
            this.logger.warn(
              `[${jobName}] Job not found yet, retrying... (this is normal)`
            );
            return;
          }

          clearInterval(checkInterval);
          clearTimeout(timeout);
          this.logger.error(
            `[${jobName}] Unrecoverable error while monitoring job:`,
            error.body?.message || error.message
          );
          reject(new Error(error));
        }
      }, 5000);
    });
  }

  private async getPodLogsForJob(
    namespace: string,
    jobName: string
  ): Promise<string> {
    try {
      const labelSelector = `job-name=${jobName}`;
      const podList = await this.k8sCoreApi.listNamespacedPod({
        namespace,
        labelSelector: labelSelector
      });

      if (podList.items.length === 0) {
        return 'Could not find pod for the job to retrieve logs.';
      }

      const podName = podList.items[0].metadata?.name ?? 'buildkit-builder';

      const logs = await this.k8sCoreApi.readNamespacedPodLog({
        name: podName,
        namespace: namespace
      });

      return logs;
    } catch (error) {
      this.logger.error(
        `[${jobName}] Failed to retrieve pod logs:`,
        error.body?.message || error
      );
      return 'Failed to retrieve logs from the build pod.';
    }
  }

  private async updateBuildStatus(
    buildId: string,
    status: string,
    imageUri?: string,
    logs?: string
  ) {
    const updateData: any = { status, finished_at: new Date() };
    if (imageUri) updateData.image_uri = imageUri;
    if (logs) updateData.logs = logs;

    await this.db.from('builds').update(updateData).eq('id', buildId);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} has completed.`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: any) {
    this.logger.error(`Job ${job.id} has failed with error: ${err.message}`);
  }
}
