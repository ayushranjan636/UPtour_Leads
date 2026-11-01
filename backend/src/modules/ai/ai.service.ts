import { BadRequestException, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIAnalysisResult, AIReplyResult } from './ai.interfaces';
import {
  buildReplySystemPrompt,
  truncateAtSentence,
  MAX_REPLY_CHARS,
  type ReplyContext,
} from './reply-prompt';

/**
 * AI PROVIDER — Multi-model with automatic failover
 * 
 * Primary:  OpenAI GPT-4o (best structured output)
 * Fallback: Google Gemini 2.0 Flash (fast, cheap backup)
 * 
 * Strategy: Try OpenAI first. If it fails (timeout, rate limit, error),
 * automatically retry with Gemini. Never let AI failure block the pipeline.
 * 
 * Cost comparison (per 1M tokens):
 *   GPT-4o:       $2.50 in / $10 out  — most reliable structured JSON
 *   GPT-4o-mini:  $0.15 in / $0.60 out — good balance
 *   Gemini Flash:  $0.075 in / $0.30 out — cheapest, good fallback
 */
interface AIProvider {
  name: string;
  call(systemPrompt: string, userMessage: string, jsonMode: boolean): Promise<string>;
  isAvailable(): boolean;
}

/** AI keys saved from Settings. Each falls back to its environment variable. */
export interface AiKeySettings {
  openaiKey?: string;
  openaiModel?: string;
  geminiKey?: string;
  geminiModel?: string;
}

