import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CampaignContact } from '../../entities/campaign-contact.entity';
import { MessageTemplate } from '../../entities/message-template.entity';
import { Message, MessageDirection } from '../../entities/message.entity';
import { AiAnalysis } from '../../entities/ai-analysis.entity';
import { Campaign } from '../../entities/campaign.entity';

/**
 * SEQUENCE SERVICE
 *
 * Manages multi-step message sequences with conditional triggers.
 *
 * Each campaign has templates with sequence_order and trigger_condition:
 *   0: 'initial'            → first message, sent immediately
 *   1: 'no_reply_48h'       → send if no reply after 48 hours
 *   2: 'no_reply_120h'      → send if no reply after 5 days
 *   3: 'replied_interested'  → auto-reply when AI detects interest
 *   4: 'replied_question'    → auto-reply when AI detects a question
 *
 * The service evaluates conditions and advances contacts through
 * the sequence, queuing the next message when conditions are met.
 */
@Injectable()
export class SequenceService {
  private readonly logger = new Logger(SequenceService.name);

  constructor(
    @InjectRepository(CampaignContact)
    private readonly ccRepo: Repository<CampaignContact>,
    @InjectRepository(MessageTemplate)
    private readonly templateRepo: Repository<MessageTemplate>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(AiAnalysis)
    private readonly analysisRepo: Repository<AiAnalysis>,
    @InjectRepository(Campaign)
    private readonly campaignRepo: Repository<Campaign>,
    @InjectQueue('message-send')
    private readonly sendQueue: Queue,
  ) {}

  /**
   * Determine which template to send next for a campaign contact.
   * Returns the next template in the sequence, or null if sequence is complete.
   */
  async getNextStep(campaignContactId: string): Promise<MessageTemplate | null> {
    const cc = await this.ccRepo.findOne({
      where: { id: campaignContactId },
      relations: ['campaign'],
    });
    if (!cc) return null;

    // Find template at current sequence step
    const nextTemplate = await this.templateRepo.findOne({
      where: {
        campaign_id: cc.campaign_id,
        sequence_order: cc.current_sequence_step,
      },
    });

    return nextTemplate || null;
  }

  /**
   * Evaluate if a trigger condition is met for a campaign contact.
   *
   * Supported conditions:
   * - 'initial': always true (first message)
   * - 'no_reply_48h': true if no reply within 48 hours of last send
   * - 'no_reply_120h': true if no reply within 120 hours (5 days)
   * - 'replied_interested': true if latest AI analysis shows interest
   * - 'replied_question': true if latest AI analysis detects a question
   */
  async evaluateCondition(
    condition: string,
    campaignContact: CampaignContact,
  ): Promise<boolean> {
    switch (condition) {
      case 'initial':
        return true;

      case 'no_reply_48h':
        return this.checkNoReply(campaignContact, 48);

      case 'no_reply_120h':
        return this.checkNoReply(campaignContact, 120);

      case 'replied_interested':
        return this.checkAiCondition(campaignContact, 'interested');

      case 'replied_question':
        return this.checkAiCondition(campaignContact, 'question');

      default:
        this.logger.warn(`Unknown trigger condition: ${condition}`);
        return false;
    }
  }

