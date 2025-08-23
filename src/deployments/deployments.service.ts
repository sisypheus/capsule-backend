import { Tables } from 'database.types';
import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import { PostgrestError, User } from '@supabase/supabase-js';
import { AuthService } from 'src/auth/auth.service';
import { KubernetesService } from 'src/kubernetes/kubernetes.service';

@Injectable()
export class DeploymentsService {
  constructor(
    private readonly authService: AuthService,
    private readonly kubernetesService: KubernetesService
  ) {}

  async create(user: User, imageName: string): Promise<any> {
    const supabase = this.authService.getSupabaseClient();

    const { count, error: countError } = await supabase
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
      await supabase
        .from('deployments')
        .insert({
          user_id: user.id,
          image_name: imageName,
          status: 'provisioning'
        })
        .select()
        .single();

    if (error || !data) {
      throw NotFoundException;
    }

    try {
      const { ingressUrl } =
        await this.kubernetesService.deployApplication(imageName);

      return await supabase
        .from('deployments')
        .update({
          url: ingressUrl,
          status: 'active'
        })
        .eq('id', data.id)
        .select();
    } catch (error) {
      await supabase
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
    const supabase = this.authService.getSupabaseClient();
    const { data, error } = await supabase
      .from('deployments')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }
}
