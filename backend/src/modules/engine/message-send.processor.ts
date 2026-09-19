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
import { OpenwaService } from '../openwa/openwa.service';
import { FollowupSchedulerService } from './followup-scheduler.service';

interface SendJobData {
  campaignContactId: string;
  campaignId: string;
  contactId: string;
  sessionId: string;
  templateId?: string;
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
    const { campaignContactId, campaignId, contactId, sessionId } = job.data;
    const startTime = Date.now();

    try {
      // 1. Load entities
      const cc = await this.ccRepo.findOne({
        where: { id: campaignContactId },
        relations: ['contact', 'campaign'],
      });
      if (!cc) throw new Error(`CampaignContact ${campaignContactId} not found`);

      const contact = cc.contact;
      const campaign = cc.campaign;

      // Safety: skip if opted out or suppressed
      if (contact.is_opted_out || contact.is_suppressed) {
        this.logger.log(`Skipped contact ${contactId}: ${contact.is_opted_out ? 'opted out' : `suppressed: ${contact.suppressed_reason}`}`);
        return { skipped: true, reason: 'opted_out_or_suppressed' };
      }

      // 2. Find the right template
      const template = await this.templateRepo.findOne({
        where: {
          campaign_id: campaignId,
          sequence_order: cc.current_sequence_step,
        },
        order: { sequence_order: 'ASC' },
      });

      if (!template) {
        // Fallback: use first template
        const fallback = await this.templateRepo.findOne({
          where: { campaign_id: campaignId },
          order: { sequence_order: 'ASC' },
        });
        if (!fallback) throw new Error(`No templates found for campaign ${campaignId}`);
      }

      const activeTemplate = template || await this.templateRepo.findOne({
        where: { campaign_id: campaignId },
        order: { sequence_order: 'ASC' },
      });

      // 3. Render template
      const renderedBody = this.renderTemplate(activeTemplate.body, contact, campaign);

      // 4. Format chat ID for OpenWA
      const chatId = contact.whatsapp_chat_id || `${contact.whatsapp_number.replace('+', '')}@c.us`;

      // 5. Send via OpenWA
      let openwaResult: any;
      if (activeTemplate.type === 'text' || !activeTemplate.media_url) {
        openwaResult = await this.openwa.sendText(sessionId, chatId, renderedBody);
      } else if (activeTemplate.type === 'image') {
        openwaResult = await this.openwa.sendImage(sessionId, chatId, activeTemplate.media_url, renderedBody);
      } else if (activeTemplate.type === 'document') {
        openwaResult = await this.openwa.sendDocument(
          sessionId, chatId, activeTemplate.media_url,
          activeTemplate.media_filename || 'document.pdf', renderedBody,
        );
      } else if (activeTemplate.type === 'video') {
        openwaResult = await this.openwa.sendVideo(sessionId, chatId, activeTemplate.media_url, renderedBody);
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
        openwa_session_id: sessionId,
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

      // Mark as failed
      await this.ccRepo.update(campaignContactId, { status: 'failed' as any });

      // Log failure
      this.logger.warn(`Message send failed for CC ${campaignContactId}: ${err.message} (${durationMs}ms)`);

      throw err; // BullMQ will retry based on config
    }
  }

  /**
   * Replace template variables with actual contact/campaign data.
   * Supports: {{contact_name}}, {{company_name}}, {{country}}, {{product}}
   */
  private renderTemplate(body: string, contact: Contact, campaign: Campaign): string {
    if (!body) return '';

    return body
      .replace(/\{\{contact_name\}\}/g, contact.name || 'there')
      .replace(/\{\{company_name\}\}/g, (contact as any).company?.name || '')
      .replace(/\{\{country\}\}/g, (contact as any).company?.country || '')
      .replace(/\{\{product\}\}/g, campaign.product || '')
      .replace(/\{\{campaign_name\}\}/g, campaign.name || '');
  }
}
