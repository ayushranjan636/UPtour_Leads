import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Campaign, CampaignStatus } from '../../entities/campaign.entity';
import {
  CampaignContact,
  CampaignContactStatus,
} from '../../entities/campaign-contact.entity';
import { MessageTemplate } from '../../entities/message-template.entity';
import { NotificationService } from '../notifications/notification.service';
import {
  minutesSinceMidnightIn,
  parseTimeToMinutes,
} from '../../common/utils/timezone.util';

@Injectable()
export class CampaignSchedulerService {
  private readonly logger = new Logger(CampaignSchedulerService.name);

  constructor(
    @InjectRepository(Campaign)
    private readonly campaignRepo: Repository<Campaign>,
    @InjectRepository(CampaignContact)
    private readonly campaignContactRepo: Repository<CampaignContact>,
    @InjectRepository(MessageTemplate)
    private readonly templateRepo: Repository<MessageTemplate>,
    @InjectQueue('message-send')
    private readonly messageSendQueue: Queue,
    private readonly notificationService: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCampaignScheduling(): Promise<void> {
    try {
      const activeCampaigns = await this.campaignRepo.find({
        where: { status: CampaignStatus.ACTIVE },
      });

      if (activeCampaigns.length === 0) {
        return;
      }

      this.logger.log(
        `Processing ${activeCampaigns.length} active campaign(s)`,
      );

      let totalQueued = 0;

      for (const campaign of activeCampaigns) {
        try {
          const queued = await this.processCampaign(campaign);
          totalQueued += queued;

          // Auto-complete: if no pending contacts remain, mark campaign as completed
          await this.checkAutoComplete(campaign);
        } catch (error) {
          this.logger.error(
            `Error processing campaign ${campaign.id} (${campaign.name}): ${(error as Error).message}`,
            (error as Error).stack,
          );
        }
      }

      if (totalQueued > 0) {
        this.logger.log(
          `Campaign scheduling complete: ${totalQueued} message(s) queued across ${activeCampaigns.length} campaign(s)`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Campaign scheduling failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Auto-complete campaign when all contacts have been processed.
   * A campaign is complete when:
   *  - No contacts are in 'pending' status
   *  - At least one contact was processed (campaign wasn't empty)
   */
  private async checkAutoComplete(campaign: Campaign): Promise<void> {
    const pendingCount = await this.campaignContactRepo.count({
      where: {
        campaign_id: campaign.id,
        status: CampaignContactStatus.PENDING,
      },
    });

    if (pendingCount > 0) return;

    // Check that at least one contact was processed (don't complete empty campaigns)
    const totalContacts = await this.campaignContactRepo.count({
      where: { campaign_id: campaign.id },
    });

    if (totalContacts === 0) return;

    // All contacts processed — mark campaign as completed
    await this.campaignRepo.update(campaign.id, {
      status: CampaignStatus.COMPLETED,
    });

    this.logger.log(
      `Campaign ${campaign.id} (${campaign.name}) auto-completed: all ${totalContacts} contacts processed`,
    );

    try {
      await this.notificationService.create(
        'campaign_complete',
        'Campaign Completed',
        `Campaign "${campaign.name}" has been automatically completed — all ${totalContacts} contacts processed`,
        {
          campaignId: campaign.id,
          campaignName: campaign.name,
          totalContacts,
          stats: {
            sent: campaign.stats_sent,
            delivered: campaign.stats_delivered,
            read: campaign.stats_read,
            replied: campaign.stats_replied,
            leads: campaign.stats_leads,
          },
        },
      );
    } catch { /* non-critical */ }
  }

  /**
   * NOTE: message enqueueing lives ONLY in SendDistributorService.
   *
   * This service previously ALSO selected `pending` contacts and enqueued them,
   * on its own EVERY_MINUTE cron, without updating their status. That caused:
   *   - two jobs per contact per tick (both crons read the same pending rows), and
   *   - the same contacts being re-enqueued every single minute forever, since
   *     nothing here transitioned them out of `pending`.
   *
   * SendDistributorService is the single producer: it paces sends across the
   * window, verifies the number, and atomically claims each row. This service
   * now only handles send-window logging and campaign auto-completion.
   */
  private async processCampaign(campaign: Campaign): Promise<number> {
    if (!this.isWithinSendWindow(campaign)) {
      this.logger.debug(
        `Campaign ${campaign.id} (${campaign.name}) outside send window — skipping`,
      );
    }
    return 0;
  }

  /**
   * Checks whether the current time falls within the campaign's configured
   * send window, converted to the campaign's timezone.
   *
   * Supports windows that wrap past midnight (start > end).
   */
  isWithinSendWindow(campaign: Campaign): boolean {
    // resolveTimezone never throws: unrecognised values (e.g. "India") are mapped
    // to a real IANA zone or fall back to the default, so an invalid timezone can
    // no longer make this check throw and bypass the window entirely.
    const currentMinutes = minutesSinceMidnightIn(campaign.send_window_timezone);
    const startMinutes = parseTimeToMinutes(campaign.send_window_start, 9 * 60);
    const endMinutes = parseTimeToMinutes(campaign.send_window_end, 18 * 60);

    if (startMinutes === endMinutes) return false;

    if (startMinutes < endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }

    // Window wraps midnight, e.g. 22:00 → 06:00.
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  private async countMessagesSentToday(campaignId: string): Promise<number> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const count = await this.campaignContactRepo
      .createQueryBuilder('cc')
      .where('cc.campaign_id = :campaignId', { campaignId })
      .andWhere('cc.first_sent_at >= :todayStart', { todayStart })
      .andWhere('cc.status != :pending', {
        pending: CampaignContactStatus.PENDING,
      })
      .getCount();

    return count;
  }
}
