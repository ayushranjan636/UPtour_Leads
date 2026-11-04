import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import axios, { AxiosError } from 'axios';
import { randomBytes } from 'crypto';
import { metaErrorHint } from './meta-errors';
import { publicApiBase } from '../../common/utils/public-url.util';
import { MediaService } from '../media/media.service';

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
  /**
   * Meta app id. Only needed to upload the sample image of a template with a media
   * header; found from the token automatically when left blank.
   */
  appId?: string;
}

/** What the portal shows about the Cloud API link. Never contains secrets. */
export interface CloudState {
  configured: boolean;
  connected: boolean;
  phone: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  /**
   * Whether the number is registered with the Cloud API. False means every send fails
   * with #133010 until it is registered; null when Meta did not say.
   */
  registered: boolean | null;
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
  /**
   * Whether Meta will deliver replies and receipts here. `callbackUrl` is the
   * account-level override Meta reports; null means the app-level URL applies.
   */
  webhook: { subscribed: boolean; callbackUrl: string | null };
  message: string;
}

/** Input for creating a message template on the WhatsApp Business Account. */
export interface NewCloudTemplate {
  /** Lowercase letters, digits and underscores, e.g. heritage_tour_intro. */
  name: string;
  /** e.g. en, en_US, hi. */
  language: string;
  category: 'MARKETING' | 'UTILITY';
  /** May contain {{1}}, {{2}}… placeholders. */
  body: string;
  /** One sample value per placeholder, which Meta's reviewers read. */
  examples?: string[];
  headerText?: string;
  /** Sample for a {{1}} in the text header, which Meta's reviewers read. */
  headerTextExample?: string;
  /** Location header: each message shows a map pin, set per send. */
  headerLocation?: boolean;
  /** Buttons of any type Meta allows. Supersedes quickReplies. */
  buttons?: NewTemplateButton[];
  /** Image, video or PDF header, from a file uploaded to the portal. */
  headerMedia?: { format: 'IMAGE' | 'VIDEO' | 'DOCUMENT'; mediaId: string };
  footer?: string;
  /** Quick-reply button labels, at most three. */
  quickReplies?: string[];
}

/** One template button. Meta allows up to 10: quick replies, 2 URL, 1 phone, 1 copy code. */
export interface NewTemplateButton {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE';
  /** Label on the button (not used by COPY_CODE, whose label Meta sets). Max 25 characters. */
  text?: string;
  /** URL buttons. May end in {{1}} for a per-message suffix. */
  url?: string;
  /** For a URL ending in {{1}}: an example suffix. For COPY_CODE: an example code. */
  example?: string;
  /** PHONE_NUMBER buttons, with country code, e.g. +919876543210. */
  phone?: string;
}

/** A button as the portal shows it on a template. */
export interface CloudTemplateButton {
  type: string;
  text: string;
  url?: string;
  phone?: string;
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
  /**
   * The blanks in order of first appearance: ['1', '2'] for a numbered template,
   * ['customer_name', 'tour'] for a named one. Named blanks must be sent with their name.
   */
  bodyParamNames: string[];
  /** POSITIONAL ({{1}}) or NAMED ({{customer_name}}). */
  parameterFormat: 'POSITIONAL' | 'NAMED';
  /** The sample file uploaded with a media header, as Meta stores it. */
  headerExampleUrl?: string | null;
  /** Text of a TEXT header, if any. */
  headerText?: string | null;
  /** URL buttons whose link ends in a {{1}} blank, which each send must fill. */
  dynamicUrlButtons?: { index: number; example: string | null }[];
  /** Example for a {{1}} in the text header; each send must fill it. */
  headerTextExample?: string | null;
  /** Copy-code buttons, which each send must give a code. */
  copyCodeButtons?: { index: number; example: string | null }[];
  /** All buttons, for display. */
  buttons?: CloudTemplateButton[];
  footer?: string | null;
}

