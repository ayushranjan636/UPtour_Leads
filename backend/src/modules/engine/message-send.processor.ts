import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { CampaignContact } from '../../entities/campaign-contact.entity';
import { Contact } from '../../entities/contact.entity';
import { Campaign } from '../../entities/campaign.entity';
import { Message } from '../../entities/message.entity';
import { MessageTemplate } from '../../entities/message-template.entity';
import { OpenwaService, toChatId } from '../openwa/openwa.service';
import { spin } from '../../common/utils/spintax.util';
import { FollowupSchedulerService } from './followup-scheduler.service';

interface SendJobData {
  campaignContactId: string;
  campaignId: string;
  contactId: string;
  sessionId: string;
  templateId?: string;
}

/**
 * Payload for an AI-composed reply. No templateId: the body is generated, already
 * sanitised and length-capped by AiService, and the contact need not be in a campaign.
 */
interface AiReplyJobData {
  contactId: string;
  campaignId?: string;
  campaignContactId?: string;
  body: string;
  mediaType: 'image' | 'video' | 'document' | null;
  mediaUrl: string | null;
  /** The inbound message this answers, so a sent reply can be traced to its trigger. */
  inboundMessageId?: string;
}

/**
 * MESSAGE SEND PROCESSOR
 * 
 * BullMQ worker that actually sends a WhatsApp message via OpenWA.
 * 
 * Flow:
 *   1. Load campaign_contact, contact, campaign, template
 *   2. Render template with contact variables
 *   3. Call OpenWA send API
 *   4. Store message record with openwa_message_id
 *   5. Update campaign_contact status
 *   6. Track workflow event
 *   7. Schedule follow-up if configured
 */
@Processor('message-send')
export class MessageSendProcessor extends WorkerHost {
  private readonly logger = new Logger(MessageSendProcessor.name);

  constructor(
    @InjectRepository(CampaignContact)
    private readonly ccRepo: Repository<CampaignContact>,
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    @InjectRepository(Campaign)
    private readonly campaignRepo: Repository<Campaign>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(MessageTemplate)
    private readonly templateRepo: Repository<MessageTemplate>,
    private readonly openwa: OpenwaService,
    // Injected lazily: FollowupSchedulerService lives in the same module and
    // does not depend back on this processor, so no circular ref.
    private readonly followupScheduler: FollowupSchedulerService,
  ) {
    super();
  }

