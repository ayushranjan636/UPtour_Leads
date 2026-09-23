/**
 * The inbound AI pipeline has two failure modes that are far more expensive than the
 * feature is valuable, and these tests exist to pin both shut:
 *
 *   1. Counting our own messages as replies, which inflates the funnel with phantom
 *      leads and deals nobody can explain.
 *   2. Answering our own messages, which on an unofficial WhatsApp gateway escalates
 *      into an AI-to-AI loop and a banned account.
 *
 * Everything else here — kill switches, opt-out, idempotency — protects the same two
 * properties from a different direction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InboundAiService } from '../modules/ai/inbound-ai.service';
import {
  assessConversionIntent,
  countTrailingAiReplies,
  isHumanInbound,
  isOwnEcho,
} from '../modules/ai/inbound-ai.decisions';
import { LeadStatus } from '../entities/lead.entity';
import { DealStage } from '../entities/deal.entity';
import { AIAnalysisResult } from '../modules/ai/ai.interfaces';

const HUMAN_INBOUND = {
  id: 'msg-in-1',
  contact_id: 'c1',
  direction: 'incoming',
  is_ai_generated: false,
  body: 'Do you have Golden Triangle itineraries?',
} as any;

const AI_OUTBOUND = {
  id: 'msg-out-1',
  contact_id: 'c1',
  direction: 'outgoing',
  is_ai_generated: true,
  body: 'We do — which dates are you looking at?',
} as any;

const CONTACT = {
  id: 'c1',
  name: 'Ravi',
  company_id: null,
  is_opted_out: false,
  is_suppressed: false,
} as any;

function analysis(over: Partial<AIAnalysisResult> = {}): AIAnalysisResult {
  return {
    intent: 'interested',
    interest_level: 'high',
    product_interest: 'Golden Triangle',
    destination_interest: ['Agra'],
    travel_period: 'March 2027',
    traveller_count: '12',
    requirements: 'four-star hotels',
    questions: null,
    needs_human: false,
    opt_out: false,
    confidence: 0.9,
    lead_score: 85,
    reasoning: 'Asked to confirm dates and pricing for a group of 12',
    ...over,
  };
}

/** Build the service with fully controllable collaborators. */
function makeService(
  over: {
    history?: any[];
    leads?: any[];
    deals?: any[];
    env?: Record<string, string>;
    reply?: any;
  } = {},
) {
  const leads: any[] = over.leads ?? [];
  const deals: any[] = over.deals ?? [];
  const history: any[] = over.history ?? [HUMAN_INBOUND];
  let leadSeq = 0;
  let dealSeq = 0;

  // `history` is written chronologically for readability; the service queries newest-first
  // (`order: { created_at: 'DESC' }`) and reverses, so the fake must do the same or the
  // loop guard sees the conversation backwards.
  const messageRepo = { find: vi.fn(async () => history.slice().reverse()) };
  const contactRepo = { findOne: vi.fn(async () => CONTACT) };
  const campaignRepo = {
    findOne: vi.fn(async () => null),
    increment: vi.fn(async () => undefined),
  };
  const ccRepo = { findOne: vi.fn(async () => null), update: vi.fn(async () => undefined) };

  const leadRepo = {
    findOne: vi.fn(async () => leads[0] ?? null),
    create: vi.fn((data: any) => ({ ...data })),
    save: vi.fn(async (data: any) => {
      const row = { id: `lead-${++leadSeq}`, created_at: new Date(), ...data };
      leads.push(row);
      return row;
    }),
    update: vi.fn(async (id: string, patch: any) => {
      const row = leads.find((l) => l.id === id);
      if (row) Object.assign(row, patch);
    }),
  };

  const dealRepo = {
    findOne: vi.fn(
      async () =>
        deals.find((d) => d.stage !== DealStage.WON && d.stage !== DealStage.LOST) ?? null,
    ),
    create: vi.fn((data: any) => ({ ...data })),
    save: vi.fn(async (data: any) => {
      const row = { id: `deal-${++dealSeq}`, created_at: new Date(), ...data };
      deals.push(row);
      return row;
    }),
  };

  const sendQueue = { add: vi.fn(async () => ({ id: 'job-1' })) };
  const aiService = {
    generateReply: vi.fn(async () =>
      over.reply === undefined
        ? {
            body: 'Happy to help — which dates?',
            mediaType: null,
            mediaUrl: null,
            needsHuman: false,
            confidence: 0.9,
          }
        : over.reply,
    ),
  };

  const claimed = new Set<string>();
  const redis = {
    // Backed by one store so the cheap pre-check and the atomic claim agree, as they do
    // against a real Redis.
    get: vi.fn(async (key: string) => (claimed.has(key) ? '1' : null)),
    isDuplicate: vi.fn(async (key: string) => {
      if (claimed.has(key)) return true;
      claimed.add(key);
      return false;
    }),
  };

  const env = over.env ?? { AI_AUTO_REPLY_ENABLED: 'true' };
  const config = { get: vi.fn((k: string) => env[k]) };

  const svc = new InboundAiService(
    messageRepo as any,
    contactRepo as any,
    campaignRepo as any,
    ccRepo as any,
    leadRepo as any,
    dealRepo as any,
    sendQueue as any,
    aiService as any,
    redis as any,
    config as any,
  );

  return {
    svc,
    leads,
    deals,
    leadRepo,
    dealRepo,
    sendQueue,
    aiService,
    redis,
    ccRepo,
    campaignRepo,
    messageRepo,
    contactRepo,
  };
}

