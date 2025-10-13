import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(AuthGuard)
  @Get('me')
  async me(@Req() req: Request) {
    return this.authService.me(req);
  }

  @Get('github/login')
  async githubLogin(@Res() res: Response) {
    return this.authService.githubLogin(res);
  }

  @Get('github/callback')
  async githubCallback(@Query('code') code: string, @Res() res: Response) {
    return this.authService.githubCallback(code, res);
  }

  @Get('logout')
  async logout(@Res() res: Response) {
    return this.authService.logout(res);
  }
}
