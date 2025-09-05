import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { DeploymentsModule } from './deployments/deployments.module';
import { KubernetesModule } from './kubernetes/kubernetes.module';
import { ScheduleModule } from '@nestjs/schedule';
import { LifecycleModule } from './lifecycle/lifecycle.module';
import { SupabaseModule } from './supabase/supabase.module';
import { CryptoModule } from './crypto/crypto.module';
import { GithubModule } from './github/github.module';
import { StateModule } from './state/state.module';

@Module({
  imports: [
    AppModule,
    AuthModule,
    ConfigModule.forRoot(),
    ScheduleModule.forRoot(),
    DeploymentsModule,
    KubernetesModule,
    LifecycleModule,
    SupabaseModule,
    CryptoModule,
    GithubModule,
    StateModule
  ],
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule {}
