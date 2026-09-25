import { Module } from '@nestjs/common';
import { FilesService } from './files.service';
import { FilesController, PhotoServeController } from './files.controller';

@Module({
  controllers: [FilesController, PhotoServeController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
