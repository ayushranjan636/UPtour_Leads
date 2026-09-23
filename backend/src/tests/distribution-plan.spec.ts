/**
 * The distribution plan must describe reality, not an idealised schedule.
 *
 * Two bugs motivated these tests. The plan scheduled `daily_send_limit` messages
 * regardless of audience size, so a campaign with 7 pending contacts advertised 30
 * sends. And the hour-by-hour split was `round(limit * minutesInSlot / windowMinutes)`,
 * an identical count every hour, while the real sender draws every gap at random from
 * the humanised band. A plan that misrepresents the sender is worse than no plan: it is
 * the thing operators reason about when a campaign looks wrong.
 */
import { describe, it, expect, vi } from 'vitest';
import { SendDistributorService } from '../modules/engine/send-distributor.service';

const MIN = 45_000;
const MAX = 180_000;

/** Exercise the planner without booting the Nest container. */
function makeService(): any {
  const svc = Object.create(SendDistributorService.prototype) as any;
  svc.humanDelayMinMs = MIN;
  svc.humanDelayMaxMs = MAX;
  svc.logger = { log: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  return svc;
}

const total = (plan: any) =>
  plan.slots.reduce((sum: number, s: any) => sum + s.count, 0);

describe('distribution plan — bounded by real recipients', () => {
  const svc = makeService();

  it('plans for the pending count, not the daily limit', () => {
    const plan = svc.getDistributionPlan(30, '09:00', '18:00', {
      pendingContacts: 7,
      seed: 'campaign-a',
    });
    expect(plan.pending_contacts).toBe(7);
    expect(plan.planned_messages).toBe(7);
    expect(total(plan)).toBe(7);
  });

  it('never exceeds pending contacts for any limit', () => {
    for (const limit of [1, 10, 30, 100, 500]) {
      for (const pending of [0, 1, 3, 7, 25, 99]) {
        const plan = svc.getDistributionPlan(limit, '09:00', '18:00', {
          pendingContacts: pending,
          seed: `c-${limit}-${pending}`,
        });
        expect(plan.planned_messages).toBeLessThanOrEqual(pending);
        expect(total(plan)).toBeLessThanOrEqual(pending);
      }
    }
  });

  it('is capped by the daily limit when the audience is larger', () => {
    const plan = svc.getDistributionPlan(10, '09:00', '18:00', {
      pendingContacts: 400,
      seed: 'campaign-b',
    });
    expect(plan.planned_messages).toBe(10);
    expect(plan.estimated_days).toBe(40);
    expect(plan.notes.join(' ')).toMatch(/400 contacts are pending/);
  });

  it('plans nothing at all once every contact has been sent to', () => {
    const plan = svc.getDistributionPlan(100, '09:00', '18:00', {
      pendingContacts: 0,
      seed: 'campaign-done',
    });
    expect(plan.planned_messages).toBe(0);
    // An empty slot array is what drives the UI's Empty state; fabricating zero-count
    // bars would show a chart for a campaign with nothing left to send.
    expect(plan.slots).toEqual([]);
    expect(plan.estimated_finish).toBeNull();
    expect(plan.notes.join(' ')).toMatch(/No pending recipients/);
  });

  it('still answers the hypothetical "what would N/day look like" question', () => {
    const plan = svc.getDistributionPlan(100, '09:00', '18:00');
    expect(plan.pending_contacts).toBeNull();
    expect(plan.planned_messages).toBe(100);
    expect(total(plan)).toBe(plan.messages_today);
  });
});

describe('distribution plan — totals are exact', () => {
  const svc = makeService();

  it('sums to the planned count for every audience size that fits', () => {
    for (let pending = 1; pending <= 60; pending++) {
      const plan = svc.getDistributionPlan(100, '09:00', '18:00', {
        pendingContacts: pending,
        seed: `exact-${pending}`,
      });
      // No rounding step exists to drift: each message is placed individually.
      expect(plan.fits_in_window).toBe(true);
      expect(total(plan)).toBe(plan.planned_messages);
    }
  });

  it('accounts for every planned message, scheduled today or spilled', () => {
    const cases: [number, string, string, number][] = [
      [7, '09:00', '09:30', 7],
      [13, '10:15', '17:45', 13],
      [1, '09:00', '18:00', 1],
      [250, '06:00', '23:00', 250],
      [500, '09:00', '10:00', 500],
    ];
    for (const [limit, start, end, pending] of cases) {
      const plan = svc.getDistributionPlan(limit, start, end, {
        pendingContacts: pending,
        seed: `${limit}-${start}-${end}`,
      });
      expect(total(plan)).toBe(plan.messages_today);
      expect(plan.messages_today + plan.spillover_messages).toBe(
        plan.planned_messages,
      );
    }
  });
});

describe('distribution plan — irregular, like the real sender', () => {
  const svc = makeService();

  it('does not produce an identical count every hour', () => {
    const plan = svc.getDistributionPlan(100, '09:00', '18:00', {
      pendingContacts: 100,
      seed: 'irregular',
    });
    const counts = plan.slots.map((s: any) => s.count);
    // The old implementation returned [11,11,11,11,11,11,11,11,12].
    expect(new Set(counts).size).toBeGreaterThan(1);
  });

  it('varies hour to hour for many different campaigns', () => {
    let uniform = 0;
    for (let i = 0; i < 25; i++) {
      const plan = svc.getDistributionPlan(60, '09:00', '18:00', {
        pendingContacts: 60,
        seed: `campaign-${i}`,
      });
      const counts = plan.slots
        .map((s: any) => s.count)
        // Trailing empty hours are legitimate: a campaign can finish early.
        .filter((c: number) => c > 0);
      if (new Set(counts).size <= 1) uniform++;
    }
    expect(uniform).toBe(0);
  });

  it('gives different campaigns different shapes', () => {
    const a = svc.getDistributionPlan(50, '09:00', '18:00', {
      pendingContacts: 50,
      seed: 'campaign-a',
    });
    const b = svc.getDistributionPlan(50, '09:00', '18:00', {
      pendingContacts: 50,
      seed: 'campaign-b',
    });
    expect(a.slots.map((s: any) => s.count)).not.toEqual(
      b.slots.map((s: any) => s.count),
    );
  });

  it('reports the humanised band as the gap when pacing fits inside it', () => {
    // 500/day over 9h paces at ~65s, inside the 45-180s band, so the sender draws
    // straight from the band — exactly what `humanizedGap`'s first regime does.
    const plan = svc.getDistributionPlan(500, '09:00', '18:00', {
      pendingContacts: 500,
      seed: 'gap-band',
    });
    expect(plan.gap_range_seconds.min).toBe(45);
    expect(plan.gap_range_seconds.max).toBe(180);
    expect(plan.gap_between_messages).toContain('drawn per message');
  });

  it('widens the reported gap when pacing needs a longer spread', () => {
    // 100/day over 9h paces at 324s, beyond the band, so the sender draws ±25% of the
    // pacing interval instead — otherwise the campaign would finish hours early.
    const plan = svc.getDistributionPlan(100, '09:00', '18:00', {
      pendingContacts: 100,
      seed: 'gap-wide',
    });
    expect(plan.gap_range_seconds.min).toBe(243);
    expect(plan.gap_range_seconds.max).toBe(405);
    expect(plan.gap_between_messages).toContain('±25%');
  });
});

describe('distribution plan — stable for the same campaign', () => {
  const svc = makeService();

  it('returns the identical plan on repeated calls', () => {
    const call = () =>
      svc.getDistributionPlan(100, '09:00', '18:00', {
        pendingContacts: 42,
        seed: 'stable-campaign',
      });
    // A plan that reshuffles on every page load is not a plan; the operator cannot
    // compare it with what actually happened.
    expect(call()).toEqual(call());
    expect(call()).toEqual(call());
  });

  it('is stable across separate service instances', () => {
    const a = makeService().getDistributionPlan(75, '08:00', '20:00', {
      pendingContacts: 75,
      seed: 'same-campaign-id',
    });
    const b = makeService().getDistributionPlan(75, '08:00', '20:00', {
      pendingContacts: 75,
      seed: 'same-campaign-id',
    });
    expect(a).toEqual(b);
  });
});

describe('distribution plan — window overflow is reported', () => {
  const svc = makeService();

  it('reports spillover rather than squeezing messages in', () => {
    // A 1-hour window cannot pace 500 messages: the sender's own gaps run out of
    // window long before the limit is reached.
    const plan = svc.getDistributionPlan(500, '09:00', '10:00', {
      pendingContacts: 500,
      seed: 'overflow',
    });
    expect(plan.fits_in_window).toBe(false);
    expect(plan.messages_today).toBeLessThan(500);
    expect(plan.messages_today).toBeGreaterThan(0);
    expect(plan.spillover_messages).toBe(500 - plan.messages_today);
    // Nothing is crammed into the final hour to make the arithmetic work.
    expect(total(plan)).toBe(plan.messages_today);
    expect(plan.notes.join(' ')).toMatch(/will go out on following days/);
    // And the operator is told the window itself is the problem, not just the audience.
    expect(plan.notes.join(' ')).toMatch(/can never be reached/);
    expect(plan.estimated_days).toBeGreaterThan(1);
  });

  it('reports a comfortable window as fitting', () => {
    const plan = svc.getDistributionPlan(30, '09:00', '18:00', {
      pendingContacts: 12,
      seed: 'fits',
    });
    expect(plan.fits_in_window).toBe(true);
    expect(plan.spillover_messages).toBe(0);
    expect(plan.notes).toEqual([]);
    expect(plan.estimated_finish).toMatch(/^\d{2}:\d{2}$/);
  });

  it('never schedules a send past the end of the window', () => {
    const plan = svc.getDistributionPlan(100, '09:00', '18:00', {
      pendingContacts: 100,
      seed: 'bounds',
    });
    expect(plan.slots.length).toBe(9);
    expect(plan.slots[0].time).toBe('09:00');
    expect(plan.slots[plan.slots.length - 1].time).toBe('17:00');
  });

  it('places the whole audience inside the window when it comfortably fits', () => {
    // 40 contacts over 9 hours: no reason for any of this to spill.
    const plan = svc.getDistributionPlan(100, '09:00', '18:00', {
      pendingContacts: 40,
      seed: 'roomy',
    });
    expect(plan.fits_in_window).toBe(true);
    expect(plan.messages_today).toBe(40);
    expect(plan.estimated_days).toBe(1);
  });
});
