import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Message } from '../../entities/message.entity';
import { CampaignContact } from '../../entities/campaign-contact.entity';
import { Contact } from '../../entities/contact.entity';
import { Lead, LeadStatus } from '../../entities/lead.entity';
import { Campaign } from '../../entities/campaign.entity';
import { AiAnalysis } from '../../entities/ai-analysis.entity';
import { AiService } from '../ai/ai.service';
import { InboundAiService, ReplyOutcome } from '../ai/inbound-ai.service';
import { isHumanInbound, advanceLeadStatus } from '../ai/inbound-ai.decisions';
import { SequenceService } from './sequence.service';

interface AnalysisJobData {
  messageId: string;
  contactId: string;
  campaignContactId?: string;
  campaignId?: string;
}

/**
 * AI ANALYSIS PROCESSOR
 * 
 * Processes incoming WhatsApp replies through OpenAI GPT-4o-mini.
 * 
 * Flow:
 *   1. Load message + conversation history
 *   2. Send to OpenAI for structured analysis
 *   3. Store analysis result
 *   4. Execute business rules:
 *      - High interest + confidence → Create lead + human handover
 *      - Medium interest → Continue AI engagement
 *      - Opt-out → Suppress immediately
 *      - Low confidence → Human review
 *      - Not interested → Stop sequence
 *   5. Check if reply triggers next sequence step
 *   6. Create notifications for leads, handovers, opt-outs
 */
