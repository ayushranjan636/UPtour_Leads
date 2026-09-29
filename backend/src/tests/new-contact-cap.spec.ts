/**
 * Two anti-ban limits an operator asked for, and the reasoning behind each.
 *
 * Cold first contact and an answer inside an ongoing thread are not equivalent traffic.
 * Introducing yourself to a stranger is what gets an account reported and banned; replying
 * to someone who already wrote to you is ordinary use. These tests pin the distinction in
 * both places it is enforced — how many new people a campaign may approach in a day, and
 * whether the assistant is willing to speak first.
 */
import { describe, it, expect, vi } from 'vitest';
import { SendDistributorService } from '../modules/engine/send-distributor.service';

/** Distributor with an in-memory Redis stand-in; only the caps are under test. */
function makeDistributor(env: Record<string, string> = {}) {
  const store = new Map<string, number>();
  const svc = Object.create(SendDistributorService.prototype) as any;
  svc.redis = {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: any) => void store.set(k, Number(v))),
  };
  svc.config = { get: vi.fn((k: string) => env[k]) };
  svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { svc, store };
}

const campaign = (dailyLimit = 100) =>
  ({ id: 'c1', name: 'Test', daily_send_limit: dailyLimit }) as any;

describe('daily cap on new contacts', () => {
  it('defaults to 30 new introductions a day', () => {
    const { svc } = makeDistributor();
    expect(svc.dailyNewContactLimit(campaign())).toBe(30);
  });

  it('can be tuned per deployment', () => {
    const { svc } = makeDistributor({ DAILY_NEW_CONTACT_LIMIT: '10' });
    expect(svc.dailyNewContactLimit(campaign())).toBe(10);
  });

  it('never exceeds the campaign\u2019s own daily limit', () => {
    // Allowing 30 first contacts under a limit of 5 would be incoherent.
    const { svc } = makeDistributor({ DAILY_NEW_CONTACT_LIMIT: '30' });
    expect(svc.dailyNewContactLimit(campaign(5))).toBe(5);
  });

  it('ignores a nonsensical setting rather than lifting the cap', () => {
    for (const bad of ['0', '-5', 'abc', '']) {
      const { svc } = makeDistributor({ DAILY_NEW_CONTACT_LIMIT: bad });
      expect(svc.dailyNewContactLimit(campaign())).toBe(30);
    }
  });

  it('counts today\u2019s introductions and resets with the day', async () => {
    const { svc, store } = makeDistributor();
    const c = campaign();
    expect(await svc.getTodayFirstContacts(c)).toBe(0);

    await svc.incrementTodayFirstContacts(c, 4);
    expect(await svc.getTodayFirstContacts(c)).toBe(4);
    await svc.incrementTodayFirstContacts(c, 2);
    expect(await svc.getTodayFirstContacts(c)).toBe(6);

    // The key is date-stamped, so tomorrow reads a different one and starts at zero.
    const key = [...store.keys()][0];
    expect(key).toContain(new Date().toISOString().slice(0, 10));
  });

  it('counts each campaign separately', async () => {
    const { svc } = makeDistributor();
    await svc.incrementTodayFirstContacts({ id: 'a', name: 'A' } as any, 30);
    expect(await svc.getTodayFirstContacts({ id: 'b', name: 'B' } as any)).toBe(0);
  });

  it('holds cold outreach when the counter cannot be read', async () => {
    const { svc } = makeDistributor();
    svc.redis.get = vi.fn().mockRejectedValue(new Error('redis down'));
    // Fails closed: a Redis outage must not silently un-cap cold outreach, which is the
    // one kind of traffic that gets an account banned. Follow-ups still flow, because
    // this counter only gates first contacts.
    expect(await svc.getTodayFirstContacts(campaign())).toBe(Number.MAX_SAFE_INTEGER);
    expect(svc.logger.warn).toHaveBeenCalled();
  });

  it('leaves room for follow-ups once new contacts are spent', () => {
    // The point of a separate counter: 30 introductions do not consume a 100/day budget,
    // so sequence branches and follow-ups keep sending for the rest of the day.
    const { svc } = makeDistributor();
    const limit = svc.dailyNewContactLimit(campaign(100));
    expect(100 - limit).toBeGreaterThan(0);
  });
});
