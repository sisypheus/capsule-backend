import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  Res,
  UseGuards
} from '@nestjs/common';
import { User } from '@supabase/supabase-js';
import { GithubService } from './github.service';
import { AuthGuard } from 'src/auth/auth.guard';
import { StateService } from 'src/state/state.service';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';

@Controller('github')
export class GithubController {
  constructor(
    private readonly githubService: GithubService,
    private readonly stateService: StateService,
    private readonly configService: ConfigService
  ) {}

  @UseGuards(AuthGuard)
  @Get('/repos')
  findAll(
    @Req() req: Request,
    @Query('search') search: string,
    @Query('page') page: number,
    @Query('per_page') per_page: number
  ) {
    const user = req['user'] as User;

    return this.githubService.getRepositoriesForUser(
      user.id,
      page,
      per_page,
      search
    );
  }

  @Get('install')
  @UseGuards(AuthGuard)
  install(@Req() req, @Res() res: Response) {
    const userId = req.user.id;

    const state = this.stateService.generateState(userId);

    const appName = process.env.GITHUB_APP_NAME;
    const installUrl = `https://github.com/apps/${appName}/installations/new?state=${state}`;

    res.redirect(installUrl);
  }

  @Get('setup-callback')
  async setupCallback(
    @Query('installation_id') installationId: string,
    @Query('state') state: string,
    @Res() res: Response
  ) {
    if (!installationId || !state) {
      throw new ForbiddenException(
        'Missing installation_id or state parameter.'
      );
    }

    const userId = this.stateService.verifyStateAndGetUserId(state);
    if (!userId) {
      throw new ForbiddenException(
        'Invalid, expired, or reused state parameter. Please try installing the app again.'
      );
    }

    await this.githubService.linkInstallationToUser(
      userId,
      parseInt(installationId, 10)
    );

    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    res.redirect(`${frontendUrl}/dashboard`);
  }
}
