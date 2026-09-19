import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BaseService } from '../../common/base/base.service';
import { Lead, LeadStatus } from '../../entities/lead.entity';
import { Contact } from '../../entities/contact.entity';
import { QueryLeadDto } from './dto/query-lead.dto';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { AIAnalysisResult } from '../ai/ai.interfaces';

@Injectable()
export class LeadsService extends BaseService<Lead> {
  protected readonly entityName = 'Lead';
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    @InjectRepository(Lead) protected readonly repo: Repository<Lead>,
    @InjectRepository(Contact) private readonly contactRepo: Repository<Contact>,
  ) { super(); }

  async findFiltered(query: QueryLeadDto): Promise<PaginatedResponseDto<Lead>> {
    const { page = 1, limit = 20, status, assigned_to, campaign_id, search } = query;
    const qb = this.repo.createQueryBuilder('lead')
      .leftJoinAndSelect('lead.contact', 'contact')
      .leftJoinAndSelect('lead.company', 'company')
      .orderBy('lead.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) qb.andWhere('lead.status = :status', { status });
    if (assigned_to) qb.andWhere('lead.assigned_to = :assigned_to', { assigned_to });
    if (campaign_id) qb.andWhere('lead.campaign_id = :campaign_id', { campaign_id });
    if (search) qb.andWhere('(contact.name ILIKE :s OR contact.whatsapp_number ILIKE :s)', { s: `%${search}%` });

    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResponseDto(data, total, page, limit);
  }

  /** Auto-create lead from AI analysis — maps interest_level to LeadStatus */
  async createFromAnalysis(
    analysis: AIAnalysisResult,
    contactId: string,
    campaignId?: string,
    campaignContactId?: string,
  ): Promise<Lead> {
    const statusMap: Record<string, LeadStatus> = {
      high: LeadStatus.INTERESTED,
      very_high: LeadStatus.INTERESTED,
      medium: LeadStatus.ENGAGED,
    };

    const lead = await this.repo.save(this.repo.create({
      contact_id: contactId,
      campaign_id: campaignId,
      campaign_contact_id: campaignContactId,
      status: statusMap[analysis.interest_level] || LeadStatus.NEW,
      lead_score: analysis.lead_score,
      product_interest: analysis.product_interest || undefined,
      destinations: analysis.destination_interest || [],
      travel_period: analysis.travel_period || undefined,
      group_size: analysis.traveller_count || undefined,
      requirements: analysis.requirements || undefined,
      source: campaignId ? 'whatsapp_campaign' : 'whatsapp_direct',
    }));

    this.logger.log(`Lead created: ${lead.id} (score: ${analysis.lead_score})`);
    return lead;
  }

  async assign(id: string, userId: string): Promise<Lead> {
    const lead = await this.findById(id);
    lead.assigned_to = userId;
    return this.repo.save(lead);
  }
}
