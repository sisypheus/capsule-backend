import { Module } from '@nestjs/common';
import { DeploymentsController } from './deployments.controller';
import { DeploymentsService } from './deployments.service';
import { KubernetesModule } from 'src/kubernetes/kubernetes.module';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [SupabaseModule, KubernetesModule, AuthModule],
  controllers: [DeploymentsController],
  providers: [DeploymentsService]
})
export class DeploymentsModule {}
