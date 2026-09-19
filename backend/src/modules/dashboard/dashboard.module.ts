import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contact } from '../../entities/contact.entity';
import { Message } from '../../entities/message.entity';
import { Lead } from '../../entities/lead.entity';
import { Deal } from '../../entities/deal.entity';
import { Campaign } from '../../entities/campaign.entity';
import { CampaignContact } from '../../entities/campaign-contact.entity';
import { AiAnalysis } from '../../entities/ai-analysis.entity';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contact,
      Message,
      Lead,
      Deal,
      Campaign,
      CampaignContact,
      AiAnalysis,
    ]),
  ],
  providers: [DashboardService],
  controllers: [DashboardController],
})
export class DashboardModule {}
