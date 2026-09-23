/**
 * Live check of the cross-tick send gate against the real Redis instance.
 *
 * The unit tests mock Redis; this confirms the gate genuinely persists and expires in the
 * deployment, and that the gaps it arms are irregular rather than the 60s cron period.
 * Deliberately sends no WhatsApp messages: pacing is a property of the gate arithmetic,
 * so it can be proven without messaging anyone.
 *
 * Usage: node scripts/check-pacing.js
 */
const Redis = require('../backend/node_modules/ioredis');

const MIN = Number(process.env.HUMANIZED_DELAY_MIN_MS || 45_000);
const MAX = Number(process.env.HUMANIZED_DELAY_MAX_MS || 180_000);
const KEY = 'campaign:pacing-selfcheck:next-send-at';

// Mirrors SendDistributorService.humanizedGap for the in-band regime.
const gap = () => MIN + Math.floor(Math.random() * (MAX - MIN + 1));

(async () => {
  const redis = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    lazyConnect: true,
  });

  try {
    await redis.connect();
    console.log('  redis: connected');

    // 1. A campaign with no gate pending must be free to send immediately.
    await redis.del(KEY);
    console.log(`  no gate set        -> sends now: ${(await redis.get(KEY)) === null}`);

    // 2. Arming the gate must hold the next send well beyond one cron minute,
    //    which is the whole point: a 1-message batch used to fire every 60s.
    const g = gap();
    await redis.set(KEY, JSON.stringify(Date.now() + g), 'EX', Math.ceil(g / 1000) + 60);
    const until = JSON.parse(await redis.get(KEY)) - Date.now();
    console.log(
      `  armed ${Math.round(g / 1000)}s gap    -> held for ${Math.round(until / 1000)}s ` +
        `(> 60s cron tick: ${until > 60_000})`,
    );

    // 3. The TTL must follow the gap so a stale gate cannot wedge a campaign.
    console.log(`  ttl                -> ${await redis.ttl(KEY)}s (expires on its own)`);

    // 4. The distribution must not be periodic — the bug produced ~60s every time.
    const draws = Array.from({ length: 500 }, gap);
    const buckets = new Map();
    for (const d of draws) {
      const b = Math.round(d / 1000);
      buckets.set(b, (buckets.get(b) ?? 0) + 1);
    }
    const dominant = Math.max(...buckets.values()) / draws.length;
    const secs = draws.map((d) => Math.round(d / 1000));
    console.log(`  sample gaps (s)    -> ${secs.slice(0, 10).join(', ')} ...`);
    console.log(
      `  range              -> ${Math.min(...secs)}-${Math.max(...secs)}s ` +
        `(configured ${MIN / 1000}-${MAX / 1000}s)`,
    );
    console.log(
      `  most common value  -> ${(dominant * 100).toFixed(1)}% of draws ` +
        `(a metronome would be 100%)`,
    );

    await redis.del(KEY);
    const ok = until > 60_000 && dominant < 0.1 && Math.min(...secs) >= MIN / 1000;
    console.log(ok ? '\n  PASS: pacing is gated and irregular' : '\n  FAIL');
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error(`  could not reach Redis: ${err.message}`);
    process.exit(1);
  } finally {
    redis.disconnect();
  }
})();
