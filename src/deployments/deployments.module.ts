import { Module } from '@nestjs/common';
import { DeploymentsController } from './deployments.controller';
import { DeploymentsService } from './deployments.service';
import { AuthModule } from 'src/auth/auth.module';
import { KubernetesModule } from 'src/kubernetes/kubernetes.module';

@Module({
  imports: [AuthModule, KubernetesModule],
  controllers: [DeploymentsController],
  providers: [DeploymentsService]
})
export class DeploymentsModule {}