  async process(job: Job<SendJobData>) {
    // AI replies are a different shape: there is no template, the body is already
    // composed, and the contact may not belong to any campaign.
    if (job.name === 'send-ai-reply') {
      return this.processAiReply(job as unknown as Job<AiReplyJobData>);
    }

    const { campaignContactId, campaignId, contactId, sessionId } = job.data;
    const startTime = Date.now();
    // Hoisted so the catch block can record what we attempted to send. Undefined when
    // the failure happened before rendering (e.g. no active template).
    let renderedBodyForAudit: string | undefined;

    try {
      // 1. Load entities
      const cc = await this.ccRepo.findOne({
        where: { id: campaignContactId },
        // contact.company is required: renderTemplate resolves {{company_name}} and
        // {{country}} from it. Without the relation both silently rendered as empty
        // strings in every outbound message.
        relations: ['contact', 'contact.company', 'campaign'],
      });
      if (!cc) throw new Error(`CampaignContact ${campaignContactId} not found`);

      const contact = cc.contact;
      const campaign = cc.campaign;

      // Safety: skip if opted out or suppressed
      if (contact.is_opted_out || contact.is_suppressed) {
        this.logger.log(`Skipped contact ${contactId}: ${contact.is_opted_out ? 'opted out' : `suppressed: ${contact.suppressed_reason}`}`);
        return { skipped: true, reason: 'opted_out_or_suppressed' };
      }

      // 2. Find the right template.
      // Resolve the step match and the fallback in one query rather than up to three:
      // the previous version queried the fallback twice and discarded the first result.
      const templates = await this.templateRepo.find({
        where: { campaign_id: campaignId },
        order: { sequence_order: 'ASC' },
      });

      if (!templates.length) {
        throw new Error(`No templates found for campaign ${campaignId}`);
      }

      const activeTemplate =
        templates.find((t) => t.sequence_order === cc.current_sequence_step) ??
        // Lowest sequence_order. Covers the common case where the first template was
        // authored as step 1 while current_sequence_step starts at 0.
        templates[0];

      // 3. Render template
      const renderedBody = this.renderTemplate(activeTemplate.body, contact, campaign);
      renderedBodyForAudit = renderedBody;

      // 4. Format chat ID for OpenWA (shared helper — the manual send path used to
      //    build this differently and left the leading `+` in, which the gateway rejects)
      const chatId = toChatId(contact.whatsapp_number, contact.whatsapp_chat_id);

      // 4b. Resolve the real session. Every queue producer enqueues
      //     `campaign.openwa_session_id || 'default'`, and 'default' is not a session
      //     id — the gateway answers `400 Session 'default' is not active`. Resolving
      //     here covers all four producers (distributor, follow-up, sequence, AI reply)
      //     in one place.
      const resolvedSessionId = await this.openwa.resolveSessionId(sessionId);

      // 5. Send via OpenWA
      let openwaResult: any;
      if (activeTemplate.type === 'text' || !activeTemplate.media_url) {
        openwaResult = await this.openwa.sendText(resolvedSessionId, chatId, renderedBody);
      } else if (activeTemplate.type === 'image') {
        openwaResult = await this.openwa.sendImage(resolvedSessionId, chatId, activeTemplate.media_url, renderedBody);
      } else if (activeTemplate.type === 'document') {
        openwaResult = await this.openwa.sendDocument(
          resolvedSessionId, chatId, activeTemplate.media_url,
          activeTemplate.media_filename || 'document.pdf', renderedBody,
        );
      } else if (activeTemplate.type === 'video') {
        openwaResult = await this.openwa.sendVideo(resolvedSessionId, chatId, activeTemplate.media_url, renderedBody);
      }

      // 6. Store message record
      const message = this.messageRepo.create({
        campaign_contact_id: campaignContactId,
        contact_id: contactId,
        direction: 'outgoing' as any,
        type: activeTemplate.type || 'text',
        body: renderedBody,
        media_url: activeTemplate.media_url,
        // OpenWA returns { messageId, timestamp } — see
        // openwa/src/modules/message/dto/send-message.dto.ts:78-84.
        // Reading `.id` stored null, so message.ack / message.failed webhooks
        // could never correlate back and statuses were stuck on "sent".
        openwa_message_id: openwaResult?.messageId ?? openwaResult?.id ?? null,
        openwa_session_id: resolvedSessionId,
        status: 'sent' as any,
        template_id: activeTemplate.id,
        sent_at: new Date(),
      });
      await this.messageRepo.save(message);

      // 7. Update campaign_contact
      const now = new Date();
      await this.ccRepo.update(campaignContactId, {
        status: 'sent' as any,
        first_sent_at: cc.first_sent_at || now,
        last_sent_at: now,
        current_sequence_step: cc.current_sequence_step + 1,
      });

      // 8. Update campaign stats
      await this.campaignRepo.increment({ id: campaignId }, 'stats_sent', 1);

      // 9. Schedule follow-ups after the FIRST message only.
      // Without this call no followup_jobs rows are ever created, so
      // FollowupSchedulerService.processFollowups() always finds nothing and
      // the entire follow-up leg of the funnel silently does nothing.
      if (!cc.first_sent_at) {
        try {
          await this.followupScheduler.scheduleFollowups(
            campaignContactId,
            campaignId,
            contactId,
          );
        } catch (scheduleErr) {
          // Never fail a delivered message because follow-up planning failed.
          this.logger.warn(
            `Follow-up scheduling failed for CC ${campaignContactId}: ${(scheduleErr as Error).message}`,
          );
        }
      }

      // 10. Log workflow
      const durationMs = Date.now() - startTime;
      this.logger.log(`Message sent via session ${sessionId} (openwa_id=${openwaResult?.messageId ?? openwaResult?.id}, template=${activeTemplate.id}, type=${activeTemplate.type}, ${durationMs}ms)`);

      this.logger.log(`Sent message to ${contact.whatsapp_number} via campaign ${campaign.name}`);
      return { success: true, messageId: message.id, openwaId: openwaResult?.messageId ?? openwaResult?.id };

    } catch (err) {
      const durationMs = Date.now() - startTime;
      this.logger.error(`Failed to send message for CC ${campaignContactId}: ${err.message}`);

      // Record *why* it failed, not just that it did.
      //
      // Previously only campaign_contacts.status was set, so a failed row had no message
      // and no reason: the UI showed a bare "Failed" and the cause could only be found by
      // grepping server logs. Persisting a row makes the reason visible in the campaign
      // and conversation views. Best-effort — a bookkeeping failure must not mask the
      // original send error, which BullMQ still needs to see to retry.
      try {
        await this.messageRepo.save(
          this.messageRepo.create({
            campaign_contact_id: campaignContactId,
            contact_id: contactId,
            direction: 'outgoing' as any,
            type: 'text' as any,
            body: renderedBodyForAudit ?? '',
            status: 'failed' as any,
            failed_reason: String(err?.message ?? err).slice(0, 500),
          }),
        );
      } catch (auditErr) {
        this.logger.warn(
          `Could not record the failure reason for CC ${campaignContactId}: ${(auditErr as Error).message}`,
        );
      }

      // Mark as failed
      await this.ccRepo.update(campaignContactId, { status: 'failed' as any });

      // Log failure
      this.logger.warn(`Message send failed for CC ${campaignContactId}: ${err.message} (${durationMs}ms)`);

      throw err; // BullMQ will retry based on config
    }
  }

