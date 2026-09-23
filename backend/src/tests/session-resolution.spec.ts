/**
 * Session resolution must survive a re-link.
 *
 * Re-linking WhatsApp mints a new session id, stranding OPENWA_SESSION_ID on one that no
 * longer exists. The service used to return the configured id without checking, so every
 * send failed with "Session is not active" while a healthy session sat unused — the exact
 * failure seen on the BodhGaya campaign.
 */
import { describe, it, expect, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { OpenwaService } from '../modules/openwa/openwa.service';

const READY = { id: 'live-id', name: 'sales', status: 'ready' };

/** Build a service with a stubbed gateway; only resolveSessionId is under test. */
function makeService(configured: string | null, sessions: any[]): OpenwaService {
  const svc = Object.create(OpenwaService.prototype) as any;
  svc.configuredSessionId = configured;
  svc.discoveredSessionId = null;
  svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  svc.getSessions = vi.fn().mockResolvedValue(sessions);
  return svc;
}

describe('OpenwaService.resolveSessionId', () => {
  it('falls back to the connected session when the configured id is gone', async () => {
    const svc = makeService('stale-id-from-a-previous-link', [READY]);
    await expect(svc.resolveSessionId()).resolves.toBe('live-id');
  });

  it('prefers the configured session when it is genuinely ready', async () => {
    const svc = makeService('pinned', [
      { id: 'pinned', name: 'pinned', status: 'ready' },
      READY,
    ]);
    // Determinism matters for multi-session setups: a pinned, healthy session must win
    // over whichever one happens to be listed first.
    await expect(svc.resolveSessionId()).resolves.toBe('pinned');
  });

  it('skips a configured session that exists but is not ready', async () => {
    const svc = makeService('pinned', [
      { id: 'pinned', name: 'pinned', status: 'qr_ready' },
      READY,
    ]);
    await expect(svc.resolveSessionId()).resolves.toBe('live-id');
  });

  it('refuses to guess when nothing is connected', async () => {
    const svc = makeService('pinned', [{ id: 'pinned', status: 'disconnected' }]);
    // Better a clear 503 than silently sending from an unexpected number.
    await expect(svc.resolveSessionId()).rejects.toThrow(ServiceUnavailableException);
  });

  it('still honours an explicit per-campaign override', async () => {
    const svc = makeService(null, [READY]);
    await expect(svc.resolveSessionId('campaign-session')).resolves.toBe('campaign-session');
  });

  it('ignores the historical "default" placeholder', async () => {
    const svc = makeService('default', [READY]);
    await expect(svc.resolveSessionId('default')).resolves.toBe('live-id');
  });
});
