import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Message } from '../../entities/message.entity';
import { Contact } from '../../entities/contact.entity';
import { CampaignContact } from '../../entities/campaign-contact.entity';
import { Campaign } from '../../entities/campaign.entity';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, Contact, CampaignContact, Campaign]),
    BullModule.registerQueue({ name: 'ai-analysis' }),
    BullModule.registerQueue({ name: 'webhook-process' }),
    // Inbound lead creation and auto-reply live in AiModule so the webhook path and the
    // analysis worker apply identical rules. AiModule does not depend back on this
    // module, so there is no circular reference.
    AiModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
