import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkflowEvent, WorkflowStage, WorkflowStatus } from './workflow-tracker.entity';

@Injectable()
export class WorkflowTrackerService {
  private readonly logger = new Logger(WorkflowTrackerService.name);

  constructor(
    @InjectRepository(WorkflowEvent)
    private readonly repo: Repository<WorkflowEvent>,
  ) {}

  /** Track a single workflow event */
  async track(
    stage: WorkflowStage,
    status: WorkflowStatus,
    opts?: { contactId?: string; campaignId?: string; metadata?: any; error?: string },
  ): Promise<void> {
    try {
      await this.repo.save(
        this.repo.create({
          stage,
          status,
          contact_id: opts?.contactId,
          campaign_id: opts?.campaignId,
          metadata: opts?.metadata,
          error_message: opts?.error,
        }),
      );
    } catch (err) {
      this.logger.warn(`Failed to track event: ${err.message}`);
    }
  }

  /** Get a contact's full journey through the pipeline */
  async getContactJourney(contactId: string): Promise<WorkflowEvent[]> {
    return this.repo.find({
      where: { contact_id: contactId },
      order: { created_at: 'ASC' },
    });
  }

  /** Get pipeline health for a campaign */
  async getCampaignPipelineHealth(campaignId: string) {
    const events = await this.repo
      .createQueryBuilder('e')
      .select('e.stage', 'stage')
      .addSelect('e.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('e.campaign_id = :campaignId', { campaignId })
      .groupBy('e.stage')
      .addGroupBy('e.status')
      .getRawMany();

    // Transform into { stage: { success: N, failed: N } } map
    const map: Record<string, Record<string, number>> = {};
    for (const row of events) {
      if (!map[row.stage]) map[row.stage] = {};
      map[row.stage][row.status] = parseInt(row.count, 10);
    }
    return map;
  }

  /** Get recent faults for a campaign */
  async getCampaignFaults(campaignId: string, limit = 50): Promise<WorkflowEvent[]> {
    return this.repo.find({
      where: { campaign_id: campaignId, status: WorkflowStatus.FAILED },
      order: { created_at: 'DESC' },
      take: limit,
    });
  }

  /** Detect contacts stuck at a stage (no progression in N hours) */
  async detectStuckContacts(campaignId: string, hoursThreshold = 24) {
    const cutoff = new Date(Date.now() - hoursThreshold * 3600_000);
    return this.repo
      .createQueryBuilder('e')
      .select('e.contact_id', 'contact_id')
      .addSelect('MAX(e.created_at)', 'last_event')
      .addSelect('MAX(e.stage)', 'last_stage')
      .where('e.campaign_id = :campaignId', { campaignId })
      .groupBy('e.contact_id')
      .having('MAX(e.created_at) < :cutoff', { cutoff })
      .getRawMany();
  }
}
