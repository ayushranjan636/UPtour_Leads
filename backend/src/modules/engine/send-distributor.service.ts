import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
/**
 * Most messages a single distributor cycle may enqueue.
 *
 * Queue delays are measured from enqueue time, so a large batch collapses into a burst
 * regardless of the per-message gaps. Keeping this small means one cycle's sends occupy
 * several minutes of wall-clock time, which is what the humanised gaps are for.
 */
const MAX_PER_CYCLE = 5;

/**
 * Consecutive send failures that trip the circuit breaker and pause a campaign.
 *
 * When WhatsApp restricts a number, every send fails. Without this the distributor
 * keeps enqueueing into a dead session for the rest of the day, burning the daily
 * allowance and — worse — continuing to look like automated abuse to WhatsApp. Pausing
 * turns a silent failure into something an operator sees and can act on.
 */
const FAILURE_PAUSE_THRESHOLD = 5;

@Injectable()
export class SendDistributorService {
  private readonly logger = new Logger(SendDistributorService.name);

  /**
   * Bounds for the randomised inter-message gap, in milliseconds.
   *
   * Configurable via HUMANIZED_DELAY_MIN_MS / HUMANIZED_DELAY_MAX_MS. Defaults of
   * 45s-180s follow the safe-sending guidance for unofficial WhatsApp clients: a few
   * messages a minute per session is sustainable, bursts are not.
   */
  private readonly humanDelayMinMs: number;
  private readonly humanDelayMaxMs: number;

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
    private readonly config: ConfigService,
  ) {
    this.humanDelayMinMs = this.readDelayMs('HUMANIZED_DELAY_MIN_MS', 45_000);
    this.humanDelayMaxMs = this.readDelayMs('HUMANIZED_DELAY_MAX_MS', 180_000);

    if (this.humanDelayMaxMs <= this.humanDelayMinMs) {
      // A max at or below the min would collapse the distribution back to a constant
      // gap — the exact pattern this is meant to avoid — so refuse it loudly.
      throw new Error(
        `HUMANIZED_DELAY_MAX_MS (${this.humanDelayMaxMs}) must be greater than ` +
          `HUMANIZED_DELAY_MIN_MS (${this.humanDelayMinMs}).`,
      );
    }

    this.logger.log(
      `Humanised send delay: ${Math.round(this.humanDelayMinMs / 1000)}-` +
        `${Math.round(this.humanDelayMaxMs / 1000)}s, drawn per message`,
    );
  }

  /** Read a positive integer millisecond setting, falling back to a safe default. */
  private readDelayMs(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    const parsed = parseInt(raw ?? '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  }

  /**
   * Pause a campaign when its recent sends keep failing.
   *
   * Counts `failed` campaign_contacts with no successful send after them. A restricted
   * number fails every send, and continuing to push into that is both futile and an
   * ongoing abuse signal. Returns true when the campaign was paused.
   */
  private async tripBreakerIfFailing(campaign: Campaign): Promise<boolean> {
    const recent = await this.ccRepo
      .createQueryBuilder('cc')
      .select('cc.status', 'status')
      .where('cc.campaign_id = :id', { id: campaign.id })
      .andWhere('cc.last_sent_at IS NOT NULL')
      .orderBy('cc.last_sent_at', 'DESC')
      .limit(FAILURE_PAUSE_THRESHOLD)
      .getRawMany<{ status: string }>();

    if (recent.length < FAILURE_PAUSE_THRESHOLD) return false;
    if (!recent.every((r) => r.status === 'failed')) return false;

    await this.campaignRepo.update(campaign.id, { status: 'paused' as any });
    this.logger.error(
      `Campaign "${campaign.name}" paused: the last ${FAILURE_PAUSE_THRESHOLD} sends all ` +
        'failed. This usually means the WhatsApp session dropped or the number was ' +
        'restricted — check the gateway before resuming.',
    );
    return true;
  }

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
    // 0. Circuit breaker: stop pushing into a session that is failing every send.
    if (await this.tripBreakerIfFailing(campaign)) return;

    // 1. Check send window
    if (!this.isWithinSendWindow(campaign)) return;

    // 2. Check daily limit (Redis-based, survives restarts)
    const todaySent = await this.getTodaySent(campaign);
    const dailyLimit = campaign.daily_send_limit || 100;
    if (todaySent >= dailyLimit) return;

    // 3. Respect the randomised gap chosen after the previous send.
    //
    // Without this gate the cron period *became* the pacing. A typical campaign
    // computes a batch of 1 (30/day over a 9h window rounds up to one per minute), and
    // with a single message per batch the within-batch randomisation below never runs,
    // so every message was enqueued with zero delay exactly 60s apart. Perfectly
    // regular spacing is the single most machine-like signal a sender can emit, which
    // is precisely what the humanised delays exist to avoid. Holding the gap in Redis
    // makes it apply *across* ticks, so spacing is irregular however small the batch.
    const gateMs = await this.getNextSendGate(campaign);
    if (gateMs !== null && Date.now() < gateMs) return;

    // 4. Calculate batch size for this cycle
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

    // 5. Verify and queue with humanised, non-uniform delays
    const delayPerMessage = this.calculateDelay(campaign, dailyLimit);
    let queuedCount = 0;
    // Accumulated offset for this batch. Each message adds its own randomly drawn
    // gap, so the queue has no constant period for WhatsApp to fingerprint.
    let cumulativeDelay = 0;

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

      // First message of a cycle goes out promptly; every later one waits a freshly
      // drawn gap, so spacing within the batch is irregular by construction.
      if (queuedCount > 0) {
        cumulativeDelay += this.humanizedGap(delayPerMessage);
      }
      const delay = cumulativeDelay;

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

      // Arm the gate for the next cycle with a freshly drawn gap, measured from the
      // last message in this batch. This is what makes the spacing irregular when the
      // batch is a single message and the within-batch randomisation cannot apply.
      await this.armNextSendGate(
        campaign,
        cumulativeDelay + this.humanizedGap(delayPerMessage),
      );

      this.logger.log(
        `Campaign ${campaign.name}: queued ${queuedCount} messages ` +
        `(${todaySent + queuedCount}/${dailyLimit} today)`,
      );
    }
  }

  /** Redis key holding the epoch-ms before which this campaign must not send again. */
  private sendGateKey(campaign: Campaign): string {
    return `campaign:${campaign.id}:next-send-at`;
  }

  /**
   * When this campaign may next enqueue, or null when it may send immediately.
   *
   * A missing key means "no gap pending" — a fresh campaign sends on its first tick
   * rather than waiting out a delay it never earned.
   */
  private async getNextSendGate(campaign: Campaign): Promise<number | null> {
    const at = await this.redis
      .get<number>(this.sendGateKey(campaign))
      // Redis being unavailable must not stall a campaign; fall back to sending.
      .catch(() => null);
    return typeof at === 'number' ? at : null;
  }

  /** Hold the next send until `gapMs` from now. */
  private async armNextSendGate(campaign: Campaign, gapMs: number): Promise<void> {
    // TTL follows the gap so a stale gate can never outlive its purpose and wedge a
    // campaign; +60s of slack covers the cron tick that reads it.
    const ttlSeconds = Math.ceil(gapMs / 1000) + 60;
    await this.redis
      .set(this.sendGateKey(campaign), Date.now() + gapMs, ttlSeconds)
      .catch((err) =>
        this.logger.warn(
          `Could not persist the send gate for ${campaign.name}; ` +
            `pacing falls back to the cron period: ${(err as Error).message}`,
        ),
      );
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

    // Cap per cycle. Was 20, which let 20 messages leave inside one minute — a burst
    // that defeats the whole point of the 45-180s humanised gaps, since the queue
    // delays are relative to enqueue time. 5 keeps a cycle's worth of sends spread
    // across roughly 4-15 minutes of real time.
    return Math.min(batch, remaining, MAX_PER_CYCLE);
  }

  /**
   * Base spacing between messages, before randomisation.
   *
   * Spreads the daily allowance across the send window so a campaign finishes near
   * the end of its window rather than blasting up front.
   *
   * Examples:
   *   10 contacts / 9hr window = 54 min between = 3,240,000ms
   *   100 contacts / 9hr window = 5.4 min between = 324,000ms
   *   500 contacts / 9hr window = 1.08 min between = 64,800ms
   */
  private calculateDelay(campaign: Campaign, dailyLimit: number): number {
    const windowMs = this.getSendWindowMinutes(campaign) * 60 * 1000;
    const delayMs = Math.floor(windowMs / dailyLimit);

    // Never tighter than the humanised minimum, whatever the arithmetic says.
    return Math.max(delayMs, this.humanDelayMinMs);
  }

  /**
   * Randomised gap to the next message.
   *
   * A constant interval is the single most machine-like signal a sender can emit —
   * WhatsApp's anti-abuse systems look for exactly that regularity. Every gap is
   * therefore drawn fresh from a uniform distribution rather than derived from a
   * fixed base, so no two sends are evenly spaced and the sequence has no period.
   *
   * Two regimes:
   *  - When the pacing interval fits inside the humanised band, draw uniformly from
   *    [HUMANIZED_DELAY_MIN_MS, HUMANIZED_DELAY_MAX_MS] (default 45s-180s).
   *  - When pacing demands a wider spread (a small audience across a long window),
   *    draw from ±25% of that interval instead, so the campaign still fills its
   *    window instead of finishing hours early.
   *
   * Replaces a fixed `base + ±20%` jitter, which left the mean exactly on the base
   * and so still produced a detectable rhythm.
   */
  private humanizedGap(pacingDelayMs: number): number {
    const min = this.humanDelayMinMs;
    const max = this.humanDelayMaxMs;

    if (pacingDelayMs <= max) {
      return min + Math.floor(Math.random() * (max - min + 1));
    }

    const spread = pacingDelayMs * 0.25;
    const low = Math.max(min, Math.floor(pacingDelayMs - spread));
    const high = Math.floor(pacingDelayMs + spread);
    return low + Math.floor(Math.random() * (high - low + 1));
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
