import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

export const BUILD_QUEUE_NAME = 'build-queue';
export const DEPLOY_QUEUE_NAME = 'deploy-queue';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: BUILD_QUEUE_NAME },
      { name: DEPLOY_QUEUE_NAME }
    )
  ],
  exports: [BullModule]
})
export class QueueModule {}
