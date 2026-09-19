import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BaseService } from '../../common/base/base.service';
import { Deal, DealStage } from '../../entities/deal.entity';
import { Lead, LeadStatus } from '../../entities/lead.entity';
import { CreateDealDto } from './dto/create-deal.dto';
import { UpdateDealDto } from './dto/update-deal.dto';

@Injectable()
export class DealsService extends BaseService<Deal> {
  protected readonly entityName = 'Deal';
  private readonly logger = new Logger(DealsService.name);

  constructor(
    @InjectRepository(Deal) protected readonly repo: Repository<Deal>,
    @InjectRepository(Lead) private readonly leadRepo: Repository<Lead>,
  ) { super(); }

  /** Override create to validate lead exists */
  async createDeal(dto: CreateDealDto): Promise<Deal> {
    const lead = await this.leadRepo.findOne({ where: { id: dto.lead_id } });
    if (!lead) throw new NotFoundException(`Lead '${dto.lead_id}' not found`);
    return this.repo.save(this.repo.create(dto));
  }

  /** Override update with deal-stage → lead-status sync */
  async updateDeal(id: string, dto: UpdateDealDto): Promise<Deal> {
    const deal = await this.findById(id);

    // Stage transition side-effects
    const stageToLeadStatus: Partial<Record<DealStage, LeadStatus>> = {
      [DealStage.WON]: LeadStatus.WON,
      [DealStage.LOST]: LeadStatus.LOST,
      [DealStage.NEGOTIATION]: LeadStatus.NEGOTIATION,
      [DealStage.PROPOSAL]: LeadStatus.PROPOSAL_SENT,
    };

    if (dto.stage && dto.stage !== deal.stage) {
      if (dto.stage === DealStage.WON) { deal.won_at = new Date(); deal.lost_at = null; deal.lost_reason = null; }
      if (dto.stage === DealStage.LOST) { deal.lost_at = new Date(); deal.won_at = null; deal.lost_reason = dto.lost_reason || null; }

      const newLeadStatus = stageToLeadStatus[dto.stage];
      if (newLeadStatus) await this.syncLeadStatus(deal.lead_id, newLeadStatus);
    }

    Object.assign(deal, dto);
    return this.repo.save(deal);
  }

  private async syncLeadStatus(leadId: string, status: LeadStatus): Promise<void> {
    try {
      await this.leadRepo.update(leadId, { status });
      this.logger.log(`Lead ${leadId} → ${status}`);
    } catch (err) {
      this.logger.warn(`Failed to sync lead ${leadId}: ${err.message}`);
    }
  }
}