  /**
   * Send an AI-generated reply.
   *
   * Kept separate from the campaign path because the two differ in every respect that
   * matters: no template lookup, a body that is already composed and sanitised, and a
   * contact that may have no campaign at all (an inbound message from someone who was
   * never enrolled still deserves an answer).
   *
   * Re-checks opt-out and suppression at send time: the job sat in a delay queue, and
   * the contact may have opted out in the meantime.
   */
  private async processAiReply(job: Job<AiReplyJobData>) {
    const { contactId, campaignContactId, body, mediaType, mediaUrl } = job.data;
    const startTime = Date.now();

    const contact = await this.contactRepo.findOne({
      where: { id: contactId },
      relations: ['company'],
    });
    if (!contact) throw new Error(`Contact ${contactId} not found`);

    if (contact.is_opted_out || contact.is_suppressed) {
      this.logger.log(`Skipped AI reply to ${contactId}: opted out or suppressed`);
      return { skipped: true, reason: 'opted_out_or_suppressed' };
    }

    // A human taking over between queue and send must win.
    if (campaignContactId) {
      const cc = await this.ccRepo.findOne({ where: { id: campaignContactId } });
      if (cc?.mode === 'human') {
        this.logger.log(`Skipped AI reply to ${contactId}: human took over`);
        return { skipped: true, reason: 'human_takeover' };
      }
    }

    const chatId = toChatId(contact.whatsapp_number, contact.whatsapp_chat_id);
    const sessionId = await this.openwa.resolveSessionId(null);

    let result: any;
    if (mediaType === 'image' && mediaUrl) {
      result = await this.openwa.sendImage(sessionId, chatId, mediaUrl, body);
    } else if (mediaType === 'video' && mediaUrl) {
      result = await this.openwa.sendVideo(sessionId, chatId, mediaUrl, body);
    } else if (mediaType === 'document' && mediaUrl) {
      result = await this.openwa.sendDocument(sessionId, chatId, mediaUrl, 'document.pdf', body);
    } else {
      result = await this.openwa.sendText(sessionId, chatId, body);
    }

    await this.messageRepo.save(
      this.messageRepo.create({
        campaign_contact_id: campaignContactId ?? (null as any),
        contact_id: contactId,
        direction: 'outgoing' as any,
        type: (mediaType ?? 'text') as any,
        body,
        media_url: mediaUrl ?? (null as any),
        openwa_message_id: result?.messageId ?? result?.id ?? null,
        openwa_session_id: sessionId,
        status: 'sent' as any,
        sent_at: new Date(),
        // Marks this as machine-composed rather than a template or a human send, so
        // the conversation view and any audit can tell them apart.
        is_ai_generated: true,
      }),
    );

    this.logger.log(`AI reply sent to ${contactId} in ${Date.now() - startTime}ms`);
    return { success: true };
  }

  /**
   * Replace template variables with actual contact/campaign data.
   * Supports: {{contact_name}}, {{company_name}}, {{country}}, {{state}},
   * {{district}}, {{city}}, {{product}}, {{campaign_name}}
   */
  private renderTemplate(body: string, contact: Contact, campaign: Campaign): string {
    if (!body) return '';

    // Requires the caller to have loaded `contact.company` — see process().
    const company = (contact as any).company;

    // Spin first, then substitute. Resolving spintax before merge fields means a
    // variant can itself contain a placeholder, and the placeholder protection in
    // spin() guarantees the fields survive the pass.
    const spun = spin(body);

    return spun
      .replace(/\{\{contact_name\}\}/g, contact.name || 'there')
      .replace(/\{\{company_name\}\}/g, company?.name || '')
      .replace(/\{\{country\}\}/g, company?.country || '')
      .replace(/\{\{state\}\}/g, company?.state_region || '')
      .replace(/\{\{district\}\}/g, company?.district || '')
      .replace(/\{\{city\}\}/g, company?.city || '')
      .replace(/\{\{product\}\}/g, campaign.product || '')
      .replace(/\{\{campaign_name\}\}/g, campaign.name || '');
  }
}
