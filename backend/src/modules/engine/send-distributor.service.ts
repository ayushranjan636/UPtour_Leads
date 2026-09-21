import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Campaign } from '../../entities/campaign.entity';
import {
  CampaignContact,
  CampaignContactStatus,
} from '../../entities/campaign-contact.entity';
import { Contact } from '../../entities/contact.entity';
import { OpenwaService } from '../openwa/openwa.service';
import { RedisService } from '../../common/redis/redis.service';
import {
  dayKeyIn,
  minutesSinceMidnightIn,
  parseTimeToMinutes,
} from '../../common/utils/timezone.util';

/**
 * SEND DISTRIBUTOR
 * 
 * This is the heart of the sending engine. It takes the user's configured
 * quantity (10, 100, 500, or any custom number) and automatically distributes
 * messages evenly across the campaign's send window (e.g., 09:00–18:00).
 * 
 * Example:
 *   daily_send_limit = 100
 *   send_window = 09:00 to 18:00 (9 hours = 540 minutes)
 *   → 100 messages / 540 minutes = 1 message every 5.4 minutes
 *   → With jitter: 4–7 minutes between messages
 * 
 *   daily_send_limit = 10
 *   → 10 messages / 540 minutes = 1 message every 54 minutes
 *   → With jitter: 45–65 minutes between messages
 * 
 *   daily_send_limit = 500
 *   → 500 / 540 = ~1 message per 1.08 minutes
 *   → Capped to minimum 30s gap for safety
 * 
 * The distributor runs every minute, checks active campaigns, and queues
 * exactly the right number of messages to maintain even distribution.
 * 
 * Phase 1B additions:
 *   - WhatsApp number verification via OpenWA checkNumber()
 *   - Redis-based daily counters (survives restarts)
 *   - Verification caching in Redis (24h TTL)
 */
@Injectable()
export class SendDistributorService {
  private readonly logger = new Logger(SendDistributorService.name);

  private static readonly VERIFY_CACHE_TTL = 86400; // 24 hours
  private static readonly DAILY_COUNT_TTL = 86400;  // 24 hours

