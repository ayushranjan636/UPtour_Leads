/**
 * INBOUND AI SERVICE
 *
 * Owns everything that happens because a person messaged us: the lead they become, the
 * deal they turn into, and the automated answer they get. All three live together
 * because they share the same non-negotiable precondition — the message must have been
 * sent by a human — and because both entry points (the webhook handler and the
 * ai-analysis worker) must apply exactly the same rules. Two copies of this logic would
 * mean two chances to answer the same message twice.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Message } from '../../entities/message.entity';
import { Contact } from '../../entities/contact.entity';
import { Campaign } from '../../entities/campaign.entity';
import { CampaignContact } from '../../entities/campaign-contact.entity';
import { Lead, LeadStatus } from '../../entities/lead.entity';
import { Deal, DealStage } from '../../entities/deal.entity';
import { RedisService } from '../../common/redis/redis.service';
import { AiService } from './ai.service';
import { AIAnalysisResult } from './ai.interfaces';
import {
  AI_REPLY_MIN_CONFIDENCE,
  MAX_CONSECUTIVE_AI_REPLIES,
  OPEN_DEAL_STAGES,
  advanceLeadStatus,
  assessConversionIntent,
  countTrailingAiReplies,
  isHumanInbound,
} from './inbound-ai.decisions';

/** Lead `source` for a contact who replied to us on WhatsApp. */
export const LEAD_SOURCE_WHATSAPP_REPLY = 'whatsapp_reply';

/** Newest-first window of a conversation passed to the model for context. */
const HISTORY_WINDOW = 10;

export interface InboundContext {
  message: Message;
  contact: Contact;
  campaignId?: string | null;
  campaignContactId?: string | null;
}

/**
 * Why a reply was or was not queued.
 *
 * Callers need the distinction: `already_answered` means the message has been dealt
 * with, so the canned follow-up sequence must stay quiet, whereas `disabled` or
 * `declined` means nothing was sent and the sequence may proceed as before.
 */
export type ReplyOutcome = {
  queued: boolean;
  reason:
    | 'queued'
    | 'not_human_inbound'
    | 'disabled_globally'
    | 'disabled_for_campaign'
    | 'opted_out_or_suppressed'
    | 'human_takeover'
    | 'already_answered'
    | 'loop_guard'
    | 'no_reply_generated'
    | 'needs_human'
    | 'error';
};

@Injectable()
export class InboundAiService {
  private readonly logger = new Logger(InboundAiService.name);

