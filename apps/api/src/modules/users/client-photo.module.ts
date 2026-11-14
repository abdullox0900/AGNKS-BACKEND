import { Module } from '@nestjs/common';
import { ClientPhotoController } from './client-photo.controller';
import { ClientPhotoService } from './client-photo.service';

/** Clients' Telegram pictures (signed URLs + the proxy), shared by the clients list, the review queue… */
@Module({
  controllers: [ClientPhotoController],
  providers: [ClientPhotoService],
  exports: [ClientPhotoService],
})
export class ClientPhotoModule {}
