import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    const access_token = request.cookies['access_token'];

    if (!access_token) {
      throw new UnauthorizedException('No access token found');
    }

    try {
      const supabase = this.authService.getSupabaseClient();
      const {
        data: { user },
        error
      } = await supabase.auth.getUser(access_token);

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
