// src/auth/auth.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class AuthService implements OnModuleInit {
  private supabase: SupabaseClient;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>(
      'SUPABASE_SERVICE_ROLE_KEY'
    );
    this.supabase = createClient(supabaseUrl!, supabaseKey!, {
      auth: {
        flowType: 'pkce'
      }
    });
  }

  getSupabaseClient(): SupabaseClient {
    return this.supabase;
  }
}
