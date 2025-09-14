import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Supabase } from 'src/supabase/supabase.service';
import { GithubService } from 'src/github/github.service';
// ... import de Supabase et GithubService

@Injectable()
export class BuildService {
  constructor(
    @InjectQueue('build-queue') private readonly buildQueue: Queue,
    private readonly db: Supabase,
    private readonly githubService: GithubService
  ) {}

  async createBuildJob(
    userId: string,
    repoFullName: string,
    branch: string
  ): Promise<any> {
    // 1. Récupérer l'installationId pour cet utilisateur
    const installation_id = await this.githubService.getInstallationID(userId);

    // 2. Créer une entrée dans la table 'builds'
    const { data: build, error } = await this.db
      .from('builds')
      .insert({ status: 'queued', user_id: userId, repo_name: repoFullName })
      .select()
      .single();
    if (error) throw error;

    // 3. Ajouter la tâche à la file d'attente BullMQ
    await this.buildQueue.add('new-build', {
      id: build.id,
      repo_name: repoFullName,
      branch,
      installation_id
    });

    return build;
  }
}
