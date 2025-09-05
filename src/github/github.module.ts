import { Module } from '@nestjs/common';
import { GithubService } from './github.service';
import { ConfigModule } from '@nestjs/config';
import { GithubController } from './github.controller';
import { AuthModule } from 'src/auth/auth.module';
import { StateModule } from 'src/state/state.module';

@Module({
  imports: [ConfigModule, AuthModule, StateModule],
  providers: [GithubService],
  controllers: [GithubController]
})
export class GithubModule {}
