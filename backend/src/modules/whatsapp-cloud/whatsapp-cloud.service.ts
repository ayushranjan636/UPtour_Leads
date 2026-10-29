import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import axios, { AxiosError } from 'axios';
import { randomBytes } from 'crypto';

/** Which transport carries WhatsApp traffic. */
export type WhatsAppProvider = 'session' | 'cloud';

/**
 * Prefix that marks a "session id" as belonging to the Cloud API.
 *
 * The rest of the app already threads a session id through every send and stores it on
 * each message. Encoding the provider into that id (`cloud:<phone_number_id>`) lets
 * every existing call site route correctly without learning a second concept.
 */
export const CLOUD_SESSION_PREFIX = 'cloud:';

export function isCloudSessionId(sessionId: string | null | undefined): boolean {
  return !!sessionId && sessionId.startsWith(CLOUD_SESSION_PREFIX);
}

/** Credentials for one WhatsApp Business phone number on Meta's Cloud API. */
export interface CloudConfig {
  /** Permanent System User token with whatsapp_business_messaging + management. */
  accessToken: string;
  phoneNumberId: string;
  /** WhatsApp Business Account id. Needed to list templates and subscribe webhooks. */
  wabaId: string;
  /** Meta app secret. Verifies the X-Hub-Signature-256 header on every webhook. */
  appSecret: string;
  /** Shared string Meta echoes back when the webhook URL is first verified. */
  verifyToken: string;
  apiVersion: string;
}

/** What the portal shows about the Cloud API link. Never contains secrets. */
export interface CloudState {
  configured: boolean;
  connected: boolean;
  phone: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  phoneNumberId: string | null;
  wabaId: string | null;
  apiVersion: string;
  /** Last four characters only, so an operator can tell which token is stored. */
  accessTokenHint: string | null;
  hasAppSecret: boolean;
  verifyToken: string | null;
  webhookUrl: string;
  /** Where the credentials came from. */
  source: 'portal' | 'env' | 'none';
  message: string;
}

export interface CloudTemplate {
  name: string;
  language: string;
  status: string;
  category: string;
  /** Body text with {{1}}-style placeholders, for previewing in the portal. */
  body: string | null;
  /** Number of distinct {{n}} placeholders in the body. */
  bodyParamCount: number;
  /** IMAGE / VIDEO / DOCUMENT / TEXT, or null when the template has no header. */
  headerFormat: string | null;
}

/** Result of a send, in the same shape OpenWA returns so callers need no branching. */
export interface CloudSendResult {
  messageId: string;
}

const PROVIDER_KEY = 'whatsapp.provider';
const CLOUD_CONFIG_KEY = 'whatsapp.cloud';
const DEFAULT_API_VERSION = 'v23.0';
const GRAPH_BASE = 'https://graph.facebook.com';

/**
 * Meta's official WhatsApp Business Platform (Cloud API).
 *
 * Runs alongside the QR-linked session gateway rather than replacing it. The session
 * route is quick to set up but is an unofficial client, so the number can be banned
 * for automation. The Cloud API is the sanctioned route, with delivery webhooks,
 * approved templates and a verified business name, at the cost of Meta's rules:
 * a conversation can only be *started* with an approved template, and free-form text
 * is only allowed within 24 hours of the customer's last message.
 *
 * Credentials and the active provider are stored in Postgres (`app_settings`) so an
 * operator can connect from the Settings page. Environment variables are honoured as a
 * fallback, for deployments that prefer to keep tokens out of the database.
 */
