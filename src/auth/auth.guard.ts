import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { Supabase } from 'src/supabase/supabase.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly db: Supabase
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    const access_token = request.cookies['access_token'];

    if (!access_token) {
      throw new UnauthorizedException('No access token found');
    }

    try {
      const {
        data: { user },
        error
      } = await this.db.auth.getUser(access_token);

      if (error || !user) {
        throw new UnauthorizedException('Invalid or expired token');
      }

      request['user'] = user;
    } catch (error) {
      throw new UnauthorizedException(
        error?.message || 'Authentication failed'
      );
    }

    return true;
  }
}
