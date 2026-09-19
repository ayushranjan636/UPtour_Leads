import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { ImportFile } from '../../entities/import-file.entity';
import { Contact } from '../../entities/contact.entity';
import { Company } from '../../entities/company.entity';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { ImportsProcessor } from './imports.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([ImportFile, Contact, Company]),
    BullModule.registerQueue({ name: 'import-process' }),
  ],
  controllers: [ImportsController],
  providers: [ImportsService, ImportsProcessor],
  exports: [ImportsService],
})
export class ImportsModule {}