const AI_KEYS_SETTING = 'ai.keys';

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  private providers: AIProvider[] = [];

  // Stats for monitoring
  private stats = {
    openai: { calls: 0, failures: 0, totalMs: 0 },
    gemini: { calls: 0, failures: 0, totalMs: 0 },
  };

  /** Keys saved in Settings; empty until loaded. Env vars fill whatever is missing. */
  private saved: AiKeySettings = {};

  constructor(
    private readonly config: ConfigService,
    // Optional so tests can build the service from config alone.
    @Optional() private readonly dataSource?: DataSource,
  ) {
    this.initProviders();
  }

  /**
   * Load keys saved from Settings.
   *
   * Keys used to live only in the server's environment file, so turning AI replies on
   * meant editing the server and redeploying. Saved keys win over env vars.
   */
  async onModuleInit(): Promise<void> {
    if (!this.dataSource) return;
    try {
      await this.dataSource.query(
        'CREATE TABLE IF NOT EXISTS app_settings (key varchar(100) PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())',
      );
      const rows = await this.dataSource.query('SELECT value FROM app_settings WHERE key = $1', [AI_KEYS_SETTING]);
      this.saved = rows?.[0]?.value ?? {};
      this.initProviders();
    } catch (err) {
      this.logger.warn(`Could not load saved AI keys: ${(err as Error).message}`);
    }
  }

  /** Effective key or model: saved value first, then the environment. */
  private setting(saved: string | undefined, envKey: string, fallback = ''): string {
    return saved?.trim() || this.config.get<string>(envKey)?.trim() || fallback;
  }

  /** What Settings shows. Keys are never returned, only their last four characters. */
  getKeyState() {
    const describe = (savedKey: string | undefined, envKey: string, model: string) => {
      const key = this.setting(savedKey, envKey);
      return {
        configured: !!key,
        source: savedKey?.trim() ? 'portal' : key ? 'env' : 'none',
        keyHint: key ? `…${key.slice(-4)}` : null,
        model,
      };
    };
    return {
      openai: describe(this.saved.openaiKey, 'OPENAI_API_KEY', this.setting(this.saved.openaiModel, 'OPENAI_MODEL', 'gpt-4o')),
      gemini: describe(this.saved.geminiKey, 'GEMINI_API_KEY', this.setting(this.saved.geminiModel, 'GEMINI_MODEL', 'gemini-2.0-flash')),
      active: this.providers.map((p) => p.name),
    };
  }

  /**
   * Save keys from Settings and switch to them immediately. A blank field keeps the
   * saved value; the literal "-" removes it.
   */
  async saveKeys(input: AiKeySettings) {
    if (!this.dataSource) throw new BadRequestException('Settings storage is unavailable.');
    const merge = (next: string | undefined, prev: string | undefined) =>
      next === '-' ? undefined : next?.trim() ? next.trim() : prev;
    this.saved = {
      openaiKey: merge(input.openaiKey, this.saved.openaiKey),
      openaiModel: merge(input.openaiModel, this.saved.openaiModel),
      geminiKey: merge(input.geminiKey, this.saved.geminiKey),
      geminiModel: merge(input.geminiModel, this.saved.geminiModel),
    };
    await this.dataSource.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [AI_KEYS_SETTING, JSON.stringify(this.saved)],
    );
    this.initProviders();
    return this.getKeyState();
  }

  /** Ask one provider for a one-word answer, to prove the key and model work. */
  async testProvider(name: 'openai' | 'gemini'): Promise<{ ok: true; reply: string; ms: number }> {
    const provider = this.providers.find((p) => p.name === name);
    if (!provider) throw new BadRequestException(`No ${name === 'openai' ? 'OpenAI' : 'Gemini'} key is set.`);
    const started = Date.now();
    try {
      const reply = await provider.call('Reply with the single word OK.', 'Are you working?', false);
      return { ok: true, reply: reply.trim().slice(0, 100), ms: Date.now() - started };
    } catch (err) {
      throw new BadRequestException(`${name === 'openai' ? 'OpenAI' : 'Gemini'} rejected the request: ${(err as Error).message}`);
    }
  }

  private initProviders() {
    // Rebuilt from scratch so a changed or removed key takes effect at once.
    this.providers = [];
    // Primary: OpenAI
    const openaiKey = this.setting(this.saved.openaiKey, 'OPENAI_API_KEY');
    if (openaiKey) {
      const openai = new OpenAI({ apiKey: openaiKey });
      const model = this.setting(this.saved.openaiModel, 'OPENAI_MODEL', 'gpt-4o');

      this.providers.push({
        name: 'openai',
        isAvailable: () => !!openaiKey,
        call: async (system, user, jsonMode) => {
          const response = await openai.chat.completions.create({
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            response_format: jsonMode ? { type: 'json_object' } : undefined,
            temperature: 0.3,
            max_tokens: 2000,
          });
          return response.choices[0]?.message?.content || '';
        },
      });
      this.logger.log(`AI Provider: OpenAI (${model}) ✅`);
    }

    // Fallback: Gemini
    const geminiKey = this.setting(this.saved.geminiKey, 'GEMINI_API_KEY');
    if (geminiKey) {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const geminiModel = this.setting(this.saved.geminiModel, 'GEMINI_MODEL', 'gemini-2.0-flash');

      this.providers.push({
        name: 'gemini',
        isAvailable: () => !!geminiKey,
        call: async (system, user, jsonMode) => {
          const model = genAI.getGenerativeModel({
            model: geminiModel,
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 2000,
              responseMimeType: jsonMode ? 'application/json' : 'text/plain',
            },
          });
          const result = await model.generateContent(`${system}\n\n---\n\n${user}`);
          return result.response.text();
        },
      });
      this.logger.log(`AI Provider: Gemini (${geminiModel}) ✅ (fallback)`);
    }

    if (this.providers.length === 0) {
      this.logger.warn('⚠️ No AI providers configured. Add a Gemini or OpenAI key in Settings → AI Assistant');
    }
  }

  /**
   * Core method: call AI with automatic failover.
   * Tries each provider in order. Returns first successful result.
   */
  private async callWithFailover(system: string, user: string, jsonMode = true): Promise<string> {
    for (const provider of this.providers) {
      if (!provider.isAvailable()) continue;

      const startMs = Date.now();
      try {
        const result = await Promise.race([
          provider.call(system, user, jsonMode),
          this.timeout(30_000), // 30s timeout
        ]);

        const elapsed = Date.now() - startMs;
        this.stats[provider.name] = this.stats[provider.name] || { calls: 0, failures: 0, totalMs: 0 };
        this.stats[provider.name].calls++;
        this.stats[provider.name].totalMs += elapsed;

        this.logger.log(`AI [${provider.name}] responded in ${elapsed}ms`);
        return result as string;

      } catch (err) {
        const elapsed = Date.now() - startMs;
        this.stats[provider.name] = this.stats[provider.name] || { calls: 0, failures: 0, totalMs: 0 };
        this.stats[provider.name].failures++;

        this.logger.warn(`AI [${provider.name}] failed (${elapsed}ms): ${err.message} — trying next provider`);
      }
    }

    throw new Error('All AI providers failed');
  }

  /**
   * Generate a reply to an inbound WhatsApp message.
   *
   * Distinct from `analyzeMessage`, which only classifies: this composes the actual
   * text a prospect will read, so it is deliberately conservative. The prompt forbids
   * inventing prices, dates and availability — a travel enquiry answered with a
   * fabricated quote is worse than one escalated to a human — and any low-confidence
   * or commercial question sets `needs_human` so a person takes over.
   *
   * Returns null when no provider is available, so callers fall back to their
   * pre-written templates rather than going silent.
   */
  async generateReply(
    messageBody: string,
    conversationHistory: { role: string; content: string }[] = [],
    context: ReplyContext = {},
  ): Promise<AIReplyResult | null> {
    if (!this.providers.some((p) => p.isAvailable())) {
      this.logger.warn('No AI provider available — cannot generate a reply');
      return null;
    }

    const system = buildReplySystemPrompt(context);
    const history = conversationHistory
      .slice(-8)
      .map((m) => `${m.role === 'assistant' ? 'Us' : 'Them'}: ${m.content}`)
      .join('\n');

    const user = `Conversation so far:\n${history || '(none)'}\n\nTheir latest message:\n"${messageBody}"\n\nCompose the reply.`;

    try {
      const raw = await this.callWithFailover(system, user, true);
      return this.parseReply(raw);
    } catch (err) {
      this.logger.error(`Reply generation failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Parse and sanitise a generated reply.
   *
   * Everything is validated rather than trusted: an over-long body gets truncated at a
   * sentence boundary (WhatsApp renders walls of text badly and it reads as automated),
   * and a media URL is only accepted if it is a plausible http(s) link, because the
   * value is handed to the gateway to fetch.
   */
  private parseReply(raw: string): AIReplyResult | null {
    let parsed: any;
    try {
      parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim());
    } catch {
      this.logger.warn('Reply generation returned unparseable JSON');
      return null;
    }

    const body = typeof parsed.body === 'string' ? parsed.body.trim() : '';
    if (!body) return null;

    const mediaType = ['image', 'video', 'document'].includes(parsed.media_type)
      ? parsed.media_type
      : null;
    const mediaUrl =
      typeof parsed.media_url === 'string' && /^https?:\/\/\S+$/i.test(parsed.media_url.trim())
        ? parsed.media_url.trim()
        : null;

    return {
      body: truncateAtSentence(body, MAX_REPLY_CHARS),
      // Media only counts when both halves are present; a type without a URL would
      // fall through the processor's send branch and deliver nothing.
      mediaType: mediaType && mediaUrl ? mediaType : null,
      mediaUrl: mediaType && mediaUrl ? mediaUrl : null,
      needsHuman: parsed.needs_human === true,
      confidence:
        typeof parsed.confidence === 'number'
          ? Math.min(Math.max(parsed.confidence, 0), 1)
          : 0.5,
    };
  }

  /**
   * Analyze an incoming WhatsApp message.
   * Returns structured JSON with intent, interest, confidence, etc.
   */
  async analyzeMessage(
    messageBody: string,
    conversationHistory: { role: string; content: string }[],
    campaignContext?: { product?: string; campaignName?: string },
  ): Promise<AIAnalysisResult> {
    const system = `You are an AI for UP Heritage Tours (India B2B travel).
Analyze this WhatsApp reply from a travel agency. Return ONLY valid JSON:
{
  "intent": "interested|not_interested|question|opt_out|greeting|request_info|out_of_office|unclear",
  "interest_level": "high|medium|low|none",
  "product_interest": "string or null",
  "destination_interest": ["array"] or null,
  "travel_period": "string or null",
  "traveller_count": "string or null",
  "requirements": "string or null",
  "questions": ["array"] or null,
  "needs_human": true/false,
  "opt_out": true/false,
  "confidence": 0.0-1.0,
  "lead_score": 0-100,
  "reasoning": "brief explanation"
}
RULES: Never invent data. If not mentioned, use null. Detect opt-out aggressively.
${campaignContext?.product ? `Product: ${campaignContext.product}` : ''}`;

    const history = conversationHistory
      .map((m) => `${m.role === 'user' ? 'Agency' : 'Us'}: ${m.content}`)
      .join('\n');
    const user = `${history}\n\nNew message from agency:\n${messageBody}`;

    const raw = await this.callWithFailover(system, user, true);
    return this.parseAnalysis(raw);
  }

  /**
   * Generate structured data (for data collection module).
   */
  async generateStructuredData(prompt: string): Promise<string> {
    const system = 'Return ONLY valid JSON. No markdown, no explanation.';
    const raw = await this.callWithFailover(system, prompt, true);

    // Normalize: extract array from wrapper objects
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return JSON.stringify(parsed);
      for (const key of ['data', 'contacts', 'results', 'agencies']) {
        if (parsed[key] && Array.isArray(parsed[key])) return JSON.stringify(parsed[key]);
      }
    } catch { /* return raw */ }
    return raw;
  }

  /**
   * Get provider health stats for dashboard.
   */
  getStats() {
    return {
      providers: this.providers.map((p) => p.name),
      stats: this.stats,
      primaryAvailable: this.providers[0]?.isAvailable() ?? false,
      fallbackAvailable: this.providers[1]?.isAvailable() ?? false,
    };
  }

  private parseAnalysis(raw: string): AIAnalysisResult {
    try {
      const p = JSON.parse(raw);
      return {
        intent: p.intent || 'unclear',
        interest_level: p.interest_level || 'none',
        product_interest: p.product_interest || null,
        destination_interest: Array.isArray(p.destination_interest) ? p.destination_interest : null,
        travel_period: p.travel_period || null,
        traveller_count: p.traveller_count || null,
        requirements: p.requirements || null,
        questions: Array.isArray(p.questions) ? p.questions : null,
        needs_human: !!p.needs_human,
        opt_out: !!p.opt_out,
        confidence: typeof p.confidence === 'number' ? p.confidence : 0,
        lead_score: typeof p.lead_score === 'number' ? p.lead_score : 0,
        reasoning: p.reasoning || '',
      };
    } catch {
      this.logger.error('Failed to parse AI response — returning safe defaults');
      return {
        intent: 'unclear', interest_level: 'none', product_interest: null,
        destination_interest: null, travel_period: null, traveller_count: null,
        requirements: null, questions: null, needs_human: true, opt_out: false,
        confidence: 0, lead_score: 0, reasoning: 'Parse failure — needs human review',
      };
    }
  }

  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) => setTimeout(() => reject(new Error(`AI timeout ${ms}ms`)), ms));
  }
}
