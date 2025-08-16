import { ForbiddenException, Injectable } from '@nestjs/common';
import { User } from '@supabase/supabase-js';
import { AuthService } from 'src/auth/auth.service';

@Injectable()
export class DeploymentsService {
  constructor(private readonly authService: AuthService) {}

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

    const { data, error } = await supabase
      .from('deployments')
      .insert({
        user_id: user.id,
        image_name: imageName,
        status: 'provisioning'
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
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
