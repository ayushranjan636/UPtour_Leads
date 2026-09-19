import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from '../../entities/contact.entity';
import { Message, MessageDirection, MessageStatus } from '../../entities/message.entity';
import { Lead } from '../../entities/lead.entity';
import { Deal } from '../../entities/deal.entity';
import { Campaign, CampaignStatus } from '../../entities/campaign.entity';
import { CampaignContact } from '../../entities/campaign-contact.entity';
import { AiAnalysis } from '../../entities/ai-analysis.entity';

export interface DashboardOverview {
  totalContacts: number;
  validContacts: number;
  messagesSent: number;
  messagesDelivered: number;
  messagesRead: number;
  responses: number;
  totalLeads: number;
  totalDeals: number;
  activeCampaigns: number;
  conversionRate: number;
}

export interface CampaignStatsItem {
  id: string;
  name: string;
  status: string;
  stats_sent: number;
  stats_delivered: number;
  stats_read: number;
  stats_replied: number;
  stats_opted_out: number;
  stats_leads: number;
}

export interface PipelineItem {
  status: string;
  count: number;
}

export interface CampaignAnalytics {
  campaign: { id: string; name: string; status: string };
  funnel: {
    sent: number;
    delivered: number;
    read: number;
    replied: number;
    leads: number;
    deals: number;
  };
  daily_breakdown: {
    date: string;
    sent: number;
    delivered: number;
    replied: number;
    leads: number;
  }[];
  top_contacts: {
    contact_id: string;
    name: string;
    company: string;
    status: string;
    interest_level: string | null;
    lead_score: number | null;
  }[];
  ai_summary: {
    total_analyzed: number;
    intent_distribution: Record<string, number>;
    interest_distribution: Record<string, number>;
    avg_confidence: number;
    avg_lead_score: number;
  };
}

