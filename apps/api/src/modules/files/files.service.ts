import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { AppError } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { StorageService } from '@/infra/storage/storage.service';
import { RedisService } from '@/infra/redis/redis.service';

const MAX_UPLOADS_PER_MINUTE = 5;
const MAX_LONG_SIDE = 1600;
const JPEG_QUALITY = 80;

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async uploadReceiptPhoto(cardId: string, buffer: Buffer): Promise<{ photoId: string }> {
    await this.enforceRateLimit(cardId);

    // sharp strips all metadata (including GPS EXIF) by default unless .withMetadata() is called.
    const processed = await sharp(buffer)
      .rotate()
      .resize({ width: MAX_LONG_SIDE, height: MAX_LONG_SIDE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer({ resolveWithObject: true });

    const now = new Date();
    const key = `photos/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.jpg`;
    await this.storage.write(key, processed.data);

    const retentionDays = this.config.get<number>('PHOTOS_RETENTION_DAYS', 365);
    const deleteAfter = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);

    const photo = await this.prisma.receiptPhoto.create({
      data: {
        cardId,
        storageKey: key,
        width: processed.info.width,
        height: processed.info.height,
        sizeBytes: processed.info.size,
        deleteAfter,
      },
    });

    return { photoId: photo.id };
  }

  async getSignedUrl(photoId: string, ttlSeconds: number): Promise<{ storageKey: string; token: string; expiresAt: number }> {
    const photo = await this.prisma.receiptPhoto.findUnique({ where: { id: photoId } });
    if (!photo) throw new AppError('NOT_FOUND');
    const { token, expiresAt } = this.storage.signKey(photo.storageKey, ttlSeconds);
    return { storageKey: photo.storageKey, token, expiresAt };
  }

  async readSignedPhoto(storageKey: string, expiresAt: number, token: string): Promise<Buffer> {
    if (!this.storage.verifySignedKey(storageKey, expiresAt, token)) {
      throw new AppError('AUTH_FORBIDDEN', { reason: 'invalid_signature' });
    }
    return this.storage.read(storageKey);
  }

  private async enforceRateLimit(cardId: string): Promise<void> {
    const count = await this.redis.safeIncr(`upload_rl:${cardId}`, 60);
    if (count !== null && count > MAX_UPLOADS_PER_MINUTE) {
      throw new AppError('RATE_LIMITED');
    }
  }
}
