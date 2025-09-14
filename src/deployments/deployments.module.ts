import { Module } from '@nestjs/common';
import { DeploymentsController } from './deployments.controller';
import { DeploymentsService } from './deployments.service';
import { KubernetesModule } from 'src/kubernetes/kubernetes.module';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { AuthModule } from 'src/auth/auth.module';
import { BuildModule } from 'src/build/build.module';

@Module({
  imports: [SupabaseModule, KubernetesModule, AuthModule, BuildModule],
  controllers: [DeploymentsController],
  providers: [DeploymentsService]
})
export class DeploymentsModule {}