describe('human-inbound gate', () => {
  it('accepts a genuine inbound message', () => {
    expect(isHumanInbound(HUMAN_INBOUND)).toBe(true);
  });

  it('rejects our own AI reply, our own template send, and nothing at all', () => {
    expect(isHumanInbound(AI_OUTBOUND)).toBe(false);
    expect(isHumanInbound({ direction: 'outgoing', is_ai_generated: false })).toBe(false);
    // An assistant row with the wrong direction must still never count.
    expect(isHumanInbound({ direction: 'incoming', is_ai_generated: true })).toBe(false);
    expect(isHumanInbound(null)).toBe(false);
  });

  it('recognises a gateway echo of our own message', () => {
    expect(isOwnEcho({ fromMe: true })).toBe(true);
    expect(isOwnEcho({ from_me: true })).toBe(true);
    expect(isOwnEcho({ self: true })).toBe(true);
    expect(isOwnEcho({ from: '+911234567890@c.us' })).toBe(false);
  });
});

describe('trailing assistant messages', () => {
  it('counts only the run since the prospect last spoke', () => {
    expect(countTrailingAiReplies([HUMAN_INBOUND])).toBe(0);
    expect(countTrailingAiReplies([HUMAN_INBOUND, AI_OUTBOUND])).toBe(1);
    expect(countTrailingAiReplies([HUMAN_INBOUND, AI_OUTBOUND, AI_OUTBOUND])).toBe(2);
    // A new human message resets the run.
    expect(countTrailingAiReplies([AI_OUTBOUND, AI_OUTBOUND, HUMAN_INBOUND])).toBe(0);
    expect(countTrailingAiReplies([])).toBe(0);
  });
});

describe('lead creation from a reply', () => {
  it('creates one lead for a genuine human reply', async () => {
    const ctx = makeService();

    const lead = await ctx.svc.ensureLeadForHumanReply({
      message: HUMAN_INBOUND,
      contact: CONTACT,
      campaignId: 'camp-1',
      campaignContactId: 'cc-1',
    });

    expect(lead).toBeTruthy();
    expect(ctx.leads).toHaveLength(1);
    expect(ctx.leads[0]).toMatchObject({
      contact_id: 'c1',
      campaign_id: 'camp-1',
      campaign_contact_id: 'cc-1',
      status: LeadStatus.ENGAGED,
    });
    expect(ctx.leads[0].source).toBeTruthy();
    // A new lead is a funnel event worth counting, exactly once.
    expect(ctx.campaignRepo.increment).toHaveBeenCalledWith({ id: 'camp-1' }, 'stats_leads', 1);
  });

  it('never creates a lead from an AI-generated message', async () => {
    const ctx = makeService();

    const lead = await ctx.svc.ensureLeadForHumanReply({
      message: AI_OUTBOUND,
      contact: CONTACT,
      campaignId: 'camp-1',
    });

    expect(lead).toBeNull();
    expect(ctx.leads).toHaveLength(0);
    expect(ctx.leadRepo.save).not.toHaveBeenCalled();
  });

  it('is idempotent: a second reply reuses the first lead', async () => {
    const ctx = makeService();

    const first = await ctx.svc.ensureLeadForHumanReply({
      message: HUMAN_INBOUND,
      contact: CONTACT,
    });
    const second = await ctx.svc.ensureLeadForHumanReply({
      message: { ...HUMAN_INBOUND, id: 'msg-in-2' },
      contact: CONTACT,
    });

    expect(second!.id).toBe(first!.id);
    expect(ctx.leads).toHaveLength(1);
    expect(ctx.leadRepo.save).toHaveBeenCalledTimes(1);
  });

  it('backfills the campaign link on an existing lead rather than duplicating it', async () => {
    const ctx = makeService({
      leads: [
        {
          id: 'lead-existing',
          contact_id: 'c1',
          status: LeadStatus.ENGAGED,
          created_at: new Date(),
        },
      ],
    });

    await ctx.svc.ensureLeadForHumanReply({
      message: HUMAN_INBOUND,
      contact: CONTACT,
      campaignId: 'camp-9',
      campaignContactId: 'cc-9',
    });

    expect(ctx.leads).toHaveLength(1);
    expect(ctx.leadRepo.update).toHaveBeenCalledWith('lead-existing', {
      campaign_id: 'camp-9',
      campaign_contact_id: 'cc-9',
    });
  });
});

