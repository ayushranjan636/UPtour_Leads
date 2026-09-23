import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhooksService } from '../modules/webhooks/webhooks.service';

/**
 * Covers the two things that previously made webhook handling lossy:
 *   1. duplicate deliveries (OpenWA retries) being processed twice, and
 *   2. events being handled inline so a failure was swallowed with no retry.
 *
 * Plus the funnel-integrity rule on the inbound path: only a message a person actually
 * sent may count as a reply. An echo of our own outbound traffic treated as an inbound
 * reply would inflate stats_replied, create a phantom lead, and be auto-answered — the
 * first step of an AI-to-AI loop.
 */

function makeService(over: Partial<Record<string, any>> = {}) {
  const queue = { add: vi.fn(async () => ({ id: 'j1' })) };
  const redis = { isDuplicate: vi.fn(async () => false) };
  const noopRepo = () => ({ findOne: vi.fn(), update: vi.fn(), save: vi.fn(), create: vi.fn(), increment: vi.fn() });
  const inboundAi = { handleInboundHumanMessage: vi.fn(async () => ({ queued: false, reason: 'disabled_globally' })) };

  const svc = new WebhooksService(
    noopRepo() as any, // message
    noopRepo() as any, // contact
    noopRepo() as any, // campaignContact
    noopRepo() as any, // campaign
    { add: vi.fn() } as any, // ai-analysis queue
    queue as any, // webhook-process queue
    { create: vi.fn() } as any, // notifications
    redis as any,
    inboundAi as any,
    ...[],
  );

  Object.assign(svc as any, over);
  return { svc, queue, redis, inboundAi };
}

describe('WebhooksService.processEvent', () => {
  let ctx: ReturnType<typeof makeService>;

  beforeEach(() => {
    ctx = makeService();
  });

  it('queues a known event onto webhook-process instead of handling it inline', async () => {
    const inline = vi.spyOn(ctx.svc, 'handleEventInline');

    await ctx.svc.processEvent({
      event: 'message.ack',
      deliveryId: 'd1',
      data: { messageId: 'm1', ack: 2 },
    });

    expect(ctx.queue.add).toHaveBeenCalledTimes(1);
    const [jobName, payload, opts] = ctx.queue.add.mock.calls[0];
    expect(jobName).toBe('process-webhook');
    expect(payload).toEqual({ event: 'message.ack', data: { messageId: 'm1', ack: 2 } });
    // Bounded retries with backoff, and failures retained for inspection.
    expect(opts.attempts).toBe(3);
    expect(opts.removeOnFail).toBe(false);
    expect(inline).not.toHaveBeenCalled();
  });

  it('skips a replayed delivery without queuing anything', async () => {
    ctx.redis.isDuplicate = vi.fn(async () => true);

    await ctx.svc.processEvent({
      event: 'message.received',
      deliveryId: 'dup-1',
      data: { messageId: 'm9' },
    });

    expect(ctx.queue.add).not.toHaveBeenCalled();
  });

  it('dedupes on idempotencyKey when present, else deliveryId, else messageId', async () => {
    await ctx.svc.processEvent({
      event: 'message.ack',
      idempotencyKey: 'idem-1',
      deliveryId: 'del-1',
      data: { messageId: 'm1' },
    });
    expect(ctx.redis.isDuplicate.mock.calls[0][0]).toContain('idem-1');

    const b = makeService();
    await b.svc.processEvent({
      event: 'message.ack',
      deliveryId: 'del-2',
      data: { messageId: 'm2' },
    });
    expect(b.redis.isDuplicate.mock.calls[0][0]).toContain('del-2');

    const c = makeService();
    await c.svc.processEvent({
      event: 'message.ack',
      data: { messageId: 'm3' },
    });
    expect(c.redis.isDuplicate.mock.calls[0][0]).toContain('m3');
  });

  it('drops an unknown event before touching the queue', async () => {
    await ctx.svc.processEvent({
      event: 'not.a.real.event',
      deliveryId: 'x',
      data: {},
    });

    expect(ctx.queue.add).not.toHaveBeenCalled();
  });

  it('falls back to inline handling when the queue is unavailable', async () => {
    ctx.queue.add = vi.fn(async () => {
      throw new Error('redis down');
    });
    const inline = vi
      .spyOn(ctx.svc, 'handleEventInline')
      .mockResolvedValue(undefined);

    await ctx.svc.processEvent({
      event: 'session.status',
      deliveryId: 'd2',
      data: { sessionId: 'default', status: 'connected' },
    });

    // The event must not be lost just because Redis blipped.
    expect(inline).toHaveBeenCalledWith('session.status', {
      sessionId: 'default',
      status: 'connected',
    });
  });
});

