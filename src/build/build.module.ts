import { Module } from '@nestjs/common';
import { BuildService } from './build.service';
import { BuildProcessor } from './build.processor';
import { GithubModule } from 'src/github/github.module';
import { KubernetesModule } from 'src/kubernetes/kubernetes.module';
import { QueueModule } from 'src/queue/queue.module';
import { LogsModule } from 'src/logs/logs.module';

@Module({
  imports: [QueueModule, GithubModule, KubernetesModule, LogsModule],
  providers: [BuildService, BuildProcessor],
  exports: [BuildService]
})
export class BuildModule {}
