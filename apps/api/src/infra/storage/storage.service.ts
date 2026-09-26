import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Local-disk object storage. Every AGNKS-* app in this workspace runs on the
 * operator's own server (Q1: no external cloud dependency), so this is a
 * thin, swappable wrapper — replacing it with a MinIO/S3 client later only
 * touches this file.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly root: string;
  private readonly signingSecret: string;

  constructor(private readonly config: ConfigService) {
    this.root = resolve(this.config.get<string>('STORAGE_ROOT', './storage'));
    this.signingSecret = this.config.get<string>('JWT_ACCESS_SECRET', 'dev-secret');
  }

  async write(key: string, data: Buffer): Promise<void> {
    const fullPath = join(this.root, key);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, data);
  }

  async read(key: string): Promise<Buffer> {
    return readFile(join(this.root, key));
  }

  async delete(key: string): Promise<void> {
    try {
      await rm(join(this.root, key), { force: true });
    } catch (err) {
      this.logger.warn(`Failed to delete ${key}: ${(err as Error).message}`);
    }
  }

  /** Signed, time-limited reference — never a public URL (photos are private). */
  signKey(key: string, ttlSeconds: number): { token: string; expiresAt: number } {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const token = createHmac('sha256', this.signingSecret).update(`${key}:${expiresAt}`).digest('hex');
    return { token, expiresAt };
  }

  verifySignedKey(key: string, expiresAt: number, token: string): boolean {
    if (Date.now() / 1000 > expiresAt) return false;
    const expected = createHmac('sha256', this.signingSecret).update(`${key}:${expiresAt}`).digest('hex');
    return expected === token;
  }
}