/** An inbound handler wired with just enough repository behaviour to trace the path. */
function makeInboundService(opts: { campaignContact?: any } = {}) {
  const contact = {
    id: 'c1',
    name: 'Ravi',
    whatsapp_number: '+911234567890',
    whatsapp_chat_id: '911234567890@c.us',
    is_opted_out: false,
    is_suppressed: false,
  };

  const saved: any[] = [];
  const messageRepo = {
    create: vi.fn((d: any) => ({ id: 'msg-1', ...d })),
    save: vi.fn(async (d: any) => {
      saved.push(d);
      return d;
    }),
    findOne: vi.fn(),
  };
  const contactRepo = { findOne: vi.fn(async () => contact), save: vi.fn(async (d: any) => d), create: vi.fn() };
  const ccRepo = {
    findOne: vi.fn(async () => opts.campaignContact ?? null),
    save: vi.fn(async (d: any) => d),
  };
  const campaignRepo = { increment: vi.fn(async () => undefined), findOne: vi.fn() };
  const analysisQueue = { add: vi.fn(async () => ({ id: 'a1' })) };
  const inboundAi = {
    handleInboundHumanMessage: vi.fn(async () => ({ queued: true, reason: 'queued' })),
  };
  const notifications = { create: vi.fn(async () => undefined) };

  const svc = new WebhooksService(
    messageRepo as any,
    contactRepo as any,
    ccRepo as any,
    campaignRepo as any,
    analysisQueue as any,
    { add: vi.fn() } as any,
    notifications as any,
    { isDuplicate: vi.fn(async () => false) } as any,
    inboundAi as any,
  );

  return { svc, messageRepo, contactRepo, ccRepo, campaignRepo, analysisQueue, inboundAi, notifications, saved };
}

describe('WebhooksService.handleMessageReceived', () => {
  const inbound = {
    from: '911234567890@c.us',
    body: 'Do you have Golden Triangle itineraries?',
    id: 'wa-1',
  };

  it('stores the reply, marks the campaign contact replied and hands off for lead/reply', async () => {
    const ctx = makeInboundService({
      campaignContact: { id: 'cc-1', campaign_id: 'camp-1', contact_id: 'c1', status: 'sent' },
    });

    await ctx.svc.handleMessageReceived(inbound);

    expect(ctx.campaignRepo.increment).toHaveBeenCalledWith({ id: 'camp-1' }, 'stats_replied', 1);
    expect(ctx.inboundAi.handleInboundHumanMessage).toHaveBeenCalledTimes(1);
    const arg = ctx.inboundAi.handleInboundHumanMessage.mock.calls[0][0] as any;
    expect(arg).toMatchObject({ campaignId: 'camp-1', campaignContactId: 'cc-1' });
    // Existing behaviour must survive: analysis is still queued and the bell still rings.
    expect(ctx.analysisQueue.add).toHaveBeenCalledTimes(1);
    expect(ctx.notifications.create).toHaveBeenCalledTimes(1);
  });

  it('drops an echo of our own message before anything is stored or counted', async () => {
    const ctx = makeInboundService({
      campaignContact: { id: 'cc-1', campaign_id: 'camp-1', contact_id: 'c1', status: 'sent' },
    });

    await ctx.svc.handleMessageReceived({ ...inbound, fromMe: true });

    // No message row, no reply stat, no lead, no auto-reply: an echo is not a reply.
    expect(ctx.messageRepo.save).not.toHaveBeenCalled();
    expect(ctx.campaignRepo.increment).not.toHaveBeenCalled();
    expect(ctx.inboundAi.handleInboundHumanMessage).not.toHaveBeenCalled();
    expect(ctx.analysisQueue.add).not.toHaveBeenCalled();
  });

  it('still drops group traffic', async () => {
    const ctx = makeInboundService();

    await ctx.svc.handleMessageReceived({ ...inbound, from: '9112345-67890@g.us' });

    expect(ctx.messageRepo.save).not.toHaveBeenCalled();
    expect(ctx.inboundAi.handleInboundHumanMessage).not.toHaveBeenCalled();
  });

  it('records an inbound message that belongs to no campaign and still seeks a lead', async () => {
    const ctx = makeInboundService();

    await ctx.svc.handleMessageReceived(inbound);

    // Someone who was never enrolled still deserves a lead and an answer.
    expect(ctx.campaignRepo.increment).not.toHaveBeenCalled();
    const arg = ctx.inboundAi.handleInboundHumanMessage.mock.calls[0][0] as any;
    expect(arg.campaignId).toBeNull();
    expect(arg.campaignContactId).toBeNull();
  });
});
