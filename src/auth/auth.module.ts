import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConfigModule } from '@nestjs/config';
import { AuthGuard } from './auth.guard';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { CryptoModule } from 'src/crypto/crypto.module';

@Module({
  imports: [ConfigModule, SupabaseModule, CryptoModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
  exports: [AuthGuard, AuthService]
})
export class AuthModule {}