describe('deal classification', () => {
  it('creates a deal for a clear intent to convert and records why', async () => {
    const ctx = makeService({
      leads: [{ id: 'lead-1', contact_id: 'c1', status: LeadStatus.ENGAGED, created_at: new Date() }],
    });

    const deal = await ctx.svc.maybeCreateDealFromAnalysis({
      analysis: analysis(),
      contactId: 'c1',
      messageId: 'msg-in-1',
    });

    expect(deal).toBeTruthy();
    expect(deal!.lead_id).toBe('lead-1');
    expect(deal!.stage).toBe(DealStage.PROPOSAL);
    // Auditable: the reasoning and the triggering message must be on the row.
    expect(deal!.notes).toContain('msg-in-1');
    expect(deal!.notes).toContain('lead score 85');
    // No quote exists yet, so no value may be invented.
    expect(deal!.estimated_value).toBeUndefined();
    // The lead moves forward.
    expect(ctx.leadRepo.update).toHaveBeenCalledWith('lead-1', { status: LeadStatus.QUALIFIED });
  });

  it('is idempotent: never a second open deal for the same lead', async () => {
    const ctx = makeService({
      leads: [
        { id: 'lead-1', contact_id: 'c1', status: LeadStatus.QUALIFIED, created_at: new Date() },
      ],
      deals: [
        { id: 'deal-open', lead_id: 'lead-1', stage: DealStage.NEGOTIATION, created_at: new Date() },
      ],
    });

    const deal = await ctx.svc.maybeCreateDealFromAnalysis({
      analysis: analysis(),
      contactId: 'c1',
    });

    expect(deal!.id).toBe('deal-open');
    expect(ctx.dealRepo.save).not.toHaveBeenCalled();
    expect(ctx.deals).toHaveLength(1);
  });

  it('holds back on anything short of a clear conversion signal', async () => {
    const weak: Partial<AIAnalysisResult>[] = [
      { interest_level: 'medium' },
      { confidence: 0.6 },
      { lead_score: 55 },
      { intent: 'greeting' },
      { opt_out: true },
      // Enthusiasm with nothing concrete agreed is not a deal.
      {
        travel_period: null,
        traveller_count: null,
        product_interest: null,
        requirements: null,
        destination_interest: null,
      },
    ];

    for (const over of weak) {
      const ctx = makeService({
        leads: [
          { id: 'lead-1', contact_id: 'c1', status: LeadStatus.ENGAGED, created_at: new Date() },
        ],
      });
      const deal = await ctx.svc.maybeCreateDealFromAnalysis({
        analysis: analysis(over),
        contactId: 'c1',
      });
      expect(deal, `expected no deal for ${JSON.stringify(over)}`).toBeNull();
      expect(ctx.deals).toHaveLength(0);
    }
  });

  it('explains its verdict either way', () => {
    expect(assessConversionIntent(analysis()).ready).toBe(true);
    const no = assessConversionIntent(analysis({ interest_level: 'low' }));
    expect(no.ready).toBe(false);
    expect(no.reason).toContain('low');
  });
});

