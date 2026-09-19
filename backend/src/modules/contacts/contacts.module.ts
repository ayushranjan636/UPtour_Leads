import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contact } from '../../entities/contact.entity';
import { Company } from '../../entities/company.entity';
import { CampaignContact } from '../../entities/campaign-contact.entity';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { OpenwaModule } from '../openwa/openwa.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contact, Company, CampaignContact]),
    OpenwaModule,
  ],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
