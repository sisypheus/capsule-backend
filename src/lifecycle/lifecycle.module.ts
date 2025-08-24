import { Module } from '@nestjs/common';
import { LifecycleService } from './lifecycle.service';
import { ConfigModule } from '@nestjs/config';
import { KubernetesModule } from 'src/kubernetes/kubernetes.module';
import { SupabaseModule } from 'src/supabase/supabase.module';

@Module({
  imports: [SupabaseModule, KubernetesModule, ConfigModule],
  providers: [LifecycleService]
})
export class LifecycleModule {}