  constructor(
    @InjectRepository(Campaign)
    private readonly campaignRepo: Repository<Campaign>,
    @InjectRepository(CampaignContact)
    private readonly ccRepo: Repository<CampaignContact>,
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    @InjectQueue('message-send')
    private readonly sendQueue: Queue,
    private readonly openwa: OpenwaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Runs every 60 seconds. For each active campaign:
   * 1. Check if within send window (timezone-aware)
   * 2. Check daily limit not exceeded
   * 3. Calculate how many to queue RIGHT NOW based on even distribution
   * 4. Pick pending contacts, verify WhatsApp, queue with calculated delay
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async distribute() {
    const activeCampaigns = await this.campaignRepo.find({
      where: { status: 'active' as any },
    });

    for (const campaign of activeCampaigns) {
      try {
        await this.distributeCampaign(campaign);
      } catch (err) {
        this.logger.error(`Distribution failed for campaign ${campaign.id}: ${err.message}`);
      }
    }
  }

  private async distributeCampaign(campaign: Campaign) {
    // 1. Check send window
    if (!this.isWithinSendWindow(campaign)) return;

    // 2. Check daily limit (Redis-based, survives restarts)
    const todaySent = await this.getTodaySent(campaign);
    const dailyLimit = campaign.daily_send_limit || 100;
    if (todaySent >= dailyLimit) return;

    // 3. Calculate batch size for this minute
    const batchSize = this.calculateBatchSize(campaign, todaySent);
    if (batchSize <= 0) return;

    // 4. Pick pending contacts
    const pendingContacts = await this.ccRepo
      .createQueryBuilder('cc')
      .innerJoinAndSelect('cc.contact', 'c')
      .where('cc.campaign_id = :campaignId', { campaignId: campaign.id })
      .andWhere('cc.status = :status', { status: 'pending' })
      .andWhere('c.is_opted_out = false')
      .andWhere('c.is_suppressed = false')
      .orderBy('cc.created_at', 'ASC')
      .limit(batchSize)
      .getMany();

    if (pendingContacts.length === 0) return;

    // 5. Verify and queue with distributed delays
    const delayPerMessage = this.calculateDelay(campaign, dailyLimit);
    let queuedCount = 0;

    for (let i = 0; i < pendingContacts.length; i++) {
      const cc = pendingContacts[i];
      const contact = cc.contact;

      // Verify WhatsApp number before sending
      const verified = await this.verifyWhatsAppNumber(
        contact,
        // Resolve before the WhatsApp existence check: 'default' is not a session id,
        // so this check silently errored and fell through to "assume reachable".
        await this.openwa.resolveSessionId(campaign.openwa_session_id),
      );

      if (!verified) {
        this.logger.log(`Skipped contact ${contact.id}: not on WhatsApp`);
        continue;
      }

      const delay = queuedCount * delayPerMessage + this.jitter(delayPerMessage);

      // Atomically claim this row before enqueueing. The conditional UPDATE is
      // the lock: if a concurrent tick already moved it out of `pending`, the
      // affected-row count is 0 and we skip, so a contact can never be queued
      // twice (which would mean sending the same WhatsApp message twice).
      const claim = await this.ccRepo
        .createQueryBuilder()
        .update(CampaignContact)
        .set({ status: CampaignContactStatus.SENT })
        .where('id = :id AND status = :pending', {
          id: cc.id,
          pending: CampaignContactStatus.PENDING,
        })
        .execute();

      if (!claim.affected) {
        this.logger.debug(
          `Contact ${cc.contact_id} already claimed by another tick — skipping`,
        );
        continue;
      }

      try {
        await this.sendQueue.add(
          'send-campaign-message',
          {
            campaignContactId: cc.id,
            campaignId: campaign.id,
            contactId: cc.contact_id,
            sessionId: campaign.openwa_session_id || 'default',
          },
          {
            delay,
            attempts: 2,
            backoff: { type: 'fixed', delay: 30000 },
            removeOnComplete: true,
            removeOnFail: false,
          },
        );
      } catch (err) {
        // Enqueue failed — release the claim so the next tick can retry.
        await this.ccRepo.update(cc.id, {
          status: CampaignContactStatus.PENDING,
        });
        this.logger.error(
          `Failed to enqueue contact ${cc.contact_id}, released claim: ${(err as Error).message}`,
        );
        continue;
      }

      queuedCount++;
      this.logger.log(`Contact ${cc.contact_id} queued with ${Math.round(delay / 1000)}s delay (batch ${queuedCount}/${pendingContacts.length})`);
    }

    if (queuedCount > 0) {
      // Update daily counter in Redis
      await this.incrementTodaySent(campaign, queuedCount);

      this.logger.log(
        `Campaign ${campaign.name}: queued ${queuedCount} messages ` +
        `(${todaySent + queuedCount}/${dailyLimit} today)`,
      );
    }
  }

  /**
   * Verify a WhatsApp number with caching.
   * Returns true if number is on WhatsApp, false otherwise.
   * Caches result in Redis for 24 hours.
   * On verification failure, suppresses the contact.
   */
  async verifyWhatsAppNumber(contact: Contact, sessionId: string): Promise<boolean> {
    const cacheKey = `wa:verified:${contact.whatsapp_number}`;

    // Check Redis cache first
    const cached = await this.redis.get<boolean>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Call OpenWA checkNumber
    try {
      const rawNumber = contact.whatsapp_number.replace('+', '');
      const exists = await this.openwa.checkNumber(sessionId, rawNumber);

      // Cache result
      await this.redis.set(cacheKey, exists, SendDistributorService.VERIFY_CACHE_TTL);

      if (exists) {
        // Mark contact as verified
        await this.contactRepo.update(contact.id, { whatsapp_verified: true });
      } else {
        // Suppress contact — not on WhatsApp
        await this.contactRepo.update(contact.id, {
          is_suppressed: true,
          suppressed_reason: 'not_on_whatsapp',
          whatsapp_verified: false,
        });
      }

      return exists;
    } catch (err) {
      this.logger.warn(`WhatsApp verification failed for ${contact.whatsapp_number}: ${err.message}`);
      // On error, allow sending (don't block on verification failure)
      return true;
    }
  }

  /**
   * Verify and send — public method for one-off sends.
   * Checks WhatsApp number before queuing.
   */
  async verifyAndSend(
    campaignContactId: string,
    campaignId: string,
    contactId: string,
    sessionId: string,
  ): Promise<{ queued: boolean; reason?: string }> {
    const contact = await this.contactRepo.findOne({ where: { id: contactId } });
    if (!contact) return { queued: false, reason: 'contact_not_found' };

    const verified = await this.verifyWhatsAppNumber(contact, sessionId);
    if (!verified) return { queued: false, reason: 'not_on_whatsapp' };

    await this.sendQueue.add(
      'send-campaign-message',
      { campaignContactId, campaignId, contactId, sessionId },
      {
        attempts: 2,
        backoff: { type: 'fixed', delay: 30000 },
        removeOnComplete: true,
      },
    );

    return { queued: true };
  }

  /**
   * Calculate how many messages to queue in this 1-minute cycle.
   * 
   * Formula:
   *   send_window_minutes = (end - start) in minutes (e.g., 540 for 9AM-6PM)
   *   messages_per_minute = daily_limit / send_window_minutes
   *   batch_this_minute = ceil(messages_per_minute)
   * 
   * But never exceed remaining daily limit.
   */
  private calculateBatchSize(campaign: Campaign, todaySent: number): number {
    const dailyLimit = campaign.daily_send_limit || 100;
    const remaining = dailyLimit - todaySent;
    if (remaining <= 0) return 0;

    const windowMinutes = this.getSendWindowMinutes(campaign);
    const elapsedMinutes = this.getElapsedWindowMinutes(campaign);
    const remainingMinutes = windowMinutes - elapsedMinutes;
    if (remainingMinutes <= 0) return remaining; // send all remaining at end

    // Evenly distribute remaining over remaining window
    const messagesPerMinute = remaining / remainingMinutes;
    const batch = Math.ceil(messagesPerMinute);

    return Math.min(batch, remaining, 20); // cap at 20 per cycle for safety
  }

  /**
   * Calculate delay between messages in milliseconds.
   * 
   * Examples:
   *   10 contacts / 9hr window = 54 min between = 3,240,000ms
   *   100 contacts / 9hr window = 5.4 min between = 324,000ms
   *   500 contacts / 9hr window = 1.08 min between = 64,800ms (capped at 30s min)
   */
  private calculateDelay(campaign: Campaign, dailyLimit: number): number {
    const windowMs = this.getSendWindowMinutes(campaign) * 60 * 1000;
    const delayMs = Math.floor(windowMs / dailyLimit);

    // Minimum 30 seconds between messages (WhatsApp safety)
    return Math.max(delayMs, 30000);
  }

  /**
   * Add ±20% random jitter to avoid predictable patterns.
   */
  private jitter(baseDelay: number): number {
    const variance = baseDelay * 0.2;
    return Math.floor(Math.random() * variance * 2 - variance);
  }

  /**
   * Check if current time is within campaign's send window (timezone-aware).
   */
  private isWithinSendWindow(campaign: Campaign): boolean {
    const currentMinutes = minutesSinceMidnightIn(campaign.send_window_timezone);
    const startMinutes = parseTimeToMinutes(campaign.send_window_start, 9 * 60);
    const endMinutes = parseTimeToMinutes(campaign.send_window_end, 18 * 60);

    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  private getSendWindowMinutes(campaign: Campaign): number {
    const startMinutes = parseTimeToMinutes(campaign.send_window_start, 9 * 60);
    const endMinutes = parseTimeToMinutes(campaign.send_window_end, 18 * 60);
    // Guard against a misconfigured window (end <= start) causing a divide-by-zero
    // or negative pacing interval downstream.
    return Math.max(1, endMinutes - startMinutes);
  }

  private getElapsedWindowMinutes(campaign: Campaign): number {
    const currentMinutes = minutesSinceMidnightIn(campaign.send_window_timezone);
    const startMinutes = parseTimeToMinutes(campaign.send_window_start, 9 * 60);

    return Math.max(0, currentMinutes - startMinutes);
  }

  /**
   * Redis-based daily sent counter — survives restarts.
   *
   * The date key is computed in the CAMPAIGN'S timezone, not UTC. Using UTC would
   * roll the counter over in the middle of the send window for any campaign east
   * of UTC (e.g. Asia/Kolkata rolls at 05:30 local), letting a campaign send well
   * past its configured daily limit.
   */
  private dailySentKey(campaign: Campaign): string {
    const today = dayKeyIn(campaign.send_window_timezone);
    return `daily:sent:${campaign.id}:${today}`;
  }

  private async getTodaySent(campaign: Campaign): Promise<number> {
    const count = await this.redis.get<number>(this.dailySentKey(campaign));
    return count ?? 0;
  }

  private async incrementTodaySent(
    campaign: Campaign,
    count: number,
  ): Promise<void> {
    const key = this.dailySentKey(campaign);
    const current = await this.redis.get<number>(key);
    await this.redis.set(
      key,
      (current ?? 0) + count,
      SendDistributorService.DAILY_COUNT_TTL,
    );
  }

  /**
   * Public method for dashboard: get distribution plan for a campaign.
   * Shows the user exactly how their chosen quantity will be distributed.
   */
  getDistributionPlan(dailyLimit: number, windowStart = '09:00', windowEnd = '18:00') {
    const startMinutes = parseTimeToMinutes(windowStart, 9 * 60);
    const endMinutes = parseTimeToMinutes(windowEnd, 18 * 60);
    const windowMinutes = Math.max(1, endMinutes - startMinutes);
    const windowHours = windowMinutes / 60;

    const safeLimit = Math.max(1, dailyLimit);
    const delayMinutes = windowMinutes / safeLimit;
    const messagesPerHour = safeLimit / windowHours;

    const minGapSeconds = Math.max(delayMinutes * 60, 30);

    // Hour-by-hour slots so the UI can chart the plan. The frontend renders
    // these as bars; without them the "Distribution Plan" tab is always empty.
    const slots: { time: string; count: number }[] = [];
    let remaining = safeLimit;
    for (let m = startMinutes; m < endMinutes && remaining > 0; m += 60) {
      const minutesInSlot = Math.min(60, endMinutes - m);
      const count = Math.min(
        remaining,
        Math.round((safeLimit * minutesInSlot) / windowMinutes),
      );
      const hh = String(Math.floor(m / 60) % 24).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      slots.push({ time: `${hh}:${mm}`, count });
      remaining -= count;
    }
    // Rounding can leave a remainder — put it in the last slot.
    if (remaining > 0 && slots.length > 0) {
      slots[slots.length - 1].count += remaining;
    }

    return {
      daily_limit: dailyLimit,
      send_window: `${windowStart} — ${windowEnd}`,
      window_hours: windowHours,
      messages_per_hour: Math.round(messagesPerHour * 10) / 10,
      gap_between_messages: `${Math.round(minGapSeconds)}s (~${Math.round(delayMinutes * 10) / 10} min)`,
      estimated_completion: `${windowHours} hours`,
      slots,
      safety_rating: dailyLimit <= 100 ? 'SAFE' : dailyLimit <= 300 ? 'MODERATE' : 'AGGRESSIVE',
      recommendation:
        dailyLimit <= 100
          ? 'Safe volume. Low ban risk.'
          : dailyLimit <= 300
          ? 'Moderate volume. Use typing simulation. Monitor delivery rates.'
          : 'High volume. Consider multiple WhatsApp sessions.',
    };
  }
}