/** Blanks in a template body, in order of first appearance, without braces. */
export function templateParamNames(text: string | null | undefined): string[] {
  const seen: string[] = [];
  for (const m of (text ?? '').matchAll(/\{\{\s*([\w]+)\s*\}\}/g)) {
    if (!seen.includes(m[1])) seen.push(m[1]);
  }
  return seen;
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
export class WhatsappCloudService implements OnModuleInit, OnApplicationBootstrap {
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
    // Optional so tests can build the service without storage.
    @Optional() private readonly media?: MediaService,
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
      // Not Cloud API specific, but this is the one place schema patches run on boot.
      `ALTER TABLE IF EXISTS campaigns ADD COLUMN IF NOT EXISTS daily_new_contact_limit int NULL`,
      `ALTER TABLE IF EXISTS campaigns ADD COLUMN IF NOT EXISTS min_gap_seconds int NULL`,
      `ALTER TABLE IF EXISTS campaigns ADD COLUMN IF NOT EXISTS max_gap_seconds int NULL`,
    ];
    for (const sql of statements) {
      try {
        await this.dataSource.query(sql);
      } catch (err) {
        this.logger.error(`Schema patch failed (${sql.split('\n')[0]}): ${(err as Error).message}`);
      }
    }
  }

  /**
   * Make sure Meta's webhooks point here once the app is up.
   *
   * Credentials saved before automatic registration existed, or a domain change, would
   * otherwise leave replies and delivery ticks going nowhere until someone noticed.
   * Soft-fails: a Meta outage must not stop the portal from starting.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const cfg = await this.getConfig();
      const url = this.webhookUrl();
      if (!cfg?.wabaId || !cfg.verifyToken || !/^https:\/\//.test(url)) return;
      const status = await this.webhookStatus(cfg);
      if (status.callbackUrl === url) return;
      await this.registerWebhookFor(cfg);
    } catch (err) {
      this.logger.warn(`Webhook check on startup skipped: ${(err as Error).message}`);
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
    return `${publicApiBase(this.config)}/webhooks/whatsapp-cloud`;
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
      appId: pick(input.appId, previous?.appId) || undefined,
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
    try {
      await this.registerWebhookFor(cfg);
    } catch (err) {
      this.logger.warn(`Could not register the webhook for WABA ${cfg.wabaId}: ${(err as Error).message}`);
    }
  }

  /**
   * Point Meta's webhooks for this WhatsApp Business Account at the portal.
   *
   * `override_callback_uri` sets the callback for this account alone, using the same
   * system-user token as sending. That removes the manual "paste the callback URL into
   * the Meta dashboard" step, which is where most setups silently stall: messages send,
   * but replies and delivery ticks never arrive. Meta verifies the URL by calling our
   * GET handler with the verify token before accepting it.
   */
  private async registerWebhookFor(cfg: CloudConfig): Promise<{ callbackUrl: string | null }> {
    if (!cfg.wabaId) {
      throw new BadRequestException('Add the WhatsApp Business Account ID first.');
    }
    const callbackUrl = this.webhookUrl();
    const publicHttps = /^https:\/\//.test(callbackUrl) && !/localhost|127\.0\.0\.1/.test(callbackUrl);
    const body: Record<string, string> = {};
    if (publicHttps && cfg.verifyToken) {
      body.override_callback_uri = callbackUrl;
      body.verify_token = cfg.verifyToken;
    }
    try {
      await axios.post(`${GRAPH_BASE}/${cfg.apiVersion}/${cfg.wabaId}/subscribed_apps`, body, {
        headers: { Authorization: `Bearer ${cfg.accessToken}` },
        timeout: 20_000,
      });
    } catch (err) {
      throw new BadRequestException(`Meta did not accept the webhook: ${this.describeError(err)}`);
    }
    this.logger.log(
      body.override_callback_uri
        ? `Webhook for WABA ${cfg.wabaId} now points at ${callbackUrl}`
        : `Subscribed the app to WABA ${cfg.wabaId} (callback not set: ${callbackUrl} is not public HTTPS)`,
    );
    return { callbackUrl: body.override_callback_uri ?? null };
  }

  /** Register the webhook on demand, for the Settings button. */
  async registerWebhook(): Promise<CloudState> {
    const cfg = await this.requireConfig();
    if (!/^https:\/\//.test(this.webhookUrl())) {
      throw new BadRequestException(
        `Meta needs a public HTTPS address, and the callback is ${this.webhookUrl()}. ` +
          'This works on the deployed portal, or set PUBLIC_API_URL to a public tunnel.',
      );
    }
    await this.registerWebhookFor(cfg);
    return this.getState();
  }

  /** Where Meta currently sends this account's webhooks, as Meta reports it. */
  private async webhookStatus(cfg: CloudConfig): Promise<CloudState['webhook']> {
    if (!cfg.wabaId) return { subscribed: false, callbackUrl: null };
    try {
      const { data } = await axios.get(`${GRAPH_BASE}/${cfg.apiVersion}/${cfg.wabaId}/subscribed_apps`, {
        headers: { Authorization: `Bearer ${cfg.accessToken}` },
        timeout: 10_000,
      });
      const apps: any[] = data?.data ?? [];
      const override = apps.map((a) => a?.override_callback_uri).find(Boolean) ?? null;
      return { subscribed: apps.length > 0, callbackUrl: override };
    } catch {
      return { subscribed: false, callbackUrl: null };
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
      registered: null,
      phoneNumberId: config?.phoneNumberId ?? null,
      wabaId: config?.wabaId || null,
      apiVersion: config?.apiVersion ?? DEFAULT_API_VERSION,
      accessTokenHint: config?.accessToken ? `…${config.accessToken.slice(-4)}` : null,
      hasAppSecret: !!config?.appSecret,
      verifyToken: config?.verifyToken || null,
      webhookUrl: this.webhookUrl(),
      source,
      webhook: { subscribed: false, callbackUrl: null },
      message: 'WhatsApp Cloud API is not connected.',
    };
    if (!config) return base;
    base.webhook = await this.webhookStatus(config);

    try {
      const { data } = await axios.get(`${GRAPH_BASE}/${config.apiVersion}/${config.phoneNumberId}`, {
        params: { fields: 'display_phone_number,verified_name,quality_rating,platform_type' },
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
        // CLOUD_API once registered; NOT_APPLICABLE (or absent) for a number only added in
        // WhatsApp Manager, which looks connected here but cannot send.
        registered: data?.platform_type ? data.platform_type === 'CLOUD_API' : null,
        message:
          data?.platform_type && data.platform_type !== 'CLOUD_API'
            ? `${name || 'This number'} is not registered with the Cloud API yet, so messages cannot send. Register it below.`
            : name
              ? `Connected as ${name}`
              : 'Connected',
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
        fields: 'name,language,status,category,components,parameter_format',
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
          const names = templateParamNames(bodyText);
          out.push({
            name: t.name,
            language: t.language,
            status: t.status,
            category: t.category,
            body: bodyText,
            bodyParamCount: names.length,
            headerFormat: header?.format ?? null,
            bodyParamNames: names,
            parameterFormat:
              t.parameter_format === 'NAMED' || names.some((n) => !/^\d+$/.test(n)) ? 'NAMED' : 'POSITIONAL',
            headerExampleUrl: header?.example?.header_handle?.[0] ?? header?.example?.header_url?.[0] ?? null,
            headerText: header?.format === 'TEXT' ? (header?.text ?? null) : null,
            headerTextExample: header?.example?.header_text?.[0] ?? null,
            footer: (t.components ?? []).find((c: any) => c.type === 'FOOTER')?.text ?? null,
            buttons: ((t.components ?? []).find((c: any) => c.type === 'BUTTONS')?.buttons ?? []).map((b: any) => ({
              type: b.type,
              text: b.text ?? (b.type === 'COPY_CODE' ? 'Copy offer code' : ''),
              url: b.url,
              phone: b.phone_number,
            })),
            copyCodeButtons: ((t.components ?? []).find((c: any) => c.type === 'BUTTONS')?.buttons ?? [])
              .map((b: any, index: number) => ({ b, index }))
              .filter(({ b }: any) => b?.type === 'COPY_CODE')
              .map(({ b, index }: any) => ({ index, example: (Array.isArray(b.example) ? b.example[0] : b.example) ?? null })),
            dynamicUrlButtons: ((t.components ?? []).find((c: any) => c.type === 'BUTTONS')?.buttons ?? [])
              .map((b: any, index: number) => ({ b, index }))
              .filter(({ b }: any) => b?.type === 'URL' && /\{\{\s*\w+\s*\}\}/.test(b?.url ?? ''))
              .map(({ b, index }: any) => {
                // Meta stores the example as the full URL; the parameter is only the part
                // that replaces the blank, i.e. what follows the fixed prefix.
                const prefix = String(b.url).split(/\{\{/)[0];
                const ex: string | undefined = b.example?.[0];
                return { index, example: ex ? (ex.startsWith(prefix) ? ex.slice(prefix.length) : ex) : null };
              }),
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

  /**
   * Submit a new template to Meta for approval.
   *
   * Meta reviews it (usually minutes, sometimes a day). It can be chosen on campaign
   * steps straight away but only sends once its status is APPROVED.
   */
  async createTemplate(input: NewCloudTemplate): Promise<{ id: string; status: string; name: string }> {
    const cfg = await this.requireConfig();
    if (!cfg.wabaId) {
      throw new BadRequestException('Add the WhatsApp Business Account ID in Settings → WhatsApp first.');
    }
    const name = input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!name) throw new BadRequestException('Give the template a name, e.g. heritage_tour_intro.');
    const body = input.body?.trim();
    if (!body) throw new BadRequestException('The message text is required.');

    // Meta numbers placeholders {{1}}, {{2}}… and rejects gaps or a body that is only
    // variables. Checking here gives the operator the reason in plain words.
    const used = [...new Set((body.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) => Number(m.replace(/\D/g, ''))))].sort(
      (a, b) => a - b,
    );
    if (used.some((n, i) => n !== i + 1)) {
      throw new BadRequestException('Number the blanks in order: {{1}}, then {{2}}, and so on.');
    }
    const examples = (input.examples ?? []).map((e) => e?.trim()).filter(Boolean);
    if (examples.length < used.length) {
      throw new BadRequestException(
        `Give a sample value for each blank (${used.length} needed). Meta's reviewers read them.`,
      );
    }

    const components: any[] = [];
    if (input.headerMedia?.mediaId) {
      const handle = await this.uploadSampleForTemplate(cfg, input.headerMedia.mediaId);
      components.push({ type: 'HEADER', format: input.headerMedia.format, example: { header_handle: [handle] } });
    } else if (input.headerLocation) {
      components.push({ type: 'HEADER', format: 'LOCATION' });
    } else if (input.headerText?.trim()) {
      const text = input.headerText.trim();
      const hasBlank = /\{\{\s*1\s*\}\}/.test(text);
      if (hasBlank && !input.headerTextExample?.trim()) {
        throw new BadRequestException('Give a sample value for the {{1}} in the header.');
      }
      components.push({
        type: 'HEADER',
        format: 'TEXT',
        text,
        ...(hasBlank ? { example: { header_text: [input.headerTextExample!.trim()] } } : {}),
      });
    }
    components.push({
      type: 'BODY',
      text: body,
      ...(used.length ? { example: { body_text: [examples.slice(0, used.length)] } } : {}),
    });
    if (input.footer?.trim()) components.push({ type: 'FOOTER', text: input.footer.trim() });
    const buttons = WhatsappCloudService.buildButtons(input);
    if (buttons.length) components.push({ type: 'BUTTONS', buttons });

    try {
      const { data } = await axios.post(
        `${GRAPH_BASE}/${cfg.apiVersion}/${cfg.wabaId}/message_templates`,
        { name, language: input.language || 'en', category: input.category || 'MARKETING', components },
        { headers: { Authorization: `Bearer ${cfg.accessToken}` }, timeout: 20_000 },
      );
      this.logger.log(`Submitted template ${name} for approval (${data?.status})`);
      return { id: data?.id, status: data?.status ?? 'PENDING', name };
    } catch (err) {
      throw new BadRequestException(`Meta rejected the template: ${this.describeError(err)}`);
    }
  }

  /**
   * Template buttons in Meta's shape, checked against Meta's limits first so the
   * operator gets the reason in plain words instead of a rejection code.
   */
  static buildButtons(input: { buttons?: NewTemplateButton[]; quickReplies?: string[] }): any[] {
    const list: NewTemplateButton[] = [
      ...(input.buttons ?? []),
      ...(input.quickReplies ?? []).filter((r) => r?.trim()).map((text) => ({ type: 'QUICK_REPLY' as const, text })),
    ];
    if (list.length > 10) throw new BadRequestException('Meta allows at most 10 buttons on a template.');
    const count = (t: string) => list.filter((b) => b.type === t).length;
    if (count('URL') > 2) throw new BadRequestException('Meta allows at most 2 website buttons.');
    if (count('PHONE_NUMBER') > 1) throw new BadRequestException('Meta allows 1 call button.');
    if (count('COPY_CODE') > 1) throw new BadRequestException('Meta allows 1 copy-code button.');

    // Meta requires quick replies to be grouped together, before or after the others.
    const ordered = [...list.filter((b) => b.type === 'QUICK_REPLY'), ...list.filter((b) => b.type !== 'QUICK_REPLY')];
    return ordered.map((b) => {
      const text = b.text?.trim() ?? '';
      if (b.type !== 'COPY_CODE' && !text) throw new BadRequestException('Every button needs a label.');
      if (text.length > 25) throw new BadRequestException(`Button label "${text}" is longer than 25 characters.`);
      switch (b.type) {
        case 'QUICK_REPLY':
          return { type: 'QUICK_REPLY', text };
        case 'URL': {
          const url = b.url?.trim() ?? '';
          if (!/^https?:\/\//.test(url)) throw new BadRequestException(`Website button "${text}" needs a full link starting with https://`);
          const blank = /\{\{\s*1\s*\}\}/.test(url);
          if (blank && !/\{\{\s*1\s*\}\}$/.test(url)) {
            throw new BadRequestException('In a website link, {{1}} can only be at the very end.');
          }
          if (blank && !b.example?.trim()) {
            throw new BadRequestException(`Give an example ending for the {{1}} in "${text}".`);
          }
          return {
            type: 'URL',
            text,
            url,
            ...(blank ? { example: [url.replace(/\{\{\s*1\s*\}\}$/, b.example!.trim())] } : {}),
          };
        }
        case 'PHONE_NUMBER': {
          const phone = (b.phone ?? '').replace(/[^\d+]/g, '');
          if (!/^\+?\d{8,15}$/.test(phone)) throw new BadRequestException(`Call button "${text}" needs a phone number with country code.`);
          return { type: 'PHONE_NUMBER', text, phone_number: phone.startsWith('+') ? phone : `+${phone}` };
        }
        case 'COPY_CODE': {
          const code = b.example?.trim();
          if (!code || code.length > 15) throw new BadRequestException('A copy-code button needs an example code of up to 15 characters.');
          return { type: 'COPY_CODE', example: code };
        }
        default:
          throw new BadRequestException(`Unknown button type ${(b as any).type}`);
      }
    });
  }

  /** The Meta app the token belongs to, from the saved App ID or the token itself. */
  private async resolveAppId(cfg: CloudConfig): Promise<string> {
    if (cfg.appId?.trim()) return cfg.appId.trim();
    try {
      const { data } = await axios.get(`${GRAPH_BASE}/${cfg.apiVersion}/debug_token`, {
        params: { input_token: cfg.accessToken, access_token: cfg.accessToken },
        timeout: 15_000,
      });
      const appId = data?.data?.app_id;
      if (appId) return String(appId);
    } catch {
      /* fall through to the explanation below */
    }
    throw new BadRequestException(
      'Meta needs your App ID to upload the template image. Add it under Settings → WhatsApp → Edit credentials (Meta app → App settings → Basic → App ID).',
    );
  }

  /**
   * Upload a sample of the header media through Meta's Resumable Upload API.
   *
   * A template with an image, video or PDF header must include an example file for
   * Meta's reviewers, given as an upload handle rather than a link.
   */
  private async uploadSampleForTemplate(cfg: CloudConfig, mediaId: string): Promise<string> {
    if (!this.media) throw new BadRequestException('File storage is unavailable.');
    const file = await this.media.get(mediaId);
    const appId = await this.resolveAppId(cfg);
    try {
      const session = await axios.post(`${GRAPH_BASE}/${cfg.apiVersion}/${appId}/uploads`, null, {
        params: { file_name: file.filename, file_length: file.data.length, file_type: file.mime },
        headers: { Authorization: `Bearer ${cfg.accessToken}` },
        timeout: 20_000,
      });
      const uploadId: string = session.data?.id;
      const { data } = await axios.post(`${GRAPH_BASE}/${cfg.apiVersion}/${uploadId}`, file.data, {
        headers: {
          Authorization: `OAuth ${cfg.accessToken}`,
          file_offset: '0',
          'Content-Type': 'application/octet-stream',
        },
        maxBodyLength: Infinity,
        timeout: 60_000,
      });
      if (!data?.h) throw new Error('Meta returned no upload handle');
      return data.h as string;
    } catch (err) {
      throw new BadRequestException(`Meta did not accept the template image: ${this.describeError(err)}`);
    }
  }

  async deleteTemplate(name: string): Promise<{ deleted: boolean }> {
    const cfg = await this.requireConfig();
    if (!cfg.wabaId) throw new BadRequestException('Add the WhatsApp Business Account ID first.');
    try {
      await axios.delete(`${GRAPH_BASE}/${cfg.apiVersion}/${cfg.wabaId}/message_templates`, {
        params: { name },
        headers: { Authorization: `Bearer ${cfg.accessToken}` },
        timeout: 15_000,
      });
      return { deleted: true };
    } catch (err) {
      throw new BadRequestException(`Meta did not delete the template: ${this.describeError(err)}`);
    }
  }

  /**
   * Register the phone number with the Cloud API.
   *
   * A number added in WhatsApp Manager is not usable for sending until this call is
   * made once with a 6-digit PIN, which also becomes its two-step verification PIN.
   * Until then every message fails with #133010.
   */
  async registerNumber(pin: string): Promise<CloudState> {
    const cfg = await this.requireConfig();
    if (!/^\d{6}$/.test(pin ?? '')) {
      throw new BadRequestException('The PIN must be exactly 6 digits.');
    }
    try {
      await axios.post(
        `${GRAPH_BASE}/${cfg.apiVersion}/${cfg.phoneNumberId}/register`,
        { messaging_product: 'whatsapp', pin },
        { headers: { Authorization: `Bearer ${cfg.accessToken}` }, timeout: 30_000 },
      );
      this.logger.log(`Registered phone number ${cfg.phoneNumberId} with the Cloud API`);
    } catch (err) {
      throw new BadRequestException(`Meta did not register the number: ${this.describeError(err)}`);
    }
    this.cache = null;
    return this.getState();
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
  /** Recently read template definitions, so a campaign burst does not list them per message. */
  private templateCache: { at: number; list: CloudTemplate[] } | null = null;

  /** The definition Meta holds for one template, or null when it cannot be read. */
  async findTemplate(name: string, language: string): Promise<CloudTemplate | null> {
    const fresh = this.templateCache && Date.now() - this.templateCache.at < 5 * 60_000;
    let list = fresh ? this.templateCache!.list : null;
    if (!list) {
      list = await this.listTemplates().catch(() => null);
      if (list) this.templateCache = { at: Date.now(), list };
    }
    if (!list) return null;
    return (
      list.find((t) => t.name === name && t.language === language) ??
      list.find((t) => t.name === name) ??
      null
    );
  }

  /**
   * Body parameters in the shape the template expects.
   *
   * Templates written in WhatsApp Manager can use named blanks ({{customer_name}}), and
   * Meta then requires every value to carry `parameter_name`; sending them positionally
   * fails with "(#100) Parameter name is missing or empty". The count is also matched to
   * the template, because too many or too few values fail with #132000.
   */
  static shapeBodyParams(values: string[], def: CloudTemplate | null): any[] {
    const clean = (v: string | undefined) => (v?.trim() ? v : '-');
    if (!def) return values.map((text) => ({ type: 'text', text: clean(text) }));
    const names = def.bodyParamNames ?? [];
    const sized = names.map((_n, i) => values[i]);
    if (def.parameterFormat === 'NAMED') {
      return names.map((n, i) => ({ type: 'text', parameter_name: n, text: clean(sized[i]) }));
    }
    return sized.map((text) => ({ type: 'text', text: clean(text) }));
  }

  async sendTemplate(
    to: string,
    name: string,
    language: string,
    bodyParams: string[] = [],
    header?: { type: 'image' | 'video' | 'document'; link: string; filename?: string } | null,
  ) {
    const def = await this.findTemplate(name, language || 'en');
    const components: any[] = [];
    const mediaHeader = !!def?.headerFormat && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(def.headerFormat);
    // Meta does not reuse the sample uploaded with the template: every send of a template
    // with an image, video or PDF header must include one, or Meta rejects it. When the
    // campaign step has no file of its own, send the template's own sample.
    if (def && mediaHeader && !header?.link) {
      const kind = def.headerFormat!.toLowerCase() as 'image' | 'video' | 'document';
      const mediaId = await this.templateHeaderMediaId(def);
      components.push({ type: 'header', parameters: [{ type: kind, [kind]: { id: mediaId } }] });
    }
    // A header sent to a template without one fails with #132012, so it is dropped.
    if (header?.link && (!def || mediaHeader)) {
      const media: Record<string, string> = { link: header.link };
      if (header.type === 'document' && header.filename) media.filename = header.filename;
      components.push({ type: 'header', parameters: [{ type: header.type, [header.type]: media }] });
    }
    // Meta rejects empty values, so a missing merge value becomes a dash rather than
    // failing the whole send.
    const parameters = WhatsappCloudService.shapeBodyParams(bodyParams, def);
    if (parameters.length) components.push({ type: 'body', parameters });
    if (def?.headerFormat === 'TEXT' && def.headerText && /\{\{\s*\w+\s*\}\}/.test(def.headerText)) {
      // The header blank takes the template's sample, e.g. a destination or offer name.
      components.unshift({ type: 'header', parameters: [{ type: 'text', text: def.headerTextExample || bodyParams[0] || '-' }] });
    }
    if (def?.headerFormat === 'LOCATION') {
      const loc = await this.businessLocation();
      components.unshift({ type: 'header', parameters: [{ type: 'location', location: loc }] });
    }
    for (const btn of def?.copyCodeButtons ?? []) {
      components.push({
        type: 'button',
        sub_type: 'copy_code',
        index: String(btn.index),
        parameters: [{ type: 'coupon_code', coupon_code: btn.example || 'OFFER' }],
      });
    }
    for (const btn of def?.dynamicUrlButtons ?? []) {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: String(btn.index),
        parameters: [{ type: 'text', text: btn.example || '-' }],
      });
    }
    const result = await this.post({
      to: WhatsappCloudService.toRecipient(to),
      type: 'template',
      template: {
        name,
        language: { code: def?.language ?? (language || 'en') },
        ...(components.length ? { components } : {}),
      },
    });
    return { ...result, renderedBody: WhatsappCloudService.renderTemplateText(def, bodyParams) };
  }

  /** The text the recipient reads, so the conversation shows the message, not its name. */
  static renderTemplateText(def: CloudTemplate | null, values: string[]): string | null {
    if (!def?.body) return null;
    const names = def.bodyParamNames ?? [];
    const body = def.body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, n) => {
      const i = names.indexOf(n);
      return (i >= 0 && values[i]?.trim()) || '-';
    });
    return [def.headerText, body].filter(Boolean).join('\n\n');
  }

  /** The pin shown by templates with a location header. Saved from Settings. */
  async businessLocation(): Promise<{ latitude: number; longitude: number; name?: string; address?: string }> {
    const loc = await this.readSetting<{ latitude: number; longitude: number; name?: string; address?: string }>(
      'whatsapp.location',
    );
    if (!loc || !Number.isFinite(Number(loc.latitude)) || !Number.isFinite(Number(loc.longitude))) {
      throw new BadRequestException(
        'This template shows a location. Set your business location under Settings → WhatsApp → Business location first.',
      );
    }
    return { ...loc, latitude: Number(loc.latitude), longitude: Number(loc.longitude) };
  }

  async getBusinessLocation() {
    return this.readSetting<{ latitude: number; longitude: number; name?: string; address?: string }>('whatsapp.location');
  }

  async saveBusinessLocation(loc: { latitude: number; longitude: number; name?: string; address?: string }) {
    const lat = Number(loc.latitude);
    const lng = Number(loc.longitude);
    if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) {
      throw new BadRequestException('Latitude must be -90 to 90 and longitude -180 to 180.');
    }
    const value = { latitude: lat, longitude: lng, name: loc.name?.trim() || undefined, address: loc.address?.trim() || undefined };
    await this.writeSetting('whatsapp.location', value);
    return value;
  }

  /** Uploaded copies of template header samples: Meta media ids last 30 days, kept 25. */
  private headerMediaCache = new Map<string, { id: string; at: number }>();

  /**
   * A Meta media id for a template's own header sample.
   *
   * The sample lives on Meta's CDN behind a signed link that expires, so it is fetched
   * and re-uploaded to this number's media store. Sending by id then works without the
   * portal needing a public address, and the id is reused for 25 days.
   */
  private async templateHeaderMediaId(def: CloudTemplate): Promise<string> {
    const key = `${def.name}|${def.language}`;
    const cached = this.headerMediaCache.get(key);
    if (cached && Date.now() - cached.at < 25 * 24 * 3600_000) return cached.id;

    const cfg = await this.requireConfig();
    if (!def.headerExampleUrl) {
      throw new BadRequestException(
        `Template "${def.name}" has a ${def.headerFormat?.toLowerCase()} header but Meta returned no sample to send. Attach the file to the campaign step.`,
      );
    }
    let bytes: Buffer;
    let mime: string;
    try {
      const res = await axios.get(def.headerExampleUrl, { responseType: 'arraybuffer', timeout: 30_000 });
      bytes = Buffer.from(res.data);
      mime = String(res.headers['content-type'] || '').split(';')[0] ||
        (def.headerFormat === 'IMAGE' ? 'image/jpeg' : def.headerFormat === 'VIDEO' ? 'video/mp4' : 'application/pdf');
    } catch (err) {
      throw new BadRequestException(
        `Could not fetch the header ${def.headerFormat?.toLowerCase()} of template "${def.name}" from Meta: ${this.describeError(err)}. Attach the file to the campaign step instead.`,
      );
    }
    const id = await this.uploadToMeta(cfg, bytes, mime, `${def.name}.${mime.split('/')[1] || 'bin'}`);
    this.headerMediaCache.set(key, { id, at: Date.now() });
    return id;
  }

  /** Upload a file to this phone number's media store; returns its media id. */
  private async uploadToMeta(cfg: CloudConfig, bytes: Buffer, mime: string, filename: string): Promise<string> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mime);
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), filename);
    try {
      const { data } = await axios.post(`${GRAPH_BASE}/${cfg.apiVersion}/${cfg.phoneNumberId}/media`, form, {
        headers: { Authorization: `Bearer ${cfg.accessToken}` },
        maxBodyLength: Infinity,
        timeout: 60_000,
      });
      if (!data?.id) throw new Error('Meta returned no media id');
      return String(data.id);
    } catch (err) {
      throw new BadRequestException(`Meta did not accept the header file: ${this.describeError(err)}`);
    }
  }

  /** Readable one-line cause; Graph errors put the useful text in error.error_data. */
  describeError(err: unknown): string {
    const ax = err as AxiosError<any>;
    const e = ax?.response?.data?.error;
    if (e) {
      const detail = e.error_data?.details;
      const hint = metaErrorHint(e.code);
      return [
        e.code ? `(#${e.code})` : null,
        e.message,
        detail && detail !== e.message ? `- ${detail}` : null,
        hint ? `Fix: ${hint}` : null,
      ]
        .filter(Boolean)
        .join(' ');
    }
    return [ax?.response?.status, (err as Error)?.message].filter(Boolean).join(' ');
  }
}
