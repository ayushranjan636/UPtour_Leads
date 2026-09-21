import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';

/**
 * Build the WhatsApp chat id (JID) for a phone number.
 *
 * OpenWA expects a bare international number with no `+`, e.g.
 * `919025867204@c.us`. Numbers are stored E.164-normalised (`+91…`), so the `+`
 * must be stripped — leaving it in produces `+91…@c.us`, which the gateway
 * rejects. This lived inline in two call sites that disagreed with each other;
 * exported so there is one definition and it can be unit-tested.
 */
export function toChatId(whatsappNumber: string, existingChatId?: string | null): string {
  if (existingChatId) return existingChatId;
  const bare = whatsappNumber.replace(/[^\d]/g, '');
  return `${bare}@c.us`;
}

/** Session states from which OpenWA can actually deliver a message. */
const SENDABLE_STATUS = 'ready';

@Injectable()
export class OpenwaService {
  private readonly logger = new Logger(OpenwaService.name);
  private readonly client: AxiosInstance;
  private readonly configuredSessionId?: string;

  /**
   * Cached auto-discovered session id, so resolution does not hit the gateway on
   * every send. Invalidated whenever a send fails, in case the session changed.
   */
  private discoveredSessionId: string | null = null;

  constructor(private readonly configService: ConfigService) {
    const baseURL = this.configService.getOrThrow<string>('OPENWA_BASE_URL');
    const apiKey = this.configService.getOrThrow<string>('OPENWA_API_KEY');
    this.configuredSessionId = this.configService.get<string>('OPENWA_SESSION_ID')?.trim() || undefined;

    this.client = axios.create({
      baseURL,
      headers: { 'X-API-Key': apiKey },
      timeout: 30_000,
    });

    if (!this.configuredSessionId) {
      this.logger.warn(
        'OPENWA_SESSION_ID is not set — the session will be auto-discovered from the gateway. ' +
          'Set it explicitly to pin a specific WhatsApp account.',
      );
    }
  }

  /**
   * Resolve which WhatsApp session to send through.
   *
   * Precedence: explicit argument (a campaign's own `openwa_session_id`) →
   * `OPENWA_SESSION_ID` → auto-discovery of the single `ready` session.
   *
   * Every send site previously defaulted to the literal string `'default'`, which
   * is not a session id: OpenWA resolves sessions by generated UUID, so the
   * gateway answered `400 Session 'default' is not active` on every send. Worse,
   * `OPENWA_SESSION_ID` was configured in .env but read by no code at all, so the
   * value operators set had no effect. Auto-discovery means a freshly linked
   * session works without hand-patching each campaign.
   */
  async resolveSessionId(preferred?: string | null): Promise<string> {
    const explicit = preferred?.trim();
    // Guard against the historical placeholder leaking back in from old rows.
    if (explicit && explicit !== 'default') return explicit;
    if (this.configuredSessionId && this.configuredSessionId !== 'default') {
      return this.configuredSessionId;
    }
    if (this.discoveredSessionId) return this.discoveredSessionId;

    const sessions = await this.getSessions().catch(() => [] as any[]);
    if (!Array.isArray(sessions) || sessions.length === 0) {
      throw new ServiceUnavailableException(
        'No WhatsApp session exists on the gateway. Create one and scan the QR code before sending.',
      );
    }

    const ready = sessions.find((s) => s?.status === SENDABLE_STATUS);
    if (!ready) {
      const states = sessions.map((s) => `${s?.name ?? s?.id}: ${s?.status}`).join(', ');
      throw new ServiceUnavailableException(
        `No WhatsApp session is connected (${states}). Reconnect it in the gateway dashboard before sending.`,
      );
    }

    this.discoveredSessionId = ready.id;
    this.logger.log(`Auto-discovered WhatsApp session "${ready.name}" (${ready.id})`);
    return ready.id;
  }

  /** Forget the cached session so the next resolve re-queries the gateway. */
  invalidateSessionCache(): void {
    this.discoveredSessionId = null;
  }

  /**
   * Assert the resolved session can actually deliver right now.
   *
   * Sending into a non-`ready` session returns `409 Session is not connected`, so
   * checking first turns a late, cryptic gateway error into an actionable message.
   */
  async assertSendable(sessionId: string): Promise<void> {
    const sessions = await this.getSessions().catch(() => [] as any[]);
    const session = Array.isArray(sessions)
      ? sessions.find((s) => s?.id === sessionId)
      : undefined;

    if (!session) {
      this.invalidateSessionCache();
      throw new ServiceUnavailableException(
        `WhatsApp session "${sessionId}" no longer exists on the gateway.`,
      );
    }
    if (session.status !== SENDABLE_STATUS) {
      throw new ServiceUnavailableException(
        `WhatsApp is not connected (session "${session.name}" is "${session.status}"). ` +
          'Reconnect it in the gateway dashboard before sending.',
      );
    }
  }

