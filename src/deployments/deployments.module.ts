import { Module } from '@nestjs/common';
import { DeploymentsController } from './deployments.controller';
import { DeploymentsService } from './deployments.service';
import { KubernetesModule } from 'src/kubernetes/kubernetes.module';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { AuthModule } from 'src/auth/auth.module';
import { BuildModule } from 'src/build/build.module';
import { GithubModule } from 'src/github/github.module';
import { QueueModule } from 'src/queue/queue.module';
import { DeploymentsProcessor } from './deployments.processor';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    SupabaseModule,
    KubernetesModule,
    AuthModule,
    BuildModule,
    GithubModule,
    QueueModule,
    ConfigModule
  ],
  controllers: [DeploymentsController],
  providers: [DeploymentsService, DeploymentsProcessor]
})
export class DeploymentsModule {}
