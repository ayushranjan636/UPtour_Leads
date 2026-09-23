import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
  OnApplicationBootstrap,
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

/**
 * Gateway events the portal depends on.
 *
 * `message.ack` drives delivered/read rates, `message.received` drives replies, leads and
 * AI auto-reply, `message.failed` turns a silent non-delivery into a visible failure, and
 * `session.status` lets the dashboard notice a dropped link. Subscribing to '*' instead
 * would also deliver group, call and presence traffic the portal discards, so every
 * delivery would cost a request for nothing.
 */
const OPENWA_WEBHOOK_EVENTS = [
  'message.received',
  'message.ack',
  'message.failed',
  'session.status',
] as const;

@Injectable()
export class OpenwaService implements OnApplicationBootstrap {
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
    if (this.discoveredSessionId) return this.discoveredSessionId;

    const sessions = await this.getSessions().catch(() => [] as any[]);
    if (!Array.isArray(sessions) || sessions.length === 0) {
      throw new ServiceUnavailableException(
        'No WhatsApp session exists on the gateway. Create one and scan the QR code before sending.',
      );
    }

    // A configured id is only honoured while the gateway still has it.
    //
    // Re-linking WhatsApp mints a brand new session id, which leaves OPENWA_SESSION_ID
    // pointing at a session that no longer exists. Trusting it blindly meant every send
    // failed with "Session is not active" even though a healthy session was sitting
    // right there, and the auto-discovery below could never be reached. Preferring the
    // configured session when it is genuinely usable keeps multi-session setups
    // deterministic; falling back keeps a single-session setup self-healing.
    const configured = this.configuredSessionId?.trim();
    if (configured && configured !== 'default') {
      const match = sessions.find((s) => s?.id === configured);
      if (match?.status === SENDABLE_STATUS) return configured;
      this.logger.warn(
        match
          ? `Configured OPENWA_SESSION_ID ${configured} is "${match.status}", not ${SENDABLE_STATUS}; looking for another connected session.`
          : `Configured OPENWA_SESSION_ID ${configured} no longer exists on the gateway ` +
              '(it was probably re-linked, which mints a new id); looking for a connected session.',
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

  /**
   * Subscribe to gateway events as soon as the app is up.
   *
   * Registration is a boot concern rather than a manual setup step: the subscription
   * lives in the gateway's database keyed by session id, so re-linking WhatsApp drops it
   * and every delivery receipt and inbound reply is lost until someone notices. Failing
   * softly keeps the portal usable when the gateway is simply down.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const sessionId = await this.resolveSessionId();
      await this.ensureWebhook(sessionId);
    } catch (err) {
      this.logger.warn(
        `Skipped webhook registration on boot: ${(err as Error).message}. ` +
          'It will be retried the next time WhatsApp is connected.',
      );
    }
  }

  /** Readable one-line cause; axios buries the useful part in `response.data`. */
  private describeError(err: unknown): string {
    const ax = err as AxiosError<any>;
    const body = ax?.response?.data;
    const detail =
      typeof body === 'string' ? body : (body?.message ?? body?.error ?? undefined);
    return [ax?.response?.status, detail ?? (err as Error)?.message]
      .filter(Boolean)
      .join(' ');
  }

  /** Forget the cached session so the next resolve re-queries the gateway. */
  invalidateSessionCache(): void {
    this.discoveredSessionId = null;
  }

  /**
   * Ensure the gateway will call our webhook for this session.
   *
   * Without a subscription the portal is deaf: `message.ack` never arrives so delivered
   * and read rates sit at 0 regardless of what actually happened, `message.received`
   * never arrives so replies never appear and no lead is ever created, and
   * `message.failed` never arrives so a rejected send looks sent. Subscriptions live in
   * the gateway's own database and are scoped to a session id, so re-linking WhatsApp or
   * resetting its volume silently drops them — registering on boot is what stops that
   * from becoming a days-long silent outage.
   *
   * Idempotent: an existing subscription for the same URL is reconciled rather than
   * duplicated, because duplicates would double every stat.
   */
  async ensureWebhook(sessionId: string): Promise<{ id: string; created: boolean } | null> {
    const url = this.configService.get<string>('OPENWA_WEBHOOK_URL')?.trim();
    const secret = this.configService.get<string>('OPENWA_WEBHOOK_SECRET')?.trim();

    if (!url) {
      this.logger.warn(
        'OPENWA_WEBHOOK_URL is not set, so delivery receipts and inbound replies cannot ' +
          'reach the portal. Delivered/read rates will stay at 0.',
      );
      return null;
    }
    // The gateway signs every delivery with this secret and our controller rejects
    // unsigned payloads, so registering without one produces a webhook whose every
    // delivery is refused — worse than none, because it looks configured.
    if (!secret) {
      this.logger.warn(
        'OPENWA_WEBHOOK_SECRET is not set; refusing to register a webhook whose ' +
          'deliveries our own controller would reject as unsigned.',
      );
      return null;
    }

    try {
      const existing = await this.client
        .get(`/sessions/${sessionId}/webhooks`)
        .then((r) => (Array.isArray(r.data) ? r.data : (r.data?.data ?? [])))
        .catch(() => [] as any[]);

      const match = existing.find((w: any) => w?.url === url);
      if (match) {
        // Reconcile rather than recreate: the event list or active flag may have drifted
        // (an older build subscribed to fewer events), and a second row for the same URL
        // would deliver everything twice.
        const events = Array.isArray(match.events) ? match.events : [];
        const missing = OPENWA_WEBHOOK_EVENTS.filter((e) => !events.includes(e));
        if (missing.length === 0 && match.active !== false) {
          this.logger.log(`Webhook already registered for session ${sessionId}`);
          return { id: match.id, created: false };
        }

        await this.client.patch(`/sessions/${sessionId}/webhooks/${match.id}`, {
          events: [...OPENWA_WEBHOOK_EVENTS],
          active: true,
        });
        this.logger.log(
          `Webhook ${match.id} updated for session ${sessionId}` +
            (missing.length ? ` (added ${missing.join(', ')})` : ' (re-activated)'),
        );
        return { id: match.id, created: false };
      }

      const { data } = await this.client.post(`/sessions/${sessionId}/webhooks`, {
        url,
        events: [...OPENWA_WEBHOOK_EVENTS],
        secret,
      });
      this.logger.log(`Webhook registered for session ${sessionId} -> ${url}`);
      return { id: data?.id, created: true };
    } catch (err) {
      // A missing webhook degrades reporting; it must not stop the app from booting or
      // block a send, so this is logged loudly rather than thrown.
      this.logger.error(
        `Could not register the webhook for session ${sessionId}; delivery receipts and ` +
          `inbound replies will not arrive: ${this.describeError(err)}`,
      );
      return null;
    }
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
    // A fresh link means a fresh session id, so the old subscription no longer
    // applies; register before the first message can arrive.
    await this.ensureWebhook(sessionId).catch(() => undefined);

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
