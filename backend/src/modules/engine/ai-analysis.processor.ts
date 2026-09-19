import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Message } from '../../entities/message.entity';
import { CampaignContact } from '../../entities/campaign-contact.entity';
import { Contact } from '../../entities/contact.entity';
import { Lead } from '../../entities/lead.entity';
import { Campaign } from '../../entities/campaign.entity';
import { AiAnalysis } from '../../entities/ai-analysis.entity';
import { AiService } from '../ai/ai.service';
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

      // 6. Execute business rules
      await this.executeBusinessRules(analysis, contactId, campaignId, campaignContactId);

      // 7. Check sequence triggers — after analysis, see if reply triggers next step
      if (campaignContactId) {
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
      const existingLead = await this.leadRepo.findOne({
        where: {
          contact_id: contactId,
          ...(campaignId ? { campaign_id: campaignId } : {}),
        },
      });

      const leadFields = {
        status: (analysis.interest_level === 'high'
          ? 'interested'
          : 'engaged') as any,
        product_interest: analysis.product_interest,
        destinations: analysis.destination_interest ?? [],
        travel_period: analysis.travel_period,
        group_size: analysis.traveller_count,
        requirements: analysis.requirements,
        lead_score: analysis.lead_score,
      };

      if (existingLead) {
        await this.leadRepo.update(existingLead.id, leadFields);
        this.logger.log(
          `Lead ${existingLead.id} updated (score ${analysis.lead_score}) for contact ${contactId}`,
        );
      } else {
        const leadEntity = this.leadRepo.create({
          contact_id: contactId,
          campaign_id: campaignId,
          campaign_contact_id: campaignContactId,
          source: 'whatsapp_campaign',
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

      if (analysis.opt_out) {
        await notifRepo.save(notifRepo.create({
          type: 'opt_out',
          title: 'Contact Opted Out',
          message: `Contact ${contactId} has opted out of messaging`,
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
          message: `New lead from contact ${contactId} with interest level: ${analysis.interest_level}, score: ${analysis.lead_score}`,
          metadata: { contactId, campaignId, interestLevel: analysis.interest_level, leadScore: analysis.lead_score },
          is_read: false,
        }));

        if (analysis.needs_human || analysis.interest_level === 'high') {
          await notifRepo.save(notifRepo.create({
            type: 'handover',
            title: 'Human Handover Required',
            message: `Contact ${contactId} needs human attention — interest: ${analysis.interest_level}`,
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