  /**
   * Advance a campaign contact to the next step in the sequence.
   * Evaluates the trigger condition and queues the next message if met.
   *
   * Returns true if a message was queued, false otherwise.
   */
  async advanceSequence(campaignContactId: string): Promise<boolean> {
    const cc = await this.ccRepo.findOne({
      where: { id: campaignContactId },
      relations: ['contact', 'campaign'],
    });
    if (!cc) {
      this.logger.warn(`CampaignContact ${campaignContactId} not found`);
      return false;
    }

    // Skip if contact opted out, suppressed, or human takeover
    if (cc.contact.is_opted_out || cc.contact.is_suppressed || cc.mode === 'human') {
      return false;
    }

    // Skip if campaign not active
    if (cc.campaign.status !== 'active') return false;

    // Find the next template
    const nextTemplate = await this.templateRepo.findOne({
      where: {
        campaign_id: cc.campaign_id,
        sequence_order: cc.current_sequence_step,
      },
    });

    if (!nextTemplate) {
      this.logger.log(`Sequence complete for CC ${campaignContactId} (no template at step ${cc.current_sequence_step})`);
      return false;
    }

    // Evaluate the condition
    const conditionMet = await this.evaluateCondition(nextTemplate.trigger_condition, cc);
    if (!conditionMet) {
      this.logger.debug(`Condition '${nextTemplate.trigger_condition}' not met for CC ${campaignContactId}`);
      return false;
    }

    // Queue the message
    await this.sendQueue.add(
      'send-campaign-message',
      {
        campaignContactId: cc.id,
        campaignId: cc.campaign_id,
        contactId: cc.contact_id,
        sessionId: cc.campaign.openwa_session_id || 'default',
        templateId: nextTemplate.id,
      },
      {
        attempts: 2,
        backoff: { type: 'fixed', delay: 30000 },
        removeOnComplete: true,
      },
    );

    this.logger.log(
      `Sequence step ${cc.current_sequence_step} queued for CC ${campaignContactId} ` +
      `(condition: ${nextTemplate.trigger_condition}, template: ${nextTemplate.name})`,
    );

    return true;
  }

  /**
   * Called after AI analysis to check if the reply triggers the next
   * message in the sequence. Handles 'replied_interested' and
   * 'replied_question' conditions.
   */
  async onAiAnalysisComplete(
    campaignContactId: string,
    analysisResult: { intent: string; interest_level: string },
  ): Promise<boolean> {
    if (!campaignContactId) return false;

    const cc = await this.ccRepo.findOne({
      where: { id: campaignContactId },
      relations: ['campaign'],
    });
    if (!cc || cc.mode === 'human') return false;

    // Find all reply-triggered templates for this campaign at current step
    const templates = await this.templateRepo.find({
      where: { campaign_id: cc.campaign_id },
      order: { sequence_order: 'ASC' },
    });

    // Look for a reply-condition template at or above current step
    for (const template of templates) {
      if (template.sequence_order < cc.current_sequence_step) continue;

      if (
        template.trigger_condition === 'replied_interested' &&
        (analysisResult.interest_level === 'high' || analysisResult.interest_level === 'medium')
      ) {
        return this.queueTemplate(cc, template);
      }

      if (
        template.trigger_condition === 'replied_question' &&
        analysisResult.intent === 'question'
      ) {
        return this.queueTemplate(cc, template);
      }
    }

    return false;
  }

  /** Check if no reply within the given hours */
  private checkNoReply(cc: CampaignContact, hours: number): boolean {
    if (cc.last_reply_at) return false; // contact replied
    if (!cc.last_sent_at) return false; // nothing sent yet

    const hoursSinceSent = (Date.now() - cc.last_sent_at.getTime()) / (1000 * 60 * 60);
    return hoursSinceSent >= hours;
  }

  /** Check AI analysis condition */
  private async checkAiCondition(
    cc: CampaignContact,
    type: 'interested' | 'question',
  ): Promise<boolean> {
    if (!cc.last_reply_at) return false; // no reply to analyze

    const latestAnalysis = await this.analysisRepo.findOne({
      where: { campaign_contact_id: cc.id },
      order: { created_at: 'DESC' },
    });
    if (!latestAnalysis) return false;

    if (type === 'interested') {
      return latestAnalysis.interest_level === 'high' || latestAnalysis.interest_level === 'medium';
    }
    if (type === 'question') {
      return latestAnalysis.intent === 'question' || latestAnalysis.intent === 'request_info';
    }
    return false;
  }

  /** Queue a specific template for a campaign contact */
  private async queueTemplate(cc: CampaignContact, template: MessageTemplate): Promise<boolean> {
    await this.sendQueue.add(
      'send-campaign-message',
      {
        campaignContactId: cc.id,
        campaignId: cc.campaign_id,
        contactId: cc.contact_id,
        sessionId: cc.campaign?.openwa_session_id || 'default',
        templateId: template.id,
      },
      {
        attempts: 2,
        backoff: { type: 'fixed', delay: 30000 },
        removeOnComplete: true,
      },
    );

    this.logger.log(
      `Reply-triggered template "${template.name}" queued for CC ${cc.id} (condition: ${template.trigger_condition})`,
    );

    return true;
  }
}
