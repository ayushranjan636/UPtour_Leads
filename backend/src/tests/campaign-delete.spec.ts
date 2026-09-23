/**
 * Deleting a campaign must never cost the operator anything they earned.
 *
 * Eight foreign keys point at `campaigns`/`campaign_contacts` and every one of them is
 * NO ACTION, so the delete is a hand-written sequence rather than a cascade. That makes
 * the preserve-vs-delete split a decision encoded in SQL, and these tests pin it:
 * leads/deals, sent messages and AI analyses survive with their campaign link nulled,
 * while enrolments, templates and planned follow-ups go. They also pin the three ways
 * this could silently go wrong — an active campaign being deleted mid-send, a partial
 * delete escaping the transaction, and the 60s findById cache resurrecting the row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CampaignsService } from '../modules/campaigns/campaigns.service';
import { MessageSendProcessor } from '../modules/engine/message-send.processor';
import { CampaignStatus } from '../entities/campaign.entity';

/** One row per id, so `.length` on a RETURNING result is the affected-row count. */
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));

interface FakeDb {
  campaign_contacts: number;
  message_templates: number;
  followup_jobs: number;
  leads: number;
  messages: number;
  ai_analyses: number;
  collection_jobs: number;
  campaigns: number;
}

/**
 * A CampaignsService wired to an in-memory stand-in for Postgres.
 *
 * `tx.query` is matched on the statement so each SELECT/UPDATE/DELETE reports a
 * realistic affected-row count and mutates `db`, which lets a test assert both the
 * report and the resulting state. `failOn` makes one statement throw so the
 * transaction-rollback contract can be exercised.
 */
