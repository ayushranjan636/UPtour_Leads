import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { BaseService } from '../../common/base/base.service';
import { Campaign, CampaignStatus } from '../../entities/campaign.entity';
import { CampaignContact } from '../../entities/campaign-contact.entity';
import { Contact } from '../../entities/contact.entity';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';

/**
 * State machine for campaign status transitions.
 * O(1) lookup via hash map instead of switch/case chains.
 */
const STATUS_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  [CampaignStatus.DRAFT]:     [CampaignStatus.ACTIVE, CampaignStatus.CANCELLED],
  [CampaignStatus.ACTIVE]:    [CampaignStatus.PAUSED, CampaignStatus.COMPLETED, CampaignStatus.CANCELLED],
  [CampaignStatus.PAUSED]:    [CampaignStatus.ACTIVE, CampaignStatus.CANCELLED],
  [CampaignStatus.COMPLETED]: [],
  [CampaignStatus.CANCELLED]: [],
};

@Injectable()
export class CampaignsService extends BaseService<Campaign> {
  protected readonly entityName = 'Campaign';
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    @InjectRepository(Campaign) protected readonly repo: Repository<Campaign>,
    @InjectRepository(CampaignContact) private readonly ccRepo: Repository<CampaignContact>,
    @InjectRepository(Contact) private readonly contactRepo: Repository<Contact>,
  ) { super(); }

  async createCampaign(dto: CreateCampaignDto, userId: string): Promise<Campaign> {
    return this.repo.save(this.repo.create({ ...dto, created_by: userId, status: CampaignStatus.DRAFT }));
  }

  async updateCampaign(id: string, dto: UpdateCampaignDto): Promise<Campaign> {
    const campaign = await this.findById(id);
    if (dto.status && dto.status !== campaign.status) {
      this.assertTransition(campaign.status, dto.status);
    }
    Object.assign(campaign, dto);
    return this.repo.save(campaign);
  }

  /** One-liner state transitions using the state machine */
  async activate(id: string): Promise<Campaign> { return this.transitionTo(id, CampaignStatus.ACTIVE); }
  async pause(id: string): Promise<Campaign> { return this.transitionTo(id, CampaignStatus.PAUSED); }

  private async transitionTo(id: string, target: CampaignStatus): Promise<Campaign> {
    const campaign = await this.findById(id);
    this.assertTransition(campaign.status, target);
    campaign.status = target;
    this.logger.log(`Campaign ${campaign.name} → ${target}`);
    return this.repo.save(campaign);
  }

  private assertTransition(current: CampaignStatus, target: CampaignStatus) {
    if (!STATUS_TRANSITIONS[current]?.includes(target)) {
      throw new BadRequestException(`Cannot transition from "${current}" to "${target}"`);
    }
  }

  /**
   * Batch add contacts — uses Set for O(1) dedup.
   */
  async addContacts(campaignId: string, contactIds: string[]): Promise<{ added: number; skipped: number }> {
    await this.findById(campaignId); // assert campaign exists

    const contacts = await this.contactRepo.find({ where: { id: In(contactIds) }, select: ['id'] });
    if (!contacts.length) throw new BadRequestException('No valid contact IDs');

    // O(n) dedup using Set
    const existing = await this.ccRepo.find({
      where: { campaign_id: campaignId, contact_id: In(contacts.map(c => c.id)) },
      select: ['contact_id'],
    });
    const existingSet = new Set(existing.map(cc => cc.contact_id));
    const newIds = contacts.map(c => c.id).filter(id => !existingSet.has(id));

    if (newIds.length) {
      await this.ccRepo.save(newIds.map(cid => this.ccRepo.create({ campaign_id: campaignId, contact_id: cid })));
    }

    return { added: newIds.length, skipped: contactIds.length - newIds.length };
  }

  async listContacts(campaignId: string, page = 1, limit = 20): Promise<PaginatedResponseDto<CampaignContact>> {
    await this.findById(campaignId);
    const [data, total] = await this.ccRepo.findAndCount({
      where: { campaign_id: campaignId },
      relations: ['contact', 'contact.company'],
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return new PaginatedResponseDto(data, total, page, limit);
  }

  async getStats(campaignId: string): Promise<Record<string, number>> {
    const c = await this.repo.findOne({
      where: { id: campaignId },
      select: ['id', 'stats_sent', 'stats_delivered', 'stats_read', 'stats_replied', 'stats_opted_out', 'stats_leads'],
    });
    if (!c) throw new NotFoundException(`Campaign '${campaignId}' not found`);
    return {
      sent: c.stats_sent, delivered: c.stats_delivered, read: c.stats_read,
      replied: c.stats_replied, opted_out: c.stats_opted_out, leads: c.stats_leads,
    };
  }
}
