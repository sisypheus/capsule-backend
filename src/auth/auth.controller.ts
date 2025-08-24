import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards
} from '@nestjs/common';
import type { Response } from 'express';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { Supabase } from 'src/supabase/supabase.service';
import { AuthGuard } from './auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly db: Supabase
  ) {}

  @UseGuards(AuthGuard)
  @Get('me')
  async getMe(@Req() req: Request) {
    const at = req.cookies['access_token'];

    if (!at) {
      throw new UnauthorizedException();
    }

    const {
      data: { user }
    } = await this.db.auth.getUser(at);
    return user;
  }

  @Get('github/login')
  async githubLogin(@Res() res: Response) {
    const { data, error } = await this.db.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: 'http://localhost:3000/auth/github/callback' // Doit correspondre à la config Supabase
      }
    });

    if (error) {
      return res.status(500).send('Error logging in with GitHub');
    }

    res.redirect(data.url);
  }

  @Get('github/callback')
  async githubCallback(@Query('code') code: string, @Res() res: Response) {
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
}
