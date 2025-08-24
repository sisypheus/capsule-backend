import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { SupabaseAuthClient } from '@supabase/supabase-js/dist/module/lib/SupabaseAuthClient';
import { Database } from 'database.types';

@Injectable()
export class Supabase implements OnModuleInit {
  private supabase: SupabaseClient;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>(
      'SUPABASE_SERVICE_ROLE_KEY'
    );
    this.supabase = createClient<Database>(supabaseUrl!, supabaseKey!, {
      auth: {
        flowType: 'pkce'
      }
    });
  }

  get client(): SupabaseClient {
    return this.supabase;
  }

  get auth(): SupabaseAuthClient {
    return this.supabase.auth;
  }

  from(table: string) {
    return this.supabase.from(table);
  }
}
