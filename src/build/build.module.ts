import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BuildService } from './build.service';
import { BuildProcessor } from './build.processor';
import { GithubModule } from 'src/github/github.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'build-queue'
    }),
    GithubModule
  ],
  providers: [BuildService, BuildProcessor],
  exports: [BuildService]
})
export class BuildModule {}
