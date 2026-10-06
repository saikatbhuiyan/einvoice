import { Module } from '@nestjs/common';
import { MediaRpcController } from './media-rpc.controller';
import { MediaService } from './media.service';
import { S3StorageProvider } from './s3-storage.provider';
import { STORAGE_PROVIDER } from './storage-provider.interface';

@Module({
  controllers: [MediaRpcController],
  providers: [MediaService, { provide: STORAGE_PROVIDER, useClass: S3StorageProvider }],
})
export class MediaModule {}
