import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { Supabase } from 'src/supabase/supabase.service';
import type { Response, Request } from 'express';
import { CryptoService } from 'src/crypto/crypto.service';

@Injectable()
export class AuthService {
  private supabase: SupabaseClient;

  constructor(
    private readonly configService: ConfigService,
    private readonly db: Supabase,
    private readonly cryptoService: CryptoService
  ) {}

  async me(req: Request) {
    const at = req.cookies['access_token'];

    if (!at) {
      throw new UnauthorizedException();
    }
    const {
      data: { user }
    } = await this.db.auth.getUser(at);
    return user;
  }

  async githubLogin(res: Response) {
    const { data, error } = await this.db.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: process.env.GITHUB_CALLBACK
      }
    });

    if (error) {
      return res.status(500).send('Error logging in with GitHub');
    }

    res.redirect(data.url);
  }

  async githubCallback(code: string, res: Response) {
    if (!code) {
      return res.status(400).send('No code provided');
    }

    const { data, error } = await this.db.auth.exchangeCodeForSession(code);

    if (error) {
      return res.status(500).send('Error exchanging code for session');
    }

    res.cookie('access_token', data.session.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV !== 'development',
      sameSite: 'lax',
      path: '/'
    });
    res.cookie('refresh_token', data.session.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV !== 'development',
      sameSite: 'lax',
      path: '/'
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    res.redirect(`${frontendUrl}/dashboard`);
  }

  githubAppLogin(res: Response) {
    const appName = 'capsule-paas';
    const installUrl = `https://github.com/apps/${appName}/installations/new`;
    res.redirect(installUrl);
  }

  async githubAppCallback(
    installationId: number,
    setupAction: string,
    res: Response,
    req: Request
  ) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    const at: string = req.cookies['access_token'];

    const {
      data: { user }
    } = await this.db.auth.getUser(at);

    if (!user) throw new UnauthorizedException('User not logged in');

    this.db
      .from('profile')
      .insert({
        id: user.id,
        github_installation_id: installationId
      })
      .select()
      .single();

    res.redirect(`${frontendUrl}/dashboard`);
  }
}
