import { Module } from '@nestjs/common';
import { DeploymentsController } from './deployments.controller';
import { DeploymentsService } from './deployments.service';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [DeploymentsController],
  providers: [DeploymentsService]
})
export class DeploymentsModule {}
