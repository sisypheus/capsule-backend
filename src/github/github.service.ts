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

  async getInstallationID(userId: string): Promise<any> {
    const data = (await this.db.from('profiles').select('*').eq('id', userId))
      .data![0];
    return data!.github_installation_id!;
  }

  async getRepositoriesForUser(
    userId: string,
    page = 1,
    perPage = 30,
    search = ''
  ) {
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

    if (search === '') {
      const { data: repos } =
        await octokit.apps.listReposAccessibleToInstallation({
          per_page: perPage,
          page
        });

      return this.transformRepoData(repos.repositories || []);
    } else {
      const { data: installation } = await octokit.apps.getInstallation({
        installation_id: profile.github_installation_id
      });
      const owner = installation.account?.name;

      const query = `${search} user:${owner} org:${owner}`;

      const { data: searchResult } = await octokit.search.repos({
        q: query,
        per_page: perPage,
        page
      });

      return this.transformRepoData(searchResult.items || []);
    }
  }

  private transformRepoData(repos: any[]): any[] {
    return repos.map((repo: any) => ({
      id: repo.id,
      description: repo.description,
      updated_at: repo.updated_at,
      icon: repo.owner?.avatar_url,
      name: repo.name,
      fullName: repo.full_name,
      private: repo.private
    }));
  }
}
