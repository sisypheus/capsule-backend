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

  async create(user: User, imageName: string): Promise<any> {
    const { count, error: countError } = await this.db
      .from('deployments')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .in('status', ['active', 'provisioning']);

    console.log('ere');
    if (countError || count === null) {
      throw countError!;
    }
    if (count >= 2) {
      throw new ForbiddenException(
        'Deployment limit reached (2 active deployments).'
      );
    }

    console.log('ere');
    const {
      data,
      error
    }: { data: Tables<'deployments'> | null; error: PostgrestError | null } =
      await this.db
        .from('deployments')
        .insert({
          user_id: user.id,
          image_name: imageName,
          status: 'provisioning'
        })
        .select()
        .single();

    console.log(error);
    console.log(data);
    if (error || !data) {
      throw NotFoundException;
    }

    try {
      const { ingressUrl, namespace } =
        await this.kubernetesService.deployApplication(imageName);

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

  async findForUser(user: User): Promise<any> {
    const { data, error } = await this.db
      .from('deployments')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }
}
