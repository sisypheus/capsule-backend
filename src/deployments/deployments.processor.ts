import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger, NotFoundException } from '@nestjs/common';
import { KubernetesService } from 'src/kubernetes/kubernetes.service';
import { Supabase } from 'src/supabase/supabase.service';
import { ConfigService } from '@nestjs/config';
import { Tables } from 'database.types';
import { PostgrestError } from '@supabase/supabase-js';

type BuildWithDeployment = Tables<'builds'> & {
  deployments: Tables<'deployments'> | null; // La relation peut être nulle
};

@Processor('deploy-queue')
export class DeploymentsProcessor extends WorkerHost {
  private readonly logger = new Logger(DeploymentsProcessor.name);

  constructor(
    private readonly db: Supabase,
    private readonly kubernetesService: KubernetesService,
    private readonly configService: ConfigService
  ) {
    super();
  }

  async process(
    job: Job<{ build_id: string; image_uri: string }, any, string>
  ): Promise<any> {
    const { build_id, image_uri } = job.data;
    this.logger.log(
      `Starting deployment for build ${build_id} with image ${image_uri}`
    );

    const {
      data: build,
      error: buildError
    }: { data: BuildWithDeployment | null; error: PostgrestError | null } =
      await this.db
        .from('builds')
        .select('*, deployments(*)')
        .eq('id', build_id)
        .single();

    if (buildError || !build) {
      this.logger.error(`Could not find build record for ID: ${build_id}`);
      throw new Error(`Build record not found for ID: ${build_id}`);
    }
    const deployment = build.deployments;

    try {
      if (!deployment)
        throw new NotFoundException('No deployment linked to build');

      await this.updateDeploymentStatus(deployment.id, 'deploying');

      const appName = deployment.project.split('/')[1];
      const namespace = `user-${deployment.user_id.substring(0, 8)}`;
      const url = `http://${appName}-${namespace}.${this.configService.get('BASE_DOMAIN', '127.0.0.1.nip.io')}:${this.configService.get('DEPLOYMENT_PORT', '8081')}`;

      await this.kubernetesService.applyNamespace(namespace);

      await this.kubernetesService.applyDeployment(
        namespace,
        appName,
        image_uri
      );

      await this.kubernetesService.applyService(namespace, appName);

      await this.kubernetesService.applyIngress(namespace, appName, url);

      await this.kubernetesService.waitForDeployment(namespace, appName);

      await this.updateDeploymentStatus(deployment.id, 'running', url);
      this.logger.log(
        `Deployment successful for build ${build_id}. Application is live at ${url}`
      );
    } catch (error) {
      this.logger.error(`Deployment failed for build ${build_id}:`, error);
      if (deployment)
        await this.updateDeploymentStatus(deployment.id, 'deploy_failed');
      throw error;
    }
  }

  private async updateDeploymentStatus(
    deploymentId: string,
    status: string,
    url?: string
  ) {
    const updateData: any = { status };
    if (url) {
      updateData.url = url;
    }
    await this.db.from('deployments').update(updateData).eq('id', deploymentId);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Deployment job ${job.id} completed.`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: { message: string }) {
    this.logger.error(`Deployment job ${job.id} failed: ${err?.message}`);
  }
}