describe('AI auto-reply guards', () => {
  const ctxArgs = {
    message: HUMAN_INBOUND,
    contact: CONTACT,
    campaignId: 'camp-1',
    campaignContactId: 'cc-1',
  };

  it('queues the reply on the paced message-send queue', async () => {
    const ctx = makeService();

    const outcome = await ctx.svc.maybeAutoReply({ ...ctxArgs });

    expect(outcome).toEqual({ queued: true, reason: 'queued' });
    expect(ctx.sendQueue.add).toHaveBeenCalledTimes(1);
    const [jobName, payload, opts] = ctx.sendQueue.add.mock.calls[0] as any[];
    // The queue, not OpenWA: that is where humanised pacing and typing simulation live.
    expect(jobName).toBe('send-ai-reply');
    expect(payload).toMatchObject({
      contactId: 'c1',
      body: 'Happy to help — which dates?',
      inboundMessageId: 'msg-in-1',
    });
    // A machine-instant answer is an unmistakable bot tell.
    expect(opts.delay).toBeGreaterThan(0);
  });

  it('stays silent unless the global kill switch is explicitly on', async () => {
    for (const env of [{}, { AI_AUTO_REPLY_ENABLED: 'false' }, { AI_AUTO_REPLY_ENABLED: '' }]) {
      const ctx = makeService({ env: env as any });
      const outcome = await ctx.svc.maybeAutoReply({ ...ctxArgs });
      expect(outcome.reason).toBe('disabled_globally');
      expect(ctx.sendQueue.add).not.toHaveBeenCalled();
      expect(ctx.aiService.generateReply).not.toHaveBeenCalled();
    }
  });

  it('honours the per-campaign kill switch', async () => {
    const ctx = makeService();
    ctx.campaignRepo.findOne = vi.fn(
      async () => ({ id: 'camp-1', ai_auto_reply_enabled: false }) as any,
    );

    const outcome = await ctx.svc.maybeAutoReply({ ...ctxArgs });

    expect(outcome.reason).toBe('disabled_for_campaign');
    expect(ctx.sendQueue.add).not.toHaveBeenCalled();
  });

  it('keeps replying for a campaign that predates the per-campaign switch', async () => {
    // Existing rows have no value for the column, and the global switch is where the
    // decision already lived — a null must not silently turn automation off.
    const ctx = makeService();
    ctx.campaignRepo.findOne = vi.fn(
      async () => ({ id: 'camp-1', ai_auto_reply_enabled: null }) as any,
    );

    const outcome = await ctx.svc.maybeAutoReply({ ...ctxArgs });

    expect(outcome.queued).toBe(true);
  });

  it('never replies to an opted-out or suppressed contact', async () => {
    for (const flag of ['is_opted_out', 'is_suppressed']) {
      const ctx = makeService();
      const outcome = await ctx.svc.maybeAutoReply({
        ...ctxArgs,
        contact: { ...CONTACT, [flag]: true },
      });
      expect(outcome.reason).toBe('opted_out_or_suppressed');
      expect(ctx.sendQueue.add).not.toHaveBeenCalled();
      expect(ctx.aiService.generateReply).not.toHaveBeenCalled();
    }
  });

  it('never replies to one of our own messages', async () => {
    const ctx = makeService();

    const outcome = await ctx.svc.maybeAutoReply({ ...ctxArgs, message: AI_OUTBOUND });

    expect(outcome.reason).toBe('not_human_inbound');
    expect(ctx.sendQueue.add).not.toHaveBeenCalled();
    expect(ctx.aiService.generateReply).not.toHaveBeenCalled();
  });

  it('will not answer twice while the prospect has said nothing new', async () => {
    // Conversation already ends with our own message: there is nothing to answer, and
    // continuing is how a loop starts.
    const ctx = makeService({ history: [HUMAN_INBOUND, AI_OUTBOUND] });

    const outcome = await ctx.svc.maybeAutoReply({ ...ctxArgs });

    expect(outcome.reason).toBe('loop_guard');
    expect(ctx.sendQueue.add).not.toHaveBeenCalled();
  });

  it('sends at most one reply per inbound message, even on a redelivery', async () => {
    const ctx = makeService();

    const first = await ctx.svc.maybeAutoReply({ ...ctxArgs });
    const second = await ctx.svc.maybeAutoReply({ ...ctxArgs });

    expect(first.queued).toBe(true);
    expect(second).toEqual({ queued: false, reason: 'already_answered' });
    expect(ctx.sendQueue.add).toHaveBeenCalledTimes(1);
    // The second attempt must not even pay for a model call.
    expect(ctx.aiService.generateReply).toHaveBeenCalledTimes(1);
  });

  it('still sends exactly once when Redis is unavailable', async () => {
    // With no claim store, the database-backed loop guard is the only thing left. It has
    // to be enough: a blipped Redis must not become a double reply.
    const ctx = makeService();
    ctx.redis.get = vi.fn(async () => null);
    ctx.redis.isDuplicate = vi.fn(async () => false);

    const first = await ctx.svc.maybeAutoReply({ ...ctxArgs });
    expect(first.queued).toBe(true);

    // The reply is now on the conversation, which is what the guard reads.
    const after = makeService({ history: [HUMAN_INBOUND, AI_OUTBOUND] });
    after.redis.get = vi.fn(async () => null);
    after.redis.isDuplicate = vi.fn(async () => false);

    const second = await after.svc.maybeAutoReply({ ...ctxArgs });
    expect(second.reason).toBe('loop_guard');
    expect(after.sendQueue.add).not.toHaveBeenCalled();
  });

  it('hands over instead of replying when the model asks for a human or is unsure', async () => {
    for (const reply of [
      { body: 'One moment', mediaType: null, mediaUrl: null, needsHuman: true, confidence: 0.95 },
      { body: 'Maybe', mediaType: null, mediaUrl: null, needsHuman: false, confidence: 0.2 },
    ]) {
      const ctx = makeService({ reply });
      const outcome = await ctx.svc.maybeAutoReply({ ...ctxArgs });
      expect(outcome.reason).toBe('needs_human');
      expect(ctx.sendQueue.add).not.toHaveBeenCalled();
      expect(ctx.ccRepo.update).toHaveBeenCalledWith('cc-1', { mode: 'human' });
    }
  });

  it('stays silent when no reply could be generated', async () => {
    const ctx = makeService({ reply: null });
    const outcome = await ctx.svc.maybeAutoReply({ ...ctxArgs });
    expect(outcome.reason).toBe('no_reply_generated');
    expect(ctx.sendQueue.add).not.toHaveBeenCalled();
  });

  it('yields to a human who has taken the conversation over', async () => {
    const ctx = makeService();
    ctx.ccRepo.findOne = vi.fn(async () => ({ id: 'cc-1', mode: 'human' }) as any);

    const outcome = await ctx.svc.maybeAutoReply({ ...ctxArgs });

    expect(outcome.reason).toBe('human_takeover');
    expect(ctx.sendQueue.add).not.toHaveBeenCalled();
  });

  it('passes recent conversation history to the model', async () => {
    const earlier = { ...AI_OUTBOUND, id: 'older' };
    const ctx = makeService({ history: [earlier, HUMAN_INBOUND] });

    await ctx.svc.maybeAutoReply({ ...ctxArgs });

    const [body, history] = ctx.aiService.generateReply.mock.calls[0] as any[];
    expect(body).toBe(HUMAN_INBOUND.body);
    // Oldest first, with our own turns labelled as the assistant.
    expect(history).toEqual([
      { role: 'assistant', content: earlier.body },
      { role: 'user', content: HUMAN_INBOUND.body },
    ]);
  });
});

