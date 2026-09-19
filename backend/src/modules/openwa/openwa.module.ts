import { Module } from '@nestjs/common';
import { OpenwaController } from './openwa.controller';
import { OpenwaService } from './openwa.service';

@Module({
  controllers: [OpenwaController],
  providers: [OpenwaService],
  exports: [OpenwaService],
})
export class OpenwaModule {}