@Processor('ai-analysis')
export class AiAnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger(AiAnalysisProcessor.name);

  constructor(
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(CampaignContact)
    private readonly ccRepo: Repository<CampaignContact>,
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
    @InjectRepository(Campaign)
    private readonly campaignRepo: Repository<Campaign>,
    @InjectRepository(AiAnalysis)
    private readonly analysisRepo: Repository<AiAnalysis>,
    private readonly aiService: AiService,
    private readonly inboundAi: InboundAiService,
    private readonly sequenceService: SequenceService,
  ) {
    super();
  }

  async process(job: Job<AnalysisJobData>) {
    const { messageId, contactId, campaignContactId, campaignId } = job.data;
    const startTime = Date.now();

    try {
      // 1. Load message
      const message = await this.messageRepo.findOne({ where: { id: messageId } });
      if (!message) throw new Error(`Message ${messageId} not found`);

      // 2. Load conversation history (last 10 messages)
      const history = await this.messageRepo.find({
        where: { contact_id: contactId },
        order: { created_at: 'DESC' },
        take: 10,
      });
      history.reverse();

      // 3. Load campaign context
      let campaignContext = '';
      if (campaignId) {
        const campaign = await this.campaignRepo.findOne({ where: { id: campaignId } });
        if (campaign) {
          campaignContext = `Product: ${campaign.product || 'India Tours'}. Target: ${campaign.target_country || 'Global'}.`;
        }
      }

      // 4. Call AI service
      const conversationHistory = history.map((m) => ({
        role: m.direction === 'outgoing' ? 'assistant' as const : 'user' as const,
        content: m.body || '',
      }));

      const analysis = await this.aiService.analyzeMessage(
        message.body || '',
        conversationHistory,
        { product: campaignContext || undefined, campaignName: undefined },
      );

      const processingTime = Date.now() - startTime;

      // 5. Store analysis
      const saved = await this.analysisRepo.save(
        this.analysisRepo.create({
          message_id: messageId,
          contact_id: contactId,
          campaign_contact_id: campaignContactId,
          intent: analysis.intent,
          interest_level: analysis.interest_level,
          product_interest: analysis.product_interest,
          // These columns are `text[] NOT NULL DEFAULT '{}'`, but the AI returns
          // null when the field is absent. Passing null violates the not-null
          // constraint and throws, losing the whole analysis.
          destination_interest: analysis.destination_interest ?? [],
          travel_period: analysis.travel_period,
          traveller_count: analysis.traveller_count,
          requirements: analysis.requirements,
          questions: analysis.questions ?? [],
          needs_human: analysis.needs_human,
          opt_out: analysis.opt_out,
          confidence: analysis.confidence,
          lead_score: analysis.lead_score,
          reasoning: analysis.reasoning,
          raw_llm_response: analysis as any,
          model_used: 'gpt-4o-mini',
          processing_time_ms: processingTime,
        }),
      );

      this.logger.log(`AI analyzed: Intent=${analysis.intent}, Interest=${analysis.interest_level}, Confidence=${analysis.confidence}, Score=${analysis.lead_score} (${processingTime}ms)`);

      // 6. Generate and queue an AI reply.
      //
      // Deliberately BEFORE executeBusinessRules: that method flips mode to 'human'
      // for high interest and for needs_human, and every downstream reply path bails
      // on mode === 'human'. Running it first meant the most engaged prospects — the
      // ones worth answering fastest — were the only ones who never got a reply.
      // The reply itself still yields to a human when the model says it should.
      //
      // Delegated to InboundAiService, which the webhook path also calls. One
      // implementation and one per-message dedupe claim means whichever path gets here
      // first answers, and the other finds the message already answered.
      const replyOutcome = await this.tryAiReply({
        message,
        contactId,
        campaignId,
        campaignContactId,
      });

      // `already_answered` counts as answered: the webhook path queued the reply, so the
      // canned sequence must still stay quiet or the prospect gets two messages.
      const replyQueued =
        replyOutcome.queued || replyOutcome.reason === 'already_answered';

      // 7. Execute business rules
      await this.executeBusinessRules(analysis, contactId, campaignId, campaignContactId);

      // 7b. Promote a converting conversation to a Deal.
      //
      // After the business rules, because those create or update the Lead a Deal must
      // hang off, and only for a genuine human message — a Deal conjured from our own
      // outbound text would be the most misleading row in the CRM. Best-effort: the
      // analysis and the reply are already persisted, so a Deal write failing must not
      // make BullMQ replay the whole job.
      if (isHumanInbound(message)) {
        try {
          await this.inboundAi.maybeCreateDealFromAnalysis({
            analysis,
            contactId,
            campaignId,
            campaignContactId,
            messageId,
          });
        } catch (dealErr) {
          this.logger.warn(
            `Deal classification failed for contact ${contactId}: ${(dealErr as Error).message}`,
          );
        }
      }

      // 8. Check sequence triggers — after analysis, see if reply triggers next step.
      //    Skipped when the AI already answered, so a prospect never receives a
      //    generated reply and a canned template for the same inbound message.
      if (campaignContactId && !replyQueued) {
        try {
          await this.sequenceService.onAiAnalysisComplete(campaignContactId, {
            intent: analysis.intent,
            interest_level: analysis.interest_level,
          });
        } catch (seqErr) {
          this.logger.warn(`Sequence check failed for CC ${campaignContactId}: ${seqErr.message}`);
        }
      }

      // 8. Create notifications (uses NotificationService via repository directly)
      await this.createNotifications(analysis, contactId, campaignId, campaignContactId);

      return { success: true, analysisId: saved.id, intent: analysis.intent };

    } catch (err) {
      this.logger.error(`AI analysis failed for message ${messageId}: ${err.message}`);

      // On AI failure, flag for human review
      if (campaignContactId) {
        await this.ccRepo.update(campaignContactId, { mode: 'human' as any });
      }

      throw err;
    }
  }

  /**
   * Generate an AI reply and queue it for sending, via the shared InboundAiService.
   *
   * This processor keeps a wrapper rather than calling the service inline so the one
   * precondition that matters is asserted in both entry points: only a genuine inbound
   * human message may be answered. An analysis job could in principle be enqueued for
   * any message id, and answering one of our own messages is the first step of an
   * AI-to-AI loop.
   */
  private async tryAiReply(input: {
    message: Message;
    contactId: string;
    campaignId?: string;
    campaignContactId?: string;
  }): Promise<ReplyOutcome> {
    const { message, contactId, campaignId, campaignContactId } = input;

    if (!isHumanInbound(message)) {
      this.logger.warn(
        `Not auto-replying to message ${message.id}: not a human inbound message ` +
          `(direction=${message.direction}, is_ai_generated=${message.is_ai_generated})`,
      );
      return { queued: false, reason: 'not_human_inbound' };
    }

    const contact = await this.contactRepo.findOne({
      where: { id: contactId },
      relations: ['company'],
    });
    if (!contact) return { queued: false, reason: 'not_human_inbound' };

    return this.inboundAi.maybeAutoReply({
      message,
      contact,
      campaignId,
      campaignContactId,
    });
  }

  /**
   * Business rules engine — decides what happens based on AI analysis.
   */
  private async executeBusinessRules(
    analysis: any,
    contactId: string,
    campaignId?: string,
    campaignContactId?: string,
  ) {
    // RULE: Opt-out → immediate suppression
    if (analysis.opt_out) {
      await this.contactRepo.update(contactId, {
        is_opted_out: true,
        opted_out_at: new Date(),
      });
      if (campaignContactId) {
        await this.ccRepo.update(campaignContactId, { status: 'opted_out' as any });
      }
      if (campaignId) {
        await this.campaignRepo.increment({ id: campaignId }, 'stats_opted_out', 1);
      }
      this.logger.log(`Contact ${contactId} opted out — all automation stopped`);
      return;
    }

    // RULE: High interest + confidence → Create lead + human handover
    if (
      (analysis.interest_level === 'high' || analysis.interest_level === 'medium') &&
      analysis.confidence >= 0.7
    ) {
      // Upsert: a contact who replies multiple times must not create a new lead
      // each time. Previously every qualifying reply inserted a duplicate row
      // and re-incremented stats_leads, inflating the pipeline.
      //
      // Scoped to the contact alone, matching InboundAiService: the owner's rule is one
      // lead per person who replied. Including campaign_id in the lookup meant the lead
      // the webhook path had just created without a campaign link was invisible here,
      // and a second row was inserted for the same reply.
      const existingLead = await this.leadRepo.findOne({
        where: { contact_id: contactId },
        order: { created_at: 'ASC' },
      });

      const leadFields = {
        product_interest: analysis.product_interest,
        destinations: analysis.destination_interest ?? [],
        travel_period: analysis.travel_period,
        group_size: analysis.traveller_count,
        requirements: analysis.requirements,
        lead_score: analysis.lead_score,
      };

      const classifiedStatus =
        analysis.interest_level === 'high' ? LeadStatus.INTERESTED : LeadStatus.ENGAGED;

      if (existingLead) {
        // Enrichment never regresses the funnel. A later reply classified as merely
        // engaged must not pull a lead a human already qualified, won or closed back to
        // an earlier status, so the status is only written when it moves forward.
        const nextStatus = advanceLeadStatus(existingLead.status, classifiedStatus);
        await this.leadRepo.update(existingLead.id, {
          ...leadFields,
          ...(nextStatus ? { status: nextStatus } : {}),
        });
        this.logger.log(
          `Lead ${existingLead.id} updated (score ${analysis.lead_score}) for contact ${contactId}`,
        );
      } else {
        const leadEntity = this.leadRepo.create({
          contact_id: contactId,
          campaign_id: campaignId,
          campaign_contact_id: campaignContactId,
          source: 'whatsapp_campaign',
          status: classifiedStatus,
          ...leadFields,
        });
        await this.leadRepo.save(leadEntity);

        if (campaignId) {
          await this.campaignRepo.increment({ id: campaignId }, 'stats_leads', 1);
        }

        this.logger.log(
          `Lead created with score ${analysis.lead_score} for contact ${contactId}`,
        );
      }

      // Human handover for high interest
      if (analysis.needs_human || analysis.interest_level === 'high') {
        if (campaignContactId) {
          await this.ccRepo.update(campaignContactId, {
            mode: 'human' as any,
            status: 'human_takeover' as any,
          });
        }
        this.logger.log(`Contact ${contactId} transferred to human sales — AI automation paused`);
      }
      return;
    }

    // RULE: Low confidence → human review
    if (analysis.confidence < 0.5) {
      if (campaignContactId) {
        await this.ccRepo.update(campaignContactId, { mode: 'human' as any });
      }
      this.logger.warn(`Low confidence (${analysis.confidence}) for contact ${contactId} — flagged for human review`);
      return;
    }

    // RULE: Not interested → stop sequence
    if (analysis.intent === 'not_interested') {
      if (campaignContactId) {
        await this.ccRepo.update(campaignContactId, { status: 'replied' as any });
      }
      return;
    }

    // RULE: Update status to replied
    if (campaignContactId) {
      await this.ccRepo.update(campaignContactId, {
        status: 'replied' as any,
        last_reply_at: new Date(),
      });
    }
    if (campaignId) {
      await this.campaignRepo.increment({ id: campaignId }, 'stats_replied', 1);
    }
  }

  /**
   * Create notifications based on AI analysis results.
   * Uses direct DB insert to avoid circular dependency with NotificationModule.
   */
  private async createNotifications(
    analysis: any,
    contactId: string,
    campaignId?: string,
    campaignContactId?: string,
  ): Promise<void> {
    try {
      const notifRepo = this.messageRepo.manager.getRepository('Notification');

      // Resolve a human label once. Notification text previously interpolated the raw
      // contact UUID, so the bell read "Contact 8f3a1c7e-… has opted out" — unusable
      // at a glance. Prefer the person's name, fall back to their number.
      const contact = await this.contactRepo.findOne({
        where: { id: contactId },
        relations: ['company'],
      });
      const who = contact?.name || contact?.whatsapp_number || 'Unknown contact';
      const org = (contact as any)?.company?.name;
      const label = org && org !== who ? `${who} (${org})` : who;

      if (analysis.opt_out) {
        await notifRepo.save(notifRepo.create({
          type: 'opt_out',
          title: 'Contact Opted Out',
          message: `${label} asked to stop receiving messages.`,
          metadata: { contactId, campaignId, campaignContactId },
          is_read: false,
        }));
      }

      if (
        (analysis.interest_level === 'high' || analysis.interest_level === 'medium') &&
        analysis.confidence >= 0.7
      ) {
        await notifRepo.save(notifRepo.create({
          type: 'new_lead',
          title: 'New Lead Created',
          message: `${label} replied with ${analysis.interest_level} interest (score ${analysis.lead_score}).`,
          metadata: { contactId, campaignId, interestLevel: analysis.interest_level, leadScore: analysis.lead_score },
          is_read: false,
        }));

        if (analysis.needs_human || analysis.interest_level === 'high') {
          await notifRepo.save(notifRepo.create({
            type: 'handover',
            title: 'Human Handover Required',
            message: `${label} needs a human reply — ${analysis.interest_level} interest.`,
            metadata: { contactId, campaignId, campaignContactId, reason: 'high_interest' },
            is_read: false,
          }));
        }
      }
    } catch (err) {
      // Notification creation is non-critical — don't fail the pipeline
      this.logger.warn(`Failed to create notifications: ${err.message}`);
    }
  }
}
