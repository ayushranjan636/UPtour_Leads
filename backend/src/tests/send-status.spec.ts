/**
 * "Why is my campaign not sending?" and the operator controls around it.
 *
 * An active campaign used to show "0 sent" with no reason whenever the engine skipped
 * it: outside its hours, at a daily limit, out of new-people allowance, or with nobody
 * left to message. These tests pin the plain-words reason for each case, Send now, the
 * per-campaign new-people limit, and AI keys saved from Settings.
 */
import { SendDistributorService } from '../modules/engine/send-distributor.service';
import { AiService } from '../modules/ai/ai.service';

function makeDistributor(campaign: any, counts: any, redisValues: Record<string, any> = {}) {
  const svc = Object.create(SendDistributorService.prototype) as any;
  svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  svc.config = { get: () => undefined };
  svc.campaignRepo = { findOne: vi.fn(async () => campaign) };
  svc.ccRepo = {
    createQueryBuilder: () => {
      const qb: any = {};
      for (const m of ['innerJoin', 'select', 'addSelect', 'where']) qb[m] = () => qb;
      qb.getRawOne = async () => counts;
      return qb;
    },
  };
  svc.redis = {
    get: vi.fn(async (k: string) => {
      const hit = Object.entries(redisValues).find(([p]) => k.includes(p));
      return hit ? hit[1] : null;
    }),
  };
  svc.openwa = { resolveSessionId: vi.fn(async () => 'cloud:1') };
  return svc as SendDistributorService & Record<string, any>;
}

const active = {
  id: 'c1',
  name: 'Thailand',
  status: 'active',
  daily_send_limit: 30,
  daily_new_contact_limit: null,
  send_window_start: '00:00',
  send_window_end: '23:59',
  send_window_timezone: 'Asia/Kolkata',
};
const someWaiting = { pending: '12', pending_new: '12', failed: '0', total: '12' };

describe('Campaign sending status', () => {
  it('explains a campaign outside its sending hours, with when it resumes', async () => {
    const svc = makeDistributor(active, someWaiting);
    vi.spyOn(svc as any, 'isWithinSendWindow').mockReturnValue(false);
    const s = await svc.getSendStatus('c1');
    expect(s.state).toBe('waiting');
    expect(s.headline).toBe('Outside sending hours (00:00 to 23:59)');
    expect(s.detail).toMatch(/resumes at 00:00 Asia\/Kolkata/);
  });

  it('explains a reached daily limit', async () => {
    const svc = makeDistributor(active, someWaiting, { 'daily:sent': 30 });
    const s = await svc.getSendStatus('c1');
    expect(s.headline).toBe('Daily limit reached (30 of 30)');
    expect(s.todaySent).toBe(30);
  });

  it('explains when only first messages are waiting and the new-people allowance is used', async () => {
    const svc = makeDistributor({ ...active, daily_new_contact_limit: 10 }, someWaiting, { 'first-contacts': 10 });
    const s = await svc.getSendStatus('c1');
    expect(s.headline).toBe('New-people limit reached (10 of 10 today)');
    expect(s.newLimit).toBe(10);
  });

  it('reports a WhatsApp connection problem before anything else', async () => {
    const svc = makeDistributor(active, someWaiting);
    svc.openwa.resolveSessionId = vi.fn(async () => {
      throw new Error('WhatsApp Cloud API is not connected.');
    });
    const s = await svc.getSendStatus('c1');
    expect(s).toMatchObject({ state: 'problem', headline: 'WhatsApp is not connected' });
  });

  it('says there is nobody to message instead of looking stuck', async () => {
    const svc = makeDistributor(active, { pending: '0', pending_new: '0', failed: '3', total: '5' });
    const s = await svc.getSendStatus('c1');
    expect(s.headline).toBe('Nobody waiting');
    expect(s.detail).toMatch(/3 failed/);
  });

  it('caps the per-campaign new-people limit at the daily limit', () => {
    const svc = makeDistributor(active, someWaiting) as any;
    expect(svc.dailyNewContactLimit({ ...active, daily_new_contact_limit: 80, daily_send_limit: 40 })).toBe(40);
    expect(svc.dailyNewContactLimit({ ...active, daily_new_contact_limit: null, daily_send_limit: 100 })).toBe(30);
  });
});

describe('Send now', () => {
  it('sends outside the sending hours but keeps the daily limit', async () => {
    const svc = makeDistributor(active, someWaiting, { 'daily:sent': 28 });
    const distribute = vi.spyOn(svc as any, 'distributeCampaign').mockResolvedValue(2);
    vi.spyOn(svc, 'getSendStatus').mockResolvedValue({ state: 'waiting' } as any);
    const res = await svc.sendNow('c1', 5);
    expect(distribute).toHaveBeenCalledWith(active, 5);
    expect(res.queued).toBe(2);
  });

  it('refuses a campaign that is not active', async () => {
    const svc = makeDistributor({ ...active, status: 'draft' }, someWaiting);
    await expect(svc.sendNow('c1', 5)).rejects.toThrow(/Activate the campaign first/);
  });
});

describe('AI keys from Settings', () => {
  it('uses a Gemini key saved in the portal without any env var, and never returns the key', async () => {
    const rows: Record<string, unknown> = {};
    const dataSource = {
      query: vi.fn(async (sql: string, params?: any[]) => {
        if (sql.startsWith('INSERT')) rows[params![0]] = JSON.parse(params![1]);
        if (sql.startsWith('SELECT')) return rows[params![0]] ? [{ value: rows[params![0]] }] : [];
        return [];
      }),
    };
    const ai = new AiService({ get: (_k: string, d?: string) => d } as any, dataSource as any);
    (ai as any).logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    expect(ai.getKeyState().active).toEqual([]);

    const state = await ai.saveKeys({ geminiKey: 'AIzaSECRET1234' });
    expect(state.active).toEqual(['gemini']);
    expect(state.gemini).toMatchObject({ configured: true, source: 'portal', keyHint: '…1234' });
    expect(JSON.stringify(state)).not.toContain('AIzaSECRET');

    // A restart loads it back from the database.
    const again = new AiService({ get: (_k: string, d?: string) => d } as any, dataSource as any);
    await again.onModuleInit();
    expect(again.getKeyState().active).toEqual(['gemini']);

    // "-" removes it.
    expect((await again.saveKeys({ geminiKey: '-' })).active).toEqual([]);
  });
});

describe('Pacing shown to the operator', () => {
  it('reports the typical gap: 100 a day over 09:00-18:00 is about one every 5 minutes', async () => {
    const svc = makeDistributor(
      { ...active, daily_send_limit: 100, send_window_start: '09:00', send_window_end: '18:00' },
      someWaiting,
    );
    (svc as any).humanDelayMinMs = 45_000;
    vi.spyOn(svc as any, 'isWithinSendWindow').mockReturnValue(true);
    const s = await svc.getSendStatus('c1');
    expect(s.gapMinutes).toBe(5);
    expect(s.state).toBe('sending');
  });
});
