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
import { BUILD_QUEUE_NAME, DEPLOY_QUEUE_NAME } from 'src/queue/queue.module';

import { exec } from 'child_process';
import { promisify } from 'util';
import { LogsGateway } from 'src/logs/logs.gateway';
import { KubernetesService } from 'src/kubernetes/kubernetes.service';

const execPromise = promisify(exec);

@Processor(BUILD_QUEUE_NAME)
export class BuildProcessor extends WorkerHost {
  private readonly logger = new Logger(BuildProcessor.name);

  constructor(
    private readonly kubernetesService: KubernetesService,
    private readonly logsGateway: LogsGateway,
    private readonly db: Supabase,
    private readonly githubAppService: GithubService,
    @InjectQueue(DEPLOY_QUEUE_NAME) private readonly deployQueue: Queue
  ) {
    super();
    this.deployQueue.drain();
  }

  async process(
    job: Job<
      {
        build_id: string;
        repo_name: string;
        branch: string;
        installation_id: number;
        deployment_id: string;
        port: number;
      },
      any,
      string
    >
  ): Promise<any> {
    const {
      build_id,
      repo_name,
      branch,
      installation_id,
      deployment_id,
      port
    } = job.data;
    const buildNamespace = `build-${short.generate()}`.toLowerCase();
    const cloneDir = `/tmp/build-${deployment_id}`;

    try {
      await this.updateBuildStatus(build_id, 'building');
      await this.updateDeploymentStatus(deployment_id, 'building');

      const octokit =
        await this.githubAppService.getInstallationOctokit(installation_id);
      const token = ((await octokit.auth({ type: 'installation' })) as any)
        .token;
      const cloneUrl = `https://x-access-token:${token}@github.com/${repo_name}.git`;

      await execPromise(
        `git clone --branch ${branch} --depth 1 https://github.com/${repo_name}.git ${cloneDir}`
      );

      const { stdout: commitSha } = await execPromise(
        `git -C ${cloneDir} rev-parse --short HEAD`
      );
      const uniqueTag = commitSha.trim();

      const imageUri = `${process.env.REGISTRY_URL}/${process.env.REGISTRY_USER}/${repo_name.split('/')[1]}:${uniqueTag}`;
      const namespacedObject: k8s.V1Namespace = {
        metadata: { name: buildNamespace }
      };
      await this.kubernetesService.createNamespace({
        body: namespacedObject
      });
      await this.kubernetesService.createRegistrySecret(buildNamespace);

      const jobManifest = this.createJobManifest(
        build_id,
        cloneUrl,
        branch,
        repo_name,
        imageUri
      );

      await this.kubernetesService.createNamespacedJob({
        jobManifest,
        namespace: buildNamespace
      });

      const pod = await this.kubernetesService.waitForJobPod(
        buildNamespace,
        `build-job-${build_id}`
      );
      if (!pod.metadata?.name) {
        throw new Error(`Pod not found build-job-${build_id}`);
      }

      await this.kubernetesService.waitForPodReady(
        buildNamespace,
        pod.metadata?.name
      );

      const containerName = pod.spec?.containers?.[0]?.name;
      if (!containerName) {
        throw new Error(`No container found in pod ${pod.metadata.name}`);
      }

      this.kubernetesService.watchJobAndStreamLogs(
        buildNamespace,
        pod.metadata.name,
        containerName,
        deployment_id
      );

      await this.updateBuildStatus(build_id, 'success', imageUri);
      this.logger.log(
        `[${build_id}] Build successful in namespace ${buildNamespace}.`
      );

      await this.deployQueue.add('new-deployment', {
        build_id,
        port,
        image_uri: imageUri
      });
    } catch (error) {
      this.logger.error(`[${build_id}] Build failed:`, error);
      await this.updateBuildStatus(
        build_id,
        'failed',
        undefined,
        error.message
      );
      throw error;
    } finally {
      this.logger.log(
        `[${build_id}] Cleaning up namespace ${buildNamespace}...`
      );
      await this.kubernetesService.cleanupNamespace(buildNamespace);
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

  private createJobManifest(
    buildId: string,
    cloneUrl: string,
    branch: string,
    repo_full_name: string,
    image_tag: string
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

    const targetImage = image_tag;
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