export interface ConversionFunnel {
  total_contacts: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  leads: number;
  deals: number;
  won_deals: number;
  conversion_rates: {
    sent_to_delivered: number;
    delivered_to_read: number;
    read_to_replied: number;
    replied_to_lead: number;
    lead_to_deal: number;
    deal_to_won: number;
    overall: number;
  };
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @InjectRepository(Contact)
    private readonly contactRepository: Repository<Contact>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,
    @InjectRepository(Deal)
    private readonly dealRepository: Repository<Deal>,
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(CampaignContact)
    private readonly campaignContactRepository: Repository<CampaignContact>,
    @InjectRepository(AiAnalysis)
    private readonly aiAnalysisRepository: Repository<AiAnalysis>,
  ) {}

  async getOverview(): Promise<DashboardOverview> {
    try {
      const totalContacts = await this.contactRepository.count();

      const validContacts = await this.contactRepository
        .createQueryBuilder('contact')
        .where('contact.whatsapp_verified = :verified OR contact.is_suppressed = :suppressed', {
          verified: true,
          suppressed: false,
        })
        .getCount();

      const messagesSent = await this.messageRepository.count({
        where: { direction: MessageDirection.OUTGOING },
      });

      const messagesDelivered = await this.messageRepository
        .createQueryBuilder('message')
        .where('message.direction = :direction', { direction: MessageDirection.OUTGOING })
        .andWhere('message.status IN (:...statuses)', {
          statuses: [MessageStatus.DELIVERED, MessageStatus.READ],
        })
        .getCount();

      const messagesRead = await this.messageRepository.count({
        where: {
          direction: MessageDirection.OUTGOING,
          status: MessageStatus.READ,
        },
      });

      const responses = await this.messageRepository.count({
        where: { direction: MessageDirection.INCOMING },
      });

      const totalLeads = await this.leadRepository.count();
      const totalDeals = await this.dealRepository.count();

      const activeCampaigns = await this.campaignRepository.count({
        where: { status: CampaignStatus.ACTIVE },
      });

      const conversionRate =
        totalContacts > 0
          ? Math.round((totalLeads / totalContacts) * 10000) / 100
          : 0;

      return {
        totalContacts,
        validContacts,
        messagesSent,
        messagesDelivered,
        messagesRead,
        responses,
        totalLeads,
        totalDeals,
        activeCampaigns,
        conversionRate,
      };
    } catch (error) {
      this.logger.error('Error fetching dashboard overview', error.stack);
      throw new InternalServerErrorException('Failed to fetch dashboard overview');
    }
  }

  async getCampaignStats(): Promise<CampaignStatsItem[]> {
    try {
      const campaigns = await this.campaignRepository.find({
        select: [
          'id',
          'name',
          'status',
          'stats_sent',
          'stats_delivered',
          'stats_read',
          'stats_replied',
          'stats_opted_out',
          'stats_leads',
        ],
        order: { created_at: 'DESC' },
      });

      return campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        stats_sent: c.stats_sent,
        stats_delivered: c.stats_delivered,
        stats_read: c.stats_read,
        stats_replied: c.stats_replied,
        stats_opted_out: c.stats_opted_out,
        stats_leads: c.stats_leads,
      }));
    } catch (error) {
      this.logger.error('Error fetching campaign stats', error.stack);
      throw new InternalServerErrorException('Failed to fetch campaign stats');
    }
  }

  async getPipeline(): Promise<PipelineItem[]> {
    try {
      const results = await this.leadRepository
        .createQueryBuilder('lead')
        .select('lead.status', 'status')
        .addSelect('COUNT(lead.id)', 'count')
        .groupBy('lead.status')
        .getRawMany();

      return results.map((r) => ({
        status: r.status,
        count: parseInt(r.count, 10),
      }));
    } catch (error) {
      this.logger.error('Error fetching pipeline data', error.stack);
      throw new InternalServerErrorException('Failed to fetch pipeline data');
    }
  }

  /**
   * Get detailed analytics for a specific campaign.
   * Returns: funnel data, daily breakdown, top contacts, AI analysis summary.
   */
  async getCampaignAnalytics(campaignId: string): Promise<CampaignAnalytics> {
    try {
      const campaign = await this.campaignRepository.findOne({ where: { id: campaignId } });
      if (!campaign) {
        return this.emptyCampaignAnalytics(campaignId);
      }

      // Funnel data
      const sent = campaign.stats_sent;
      const delivered = campaign.stats_delivered;
      const read = campaign.stats_read;
      const replied = campaign.stats_replied;
      const leadsCount = campaign.stats_leads;

      const dealsCount = await this.dealRepository
        .createQueryBuilder('deal')
        .innerJoin('deal.lead', 'lead')
        .where('lead.campaign_id = :campaignId', { campaignId })
        .getCount();

      // Daily breakdown (last 30 days)
      const dailyBreakdown = await this.campaignContactRepository
        .createQueryBuilder('cc')
        .select("TO_CHAR(cc.first_sent_at, 'YYYY-MM-DD')", 'date')
        .addSelect('COUNT(cc.id)', 'sent')
        .addSelect("SUM(CASE WHEN cc.status IN ('delivered','read','replied','human_takeover') THEN 1 ELSE 0 END)", 'delivered')
        .addSelect("SUM(CASE WHEN cc.status IN ('replied','human_takeover') THEN 1 ELSE 0 END)", 'replied')
        .where('cc.campaign_id = :campaignId', { campaignId })
        .andWhere('cc.first_sent_at IS NOT NULL')
        .andWhere("cc.first_sent_at >= NOW() - INTERVAL '30 days'")
        .groupBy("TO_CHAR(cc.first_sent_at, 'YYYY-MM-DD')")
        .orderBy('date', 'ASC')
        .getRawMany();

      const dailyLeads = await this.leadRepository
        .createQueryBuilder('lead')
        .select("TO_CHAR(lead.created_at, 'YYYY-MM-DD')", 'date')
        .addSelect('COUNT(lead.id)', 'leads')
        .where('lead.campaign_id = :campaignId', { campaignId })
        .andWhere("lead.created_at >= NOW() - INTERVAL '30 days'")
        .groupBy("TO_CHAR(lead.created_at, 'YYYY-MM-DD')")
        .getRawMany();

      const leadsMap = new Map(dailyLeads.map((r: any) => [r.date, parseInt(r.leads, 10)]));

      const daily = dailyBreakdown.map((r: any) => ({
        date: r.date,
        sent: parseInt(r.sent, 10) || 0,
        delivered: parseInt(r.delivered, 10) || 0,
        replied: parseInt(r.replied, 10) || 0,
        leads: leadsMap.get(r.date) || 0,
      }));

      // Top contacts
      const topContacts = await this.campaignContactRepository
        .createQueryBuilder('cc')
        .innerJoinAndSelect('cc.contact', 'contact')
        .leftJoin('contact.company', 'company')
        .addSelect('company.name')
        .where('cc.campaign_id = :campaignId', { campaignId })
        .andWhere("cc.status IN ('replied', 'human_takeover')")
        .orderBy('cc.last_reply_at', 'DESC')
        .take(20)
        .getMany();

      // Get AI analysis for top contacts
      const topContactAnalyses: CampaignAnalytics['top_contacts'] = [];
      for (const cc of topContacts) {
        const analysis = await this.aiAnalysisRepository.findOne({
          where: { campaign_contact_id: cc.id },
          order: { created_at: 'DESC' },
        });
        topContactAnalyses.push({
          contact_id: cc.contact_id,
          name: cc.contact?.name || 'Unknown',
          company: (cc.contact as any)?.company?.name || '',
          status: cc.status,
          interest_level: analysis?.interest_level || null,
          lead_score: analysis?.lead_score || null,
        });
      }

      // AI analysis summary
      const analyses = await this.aiAnalysisRepository.find({
        where: { campaign_contact_id: undefined }, // will use query builder
      });

      const aiStats = await this.aiAnalysisRepository
        .createQueryBuilder('a')
        .innerJoin('a.campaign_contact', 'cc')
        .where('cc.campaign_id = :campaignId', { campaignId })
        .select('COUNT(a.id)', 'total')
        .addSelect('AVG(a.confidence)', 'avgConfidence')
        .addSelect('AVG(a.lead_score)', 'avgLeadScore')
        .getRawOne();

      const intentDistribution = await this.aiAnalysisRepository
        .createQueryBuilder('a')
        .innerJoin('a.campaign_contact', 'cc')
        .where('cc.campaign_id = :campaignId', { campaignId })
        .select('a.intent', 'intent')
        .addSelect('COUNT(a.id)', 'count')
        .groupBy('a.intent')
        .getRawMany();

      const interestDistribution = await this.aiAnalysisRepository
        .createQueryBuilder('a')
        .innerJoin('a.campaign_contact', 'cc')
        .where('cc.campaign_id = :campaignId', { campaignId })
        .select('a.interest_level', 'interest_level')
        .addSelect('COUNT(a.id)', 'count')
        .groupBy('a.interest_level')
        .getRawMany();

      const intentMap: Record<string, number> = {};
      for (const r of intentDistribution) {
        intentMap[r.intent || 'unknown'] = parseInt(r.count, 10);
      }

      const interestMap: Record<string, number> = {};
      for (const r of interestDistribution) {
        interestMap[r.interest_level || 'unknown'] = parseInt(r.count, 10);
      }

      return {
        campaign: { id: campaign.id, name: campaign.name, status: campaign.status },
        funnel: {
          sent,
          delivered,
          read,
          replied,
          leads: leadsCount,
          deals: dealsCount,
        },
        daily_breakdown: daily,
        top_contacts: topContactAnalyses,
        ai_summary: {
          total_analyzed: parseInt(aiStats?.total || '0', 10),
          intent_distribution: intentMap,
          interest_distribution: interestMap,
          avg_confidence: parseFloat(aiStats?.avgConfidence || '0'),
          avg_lead_score: parseFloat(aiStats?.avgLeadScore || '0'),
        },
      };
    } catch (error) {
      this.logger.error(`Error fetching campaign analytics: ${error.message}`, error.stack);
      return this.emptyCampaignAnalytics(campaignId);
    }
  }

  /**
   * Get conversion funnel across all campaigns or a specific one.
   */
  async getConversionFunnel(campaignId?: string): Promise<ConversionFunnel> {
    try {
      const ccQb = this.campaignContactRepository.createQueryBuilder('cc');
      if (campaignId) {
        ccQb.where('cc.campaign_id = :campaignId', { campaignId });
      }

      const totalContacts = await ccQb.getCount();

      const statusCounts = await this.campaignContactRepository
        .createQueryBuilder('cc')
        .select('cc.status', 'status')
        .addSelect('COUNT(cc.id)', 'count')
        .where(campaignId ? 'cc.campaign_id = :campaignId' : '1=1', campaignId ? { campaignId } : {})
        .groupBy('cc.status')
        .getRawMany();

      const statusMap: Record<string, number> = {};
      for (const r of statusCounts) {
        statusMap[r.status] = parseInt(r.count, 10);
      }

      const sent = totalContacts - (statusMap['pending'] || 0);
      const delivered = (statusMap['delivered'] || 0) + (statusMap['read'] || 0) + (statusMap['replied'] || 0) + (statusMap['human_takeover'] || 0);
      const readCount = (statusMap['read'] || 0) + (statusMap['replied'] || 0) + (statusMap['human_takeover'] || 0);
      const replied = (statusMap['replied'] || 0) + (statusMap['human_takeover'] || 0);

      const leadQb = this.leadRepository.createQueryBuilder('lead');
      if (campaignId) leadQb.where('lead.campaign_id = :campaignId', { campaignId });
      const leads = await leadQb.getCount();

      const dealQb = this.dealRepository.createQueryBuilder('deal').innerJoin('deal.lead', 'lead');
      if (campaignId) dealQb.where('lead.campaign_id = :campaignId', { campaignId });
      const deals = await dealQb.getCount();

      const wonQb = this.dealRepository.createQueryBuilder('deal')
        .innerJoin('deal.lead', 'lead')
        .andWhere("deal.stage = 'won'");
      if (campaignId) wonQb.andWhere('lead.campaign_id = :campaignId', { campaignId });
      const wonDeals = await wonQb.getCount();

      const safeDiv = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 10000) / 100 : 0);

      return {
        total_contacts: totalContacts,
        sent,
        delivered,
        read: readCount,
        replied,
        leads,
        deals,
        won_deals: wonDeals,
        conversion_rates: {
          sent_to_delivered: safeDiv(delivered, sent),
          delivered_to_read: safeDiv(readCount, delivered),
          read_to_replied: safeDiv(replied, readCount),
          replied_to_lead: safeDiv(leads, replied),
          lead_to_deal: safeDiv(deals, leads),
          deal_to_won: safeDiv(wonDeals, deals),
          overall: safeDiv(wonDeals, totalContacts),
        },
      };
    } catch (error) {
      this.logger.error(`Error fetching conversion funnel: ${error.message}`, error.stack);
      return {
        total_contacts: 0, sent: 0, delivered: 0, read: 0, replied: 0,
        leads: 0, deals: 0, won_deals: 0,
        conversion_rates: {
          sent_to_delivered: 0, delivered_to_read: 0, read_to_replied: 0,
          replied_to_lead: 0, lead_to_deal: 0, deal_to_won: 0, overall: 0,
        },
      };
    }
  }

  private emptyCampaignAnalytics(campaignId: string): CampaignAnalytics {
    return {
      campaign: { id: campaignId, name: 'Not Found', status: 'unknown' },
      funnel: { sent: 0, delivered: 0, read: 0, replied: 0, leads: 0, deals: 0 },
      daily_breakdown: [],
      top_contacts: [],
      ai_summary: {
        total_analyzed: 0,
        intent_distribution: {},
        interest_distribution: {},
        avg_confidence: 0,
        avg_lead_score: 0,
      },
    };
  }
}
