import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { FollowupJob } from '../../entities/followup-job.entity';
import { CampaignContact } from '../../entities/campaign-contact.entity';
import { Campaign } from '../../entities/campaign.entity';
import { Contact } from '../../entities/contact.entity';
import { NotificationService } from '../notifications/notification.service';

/**
 * FOLLOW-UP SCHEDULER
 * 
 * Runs every 5 minutes. Finds due follow-up jobs and sends them
 * ONLY if all safety conditions pass.
 * 
 * Safety checks (ALL must pass before sending):
 *   1. Contact has NOT replied
 *   2. Contact has NOT opted out
 *   3. Mode is still 'ai' (no human takeover)
 *   4. Campaign is still active
 *   5. Max follow-ups not exceeded
 *   6. Lead is not closed
 */
@Injectable()
export class FollowupSchedulerService {
  private readonly logger = new Logger(FollowupSchedulerService.name);

  constructor(
    @InjectRepository(FollowupJob)
    private readonly followupRepo: Repository<FollowupJob>,
    @InjectRepository(CampaignContact)
    private readonly ccRepo: Repository<CampaignContact>,
    @InjectRepository(Campaign)
    private readonly campaignRepo: Repository<Campaign>,
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    @InjectQueue('message-send')
    private readonly sendQueue: Queue,
    private readonly notificationService: NotificationService,
  ) {}

  @Cron('*/5 * * * *') // Every 5 minutes
  async processFollowups() {
    try {
      await this.runDueFollowups();
    } catch (err) {
      // A cron handler that throws produces an unhandled rejection.
      this.logger.error(
        `Follow-up cycle failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  private async runDueFollowups() {
    const now = new Date();

    const dueJobs = await this.followupRepo.find({
      where: {
        status: 'scheduled' as any,
        scheduled_at: LessThanOrEqual(now),
      },
      take: 100,
      order: { scheduled_at: 'ASC' },
    });

    if (dueJobs.length === 0) return;

    this.logger.log(`Processing ${dueJobs.length} due follow-ups`);

    // Per-iteration try/catch: without it, a single TypeError (e.g. a null
    // `contact`/`campaign` relation) throws out of the cron handler and drops
    // the remaining due follow-ups. The poison row stays `scheduled`, so it
    // re-breaks the batch every 5 minutes forever — head-of-line blocking.
    for (const job of dueJobs) {
      try {
        await this.processOneFollowup(job);
      } catch (err) {
        this.logger.error(
          `Follow-up ${job.id} failed: ${(err as Error).message}`,
        );
        await this.skipFollowup(job, 'error').catch(() => {});
      }
    }
  }

  private async processOneFollowup(job: FollowupJob) {
    const cc = await this.ccRepo.findOne({
      where: { id: job.campaign_contact_id },
      relations: ['contact', 'campaign'],
    });

    if (!cc) {
      await this.skipFollowup(job, 'campaign_contact_not_found');
      return;
    }

    // The relations are nullable in the schema; dereferencing them blindly below
    // would throw and (before the guard above) poison the whole batch.
    if (!cc.contact || !cc.campaign) {
      await this.skipFollowup(job, 'campaign_contact_relations_missing');
      return;
    }

    // === SAFETY CHECKS ===

    // 1. Contact replied?
    if (cc.last_reply_at) {
      await this.skipFollowup(job, 'contact_replied');
      return;
    }

    // 2. Opted out?
    if (cc.contact.is_opted_out) {
      await this.skipFollowup(job, 'opted_out');
      try {
        await this.notificationService.create(
          'opt_out',
          'Contact Opted Out (Follow-up Skipped)',
          `Contact ${cc.contact.name || cc.contact.whatsapp_number} opted out — follow-up skipped`,
          { contactId: cc.contact_id, campaignContactId: cc.id },
        );
      } catch { /* non-critical */ }
      return;
    }

    // 3. Human mode?
    if (cc.mode === 'human') {
      await this.skipFollowup(job, 'human_takeover');
      return;
    }

    // 4. Campaign still active?
    if (cc.campaign.status !== 'active') {
      await this.skipFollowup(job, 'campaign_not_active');
      return;
    }

    // 5. Max follow-ups exceeded?
    if (cc.followup_count >= (cc.campaign.max_followups || 2)) {
      await this.skipFollowup(job, 'max_followups_reached');
      // Mark as unresponsive
      await this.ccRepo.update(cc.id, { status: 'unresponsive' as any });
      return;
    }

    // 6. Contact suppressed?
    if (cc.contact.is_suppressed) {
      await this.skipFollowup(job, 'contact_suppressed');
      return;
    }

    // === ALL CHECKS PASSED — SEND ===
    try {
      await this.sendQueue.add(
        'send-campaign-message',
        {
          campaignContactId: cc.id,
          campaignId: cc.campaign_id,
          contactId: cc.contact_id,
          sessionId: cc.campaign.openwa_session_id || 'default',
          templateId: job.template_id,
        },
        {
          attempts: 2,
          backoff: { type: 'fixed', delay: 30000 },
          removeOnComplete: true,
        },
      );

      // Update follow-up job
      await this.followupRepo.update(job.id, {
        status: 'sent' as any,
        sent_at: new Date(),
      });

      // Increment follow-up count
      await this.ccRepo.increment({ id: cc.id }, 'followup_count', 1);

      // Log
      this.logger.log(`Follow-up #${cc.followup_count + 1} sent for contact ${cc.contact_id}`);

    } catch (err) {
      this.logger.error(`Follow-up send failed: ${err.message}`);
    }
  }

  private async skipFollowup(job: FollowupJob, reason: string) {
    await this.followupRepo.update(job.id, {
      status: 'skipped' as any,
      skip_reason: reason,
    });

    this.logger.log(`Follow-up ${job.id} skipped: ${reason}`);
  }

  /**
   * Schedule follow-ups for a campaign contact.
   * Called after initial message is sent.
   */
  async scheduleFollowups(
    campaignContactId: string,
    campaignId: string,
    contactId: string,
  ) {
    const campaign = await this.campaignRepo.findOne({ where: { id: campaignId } });
    if (!campaign) return;

    // Find follow-up templates
    const templates = await this.followupRepo.manager.getRepository('MessageTemplate')
      .createQueryBuilder('t')
      .where('t.campaign_id = :campaignId', { campaignId })
      .andWhere("t.trigger_condition LIKE 'followup%'")
      .orderBy('t.sequence_order', 'ASC')
      .getMany();

    const now = new Date();

    // Default follow-up schedule: Day 2 and Day 5
    const defaultSchedule = [
      { days: 2, condition: 'followup_day_2' },
      { days: 5, condition: 'followup_day_5' },
    ];

    const schedule = templates.length > 0
      ? templates.map((t: any, i: number) => ({ days: (i + 1) * 2 + i, templateId: t.id }))
      : defaultSchedule;

    for (const item of schedule) {
      const scheduledAt = new Date(now.getTime() + (item as any).days * 24 * 60 * 60 * 1000);

      await this.followupRepo.save(
        this.followupRepo.create({
          campaign_contact_id: campaignContactId,
          template_id: (item as any).templateId || null,
          scheduled_at: scheduledAt,
          status: 'scheduled' as any,
        }),
      );
    }

    this.logger.log(`${schedule.length} follow-ups scheduled for contact ${contactId}`);
  }
}
