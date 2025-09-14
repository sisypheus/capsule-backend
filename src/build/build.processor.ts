// src/builds/builds.processor.ts
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import { Supabase } from 'src/supabase/supabase.service';
import { Logger } from '@nestjs/common';
import { GithubService } from 'src/github/github.service';

const execPromise = promisify(exec);

@Processor('build-queue')
export class BuildProcessor extends WorkerHost {
  private readonly logger = new Logger(BuildProcessor.name);

  constructor(
    private readonly db: Supabase,
    private readonly githubAppService: GithubService
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { buildId, repo_name, branch, installation_id } = job.data;
    const cloneDir = `/tmp/build-${buildId}`;
    const registryUser = process.env.REGISTRY_USER;

    try {
      console.log(installation_id);
      // 1. Mettre à jour le statut -> 'building'
      await this.updateBuildStatus(buildId, 'building');

      // 2. Cloner le dépôt
      this.logger.log(`[${buildId}] Cloning repo ${repo_name}...`);
      console.log('clone');
      const octokit =
        await this.githubAppService.getInstallationOctokit(installation_id);
      const token = ((await octokit.auth({ type: 'installation' })) as any)
        .token;
      const cloneUrl = `https://x-access-token:${token}@github.com/${repo_name}.git`;
      await execPromise(
        `git clone --branch ${branch} --depth 1 ${cloneUrl} ${cloneDir}`
      );

      // 3. Construire l'image avec BuildKit
      this.logger.log(`[${buildId}] Building image...`);
      const commitSha = (
        await execPromise(`git -C ${cloneDir} rev-parse --short HEAD`)
      ).stdout.trim();
      const imageName = `${process.env.REGISTRY_URL}/${registryUser}/${repo_name.split('/')[1]}`;
      const imageTag = `${imageName}:${commitSha}`;

      // Authentification auprès du registre de conteneurs
      await execPromise(
        `echo "${process.env.REGISTRY_PASSWORD}" | docker login ${process.env.REGISTRY_URL} -u ${process.env.REGISTRY_USER} --password-stdin`
      );

      // Lancement du build
      await execPromise(
        `DOCKER_BUILDKIT=1 docker build -t ${imageTag} ${cloneDir}`
      );

      // 4. Pousser l'image vers le registre
      this.logger.log(`[${buildId}] Pushing image ${imageTag}...`);
      await execPromise(`docker push ${imageTag}`);

      // 5. Mettre à jour le statut -> 'success'
      await this.updateBuildStatus(buildId, 'success', imageTag);
      this.logger.log(`[${buildId}] Build successful.`);
    } catch (error) {
      this.logger.error(`[${buildId}] Build failed:`, error);
      await this.updateBuildStatus(
        buildId,
        'failed',
        '',
        error.stderr || error.message
      );
      throw error; // Important pour que BullMQ marque la tâche comme échouée
    } finally {
      // 6. Nettoyer
      this.logger.log(`[${buildId}] Cleaning up directory ${cloneDir}...`);
      await fs.rm(cloneDir, { recursive: true, force: true });
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
