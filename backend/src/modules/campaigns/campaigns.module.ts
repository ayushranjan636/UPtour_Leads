import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campaign } from '../../entities/campaign.entity';
import { CampaignContact } from '../../entities/campaign-contact.entity';
import { Contact } from '../../entities/contact.entity';
import { MessageTemplate } from '../../entities/message-template.entity';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { ContactsModule } from '../contacts/contacts.module';
import { WhatsappCloudModule } from '../whatsapp-cloud/whatsapp-cloud.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Campaign, CampaignContact, Contact, MessageTemplate]),
    // Audience-by-filter reuses the contacts filter logic so a previewed count and
    // the enrolled set can never diverge.
    ContactsModule,
    // Activation checks that each opening step has an approved Meta template.
    WhatsappCloudModule,
  ],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
