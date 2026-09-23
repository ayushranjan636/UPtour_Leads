/**
 * Send pacing must not be periodic.
 *
 * A live campaign sent at 59s, 61s, 60s, 61s, 59s, 60s — effectively a metronome. The
 * cause: 30/day over a 9h window rounds to a batch of 1 per tick, and the humanised gap
 * was only applied *between* messages of a batch, so a single-message batch enqueued with
 * zero delay and the cron period became the pacing. Constant spacing is the clearest
 * machine signal a WhatsApp sender can emit, so this is an anti-ban regression, and
 * these tests pin the properties that prevent it.
 */
import { describe, it, expect, vi } from 'vitest';
import { SendDistributorService } from '../modules/engine/send-distributor.service';

const MIN = 45_000;
const MAX = 180_000;

/** Expose the private pacing helpers without booting the Nest container. */
function makeService(): any {
  const svc = Object.create(SendDistributorService.prototype) as any;
  svc.humanDelayMinMs = MIN;
  svc.humanDelayMaxMs = MAX;
  svc.logger = { log: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  return svc;
}

describe('humanised send pacing', () => {
  const svc = makeService();
  // Pacing interval inside the humanised band, as for a small campaign.
  const gaps = Array.from({ length: 400 }, () => svc.humanizedGap(MIN));

  it('stays within the configured band', () => {
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(MIN);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(MAX);
  });

  it('is not periodic: no value dominates', () => {
    // The observed bug produced ~60s every time. Any single value accounting for a large
    // share of draws means the sequence has a period a fingerprinter could lock onto.
    const counts = new Map<number, number>();
    for (const g of gaps) {
      const bucket = Math.round(g / 1000);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    const dominant = Math.max(...counts.values()) / gaps.length;
    expect(dominant).toBeLessThan(0.1);
  });

  it('spreads across the band rather than clustering', () => {
    const spread = Math.max(...gaps) - Math.min(...gaps);
    // Half the band is a generous floor; a metronome would score ~0.
    expect(spread).toBeGreaterThan((MAX - MIN) / 2);
  });

  it('consecutive gaps differ, so spacing has no constant period', () => {
    const identical = gaps.filter((g, i) => i > 0 && g === gaps[i - 1]).length;
    expect(identical).toBe(0);
  });

  it('widens beyond the band when pacing needs a longer spread', () => {
    // A small audience across a long window: the campaign should fill its window
    // instead of finishing hours early, so gaps track the pacing interval (±25%).
    const wide = Array.from({ length: 200 }, () => svc.humanizedGap(600_000));
    expect(Math.min(...wide)).toBeGreaterThan(MAX);
    expect(Math.min(...wide)).toBeGreaterThanOrEqual(450_000);
    expect(Math.max(...wide)).toBeLessThanOrEqual(750_000);
  });
});

describe('cross-tick send gate', () => {
  it('holds sends until the gap has elapsed, then releases', async () => {
    const svc = makeService();
    const store = new Map<string, number>();
    svc.redis = {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: number) => void store.set(k, v)),
    };
    const campaign = { id: 'c1', name: 'Test' } as any;

    // A fresh campaign must not wait out a delay it never earned.
    expect(await svc.getNextSendGate(campaign)).toBeNull();

    await svc.armNextSendGate(campaign, 90_000);
    const gate = await svc.getNextSendGate(campaign);
    expect(gate).toBeGreaterThan(Date.now());

    // ...and the gate is what a later tick compares against, rather than sending
    // again on the very next cron minute.
    expect(gate! - Date.now()).toBeGreaterThan(60_000);
  });

  it('sends rather than stalling when Redis is unavailable', async () => {
    const svc = makeService();
    svc.redis = {
      get: vi.fn().mockRejectedValue(new Error('redis down')),
      set: vi.fn().mockRejectedValue(new Error('redis down')),
    };
    const campaign = { id: 'c1', name: 'Test' } as any;
    // Degrading to the old cron pacing is bad; wedging a campaign forever is worse.
    await expect(svc.getNextSendGate(campaign)).resolves.toBeNull();
    await expect(svc.armNextSendGate(campaign, 90_000)).resolves.toBeUndefined();
  });
});
