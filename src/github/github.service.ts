// src/github-app/github-app.service.ts
import {
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { Supabase } from 'src/supabase/supabase.service';

@Injectable()
export class GithubService {
  private appAuth: ReturnType<typeof createAppAuth>;

  constructor(
    private readonly configService: ConfigService,
    private readonly db: Supabase
  ) {
    const appId = this.configService.get<string>('GITHUB_APP_ID');
    const privateKey = this.configService.get<string>('GITHUB_PRIVATE_KEY');
    const clientId = this.configService.get<string>('GITHUB_CLIENT_ID');

    if (!appId || !privateKey || !clientId) {
      throw new InternalServerErrorException(
        'GitHub App configuration is missing.'
      );
    }

    this.appAuth = createAppAuth({ appId, privateKey, clientId });
  }

  async getInstallationOctokit(installationId: number): Promise<Octokit> {
    if (!installationId) {
      throw new Error('Installation ID is required.');
    }

    const installationAuthentication = await this.appAuth({
      type: 'installation',
      installationId
    });

    return new Octokit({ auth: installationAuthentication.token });
  }

  async linkInstallationToUser(userId: string, installationId: number) {
    return this.db.from('profiles').upsert({
      id: userId,
      github_installation_id: installationId
    });
  }

  async getRepositoriesForUser(userId: string, page = 1, perPage = 30) {
    page = Number(page) || 1;
    perPage = Number(perPage) || 30;

    const { data: profile } = await this.db
      .from('profiles')
      .select('github_installation_id')
      .eq('id', userId)
      .single();

    if (!profile || !profile.github_installation_id) {
      throw new NotFoundException(
        "Aucune installation GitHub n'est liée à cet utilisateur."
      );
    }

    const num = profile.github_installation_id;
    const octokit = await this.getInstallationOctokit(num);

    const { data: repos } =
      await octokit.apps.listReposAccessibleToInstallation({
        per_page: perPage,
        page
      });

    return (repos.repositories || []).map((repo) => ({
      id: repo.id,
      description: repo.description,
      updated_at: repo.updated_at,
      icon: repo.owner.avatar_url,
      name: repo.name,
      fullName: repo.full_name,
      private: repo.private
    }));
  }
}
