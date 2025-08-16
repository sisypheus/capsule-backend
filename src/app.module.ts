import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { DeploymentsModule } from './deployments/deployments.module';

@Module({
  imports: [AppModule, AuthModule, ConfigModule.forRoot(), DeploymentsModule],
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule {}
