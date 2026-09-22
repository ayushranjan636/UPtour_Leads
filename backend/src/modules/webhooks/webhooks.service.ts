import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Message, MessageDirection, MessageStatus } from '../../entities/message.entity';
import { Contact } from '../../entities/contact.entity';
import {
  CampaignContact,
  CampaignContactStatus,
} from '../../entities/campaign-contact.entity';
import { Campaign, CampaignStatus } from '../../entities/campaign.entity';
import { NotificationService } from '../notifications/notification.service';
import { RedisService } from '../../common/redis/redis.service';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    @InjectRepository(CampaignContact)
    private readonly campaignContactRepo: Repository<CampaignContact>,
    @InjectRepository(Campaign)
    private readonly campaignRepo: Repository<Campaign>,
    @InjectQueue('ai-analysis')
    private readonly aiAnalysisQueue: Queue,
    @InjectQueue('webhook-process')
    private readonly webhookProcessQueue: Queue,
    private readonly notificationService: NotificationService,
    private readonly redis: RedisService,
  ) {}

  async processEvent(payload: any): Promise<void> {
    const event: string = payload?.event;
    this.logger.log(`Processing webhook event: ${event}`);

    // Idempotency: OpenWA retries failed deliveries, and a retry must not
    // insert a second message row, enqueue a second AI analysis, or create a
    // second lead. Key on the delivery/idempotency key when present, else on
    // event + message id.
    const dedupId =
      payload?.idempotencyKey ??
      payload?.deliveryId ??
      (payload?.data?.messageId ?? payload?.data?.id);

    if (dedupId) {
      const key = `webhook:seen:${event}:${dedupId}`;
      if (await this.redis.isDuplicate(key)) {
        this.logger.log(
          `Skipping duplicate webhook delivery (${event}, ${dedupId})`,
        );
        return;
      }
    }

    const KNOWN_EVENTS = [
      'message.received',
      'message.ack',
      'message.failed',
      'session.status',
    ];

    if (!KNOWN_EVENTS.includes(event)) {
      this.logger.warn(`Unknown webhook event: ${event}`);
      return;
    }

    // Hand off to the `webhook-process` queue rather than doing the work inline.
    // The controller always answers 200 so OpenWA stops retrying, which meant an
    // inline failure was lost forever. Queueing gives us bounded retries with
    // backoff and a durable failed-job record.
    try {
      await this.webhookProcessQueue.add(
        'process-webhook',
        { event, data: payload.data },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    } catch (error) {
      // Queue unavailable — fall back to inline handling so the event is not
      // dropped entirely.
      this.logger.warn(
        `Could not queue webhook ${event}, handling inline: ${(error as Error).message}`,
      );
      await this.handleEventInline(event, payload.data);
    }
  }

  /** Direct dispatch, used as a fallback and by the queue processor. */
  async handleEventInline(event: string, data: any): Promise<void> {
    try {
      switch (event) {
        case 'message.received':
          await this.handleMessageReceived(data);
          break;
        case 'message.ack':
          await this.handleMessageAck(data);
          break;
        case 'message.failed':
          await this.handleMessageFailed(data);
          break;
        case 'session.status':
          await this.handleSessionStatus(data);
          break;
        default:
          this.logger.warn(`Unknown webhook event: ${event}`);
      }
    } catch (error) {
      this.logger.error(
        `Error processing event ${event}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  async handleMessageReceived(data: any): Promise<void> {
    this.logger.log('Handling incoming message');

    try {
      const senderJid: string = data.from ?? data.sender ?? '';
      const body: string = data.body ?? '';
      const type: string = data.type ?? 'text';
      const mediaUrl: string | null = data.mediaUrl ?? data.media_url ?? null;
      const openwaMessageId: string | null = data.id ?? data.messageId ?? null;
      const sessionId: string | null = data.sessionId ?? data.session_id ?? null;

      const phone = this.normalizeJidToPhone(senderJid);
      this.logger.log(`Incoming message from ${phone ?? senderJid} (JID: ${senderJid})`);

      // Ignore group and broadcast traffic.
      //
      // The auto-create path below turns any unrecognised sender into a CRM contact.
      // For a group JID (`…@g.us`) or a status broadcast that produces a junk contact
      // named after the group id, which then appears in audiences and could be
      // messaged. Only 1:1 chats represent a person we do outreach to.
      if (this.isNonIndividualChat(senderJid)) {
        this.logger.log(`Ignoring ${senderJid}: not a one-to-one chat`);
        return;
      }

      // Match on the chat id as well as the phone: an `@lid` sender has no usable
      // number, so the JID is the only stable key we can link it by.
      let contact = await this.contactRepo.findOne({
        where: phone
          ? [{ whatsapp_number: phone }, { whatsapp_chat_id: senderJid }]
          : [{ whatsapp_chat_id: senderJid }],
      });

      if (!contact) {
        // Without a dialable number we cannot start an outreach conversation, and
        // storing the raw JID as both name and number is what produced contacts called
        // "+263986490642451@lid". Log the message against no contact rather than invent
        // one; a genuine prospect replying from a campaign always resolves above.
        if (!phone) {
          this.logger.log(
            `Ignoring inbound from ${senderJid}: privacy-masked id with no dialable number ` +
              'and no existing contact to attach it to',
          );
          return;
        }

        this.logger.log(`Creating new contact for ${phone}`);
        contact = this.contactRepo.create({
          name: phone,
          whatsapp_number: phone,
          whatsapp_chat_id: senderJid,
          whatsapp_verified: true,
          source: 'whatsapp_inbound',
        });
        contact = await this.contactRepo.save(contact);
      } else if (!contact.whatsapp_chat_id) {
        contact.whatsapp_chat_id = senderJid;
        await this.contactRepo.save(contact);
      }

      const message = this.messageRepo.create({
        contact_id: contact.id,
        direction: MessageDirection.INCOMING,
        type,
        body,
        media_url: mediaUrl,
        openwa_message_id: openwaMessageId,
        openwa_session_id: sessionId,
        status: MessageStatus.DELIVERED,
        delivered_at: new Date(),
      });
      const savedMessage = await this.messageRepo.save(message);

      const activeCampaignContact = await this.campaignContactRepo.findOne({
        where: {
          contact_id: contact.id,
          status: CampaignContactStatus.SENT,
        },
        order: { created_at: 'DESC' },
      });

      let campaignContactId: string | null = null;

      if (activeCampaignContact) {
        this.logger.log(
          `Updating campaign contact ${activeCampaignContact.id} to replied`,
        );
        activeCampaignContact.last_reply_at = new Date();
        activeCampaignContact.status = CampaignContactStatus.REPLIED;
        await this.campaignContactRepo.save(activeCampaignContact);

        savedMessage.campaign_contact_id = activeCampaignContact.id;
        await this.messageRepo.save(savedMessage);

        campaignContactId = activeCampaignContact.id;

        await this.campaignRepo.increment(
          { id: activeCampaignContact.campaign_id },
          'stats_replied',
          1,
        );
      }

      await this.aiAnalysisQueue.add(
        'analyze-reply',
        {
          messageId: savedMessage.id,
          contactId: contact.id,
          campaignContactId,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );

      this.logger.log(
        `Incoming message ${savedMessage.id} processed and queued for AI analysis`,
      );

      // Create notification for new reply
      try {
        await this.notificationService.create(
          'new_reply',
          'New WhatsApp Reply',
          `${contact.name || phone} replied: "${(body || '').substring(0, 100)}${body?.length > 100 ? '...' : ''}"`,
          {
            contactId: contact.id,
            messageId: savedMessage.id,
            campaignContactId: campaignContactId,
            phone,
          },
        );
      } catch (notifErr) {
        this.logger.warn(`Failed to create reply notification: ${(notifErr as Error).message}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle incoming message: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  async handleMessageAck(data: any): Promise<void> {
    this.logger.log('Handling message acknowledgment');

    try {
      const openwaMessageId: string =
        data.id ?? data.messageId ?? data.openwa_message_id ?? '';
      const ackLevel: number | string = data.ack ?? data.status ?? 0;

      if (!openwaMessageId) {
        this.logger.warn('Message ack received without message ID');
        return;
      }

      const message = await this.messageRepo.findOne({
        where: { openwa_message_id: openwaMessageId },
      });

      if (!message) {
        this.logger.warn(
          `Message not found for ack: ${openwaMessageId}`,
        );
        return;
      }

      const { status, timestamp } = this.mapAckToStatus(ackLevel);
      message.status = status;

      if (timestamp === 'sent_at' && !message.sent_at) {
        message.sent_at = new Date();
      }
      if (timestamp === 'delivered_at' && !message.delivered_at) {
        message.delivered_at = new Date();
      }
      if (timestamp === 'read_at' && !message.read_at) {
        message.read_at = new Date();
      }

      await this.messageRepo.save(message);

      if (message.campaign_contact_id) {
        const campaignContact = await this.campaignContactRepo.findOne({
          where: { id: message.campaign_contact_id },
        });

        if (campaignContact) {
          const shouldUpdate =
            this.statusPriority(status) >
            this.statusPriority(campaignContact.status as unknown as MessageStatus);

          if (shouldUpdate) {
            campaignContact.status =
              status as unknown as CampaignContactStatus;
            await this.campaignContactRepo.save(campaignContact);
          }

          const statsField = this.statusToStatsField(status);
          if (statsField) {
            await this.campaignRepo.increment(
              { id: campaignContact.campaign_id },
              statsField,
              1,
            );
          }
        }
      }

      this.logger.log(
        `Message ${message.id} ack updated to ${status}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle message ack: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  async handleMessageFailed(data: any): Promise<void> {
    this.logger.log('Handling message failure');

    try {
      const openwaMessageId: string =
        data.id ?? data.messageId ?? data.openwa_message_id ?? '';
      const failedReason: string =
        data.reason ?? data.error ?? 'Unknown failure reason';

      if (!openwaMessageId) {
        this.logger.warn('Message failure received without message ID');
        return;
      }

      const message = await this.messageRepo.findOne({
        where: { openwa_message_id: openwaMessageId },
      });

      if (!message) {
        this.logger.warn(
          `Message not found for failure: ${openwaMessageId}`,
        );
        return;
      }

      message.status = MessageStatus.FAILED;
      message.failed_reason = failedReason;
      await this.messageRepo.save(message);

      if (message.campaign_contact_id) {
        const campaignContact = await this.campaignContactRepo.findOne({
          where: { id: message.campaign_contact_id },
        });

        if (campaignContact) {
          campaignContact.status = CampaignContactStatus.FAILED;
          await this.campaignContactRepo.save(campaignContact);
        }
      }

      this.logger.error(
        `Message ${message.id} failed: ${failedReason}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle message failure: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  async handleSessionStatus(data: any): Promise<void> {
    const sessionId: string = data.sessionId ?? data.session_id ?? 'unknown';
    const status: string = data.status ?? 'unknown';

    this.logger.log(
      `Session status change: ${sessionId} → ${status}`,
    );

    if (
      status === 'disconnected' ||
      status === 'DISCONNECTED' ||
      status === 'CONFLICT'
    ) {
      this.logger.error(
        `CRITICAL: WhatsApp session ${sessionId} disconnected — status: ${status}. ` +
          'Campaigns using this session will not be able to send messages.',
      );
    }
  }

  /**
   * Convert a WhatsApp JID to a storable phone number.
   *
   * Returns null when the JID carries no real phone number. `@lid` is WhatsApp's
   * privacy-preserving "linked id": the digits are an internal identifier, NOT a
   * dialable number, so treating them as one produced contacts literally named
   * `+263986490642451@lid` that could never be messaged back. Those must be recognised
   * rather than coerced.
   */
  private normalizeJidToPhone(jid: string): string | null {
    if (/@lid$/i.test(jid)) return null;
    const raw = jid.replace(/@c\.us$/i, '').replace(/@s\.whatsapp\.net$/i, '');
    const digits = raw.replace(/[^\d]/g, '');
    // A real international number is at least 8 digits; anything shorter (e.g. "0")
    // is a gateway artefact, not a contact.
    if (digits.length < 8) return null;
    return `+${digits}`;
  }

  /**
   * True for JIDs that do not represent a single person we can do outreach to.
   *
   * `@g.us` is a group, `@broadcast` covers status updates and broadcast lists, and
   * `@newsletter` is a WhatsApp Channel. A 1:1 chat is `@c.us`, `@s.whatsapp.net`, or
   * `@lid` (the privacy-preserving id newer clients use).
   */
  private isNonIndividualChat(jid: string): boolean {
    return /@(g\.us|broadcast|newsletter)$/i.test(jid);
  }

  private mapAckToStatus(ack: number | string): {
    status: MessageStatus;
    timestamp: 'sent_at' | 'delivered_at' | 'read_at';
  } {
    if (typeof ack === 'string') {
      switch (ack.toLowerCase()) {
        case 'sent':
          return { status: MessageStatus.SENT, timestamp: 'sent_at' };
        case 'delivered':
          return { status: MessageStatus.DELIVERED, timestamp: 'delivered_at' };
        case 'read':
          return { status: MessageStatus.READ, timestamp: 'read_at' };
        default:
          return { status: MessageStatus.SENT, timestamp: 'sent_at' };
      }
    }

    switch (ack) {
      case 1:
        return { status: MessageStatus.SENT, timestamp: 'sent_at' };
      case 2:
        return { status: MessageStatus.DELIVERED, timestamp: 'delivered_at' };
      case 3:
        return { status: MessageStatus.READ, timestamp: 'read_at' };
      default:
        return { status: MessageStatus.SENT, timestamp: 'sent_at' };
    }
  }

  private statusPriority(status: MessageStatus): number {
    const priorities: Record<string, number> = {
      [MessageStatus.QUEUED]: 0,
      [MessageStatus.SENT]: 1,
      [MessageStatus.DELIVERED]: 2,
      [MessageStatus.READ]: 3,
      [MessageStatus.FAILED]: -1,
    };
    return priorities[status] ?? 0;
  }

  private statusToStatsField(
    status: MessageStatus,
  ): keyof Pick<Campaign, 'stats_sent' | 'stats_delivered' | 'stats_read'> | null {
    switch (status) {
      case MessageStatus.SENT:
        return 'stats_sent';
      case MessageStatus.DELIVERED:
        return 'stats_delivered';
      case MessageStatus.READ:
        return 'stats_read';
      default:
        return null;
    }
  }
}
