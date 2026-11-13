import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ClientPhotoService } from './client-photo.service';

/** Public but signed: the dashboard puts this URL straight into <img src>, which cannot send a bearer token. */
@Controller('client-photo')
@SkipThrottle()
export class ClientPhotoController {
  constructor(private readonly photos: ClientPhotoService) {}

  @Get(':id')
  async get(@Param('id') id: string, @Query('e') e: string | undefined, @Query('s') s: string | undefined, @Res() res: Response) {
    if (!this.photos.verify(id, e, s)) throw new NotFoundException();
    const buf = await this.photos.photo(id);
    if (!buf) throw new NotFoundException();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.end(buf);
  }
}
