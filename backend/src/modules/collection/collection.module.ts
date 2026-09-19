import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CollectionJob } from '../../entities/collection-job.entity';
import { CollectionResult } from '../../entities/collection-result.entity';
import { Contact } from '../../entities/contact.entity';
import { Company } from '../../entities/company.entity';
import { CampaignContact } from '../../entities/campaign-contact.entity';
import { CollectionService } from './collection.service';
import { CollectionRunnerService } from './collection-runner.service';
import { GooglePlacesProvider } from './google-places.provider';
import { CollectionController } from './collection.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CollectionJob,
      CollectionResult,
      Contact,
      Company,
      CampaignContact,
    ]),
  ],
  providers: [CollectionService, CollectionRunnerService, GooglePlacesProvider],
  controllers: [CollectionController],
  exports: [CollectionService],
})
export class CollectionModule {}
