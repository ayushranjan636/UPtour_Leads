import { Injectable, Logger } from '@nestjs/common';
import { OpenwaService } from '../openwa/openwa.service';
import {
  CLOUD_SESSION_PREFIX,
  WhatsappCloudService,
  WhatsAppProvider,
  isCloudSessionId,
} from './whatsapp-cloud.service';

export { isCloudSessionId, CLOUD_SESSION_PREFIX };

/**
 * One front door for sending WhatsApp messages, whichever transport is active.
 *
 * Mirrors the subset of OpenwaService the senders already used (resolve a session,
 * send text/media, check a number) so existing call sites only swap the injected
 * service. The provider is chosen once, when the session id is resolved: a Cloud API
 * id looks like `cloud:<phone_number_id>`, and every later call routes on that prefix.
 * That keeps a single send consistent even if an operator flips the provider mid-flight.
 */
@Injectable()
export class WhatsappSenderService {
  private readonly logger = new Logger(WhatsappSenderService.name);

  constructor(
    private readonly openwa: OpenwaService,
    private readonly cloud: WhatsappCloudService,
  ) {}

  getActiveProvider(): Promise<WhatsAppProvider> {
    return this.cloud.getProvider();
  }

  /**
   * The id to send through for the active provider.
   *
   * A campaign's stored `openwa_session_id` only means something to the session
   * gateway, so it is ignored while the Cloud API is active.
   */
  async resolveSessionId(preferred?: string | null): Promise<string> {
    if ((await this.cloud.getProvider()) === 'cloud') {
      return this.cloud.sessionId();
    }
    const sessionPreferred = isCloudSessionId(preferred) ? null : preferred;
    return this.openwa.resolveSessionId(sessionPreferred);
  }

  async assertSendable(sessionId: string): Promise<void> {
    if (isCloudSessionId(sessionId)) {
      await this.cloud.sessionId(); // throws a clear 503 when not configured
      return;
    }
    return this.openwa.assertSendable(sessionId);
  }

  invalidateSessionCache(): void {
    this.openwa.invalidateSessionCache();
  }

  sendText(sessionId: string, chatId: string, text: string): Promise<any> {
    return isCloudSessionId(sessionId)
      ? this.cloud.sendText(chatId, text)
      : this.openwa.sendText(sessionId, chatId, text);
  }

  sendImage(sessionId: string, chatId: string, url: string, caption?: string): Promise<any> {
    return isCloudSessionId(sessionId)
      ? this.cloud.sendImage(chatId, url, caption)
      : this.openwa.sendImage(sessionId, chatId, url, caption);
  }

  sendVideo(sessionId: string, chatId: string, url: string, caption?: string): Promise<any> {
    return isCloudSessionId(sessionId)
      ? this.cloud.sendVideo(chatId, url, caption)
      : this.openwa.sendVideo(sessionId, chatId, url, caption);
  }

  sendDocument(
    sessionId: string,
    chatId: string,
    url: string,
    filename: string,
    caption?: string,
  ): Promise<any> {
    return isCloudSessionId(sessionId)
      ? this.cloud.sendDocument(chatId, url, filename, caption)
      : this.openwa.sendDocument(sessionId, chatId, url, filename, caption);
  }

  /** Approved Meta template. Only meaningful on the Cloud API. */
  sendTemplate(
    sessionId: string,
    chatId: string,
    name: string,
    language: string,
    bodyParams: string[],
    header?: { type: 'image' | 'video' | 'document'; link: string; filename?: string } | null,
  ): Promise<any> {
    if (!isCloudSessionId(sessionId)) {
      throw new Error('Meta templates can only be sent through the WhatsApp Cloud API');
    }
    return this.cloud.sendTemplate(chatId, name, language, bodyParams, header);
  }

  /**
   * Whether a number is on WhatsApp.
   *
   * The Cloud API has no lookup endpoint: Meta reports an unreachable number as a
   * failed delivery instead. Answering true keeps contacts from being suppressed for a
   * check that cannot be made.
   */
  async checkNumber(sessionId: string, number: string): Promise<boolean> {
    if (isCloudSessionId(sessionId)) return true;
    return this.openwa.checkNumber(sessionId, number);
  }
}
