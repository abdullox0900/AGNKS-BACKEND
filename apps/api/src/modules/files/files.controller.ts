import {
  Controller,
  Get,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AppError } from '@agnks/types';
import { ClientAuthGuard } from '@/common/guards/client-auth.guard';
import { CurrentClient } from '@/common/decorators/current-actor.decorator';
import type { ClientActor } from '@/common/types/actor';
import { FilesService } from './files.service';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

@Controller('me/receipts')
@UseGuards(ClientAuthGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('photo')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @CurrentClient() actor: ClientActor) {
    if (!file) throw new AppError('VALIDATION_ERROR', { message: 'image file is required' });
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new AppError('VALIDATION_ERROR', { message: 'unsupported image type' });
    }
    return this.files.uploadReceiptPhoto(actor.cardId, file.buffer);
  }
}

@Controller('files/photos')
export class PhotoServeController {
  constructor(private readonly files: FilesService) {}

  @Get('view')
  async view(
    @Query('key') key: string,
    @Query('expiresAt') expiresAt: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    const buffer = await this.files.readSignedPhoto(key, Number(expiresAt), token);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(buffer);
  }
}