  async getSessions(): Promise<any[]> {
    this.logger.log('Fetching all OpenWA sessions');
    try {
      const { data } = await this.client.get('/sessions');
      return data;
    } catch (error) {
      this.handleAxiosError(error, 'Failed to fetch sessions');
    }
  }

  async getSessionStatus(sessionId: string): Promise<any> {
    this.logger.log(`Fetching status for session: ${sessionId}`);
    try {
      const { data } = await this.client.get(
        `/sessions/${sessionId}/status`,
      );
      return data;
    } catch (error) {
      this.handleAxiosError(
        error,
        `Failed to fetch status for session ${sessionId}`,
      );
    }
  }

  async sendText(
    sessionId: string,
    chatId: string,
    text: string,
  ): Promise<any> {
    this.logger.log(
      `Sending text to ${chatId} via session ${sessionId}`,
    );
    try {
      const { data } = await this.client.post(
        `/sessions/${sessionId}/messages/send-text`,
        { chatId, text },
      );
      return data;
    } catch (error) {
      this.handleAxiosError(
        error,
        `Failed to send text to ${chatId}`,
      );
    }
  }

  async sendImage(
    sessionId: string,
    chatId: string,
    imageUrl: string,
    caption?: string,
  ): Promise<any> {
    this.logger.log(
      `Sending image to ${chatId} via session ${sessionId}`,
    );
    try {
      const { data } = await this.client.post(
        `/sessions/${sessionId}/messages/send-image`,
        { chatId, url: imageUrl, caption },
      );
      return data;
    } catch (error) {
      this.handleAxiosError(
        error,
        `Failed to send image to ${chatId}`,
      );
    }
  }

  async sendDocument(
    sessionId: string,
    chatId: string,
    documentUrl: string,
    filename: string,
    caption?: string,
  ): Promise<any> {
    this.logger.log(
      `Sending document "${filename}" to ${chatId} via session ${sessionId}`,
    );
    try {
      const { data } = await this.client.post(
        `/sessions/${sessionId}/messages/send-document`,
        { chatId, url: documentUrl, filename, caption },
      );
      return data;
    } catch (error) {
      this.handleAxiosError(
        error,
        `Failed to send document to ${chatId}`,
      );
    }
  }

  async sendVideo(
    sessionId: string,
    chatId: string,
    videoUrl: string,
    caption?: string,
  ): Promise<any> {
    this.logger.log(
      `Sending video to ${chatId} via session ${sessionId}`,
    );
    try {
      const { data } = await this.client.post(
        `/sessions/${sessionId}/messages/send-video`,
        { chatId, url: videoUrl, caption },
      );
      return data;
    } catch (error) {
      this.handleAxiosError(
        error,
        `Failed to send video to ${chatId}`,
      );
    }
  }

  async checkNumber(
    sessionId: string,
    number: string,
  ): Promise<boolean> {
    this.logger.log(
      `Checking if ${number} is on WhatsApp via session ${sessionId}`,
    );
    try {
      const { data } = await this.client.get(
        `/sessions/${sessionId}/contacts/check/${number}`,
      );
      // OpenWA returns { number, exists, whatsappId }.
      // See openwa/src/modules/contact/contact.controller.ts:50-54.
      // Reading a non-existent `numberExists` made this always false, which
      // suppressed every contact and stopped all sending.
      return !!(data?.exists ?? data?.numberExists);
    } catch (error) {
      this.logger.warn(
        `Number check failed for ${number}: ${(error as Error).message}`,
      );
      // Fail open: a verification outage must not suppress real contacts.
      return true;
    }
  }

  async getHealth(): Promise<any> {
    this.logger.log('Checking OpenWA health');
    try {
      const { data } = await this.client.get('/health/ready');
      return data;
    } catch (error) {
      this.handleAxiosError(error, 'OpenWA health check failed');
    }
  }

  private handleAxiosError(error: unknown, context: string): never {
    if (error instanceof AxiosError) {
      const status =
        error.response?.status ?? HttpStatus.BAD_GATEWAY;
      const message =
        error.response?.data?.message ??
        error.message ??
        'Unknown OpenWA API error';
      this.logger.error(
        `${context}: [${status}] ${message}`,
        error.stack,
      );
      throw new HttpException(
        { statusCode: status, message: `${context}: ${message}` },
        status,
      );
    }

    this.logger.error(`${context}: ${(error as Error).message}`, (error as Error).stack);
    throw new HttpException(
      { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: context },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