describe('handleInboundHumanMessage', () => {
  let ctx: ReturnType<typeof makeService>;

  beforeEach(() => {
    ctx = makeService();
  });

  it('creates the lead and queues the reply for a human message', async () => {
    const outcome = await ctx.svc.handleInboundHumanMessage({
      message: HUMAN_INBOUND,
      contact: CONTACT,
      campaignId: 'camp-1',
      campaignContactId: 'cc-1',
    });

    expect(ctx.leads).toHaveLength(1);
    expect(outcome.queued).toBe(true);
  });

  it('does neither for a message we sent', async () => {
    const outcome = await ctx.svc.handleInboundHumanMessage({
      message: AI_OUTBOUND,
      contact: CONTACT,
    });

    expect(outcome).toEqual({ queued: false, reason: 'not_human_inbound' });
    expect(ctx.leads).toHaveLength(0);
    expect(ctx.sendQueue.add).not.toHaveBeenCalled();
  });

  it('never fails the webhook when a lead write blows up', async () => {
    ctx.leadRepo.save = vi.fn(async () => {
      throw new Error('leads table is on fire');
    });
    ctx.leadRepo.findOne = vi.fn(async () => null);

    // The reply must still be attempted, and nothing may propagate: a thrown error here
    // makes the gateway redeliver the message and run the whole pipeline again.
    const outcome = await ctx.svc.handleInboundHumanMessage({
      message: HUMAN_INBOUND,
      contact: CONTACT,
    });

    expect(outcome.queued).toBe(true);
  });
});
