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

  /**
   * One call that tells the portal whether outreach can run right now.
   *
   * Collapses "is the gateway up", "does a session exist" and "is it linked" into a
   * single answer plus an operator-facing next action, so the dashboard does not have
   * to reimplement that reasoning.
   */
  async getConnectionState(): Promise<{
    connected: boolean;
    gatewayReachable: boolean;
    status: string;
    phone: string | null;
    sessionId: string | null;
    sessionName: string | null;
    /** True while a QR is pending, i.e. the operator needs to scan. */
    awaitingScan: boolean;
    message: string;
  }> {
    let sessions: any[];
    try {
      sessions = await this.getSessions();
    } catch {
      return {
        connected: false,
        gatewayReachable: false,
        status: 'gateway_unreachable',
        phone: null,
        sessionId: null,
        sessionName: null,
        awaitingScan: false,
        message: 'The WhatsApp gateway is not running.',
      };
    }

    const session = Array.isArray(sessions)
      ? (sessions.find((s) => s?.status === SENDABLE_STATUS) ?? sessions[0])
      : undefined;

    if (!session) {
      return {
        connected: false,
        gatewayReachable: true,
        status: 'no_session',
        phone: null,
        sessionId: null,
        sessionName: null,
        awaitingScan: false,
        message: 'No WhatsApp number is linked yet.',
      };
    }

    const status: string = session.status ?? 'unknown';
    const connected = status === SENDABLE_STATUS;
    // qr_ready is the state where a code is displayed and waiting to be scanned.
    const awaitingScan = status === 'qr_ready' || status === 'qr';

    return {
      connected,
      gatewayReachable: true,
      status,
      phone: session.phone ?? null,
      sessionId: session.id ?? null,
      sessionName: session.name ?? null,
      awaitingScan,
      message: connected
        ? `Connected as ${session.phone ?? session.name}`
        : awaitingScan
          ? 'Scan the QR code with WhatsApp to finish connecting.'
          : `WhatsApp is ${status}.`,
    };
  }

  /**
   * Ensure a session exists, is started, and surface its QR code.
   *
   * Idempotent: an existing session is reused and merely (re)started, so repeated
   * clicks on Connect cannot pile up orphan sessions. The QR is not available the
   * instant a session starts — the browser has to reach WhatsApp Web first — so a
   * null qrCode here means "poll again", not "failed".
   */
  async beginConnect(
    name = 'uptour',
  ): Promise<{ sessionId: string; status: string; qrCode: string | null; message: string }> {
    const sessions = await this.getSessions().catch(() => [] as any[]);
    let session = Array.isArray(sessions) ? sessions[0] : undefined;

    if (!session) {
      this.logger.log('No WhatsApp session exists — creating one');
      try {
        const { data } = await this.client.post('/sessions', { name });
        session = data;
      } catch (error) {
        this.handleAxiosError(error, 'Could not create a WhatsApp session');
      }
    }

    const sessionId: string = session.id;
    this.invalidateSessionCache();

    if (session.status !== SENDABLE_STATUS) {
      try {
        await this.client.post(`/sessions/${sessionId}/start`);
      } catch (error) {
        // Already-starting sessions answer 4xx; that is not a failure for us.
        const status = (error as AxiosError)?.response?.status;
        if (!status || status >= 500) {
          this.handleAxiosError(error, 'Could not start the WhatsApp session');
        }
        this.logger.log(`Session ${sessionId} was already starting (${status})`);
      }
    }

    const qrCode = await this.fetchQr(sessionId);
    return {
      sessionId,
      status: session.status ?? 'initializing',
      qrCode,
      message: qrCode
        ? 'Scan this QR code with WhatsApp on your phone.'
        : 'Preparing the QR code — this takes a few seconds.',
    };
  }

  /** QR for whichever session is currently pending. */
  async getQrCode(): Promise<{ sessionId: string | null; qrCode: string | null; status: string }> {
    const sessions = await this.getSessions().catch(() => [] as any[]);
    const session = Array.isArray(sessions) ? sessions[0] : undefined;
    if (!session) return { sessionId: null, qrCode: null, status: 'no_session' };

    return {
      sessionId: session.id,
      status: session.status ?? 'unknown',
      qrCode: session.status === SENDABLE_STATUS ? null : await this.fetchQr(session.id),
    };
  }

  /**
   * Build a pre-authenticated link into the gateway dashboard.
   *
   * The key travels in the URL *fragment*, which browsers never transmit to a server,
   * so it cannot appear in gateway access logs or a proxy trail. The dashboard stores
   * it in sessionStorage and strips the fragment on arrival. This endpoint is behind
   * the portal's own JWT auth, so only an already-authenticated operator can obtain it.
   *
   * OPENWA_PUBLIC_URL exists because OPENWA_BASE_URL may be a container-internal
   * address (http://openwa:2785/api) that a browser cannot resolve.
   */
  getPortalLink(): { url: string } {
    const configured = this.configService.get<string>('OPENWA_PUBLIC_URL')?.trim();
    const base = (configured || this.deriveBrowserUrl()).replace(/\/+$/, '');
    const apiKey = this.configService.getOrThrow<string>('OPENWA_API_KEY');
    return { url: `${base}/#key=${encodeURIComponent(apiKey)}` };
  }

  /**
   * Best-effort browser-reachable gateway URL derived from OPENWA_BASE_URL.
   * Drops the trailing /api and rewrites container-only hostnames to localhost.
   */
  private deriveBrowserUrl(): string {
    const raw = this.configService.getOrThrow<string>('OPENWA_BASE_URL');
    try {
      const url = new URL(raw);
      if (url.hostname === 'openwa' || url.hostname === 'host.docker.internal') {
        url.hostname = 'localhost';
      }
      url.pathname = '';
      return url.toString();
    } catch {
      return 'http://localhost:2785';
    }
  }

  /** Unlink the device. A fresh scan is required afterwards. */
  async disconnect(): Promise<{ disconnected: boolean }> {
    const sessions = await this.getSessions().catch(() => [] as any[]);
    const session = Array.isArray(sessions) ? sessions[0] : undefined;
    if (!session) return { disconnected: true };

    try {
      await this.client.post(`/sessions/${session.id}/logout`);
    } catch (error) {
      this.handleAxiosError(error, 'Could not disconnect the WhatsApp session');
    }
    this.invalidateSessionCache();
    return { disconnected: true };
  }

  /**
   * Fetch a QR code, tolerating the not-yet-ready case.
   *
   * The gateway answers 400 "QR code is not ready yet" for a short window after a
   * session starts, which is expected rather than exceptional — the caller polls.
   */
  private async fetchQr(sessionId: string): Promise<string | null> {
    try {
      const { data } = await this.client.get(`/sessions/${sessionId}/qr`);
      return data?.qrCode ?? null;
    } catch {
      return null;
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
