import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Message } from '../../entities/message.entity';
import { Contact } from '../../entities/contact.entity';
import { Campaign } from '../../entities/campaign.entity';
import { CampaignContact } from '../../entities/campaign-contact.entity';
import { Lead } from '../../entities/lead.entity';
import { Deal } from '../../entities/deal.entity';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { InboundAiService } from './inbound-ai.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Message, Contact, Campaign, CampaignContact, Lead, Deal]),
    // Producer only. AI replies are handed to the same queue the campaign sender uses so
    // they inherit its humanised pacing instead of going straight to the gateway.
    BullModule.registerQueue({ name: 'message-send' }),
  ],
  controllers: [AiController],
  providers: [AiService, InboundAiService],
  exports: [AiService, InboundAiService],
})
export class AiModule {}