@Injectable()
export class WhatsappCloudService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappCloudService.name);

  /** Short cache so a campaign burst does not read the settings table per message. */
  private cache: {
    at: number;
    provider: WhatsAppProvider;
    config: CloudConfig | null;
    source: CloudState['source'];
  } | null = null;
  private static readonly CACHE_MS = 15_000;

  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Create the settings table and the template columns this feature needs.
   *
   * Production runs with TypeORM `synchronize` off and the project has no migrations,
   * so a new entity column would make every template query fail on a database created
   * before this release. Every statement is idempotent and runs before queue workers start.
   */
  async onModuleInit(): Promise<void> {
    const statements = [
      `CREATE TABLE IF NOT EXISTS app_settings (
         key varchar(100) PRIMARY KEY,
         value jsonb NOT NULL,
         updated_at timestamptz NOT NULL DEFAULT now()
       )`,
      `ALTER TABLE IF EXISTS message_templates ADD COLUMN IF NOT EXISTS cloud_template_name varchar NULL`,
      `ALTER TABLE IF EXISTS message_templates ADD COLUMN IF NOT EXISTS cloud_template_language varchar NULL`,
      `ALTER TABLE IF EXISTS message_templates ADD COLUMN IF NOT EXISTS cloud_template_params text NULL`,
    ];
    for (const sql of statements) {
      try {
        await this.dataSource.query(sql);
      } catch (err) {
        this.logger.error(`Schema patch failed (${sql.split('\n')[0]}): ${(err as Error).message}`);
      }
    }
  }

  // ─── Settings ──────────────────────────────────────────────────────────────

  private async readSetting<T>(key: string): Promise<T | null> {
    try {
      const rows = await this.dataSource.query('SELECT value FROM app_settings WHERE key = $1', [key]);
      return rows?.[0]?.value ?? null;
    } catch {
      return null;
    }
  }

  private async writeSetting(key: string, value: unknown): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
    this.cache = null;
  }

  private async deleteSetting(key: string): Promise<void> {
    await this.dataSource.query('DELETE FROM app_settings WHERE key = $1', [key]);
    this.cache = null;
  }

  private envConfig(): CloudConfig | null {
    const get = (k: string) => this.config.get<string>(k)?.trim() || '';
    const accessToken = get('WA_CLOUD_ACCESS_TOKEN');
    const phoneNumberId = get('WA_CLOUD_PHONE_NUMBER_ID');
    if (!accessToken || !phoneNumberId) return null;
    return {
      accessToken,
      phoneNumberId,
      wabaId: get('WA_CLOUD_WABA_ID'),
      appSecret: get('WA_CLOUD_APP_SECRET'),
      verifyToken: get('WA_CLOUD_VERIFY_TOKEN'),
      apiVersion: get('WA_CLOUD_API_VERSION') || DEFAULT_API_VERSION,
    };
  }

  private async load() {
    if (this.cache && Date.now() - this.cache.at < WhatsappCloudService.CACHE_MS) return this.cache;

    const stored = await this.readSetting<CloudConfig>(CLOUD_CONFIG_KEY);
    const env = this.envConfig();
    const usePortal = !!(stored?.accessToken && stored?.phoneNumberId);
    const config = usePortal ? stored : env;
    const source: CloudState['source'] = usePortal ? 'portal' : env ? 'env' : 'none';

    const storedProvider = await this.readSetting<WhatsAppProvider>(PROVIDER_KEY);
    const envProvider = this.config.get<string>('WHATSAPP_PROVIDER')?.trim().toLowerCase();
    const provider: WhatsAppProvider =
      storedProvider === 'cloud' || storedProvider === 'session'
        ? storedProvider
        : envProvider === 'cloud'
          ? 'cloud'
          : 'session';

    this.cache = { at: Date.now(), provider, config, source };
    return this.cache;
  }

  async getProvider(): Promise<WhatsAppProvider> {
    return (await this.load()).provider;
  }

  async setProvider(provider: WhatsAppProvider): Promise<WhatsAppProvider> {
    if (provider !== 'session' && provider !== 'cloud') {
      throw new BadRequestException('provider must be "session" or "cloud"');
    }
    if (provider === 'cloud' && !(await this.load()).config) {
      throw new BadRequestException(
        'Connect the WhatsApp Cloud API first: no access token and phone number ID are saved.',
      );
    }
    await this.writeSetting(PROVIDER_KEY, provider);
    this.logger.log(`Active WhatsApp provider switched to ${provider}`);
    return provider;
  }

  async getConfig(): Promise<CloudConfig | null> {
    return (await this.load()).config;
  }

  private async requireConfig(): Promise<CloudConfig> {
    const cfg = await this.getConfig();
    if (!cfg) {
      throw new ServiceUnavailableException(
        'WhatsApp Cloud API is not connected. Add the access token and phone number ID in Settings → WhatsApp.',
      );
    }
    return cfg;
  }

  /** Public URL Meta must call. Behind Caddy, /api lives on the portal's own origin. */
  webhookUrl(): string {
    const explicit = this.config.get<string>('WA_CLOUD_WEBHOOK_URL')?.trim();
    if (explicit) return explicit;
    const strip = (s: string) => s.trim().replace(/\/+$/, '');
    const publicApi = this.config.get<string>('PUBLIC_API_URL')?.trim();
    const frontend = this.config.get<string>('FRONTEND_URL')?.trim();
    const appUrl = this.config.get<string>('APP_URL')?.trim() || 'http://localhost:3000';
    // In production the portal origin proxies /api (Caddy). A local Vite dev server does
    // not, so a localhost frontend URL would produce a callback that 404s.
    const frontendProxiesApi = !!frontend && !/^https?:\/\/(localhost|127\.)/.test(frontend);
    const base = publicApi
      ? strip(publicApi)
      : frontendProxiesApi
        ? `${strip(frontend!)}/api`
        : `${strip(appUrl)}/api`;
    return `${base}/webhooks/whatsapp-cloud`;
  }

  /**
   * Save credentials after proving they work.
   *
   * Validating against Graph before storing means a typo is caught on the Settings page,
   * not hours later as a campaign full of failed sends. Blank secret fields keep the
   * previously stored value, so editing the WABA id does not require re-pasting a token.
   */
  async saveConfig(input: Partial<CloudConfig>): Promise<CloudState> {
    const previous = await this.readSetting<CloudConfig>(CLOUD_CONFIG_KEY);
    const pick = (v: string | undefined, prev: string | undefined) =>
      v?.trim() ? v.trim() : prev?.trim() || '';

    const next: CloudConfig = {
      accessToken: pick(input.accessToken, previous?.accessToken),
      phoneNumberId: pick(input.phoneNumberId, previous?.phoneNumberId),
      wabaId: pick(input.wabaId, previous?.wabaId),
      appSecret: pick(input.appSecret, previous?.appSecret),
      verifyToken: pick(input.verifyToken, previous?.verifyToken) || randomBytes(16).toString('hex'),
      apiVersion: pick(input.apiVersion, previous?.apiVersion) || DEFAULT_API_VERSION,
    };

    if (!next.accessToken) throw new BadRequestException('Access token is required.');
    if (!/^\d+$/.test(next.phoneNumberId)) {
      throw new BadRequestException(
        'Phone number ID must be the numeric id from WhatsApp Manager → API Setup, not the phone number itself.',
      );
    }
    if (next.wabaId && !/^\d+$/.test(next.wabaId)) {
      throw new BadRequestException('WhatsApp Business Account ID must be numeric.');
    }
    if (!/^v\d+\.\d+$/.test(next.apiVersion)) {
      throw new BadRequestException('API version must look like v23.0.');
    }

    // Prove the token can see this number before anything is stored.
    try {
      await axios.get(`${GRAPH_BASE}/${next.apiVersion}/${next.phoneNumberId}`, {
        params: { fields: 'display_phone_number,verified_name' },
        headers: { Authorization: `Bearer ${next.accessToken}` },
        timeout: 15_000,
      });
    } catch (err) {
      throw new BadRequestException(`Meta rejected these credentials: ${this.describeError(err)}`);
    }

    await this.writeSetting(CLOUD_CONFIG_KEY, next);
    await this.subscribeApp(next);
    return this.getState();
  }

  /**
   * Subscribe our Meta app to the WABA's webhooks.
   *
   * Without this Meta delivers no events for the account, so replies and delivery
   * receipts would silently never arrive. Failure is logged, not fatal, because the
   * subscription can also be made by hand in the Meta dashboard.
   */
  private async subscribeApp(cfg: CloudConfig): Promise<void> {
    if (!cfg.wabaId) return;
    try {
      await axios.post(
        `${GRAPH_BASE}/${cfg.apiVersion}/${cfg.wabaId}/subscribed_apps`,
        {},
        { headers: { Authorization: `Bearer ${cfg.accessToken}` }, timeout: 15_000 },
      );
      this.logger.log(`Subscribed the app to webhooks for WABA ${cfg.wabaId}`);
    } catch (err) {
      this.logger.warn(`Could not subscribe the app to WABA ${cfg.wabaId}: ${this.describeError(err)}`);
    }
  }

  /** Remove stored credentials and fall back to the session gateway. */
  async disconnect(): Promise<CloudState> {
    await this.deleteSetting(CLOUD_CONFIG_KEY);
    if ((await this.readSetting<WhatsAppProvider>(PROVIDER_KEY)) === 'cloud') {
      await this.writeSetting(PROVIDER_KEY, 'session');
    }
    return this.getState();
  }

  async getState(): Promise<CloudState> {
    const { config, source } = await this.load();
    const base: CloudState = {
      configured: !!config,
      connected: false,
      phone: null,
      verifiedName: null,
      qualityRating: null,
      phoneNumberId: config?.phoneNumberId ?? null,
      wabaId: config?.wabaId || null,
      apiVersion: config?.apiVersion ?? DEFAULT_API_VERSION,
      accessTokenHint: config?.accessToken ? `…${config.accessToken.slice(-4)}` : null,
      hasAppSecret: !!config?.appSecret,
      verifyToken: config?.verifyToken || null,
      webhookUrl: this.webhookUrl(),
      source,
      message: 'WhatsApp Cloud API is not connected.',
    };
    if (!config) return base;

    try {
      const { data } = await axios.get(`${GRAPH_BASE}/${config.apiVersion}/${config.phoneNumberId}`, {
        params: { fields: 'display_phone_number,verified_name,quality_rating' },
        headers: { Authorization: `Bearer ${config.accessToken}` },
        timeout: 10_000,
      });
      const name = [data?.verified_name, data?.display_phone_number].filter(Boolean).join(' · ');
      return {
        ...base,
        connected: true,
        phone: data?.display_phone_number ?? null,
        verifiedName: data?.verified_name ?? null,
        qualityRating: data?.quality_rating ?? null,
        message: name ? `Connected as ${name}` : 'Connected',
      };
    } catch (err) {
      return { ...base, message: `Meta API error: ${this.describeError(err)}` };
    }
  }

  // ─── Templates ─────────────────────────────────────────────────────────────

  async listTemplates(): Promise<CloudTemplate[]> {
    const cfg = await this.requireConfig();
    if (!cfg.wabaId) {
      throw new BadRequestException(
        'Add the WhatsApp Business Account ID in Settings → WhatsApp to list templates.',
      );
    }
    try {
      const out: CloudTemplate[] = [];
      let url: string | null = `${GRAPH_BASE}/${cfg.apiVersion}/${cfg.wabaId}/message_templates`;
      let params: Record<string, unknown> | undefined = {
        fields: 'name,language,status,category,components',
        limit: 100,
      };
      // Follow pagination; a busy account can have more than one page of templates.
      for (let page = 0; url && page < 10; page++) {
        const resp: { data: any } = await axios.get(url, {
          params,
          headers: { Authorization: `Bearer ${cfg.accessToken}` },
          timeout: 15_000,
        });
        for (const t of resp.data?.data ?? []) {
          const body = (t.components ?? []).find((c: any) => c.type === 'BODY');
          const header = (t.components ?? []).find((c: any) => c.type === 'HEADER');
          const bodyText: string | null = body?.text ?? null;
          const placeholders = new Set(
            (bodyText?.match(/\{\{\s*\w+\s*\}\}/g) ?? []).map((s) => s.replace(/\s/g, '')),
          );
          out.push({
            name: t.name,
            language: t.language,
            status: t.status,
            category: t.category,
            body: bodyText,
            bodyParamCount: placeholders.size,
            headerFormat: header?.format ?? null,
          });
        }
        url = resp.data?.paging?.next ?? null;
        params = undefined; // `next` already carries the query string
      }
      return out;
    } catch (err) {
      throw new HttpException(
        `Could not list WhatsApp templates: ${this.describeError(err)}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // ─── Sending ───────────────────────────────────────────────────────────────

  /** `cloud:<phone_number_id>` for the connected number. */
  async sessionId(): Promise<string> {
    const cfg = await this.requireConfig();
    return `${CLOUD_SESSION_PREFIX}${cfg.phoneNumberId}`;
  }

  /** Cloud API wants bare international digits; accepts `+91…`, `91…@c.us`, etc. */
  static toRecipient(chatIdOrNumber: string): string {
    return chatIdOrNumber.replace(/@.*$/, '').replace(/[^\d]/g, '');
  }

  private async post(payload: Record<string, unknown>): Promise<CloudSendResult> {
    const cfg = await this.requireConfig();
    try {
      const { data } = await axios.post(
        `${GRAPH_BASE}/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`,
        { messaging_product: 'whatsapp', recipient_type: 'individual', ...payload },
        { headers: { Authorization: `Bearer ${cfg.accessToken}` }, timeout: 30_000 },
      );
      const messageId = data?.messages?.[0]?.id;
      if (!messageId) throw new Error('Meta accepted the request but returned no message id');
      return { messageId };
    } catch (err) {
      const httpStatus = (err as AxiosError)?.response?.status;
      const reason = this.describeError(err);
      this.logger.error(`Cloud API send failed: ${reason}`);
      const status = httpStatus && httpStatus >= 400 && httpStatus < 600 ? httpStatus : HttpStatus.BAD_GATEWAY;
      throw new HttpException({ statusCode: status, message: `WhatsApp Cloud API: ${reason}` }, status);
    }
  }

  sendText(to: string, text: string) {
    return this.post({
      to: WhatsappCloudService.toRecipient(to),
      type: 'text',
      text: { body: text, preview_url: /https?:\/\//.test(text) },
    });
  }

  sendImage(to: string, link: string, caption?: string) {
    return this.post({
      to: WhatsappCloudService.toRecipient(to),
      type: 'image',
      image: { link, caption: caption || undefined },
    });
  }

  sendVideo(to: string, link: string, caption?: string) {
    return this.post({
      to: WhatsappCloudService.toRecipient(to),
      type: 'video',
      video: { link, caption: caption || undefined },
    });
  }

  sendDocument(to: string, link: string, filename: string, caption?: string) {
    return this.post({
      to: WhatsappCloudService.toRecipient(to),
      type: 'document',
      document: { link, filename, caption: caption || undefined },
    });
  }

  /**
   * Send an approved template, the only way to open a conversation on the Cloud API.
   *
   * `bodyParams` fill {{1}}, {{2}}… in order. A media header is attached when the
   * template has one and a public URL is supplied.
   */
  sendTemplate(
    to: string,
    name: string,
    language: string,
    bodyParams: string[] = [],
    header?: { type: 'image' | 'video' | 'document'; link: string; filename?: string } | null,
  ) {
    const components: any[] = [];
    if (header?.link) {
      const media: Record<string, string> = { link: header.link };
      if (header.type === 'document' && header.filename) media.filename = header.filename;
      components.push({ type: 'header', parameters: [{ type: header.type, [header.type]: media }] });
    }
    if (bodyParams.length) {
      components.push({
        type: 'body',
        // Meta rejects empty parameters, so a missing merge value becomes a placeholder
        // dash rather than failing the whole send.
        parameters: bodyParams.map((text) => ({ type: 'text', text: text?.trim() ? text : '-' })),
      });
    }
    return this.post({
      to: WhatsappCloudService.toRecipient(to),
      type: 'template',
      template: {
        name,
        language: { code: language || 'en' },
        ...(components.length ? { components } : {}),
      },
    });
  }

  /** Readable one-line cause; Graph errors put the useful text in error.error_data. */
  describeError(err: unknown): string {
    const ax = err as AxiosError<any>;
    const e = ax?.response?.data?.error;
    if (e) {
      const detail = e.error_data?.details;
      return [e.code ? `(#${e.code})` : null, e.message, detail && detail !== e.message ? `- ${detail}` : null]
        .filter(Boolean)
        .join(' ');
    }
    return [ax?.response?.status, (err as Error)?.message].filter(Boolean).join(' ');
  }
}
