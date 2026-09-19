import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Campaign } from '../../entities/campaign.entity';
import { CampaignContact } from '../../entities/campaign-contact.entity';
import { Contact } from '../../entities/contact.entity';
import { Message } from '../../entities/message.entity';
import { MessageTemplate } from '../../entities/message-template.entity';
import { FollowupJob } from '../../entities/followup-job.entity';
import { Lead } from '../../entities/lead.entity';
import { AiAnalysis } from '../../entities/ai-analysis.entity';
import { SendDistributorService } from './send-distributor.service';
import { MessageSendProcessor } from './message-send.processor';
import { FollowupSchedulerService } from './followup-scheduler.service';
import { AiAnalysisProcessor } from './ai-analysis.processor';
import { WebhookProcessor } from './webhook.processor';
import { SequenceService } from './sequence.service';
import { CampaignSchedulerService } from './campaign-scheduler.service';
import { EngineController } from './engine.controller';
import { OpenwaModule } from '../openwa/openwa.module';
import { AiModule } from '../ai/ai.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Campaign,
      CampaignContact,
      Contact,
      Message,
      MessageTemplate,
      FollowupJob,
      Lead,
      AiAnalysis,
    ]),
    BullModule.registerQueue(
      { name: 'message-send' },
      { name: 'ai-analysis' },
      { name: 'webhook-process' },
    ),
    OpenwaModule,
    AiModule,
    WebhooksModule,
  ],
  providers: [
    SendDistributorService,
    MessageSendProcessor,
    FollowupSchedulerService,
    AiAnalysisProcessor,
    WebhookProcessor,
    SequenceService,
    CampaignSchedulerService,
  ],
  controllers: [EngineController],
  exports: [SendDistributorService, FollowupSchedulerService, SequenceService],
})
export class EngineModule {}
