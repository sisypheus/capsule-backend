// src/crypto/crypto.service.ts
import {
  Injectable,
  InternalServerErrorException,
  Logger
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly key: Buffer;
  private readonly algorithm = 'aes-256-gcm';
  private readonly ivLength = 12;
  private readonly authTagLength = 16;

  constructor(private readonly configService: ConfigService) {
    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY');
    if (!encryptionKey || encryptionKey.length !== 64) {
      this.logger.error(
        'La clé de chiffrement (ENCRYPTION_KEY) est manquante ou invalide. Elle doit faire 64 caractères hexadécimaux.'
      );
      throw new InternalServerErrorException(
        'Configuration de chiffrement invalide.'
      );
    }
    this.key = Buffer.from(encryptionKey, 'hex');
  }

  encrypt(text: string): string {
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, encrypted, authTag]).toString('hex');
  }

  decrypt(encryptedText: string): string {
    try {
      const data = Buffer.from(encryptedText, 'hex');
      const iv = data.slice(0, this.ivLength);
      const encrypted = data.slice(
        this.ivLength,
        data.length - this.authTagLength
      );
      const authTag = data.slice(data.length - this.authTagLength);

      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]);
      return decrypted.toString('utf8');
    } catch (error) {
      this.logger.error('Échec du déchiffrement', error.message);
      throw new InternalServerErrorException(
        'Impossible de déchiffrer les données.'
      );
    }
  }
}
