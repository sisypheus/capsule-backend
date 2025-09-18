import { Module } from '@nestjs/common';
import { BuildService } from './build.service';
import { BuildProcessor } from './build.processor';
import { GithubModule } from 'src/github/github.module';
import { KubernetesModule } from 'src/kubernetes/kubernetes.module';
import { QueueModule } from 'src/queue/queue.module';

@Module({
  imports: [QueueModule, GithubModule, KubernetesModule],
  providers: [BuildService, BuildProcessor],
  exports: [BuildService]
})
export class BuildModule {}
