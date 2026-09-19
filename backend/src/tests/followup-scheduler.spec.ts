import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FollowupSchedulerService } from '../modules/engine/followup-scheduler.service';

/**
 * The follow-up leg had two independent failures:
 *   1. scheduleFollowups() was never called, so no followup_jobs ever existed
 *      and processFollowups() always found nothing (covered in the processor).
 *   2. One poison row threw out of the cron and dropped the rest of the batch,
 *      re-breaking every 5 minutes forever.
 */

function makeService(dueJobs: any[], ccById: Record<string, any> = {}) {
  const followupRepo = {
    find: vi.fn(async () => dueJobs),
    update: vi.fn(async () => ({})),
    save: vi.fn(async (d: any) => d),
    create: (d: any) => d,
    manager: { getRepository: () => ({}) },
  };
  const ccRepo = {
    findOne: vi.fn(async ({ where }: any) => ccById[where.id] ?? null),
    update: vi.fn(async () => ({})),
    increment: vi.fn(async () => ({})),
  };
  const campaignRepo = { findOne: vi.fn(async () => null) };
  const contactRepo = { findOne: vi.fn(async () => null) };
  const sendQueue = { add: vi.fn(async () => ({ id: 'j' })) };
  const notifications = { create: vi.fn(async () => ({})) };

  const svc = new FollowupSchedulerService(
    followupRepo as any,
    ccRepo as any,
    campaignRepo as any,
    contactRepo as any,
    sendQueue as any,
    notifications as any,
  );

  return { svc, followupRepo, ccRepo, sendQueue };
}

const healthyCc = (id: string) => ({
  id,
  contact_id: `contact-${id}`,
  campaign_id: 'camp-1',
  followup_count: 0,
  mode: 'ai',
  last_reply_at: null,
  contact: { id: `contact-${id}`, name: 'A', is_opted_out: false, is_suppressed: false },
  campaign: { status: 'active', max_followups: 2, openwa_session_id: 'default' },
});

describe('FollowupSchedulerService.processFollowups', () => {
  it('keeps processing the batch when one follow-up throws', async () => {
    const jobs = [
      { id: 'f1', campaign_contact_id: 'cc1' },
      { id: 'f2', campaign_contact_id: 'cc2' },
      { id: 'f3', campaign_contact_id: 'cc3' },
    ];

    const ctx = makeService(jobs, {
      cc1: healthyCc('cc1'),
      // cc2 deliberately absent AND made to throw
      cc3: healthyCc('cc3'),
    });

    ctx.ccRepo.findOne = vi.fn(async ({ where }: any) => {
      if (where.id === 'cc2') throw new Error('db blew up');
      return where.id === 'cc1' ? healthyCc('cc1') : healthyCc('cc3');
    });

    await ctx.svc.processFollowups();

    // f1 and f3 still sent despite f2 exploding.
    expect(ctx.sendQueue.add).toHaveBeenCalledTimes(2);
    // The poison row is marked so it cannot re-break the batch forever.
    expect(ctx.followupRepo.update).toHaveBeenCalledWith('f2', {
      status: 'skipped',
      skip_reason: 'error',
    });
  });

  it('skips a row whose contact/campaign relations are missing', async () => {
    const ctx = makeService([{ id: 'f1', campaign_contact_id: 'cc1' }], {
      cc1: { id: 'cc1', contact: null, campaign: null, followup_count: 0 },
    });

    await ctx.svc.processFollowups();

    expect(ctx.sendQueue.add).not.toHaveBeenCalled();
    expect(ctx.followupRepo.update).toHaveBeenCalledWith('f1', {
      status: 'skipped',
      skip_reason: 'campaign_contact_relations_missing',
    });
  });

  it('does not throw out of the cron when the initial query fails', async () => {
    const ctx = makeService([]);
    ctx.followupRepo.find = vi.fn(async () => {
      throw new Error('connection lost');
    });

    // Must resolve, not reject — an unhandled rejection would crash the cron.
    await expect(ctx.svc.processFollowups()).resolves.toBeUndefined();
  });

  it('sends a follow-up with the full payload the processor requires', async () => {
    const ctx = makeService([{ id: 'f1', campaign_contact_id: 'cc1', template_id: 't1' }], {
      cc1: healthyCc('cc1'),
    });

    await ctx.svc.processFollowups();

    const [, payload] = ctx.sendQueue.add.mock.calls[0];
    expect(payload).toMatchObject({
      campaignContactId: 'cc1',
      campaignId: 'camp-1',
      contactId: 'contact-cc1',
      sessionId: 'default',
      templateId: 't1',
    });
  });

  it('skips when the contact already replied', async () => {
    const cc = { ...healthyCc('cc1'), last_reply_at: new Date() };
    const ctx = makeService([{ id: 'f1', campaign_contact_id: 'cc1' }], { cc1: cc });

    await ctx.svc.processFollowups();

    expect(ctx.sendQueue.add).not.toHaveBeenCalled();
    expect(ctx.followupRepo.update).toHaveBeenCalledWith('f1', {
      status: 'skipped',
      skip_reason: 'contact_replied',
    });
  });

  it('skips and marks unresponsive once max follow-ups are reached', async () => {
    const cc = { ...healthyCc('cc1'), followup_count: 2 };
    const ctx = makeService([{ id: 'f1', campaign_contact_id: 'cc1' }], { cc1: cc });

    await ctx.svc.processFollowups();

    expect(ctx.sendQueue.add).not.toHaveBeenCalled();
    expect(ctx.ccRepo.update).toHaveBeenCalledWith('cc1', { status: 'unresponsive' });
  });
});
