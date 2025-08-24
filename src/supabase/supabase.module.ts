import { Global, Module } from '@nestjs/common';
import { Supabase } from './supabase.service';
import { ConfigModule } from '@nestjs/config';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [Supabase],
  exports: [Supabase]
})
export class SupabaseModule {}
