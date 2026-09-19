import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhooksService } from '../modules/webhooks/webhooks.service';

/**
 * Covers the two things that previously made webhook handling lossy:
 *   1. duplicate deliveries (OpenWA retries) being processed twice, and
 *   2. events being handled inline so a failure was swallowed with no retry.
 */

function makeService(over: Partial<Record<string, any>> = {}) {
  const queue = { add: vi.fn(async () => ({ id: 'j1' })) };
  const redis = { isDuplicate: vi.fn(async () => false) };
  const noopRepo = () => ({ findOne: vi.fn(), update: vi.fn(), save: vi.fn(), create: vi.fn(), increment: vi.fn() });

  const svc = new WebhooksService(
    noopRepo() as any, // message
    noopRepo() as any, // contact
    noopRepo() as any, // campaignContact
    noopRepo() as any, // campaign
    { add: vi.fn() } as any, // ai-analysis queue
    queue as any, // webhook-process queue
    { create: vi.fn() } as any, // notifications
    redis as any,
    ...[],
  );

  Object.assign(svc as any, over);
  return { svc, queue, redis };
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
