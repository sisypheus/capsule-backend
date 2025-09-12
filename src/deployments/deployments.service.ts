import { CreateDeploymentDto } from './dto/create-deployment.dto';
import { Tables } from 'database.types';
import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import { PostgrestError, User } from '@supabase/supabase-js';
import { KubernetesService } from 'src/kubernetes/kubernetes.service';
import { Supabase } from 'src/supabase/supabase.service';

@Injectable()
export class DeploymentsService {
  constructor(
    private readonly db: Supabase,
    private readonly kubernetesService: KubernetesService
  ) {}

  async create(user: User, deploymentDto: CreateDeploymentDto): Promise<any> {
    const { count, error: countError } = await this.db
      .from('deployments')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .in('status', ['active', 'provisioning']);

    if (countError || count === null) {
      throw countError!;
    }
    if (count >= 2) {
      throw new ForbiddenException(
        'Deployment limit reached (2 active deployments).'
      );
    }

    const {
      data,
      error
    }: { data: Tables<'deployments'> | null; error: PostgrestError | null } =
      await this.db
        .from('deployments')
        .insert({
          user_id: user.id,
          status: 'provisioning',
          branch: deploymentDto.branch,
          project: deploymentDto.project,
          project_name: deploymentDto.project_name,
          dockerfile_path: deploymentDto.dockerfile_path
        })
        .select()
        .single();

    if (error || !data) {
      console.log(data);
      console.log(error);
      throw NotFoundException;
    }

    try {
      const namespace = 'random';
      const ingressUrl = 'random';
      // const { ingressUrl, namespace } =
      // await this.kubernetesService.deployApplication();

      return await this.db
        .from('deployments')
        .update({
          url: ingressUrl,
          status: 'active',
          namespace
        })
        .eq('id', data.id)
        .select();
    } catch (error) {
      await this.db
        .from('deployments')
        .update({
          status: 'failed'
        })
        .eq('id', data.id)
        .select();
      throw new InternalServerErrorException(`Échec du déploiement : ${error}`);
    }
  }

  async findForUser(user: User, page = 1, perPage = 10): Promise<any> {
    page = Math.max(1, Number(page) || 1);
    perPage = Math.min(Math.max(Number(perPage) || 10, 1), 100);

    const from = (page - 1) * perPage;
    const to = from + perPage - 1;

    const { data, error } = await this.db
      .from('deployments')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    return data;
  }
}
