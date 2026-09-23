/**
 * The runtime auto-reply switch.
 *
 * This is the most consequential setting in the product: when it is on, the assistant
 * sends WhatsApp messages to real prospects with nobody reviewing them. It is also the
 * one an operator may need to flip under pressure, so it is overridable at runtime rather
 * than only through `.env` plus a redeploy.
 *
 * Two failure modes justify these tests. A switch that reads as ON when the operator set
 * it OFF keeps messaging people who should have been left alone. A switch that silently
 * reverts — an expiring key, a Redis blip read as "off" — is just as bad in the other
 * direction, because it makes the control untrustworthy.
 */
import { describe, it, expect, vi } from 'vitest';
import { InboundAiService } from '../modules/ai/inbound-ai.service';

const KEY = 'settings:ai-auto-reply-enabled';

/** A service wired to an in-memory Redis stand-in and a fixed env default. */
function makeService(envValue: string | undefined, stored?: string | null) {
  const store = new Map<string, string>();
  if (stored !== undefined && stored !== null) store.set(KEY, stored);

  const redis = {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: any) => void store.set(k, String(v))),
  };
  const config = {
    get: vi.fn((k: string) => (k === 'AI_AUTO_REPLY_ENABLED' ? envValue : undefined)),
  };

  const svc = Object.create(InboundAiService.prototype) as any;
  svc.redis = redis;
  svc.config = config;
  svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { svc, redis, store };
}

describe('auto-reply switch: effective value', () => {
  it('is off when nothing is configured at all', async () => {
    // Never fall into autonomously messaging prospects by default.
    const { svc } = makeService(undefined);
    await expect(svc.isAutoReplyEnabledGlobally()).resolves.toBe(false);
  });

  it('follows the deploy-time default when no override is set', async () => {
    for (const [env, expected] of [
      ['true', true],
      ['false', false],
      ['TRUE', true],
      ['yes', false],
      ['1', false],
      ['', false],
    ] as const) {
      const { svc } = makeService(env);
      await expect(svc.isAutoReplyEnabledGlobally()).resolves.toBe(expected);
    }
  });

  it('lets a runtime override win over the deploy-time default, both ways', async () => {
    const on = makeService('false', 'true');
    await expect(on.svc.isAutoReplyEnabledGlobally()).resolves.toBe(true);

    // The direction that matters most: env says on, the operator said off.
    const off = makeService('true', 'false');
    await expect(off.svc.isAutoReplyEnabledGlobally()).resolves.toBe(false);
  });

  it('ignores a junk override rather than guessing', async () => {
    for (const junk of ['maybe', '1', 'null', '']) {
      const { svc } = makeService('true', junk);
      // Falls back to the env default instead of inventing a meaning.
      await expect(svc.isAutoReplyEnabledGlobally()).resolves.toBe(true);
    }
  });

  it('keeps the deploy-time default when Redis is unreachable', async () => {
    const { svc } = makeService('false');
    svc.redis.get = vi.fn().mockRejectedValue(new Error('redis down'));
    // An outage must not flip the assistant to the opposite of what was configured.
    await expect(svc.isAutoReplyEnabledGlobally()).resolves.toBe(false);
  });
});

describe('auto-reply switch: writing', () => {
  it('turns the assistant on and off, and the change is what a later read sees', async () => {
    const { svc } = makeService('false');

    await expect(svc.setAutoReplyEnabled(true)).resolves.toEqual({ enabled: true });
    await expect(svc.isAutoReplyEnabledGlobally()).resolves.toBe(true);

    await expect(svc.setAutoReplyEnabled(false)).resolves.toEqual({ enabled: false });
    await expect(svc.isAutoReplyEnabledGlobally()).resolves.toBe(false);
  });

  it('persists the choice without an expiry', async () => {
    const { svc, redis } = makeService('true');
    await svc.setAutoReplyEnabled(false);
    // A deliberate "off" that quietly expires back to on after some interval would be a
    // silent re-enable, so the TTL argument must mean "keep indefinitely".
    const ttl = redis.set.mock.calls[0]?.[2];
    expect(ttl === 0 || ttl === undefined || ttl < 0).toBe(true);
  });

  it('records the switch being thrown, so the change is auditable', async () => {
    const { svc } = makeService('false');
    await svc.setAutoReplyEnabled(true);
    expect(svc.logger.warn).toHaveBeenCalled();
  });
});

describe('auto-reply switch: reporting to the UI', () => {
  it('reports the env default as the source when no override exists', async () => {
    const { svc } = makeService('true');
    await expect(svc.getAutoReplySetting()).resolves.toEqual({
      enabled: true,
      source: 'env',
      envDefault: true,
    });
  });

  it('reports an override and still exposes the underlying default', async () => {
    const { svc } = makeService('true', 'false');
    // The UI shows which value is in force *and* what it would revert to.
    await expect(svc.getAutoReplySetting()).resolves.toEqual({
      enabled: false,
      source: 'override',
      envDefault: true,
    });
  });

  it('agrees with the value the sender actually acts on', async () => {
    // The panel and the send path must never disagree: a UI reading "off" while the
    // assistant keeps replying is the worst outcome of a split-brain setting.
    for (const [env, stored] of [
      ['true', null],
      ['false', null],
      ['true', 'false'],
      ['false', 'true'],
    ] as const) {
      const { svc } = makeService(env, stored);
      const reported = await svc.getAutoReplySetting();
      const acted = await svc.isAutoReplyEnabledGlobally();
      expect(reported.enabled).toBe(acted);
    }
  });
});
