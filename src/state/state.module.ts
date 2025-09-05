import { Module } from '@nestjs/common';
import { StateService } from './state.service';

@Module({
  exports: [StateService],
  providers: [StateService]
})
export class StateModule {}