function makeService(
  opts: {
    status?: CampaignStatus;
    counts?: Partial<FakeDb>;
    failOn?: RegExp;
  } = {},
) {
  const db: FakeDb = {
    campaign_contacts: 3,
    message_templates: 2,
    followup_jobs: 4,
    leads: 5,
    messages: 9,
    ai_analyses: 6,
    collection_jobs: 1,
    campaigns: 1,
    ...opts.counts,
  };
  /** State as it was before the transaction, for the rollback assertion. */
  const initial = { ...db };
  const statements: string[] = [];

  const query = vi.fn(async (sql: string) => {
    statements.push(sql.replace(/\s+/g, ' ').trim());

    if (opts.failOn?.test(sql)) throw new Error('deadlock detected');

    if (/SELECT id FROM campaign_contacts/.test(sql)) return rows(db.campaign_contacts);
    if (/SELECT id FROM message_templates/.test(sql)) return rows(db.message_templates);

    if (/UPDATE leads/.test(sql)) return rows(db.leads);
    if (/UPDATE messages SET campaign_contact_id/.test(sql)) return rows(db.messages);
    if (/UPDATE ai_analyses/.test(sql)) return rows(db.ai_analyses);
    if (/UPDATE collection_jobs/.test(sql)) return rows(db.collection_jobs);
    if (/UPDATE messages SET template_id/.test(sql)) return rows(db.messages);
    if (/UPDATE followup_jobs SET template_id/.test(sql)) return [];

    if (/DELETE FROM followup_jobs/.test(sql)) {
      const n = db.followup_jobs;
      db.followup_jobs = 0;
      return rows(n);
    }
    if (/DELETE FROM campaign_contacts/.test(sql)) {
      const n = db.campaign_contacts;
      db.campaign_contacts = 0;
      return rows(n);
    }
    if (/DELETE FROM message_templates/.test(sql)) {
      const n = db.message_templates;
      db.message_templates = 0;
      return rows(n);
    }
    if (/DELETE FROM campaigns/.test(sql)) {
      db.campaigns = 0;
      return [];
    }
    return [];
  });

  const campaign = {
    id: 'camp-1',
    name: 'Japan Golden Route 2026',
    status: opts.status ?? CampaignStatus.PAUSED,
  };

  /** Counts findOne calls so a cached read can be told from a fresh one. */
  const findOne = vi.fn(async () => campaign);

  const repo = {
    findOne,
    manager: {
      transaction: async (work: (tx: any) => Promise<void>) => {
        try {
          await work({ query });
        } catch (err) {
          // Mirrors Postgres: nothing the failed transaction did is visible.
          Object.assign(db, initial);
          throw err;
        }
      },
    },
  };

  const svc = new CampaignsService(
    repo as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  (svc as any).logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

  return { svc, db, statements, query, findOne, campaign };
}

describe('CampaignsService.deleteCampaign', () => {
  let ctx: ReturnType<typeof makeService>;

  beforeEach(() => {
    ctx = makeService();
  });

  it('refuses an active campaign and tells the caller to pause it first', async () => {
    const active = makeService({ status: CampaignStatus.ACTIVE });

    await expect(active.svc.deleteCampaign('camp-1')).rejects.toThrow(/pause it first/i);
    // Nothing may be touched: the whole point is that queued sends stay intact.
    expect(active.query).not.toHaveBeenCalled();
    expect(active.db.campaigns).toBe(1);
    expect(active.db.campaign_contacts).toBe(3);
  });

  it('allows the non-sending statuses, so finished campaigns are not undeletable', async () => {
    for (const status of [
      CampaignStatus.DRAFT,
      CampaignStatus.PAUSED,
      CampaignStatus.COMPLETED,
      CampaignStatus.CANCELLED,
    ]) {
      const c = makeService({ status });
      await expect(c.svc.deleteCampaign('camp-1')).resolves.toMatchObject({ deleted: true });
      expect(c.db.campaigns).toBe(0);
    }
  });

  it('preserves leads by nulling both campaign links rather than deleting them', async () => {
    const report = await ctx.svc.deleteCampaign('camp-1');

    expect(report.preserved.leads).toBe(5);
    expect(ctx.statements.some((s) => /DELETE FROM leads/.test(s))).toBe(false);
    expect(ctx.statements.some((s) => /DELETE FROM deals/.test(s))).toBe(false);
    // Both columns, so a lead linked only by enrolment is unlinked too.
    expect(
      ctx.statements.some(
        (s) =>
          /UPDATE leads SET campaign_id = NULL, campaign_contact_id = NULL/.test(s) &&
          /campaign_contact_id = ANY/.test(s),
      ),
    ).toBe(true);
  });

  it('preserves the message history with its contact link intact', async () => {
    const report = await ctx.svc.deleteCampaign('camp-1');

    expect(report.preserved.messages).toBe(9);
    expect(ctx.statements.some((s) => /DELETE FROM messages/.test(s))).toBe(false);
    // Only the campaign attribution is dropped; contact_id is NOT NULL and untouched,
    // so the Conversations thread still renders.
    const update = ctx.statements.find((s) => /UPDATE messages SET campaign_contact_id/.test(s));
    expect(update).toBeDefined();
    expect(update).not.toMatch(/contact_id = NULL(?!.*campaign)/);
  });

  it('preserves ai_analyses and detaches collection jobs without deleting them', async () => {
    const report = await ctx.svc.deleteCampaign('camp-1');

    expect(report.preserved.ai_analyses).toBe(6);
    expect(report.preserved.collection_jobs).toBe(1);
    expect(ctx.statements.some((s) => /DELETE FROM ai_analyses/.test(s))).toBe(false);
    expect(ctx.statements.some((s) => /DELETE FROM collection_jobs/.test(s))).toBe(false);
  });

  it('deletes the campaign-owned scaffolding and reports the counts', async () => {
    const report = await ctx.svc.deleteCampaign('camp-1');

    expect(report.removed).toEqual({
      campaign_contacts: 3,
      message_templates: 2,
      followup_jobs: 4,
    });
    expect(ctx.db.campaign_contacts).toBe(0);
    expect(ctx.db.message_templates).toBe(0);
    expect(ctx.db.followup_jobs).toBe(0);
    expect(ctx.db.campaigns).toBe(0);
  });

  it('orders the statements so no foreign key can be left dangling', async () => {
    await ctx.svc.deleteCampaign('camp-1');

    const at = (re: RegExp) => ctx.statements.findIndex((s) => re.test(s));

    // Dependents of campaign_contacts resolve before the enrolments go.
    for (const dependent of [
      /UPDATE leads/,
      /UPDATE messages SET campaign_contact_id/,
      /UPDATE ai_analyses/,
      /DELETE FROM followup_jobs/,
    ]) {
      expect(at(dependent)).toBeLessThan(at(/DELETE FROM campaign_contacts/));
    }

    // messages.template_id is a reference to message_templates, so it must be cleared
    // before the templates are deleted.
    expect(at(/UPDATE messages SET template_id/)).toBeLessThan(at(/DELETE FROM message_templates/));

    // The campaign row is last.
    expect(at(/DELETE FROM campaigns/)).toBe(ctx.statements.length - 1);
  });

  it('runs entirely in one transaction, so a mid-way failure leaves nothing deleted', async () => {
    // Fails after the enrolments are already gone — exactly the half-deleted state a
    // non-transactional implementation would leave behind.
    const failing = makeService({ failOn: /DELETE FROM message_templates/ });

    await expect(failing.svc.deleteCampaign('camp-1')).rejects.toThrow(/deadlock/);

    expect(failing.db.campaigns).toBe(1);
    expect(failing.db.campaign_contacts).toBe(3);
    expect(failing.db.message_templates).toBe(2);
    expect(failing.db.followup_jobs).toBe(4);
  });

  it('invalidates the findById cache, so a deleted campaign does not appear to exist', async () => {
    // Warm the 60s BaseService cache the way a detail-page read would.
    await ctx.svc.findById('camp-1');
    expect(ctx.findOne).toHaveBeenCalledTimes(1);
    await ctx.svc.findById('camp-1');
    expect(ctx.findOne).toHaveBeenCalledTimes(1); // served from cache

    await ctx.svc.deleteCampaign('camp-1');

    // The next read must hit the database (where the row is gone) instead of replaying
    // the cached copy for the rest of the TTL.
    ctx.findOne.mockResolvedValue(null as any);
    await expect(ctx.svc.findById('camp-1')).rejects.toThrow(/not found/i);
  });

  it('404s before opening a transaction when the campaign does not exist', async () => {
    ctx.findOne.mockResolvedValue(null as any);

    await expect(ctx.svc.deleteCampaign('nope')).rejects.toThrow(/not found/i);
    expect(ctx.query).not.toHaveBeenCalled();
  });
});

/**
 * Deleting a campaign cannot drain BullMQ, so jobs enqueued for its contacts still run
 * afterwards — some of them hours later, because the humanised pacing enqueues sends
 * with long delays. They must retire quietly instead of throwing: a throw burns both
 * configured attempts and tries to write a `failed` message row whose
 * campaign_contact_id no longer satisfies its foreign key.
 */
describe('message-send jobs left over from a deleted campaign', () => {
  function makeProcessor(cc: any) {
    const ccRepo = { findOne: vi.fn(async () => cc), update: vi.fn(async () => ({})) };
    const messageRepo = { create: (d: any) => d, save: vi.fn(async (d: any) => d) };
    const campaignRepo = { increment: vi.fn(async () => ({})) };
    const templateRepo = { find: vi.fn(async () => []) };
    const openwa = { sendText: vi.fn(async () => ({ messageId: 'x' })), resolveSessionId: vi.fn(async () => 's' ) };

    const proc = new MessageSendProcessor(
      ccRepo as any,
      {} as any,
      campaignRepo as any,
      messageRepo as any,
      templateRepo as any,
      openwa as any,
      { scheduleFollowups: vi.fn(async () => ({})) } as any,
    );
    (proc as any).logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

    return { proc, ccRepo, messageRepo, openwa, campaignRepo };
  }

  const job = {
    name: 'send-message',
    data: {
      campaignContactId: 'cc-1',
      campaignId: 'camp-1',
      contactId: 'contact-1',
      sessionId: 'default',
    },
  } as any;

  it('skips cleanly when the enrolment is gone, without sending or retrying', async () => {
    const { proc, messageRepo, openwa } = makeProcessor(null);

    await expect(proc.process(job)).resolves.toEqual({
      skipped: true,
      reason: 'campaign_deleted',
    });
    // No throw means BullMQ retires the job; no FK-violating audit row is attempted.
    expect(messageRepo.save).not.toHaveBeenCalled();
    expect(openwa.sendText).not.toHaveBeenCalled();
  });

  it('skips when the enrolment survived but its campaign relation is missing', async () => {
    const { proc, openwa } = makeProcessor({
      id: 'cc-1',
      contact: { id: 'contact-1', is_opted_out: false, is_suppressed: false },
      campaign: null,
    });

    await expect(proc.process(job)).resolves.toEqual({
      skipped: true,
      reason: 'campaign_deleted',
    });
    expect(openwa.sendText).not.toHaveBeenCalled();
  });
});

/**
 * The deletion report has to be believable.
 *
 * Its whole purpose is to prove nothing valuable was lost, so a count that is quietly
 * always the same number is worse than showing none at all. TypeORM resolves `query` to
 * `[rows, affectedCount]` for INSERT/UPDATE/DELETE, and reading `.length` off that
 * wrapper reported "2" for every category — leads, messages, enrolments — regardless of
 * what the statements actually touched.
 */
describe('deletion report row counts', () => {
  const rowCount = (r: unknown) =>
    (CampaignsService as any).rowCount(r) as number;

  it('reads the affected count from a [rows, affected] result', () => {
    expect(rowCount([[], 0])).toBe(0);
    expect(rowCount([[{ id: 'a' }], 1])).toBe(1);
    expect(rowCount([[{ id: 'a' }, { id: 'b' }], 7])).toBe(7);
  });

  it('counts a plain RETURNING row array directly', () => {
    expect(rowCount([])).toBe(0);
    expect(rowCount([{ id: 'a' }])).toBe(1);
    expect(rowCount([{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toBe(3);
  });

  it('never invents a count from an unexpected shape', () => {
    for (const junk of [undefined, null, 0, 'x', {}]) {
      expect(rowCount(junk)).toBe(0);
    }
  });

  it('does not mistake a two-row result for the wrapper form', () => {
    // The ambiguous case: two returned rows is a real possibility, and must not be
    // read as "rows plus affected".
    expect(rowCount([{ id: 'a' }, { id: 'b' }])).toBe(2);
  });
});
