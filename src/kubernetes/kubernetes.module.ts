import { Module } from '@nestjs/common';
import { KubernetesService } from './kubernetes.service';
import { LogsModule } from 'src/logs/logs.module';

@Module({
  providers: [KubernetesService],
  exports: [KubernetesService],
  imports: [LogsModule]
})
export class KubernetesModule {}