  constructor(
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    @InjectRepository(Campaign)
    private readonly campaignRepo: Repository<Campaign>,
    @InjectRepository(CampaignContact)
    private readonly ccRepo: Repository<CampaignContact>,
    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
    @InjectRepository(Deal)
    private readonly dealRepo: Repository<Deal>,
    @InjectQueue('message-send')
    private readonly sendQueue: Queue,
    private readonly aiService: AiService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Everything the inbound webhook path should do once the message row exists.
   *
   * Never throws: a lead that could not be written or a model that timed out must not
   * fail the webhook, because failing it makes the gateway redeliver the message and the
   * whole pipeline runs again.
   */
  async handleInboundHumanMessage(ctx: InboundContext): Promise<ReplyOutcome> {
    // Single gate for the whole pipeline. Anything we sent — template, human send or a
    // previous AI reply — stops here and can neither become a lead nor be answered.
    if (!isHumanInbound(ctx.message)) {
      this.logger.warn(
        `Ignoring message ${ctx.message?.id} for lead/reply handling: ` +
          `direction=${ctx.message?.direction}, is_ai_generated=${ctx.message?.is_ai_generated} ` +
          '— only genuine inbound human messages count',
      );
      return { queued: false, reason: 'not_human_inbound' };
    }

    try {
      await this.ensureLeadForHumanReply(ctx);
    } catch (err) {
      this.logger.error(
        `Could not ensure a lead for contact ${ctx.contact.id}: ${(err as Error).message}`,
      );
    }

    try {
      return await this.maybeAutoReply(ctx);
    } catch (err) {
      this.logger.error(
        `AI auto-reply failed for contact ${ctx.contact.id}: ${(err as Error).message}`,
      );
      return { queued: false, reason: 'error' };
    }
  }

  /**
   * A human reply means a lead exists. Idempotent per contact.
   *
   * Scoped to the contact rather than to the campaign on purpose: the owner's rule is
   * one lead per person who replied, so a second reply — in the same campaign or a
   * later one — must find the existing row instead of inserting a duplicate that
   * double-counts the funnel. When the first lead was created outside a campaign and the
   * contact is now in one, the campaign link is backfilled rather than duplicated.
   */
  async ensureLeadForHumanReply(ctx: InboundContext): Promise<Lead | null> {
    if (!isHumanInbound(ctx.message)) {
      this.logger.warn(
        `Refusing to create a lead from a non-human message (${ctx.message?.id})`,
      );
      return null;
    }

    const contactId = ctx.contact.id;
    const campaignId = ctx.campaignId ?? undefined;
    const campaignContactId = ctx.campaignContactId ?? undefined;

    const existing = await this.findLeadForContact(contactId);
    if (existing) {
      const patch: Partial<Lead> = {};
      if (!existing.campaign_id && campaignId) patch.campaign_id = campaignId;
      if (!existing.campaign_contact_id && campaignContactId) {
        patch.campaign_contact_id = campaignContactId;
      }
      if (!existing.company_id && ctx.contact.company_id) {
        patch.company_id = ctx.contact.company_id;
      }

      if (Object.keys(patch).length) {
        await this.leadRepo.update(existing.id, patch);
        this.logger.log(`Lead ${existing.id} enriched from reply by contact ${contactId}`);
      } else {
        this.logger.log(`Lead ${existing.id} already exists for contact ${contactId}`);
      }
      return existing;
    }

    try {
      const lead = await this.leadRepo.save(
        this.leadRepo.create({
          contact_id: contactId,
          company_id: ctx.contact.company_id ?? undefined,
          campaign_id: campaignId,
          campaign_contact_id: campaignContactId,
          // A reply is engagement, not yet qualification. The analysis worker raises
          // this later once it knows how interested they are.
          status: LeadStatus.ENGAGED,
          source: LEAD_SOURCE_WHATSAPP_REPLY,
        }),
      );

      if (campaignId) {
        await this.campaignRepo.increment({ id: campaignId }, 'stats_leads', 1);
      }

      this.logger.log(`Lead ${lead.id} created from human reply by contact ${contactId}`);
      return lead;
    } catch (err) {
      // Two replies arriving at once can both pass the read above. Re-read before
      // giving up: if the other writer won, its row is the lead and this is a success,
      // not a failure.
      const raced = await this.findLeadForContact(contactId);
      if (raced) {
        this.logger.log(
          `Lead ${raced.id} was created concurrently for contact ${contactId} — reusing it`,
        );
        return raced;
      }
      throw err;
    }
  }

  /**
   * Create a deal when an analysed conversation shows the contact is ready to convert.
   *
   * Called from the analysis worker, which is the only place a fresh `AIAnalysisResult`
   * exists. Returns null whenever nothing should happen, including every case where the
   * thresholds were not met — see `assessConversionIntent` for why they are strict.
   */
  async maybeCreateDealFromAnalysis(input: {
    analysis: AIAnalysisResult;
    contactId: string;
    campaignId?: string;
    campaignContactId?: string;
    messageId?: string;
  }): Promise<Deal | null> {
    const { analysis, contactId, campaignId, campaignContactId, messageId } = input;

    const verdict = assessConversionIntent(analysis);
    if (!verdict.ready) {
      this.logger.log(`No deal for contact ${contactId}: ${verdict.reason}`);
      return null;
    }

    // A deal cannot exist without a lead (deals.lead_id is NOT NULL). Normally the
    // webhook path has already created it; this covers an analysis arriving for a
    // conversation that predates that path.
    let lead = await this.findLeadForContact(contactId);
    if (!lead) {
      lead = await this.leadRepo.save(
        this.leadRepo.create({
          contact_id: contactId,
          campaign_id: campaignId,
          campaign_contact_id: campaignContactId,
          status: LeadStatus.QUALIFIED,
          source: LEAD_SOURCE_WHATSAPP_REPLY,
        }),
      );
      this.logger.log(`Lead ${lead.id} created to carry a deal for contact ${contactId}`);
    }

    // Idempotent per lead: one open deal at a time. A second qualifying reply must
    // update the salesperson's context, never split the same opportunity in two.
    const openDeal = await this.dealRepo.findOne({
      where: OPEN_DEAL_STAGES.map((stage) => ({ lead_id: lead!.id, stage })),
      order: { created_at: 'DESC' },
    });
    if (openDeal) {
      this.logger.log(
        `Deal ${openDeal.id} already open for lead ${lead.id} — not creating another`,
      );
      return openDeal;
    }

    const contact = await this.contactRepo.findOne({
      where: { id: contactId },
      relations: ['company'],
    });
    const who = (contact as any)?.company?.name || contact?.name || 'WhatsApp enquiry';
    const product = analysis.product_interest || lead.product_interest || 'India tours';

    const deal = await this.dealRepo.save(
      this.dealRepo.create({
        lead_id: lead.id,
        name: `${who} — ${product}`,
        product,
        // Deliberately no estimated_value: nobody has quoted anything yet, and an
        // invented number would flow straight into pipeline reporting.
        stage: DealStage.PROPOSAL,
        // The audit trail. A deal created by a machine has to be explainable, so record
        // what the model saw, which rule passed, and which message triggered it.
        notes: this.buildDealNotes(analysis, verdict.reason, messageId),
      }),
    );

    const nextStatus = advanceLeadStatus(lead.status, LeadStatus.QUALIFIED);
    if (nextStatus) {
      await this.leadRepo.update(lead.id, { status: nextStatus });
    }

    this.logger.log(
      `Deal ${deal.id} created for lead ${lead.id} (contact ${contactId}): ${verdict.reason}`,
    );
    return deal;
  }

  /**
   * Generate an AI reply and enqueue it on the shared paced sender.
   *
   * Sending goes through the `message-send` queue rather than OpenWA directly because
   * that path applies the humanised delay and typing simulation the account depends on;
   * calling the gateway from here would emit a machine-perfect instant reply.
   *
   * Every guard below is a reason to stay silent and let a human answer. Silence costs a
   * slower response; a wrong automated answer, or a loop, costs the account.
   */
  async maybeAutoReply(ctx: InboundContext): Promise<ReplyOutcome> {
    const { message, contact } = ctx;
    const campaignId = ctx.campaignId ?? undefined;
    const campaignContactId = ctx.campaignContactId ?? undefined;

    // Never answer our own voice. Checked again here because this method is a public
    // entry point used by the analysis worker as well as the webhook path.
    if (!isHumanInbound(message)) return { queued: false, reason: 'not_human_inbound' };

    // Global kill switch, default off: automated replies are always an explicit
    // operator decision and must never switch themselves on after a deploy.
    if (!this.isAutoReplyEnabledGlobally()) {
      return { queued: false, reason: 'disabled_globally' };
    }

    if (contact.is_opted_out || contact.is_suppressed) {
      this.logger.log(
        `No AI reply to contact ${contact.id}: ${contact.is_opted_out ? 'opted out' : 'suppressed'}`,
      );
      return { queued: false, reason: 'opted_out_or_suppressed' };
    }

    const campaign = campaignId
      ? await this.campaignRepo.findOne({ where: { id: campaignId } })
      : null;

    // Per-campaign kill switch. Lets one sensitive campaign be handled entirely by
    // people while automation keeps running everywhere else.
    if (campaign && campaign.ai_auto_reply_enabled === false) {
      this.logger.log(
        `No AI reply to contact ${contact.id}: campaign ${campaign.id} has auto-reply disabled`,
      );
      return { queued: false, reason: 'disabled_for_campaign' };
    }

    if (campaignContactId) {
      const cc = await this.ccRepo.findOne({ where: { id: campaignContactId } });
      if (cc?.mode === 'human') {
        this.logger.log(`No AI reply to contact ${contact.id}: a human has taken over`);
        return { queued: false, reason: 'human_takeover' };
      }
    }

    const history = await this.loadHistory(contact.id);

    // Loop guard, and the backstop for the per-message key below when Redis is down: if
    // the conversation already ends with our own message, the prospect has not spoken
    // since and there is nothing new to answer.
    if (countTrailingAiReplies(history) >= MAX_CONSECUTIVE_AI_REPLIES) {
      this.logger.warn(
        `Loop guard: contact ${contact.id} already has an unanswered assistant message — ` +
          'not replying again until they respond',
      );
      return { queued: false, reason: 'loop_guard' };
    }

    // Cheap read before spending a model call. The webhook path and the analysis worker
    // both reach this method for the same message, and the loop guard cannot separate
    // them because the queued reply has not been sent yet. This is an optimisation only —
    // the atomic claim below is what actually guarantees a single send.
    const claimKey = `ai-reply:message:${message.id}`;
    if (await this.redis.get(claimKey)) {
      this.logger.log(`AI reply for message ${message.id} is already claimed — skipping`);
      return { queued: false, reason: 'already_answered' };
    }

    const reply = await this.aiService.generateReply(
      message.body || '',
      history.map((m) => ({
        role: m.direction === 'outgoing' ? 'assistant' : 'user',
        content: m.body || '',
      })),
      {
        contactName: contact.name,
        companyName: (contact as any).company?.name,
        city: (contact as any).company?.city,
        country: (contact as any).company?.country,
        product: campaign?.product,
        campaignName: campaign?.name,
      },
    );

    if (!reply) return { queued: false, reason: 'no_reply_generated' };

    // The model asking for a person, or being unsure, is the strongest signal available
    // that this message should not be answered automatically.
    if (reply.needsHuman || reply.confidence < AI_REPLY_MIN_CONFIDENCE) {
      await this.handOverToHuman(campaignContactId);
      this.logger.log(
        `AI declined to reply to contact ${contact.id} ` +
          `(needsHuman=${reply.needsHuman}, confidence=${reply.confidence}) — handed to a human`,
      );
      return { queued: false, reason: 'needs_human' };
    }

    // Claim the message immediately before enqueueing, and only then. An atomic SET NX
    // means exactly one of any number of concurrent or replayed triggers — a redelivered
    // webhook, the webhook path and the analysis worker racing — wins the right to
    // answer this specific message. Claiming earlier would burn the key on a skip and
    // leave the message unanswerable.
    if (await this.redis.isDuplicate(claimKey, 86_400)) {
      this.logger.log(
        `AI reply for message ${message.id} was already queued elsewhere — skipping`,
      );
      return { queued: false, reason: 'already_answered' };
    }

    await this.sendQueue.add(
      'send-ai-reply',
      {
        contactId: contact.id,
        campaignId,
        campaignContactId,
        body: reply.body,
        mediaType: reply.mediaType,
        mediaUrl: reply.mediaUrl,
        // Carried so the send side can trace a delivered reply back to the message that
        // prompted it.
        inboundMessageId: message.id,
      },
      {
        // Short randomised pause. An instant answer is an unmistakable bot tell; a few
        // seconds reads as a person picking up their phone. The gateway's typing
        // simulation runs on top of this.
        delay: 4_000 + Math.floor(Math.random() * 11_000),
        attempts: 2,
        backoff: { type: 'fixed', delay: 30_000 },
        removeOnComplete: true,
      },
    );

    this.logger.log(
      `Queued AI reply to contact ${contact.id}: "${reply.body.slice(0, 60)}…"`,
    );
    return { queued: true, reason: 'queued' };
  }

  /** Global kill switch. Absent or anything but an explicit opt-in means off. */
  private isAutoReplyEnabledGlobally(): boolean {
    const raw = this.config?.get<string>('AI_AUTO_REPLY_ENABLED');
    return String(raw ?? '').trim().toLowerCase() === 'true';
  }

  /** Oldest-first window of the conversation with this contact. */
  private async loadHistory(contactId: string): Promise<Message[]> {
    const rows = await this.messageRepo.find({
      where: { contact_id: contactId },
      order: { created_at: 'DESC' },
      take: HISTORY_WINDOW,
    });
    return (rows ?? []).slice().reverse();
  }

  /** The earliest lead for a contact, which is the one all later replies belong to. */
  private async findLeadForContact(contactId: string): Promise<Lead | null> {
    return this.leadRepo.findOne({
      where: { contact_id: contactId },
      order: { created_at: 'ASC' },
    });
  }

  private async handOverToHuman(campaignContactId?: string): Promise<void> {
    if (!campaignContactId) return;
    try {
      await this.ccRepo.update(campaignContactId, { mode: 'human' as any });
    } catch (err) {
      this.logger.warn(
        `Could not flag CC ${campaignContactId} for human handover: ${(err as Error).message}`,
      );
    }
  }

  private buildDealNotes(
    analysis: AIAnalysisResult,
    reason: string,
    messageId?: string,
  ): string {
    return [
      'Created automatically from WhatsApp conversation analysis.',
      `Why: ${reason}.`,
      `Intent: ${analysis.intent}; interest: ${analysis.interest_level}; ` +
        `confidence: ${analysis.confidence}; lead score: ${analysis.lead_score}.`,
      analysis.travel_period ? `Travel period: ${analysis.travel_period}.` : null,
      analysis.traveller_count ? `Travellers: ${analysis.traveller_count}.` : null,
      analysis.destination_interest?.length
        ? `Destinations: ${analysis.destination_interest.join(', ')}.`
        : null,
      analysis.requirements ? `Requirements: ${analysis.requirements}` : null,
      analysis.reasoning ? `Model reasoning: ${analysis.reasoning}` : null,
      messageId ? `Triggered by message ${messageId}.` : null,
      'Value left blank on purpose — no quote has been given.',
    ]
      .filter(Boolean)
      .join('\n');
  }
}
