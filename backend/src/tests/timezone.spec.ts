import { describe, it, expect } from 'vitest';
import {
  resolveTimezone,
  isValidTimezone,
  minutesSinceMidnightIn,
  parseTimeToMinutes,
  dayKeyIn,
  DEFAULT_TIMEZONE,
} from '../common/utils/timezone.util';

describe('timezone.util', () => {
  describe('isValidTimezone', () => {
    it('accepts real IANA zones', () => {
      expect(isValidTimezone('Asia/Kolkata')).toBe(true);
      expect(isValidTimezone('UTC')).toBe(true);
    });

    it('rejects friendly names and junk', () => {
      expect(isValidTimezone('India')).toBe(false);
      expect(isValidTimezone('')).toBe(false);
    });
  });

  describe('resolveTimezone', () => {
    it('passes through valid IANA zones unchanged', () => {
      expect(resolveTimezone('Asia/Bangkok')).toBe('Asia/Bangkok');
    });

    // This is the exact value that crashed SendDistributorService in production.
    it('maps the friendly name "India" to Asia/Kolkata', () => {
      expect(resolveTimezone('India')).toBe('Asia/Kolkata');
    });

    it('is case- and whitespace-insensitive for aliases', () => {
      expect(resolveTimezone('  india  ')).toBe('Asia/Kolkata');
      expect(resolveTimezone('IST')).toBe('Asia/Kolkata');
    });

    it('falls back to the default for unknown values', () => {
      expect(resolveTimezone('Narnia')).toBe(DEFAULT_TIMEZONE);
      expect(resolveTimezone(null)).toBe(DEFAULT_TIMEZONE);
      expect(resolveTimezone(undefined)).toBe(DEFAULT_TIMEZONE);
      expect(resolveTimezone('')).toBe(DEFAULT_TIMEZONE);
    });

    it('honours an explicit fallback', () => {
      expect(resolveTimezone('nonsense', 'UTC')).toBe('UTC');
    });
  });

  describe('minutesSinceMidnightIn', () => {
    it('never throws on an invalid zone', () => {
      expect(() => minutesSinceMidnightIn('India')).not.toThrow();
      expect(() => minutesSinceMidnightIn('total-garbage')).not.toThrow();
    });

    it('returns a value inside a single day', () => {
      const mins = minutesSinceMidnightIn('UTC');
      expect(mins).toBeGreaterThanOrEqual(0);
      expect(mins).toBeLessThan(1440);
    });

    it('computes the correct offset between two zones', () => {
      // Asia/Kolkata is UTC+05:30 → exactly 330 minutes ahead.
      const at = new Date('2026-09-07T00:00:00Z');
      expect(minutesSinceMidnightIn('UTC', at)).toBe(0);
      expect(minutesSinceMidnightIn('Asia/Kolkata', at)).toBe(330);
    });

    it('handles midnight without emitting 24:00', () => {
      const at = new Date('2026-09-07T18:30:00Z'); // 00:00 IST next day
      expect(minutesSinceMidnightIn('Asia/Kolkata', at)).toBe(0);
    });
  });

  describe('parseTimeToMinutes', () => {
    it('parses HH:mm', () => {
      expect(parseTimeToMinutes('09:00', 0)).toBe(540);
      expect(parseTimeToMinutes('18:30', 0)).toBe(1110);
      expect(parseTimeToMinutes('00:00', 99)).toBe(0);
    });

    it('falls back on malformed or out-of-range input', () => {
      expect(parseTimeToMinutes('not-a-time', 540)).toBe(540);
      expect(parseTimeToMinutes('', 540)).toBe(540);
      expect(parseTimeToMinutes(null, 540)).toBe(540);
      expect(parseTimeToMinutes('99:99', 540)).toBe(540);
    });

    it('tolerates a seconds suffix from Postgres time columns', () => {
      expect(parseTimeToMinutes('09:00:00', 0)).toBe(540);
    });
  });

  describe('dayKeyIn', () => {
    it('formats as YYYY-MM-DD', () => {
      expect(dayKeyIn('UTC', new Date('2026-09-07T12:00:00Z'))).toBe('2026-09-07');
    });

    // Why the daily send counter must not use UTC: at 19:00 UTC it is already
    // the next calendar day in Kolkata, so a UTC-keyed counter would reset
    // mid-window and allow the daily limit to be exceeded.
    it('rolls over on the local calendar day, not UTC', () => {
      const at = new Date('2026-09-07T19:00:00Z');
      expect(dayKeyIn('UTC', at)).toBe('2026-09-07');
      expect(dayKeyIn('Asia/Kolkata', at)).toBe('2026-09-08');
    });

    it('resolves friendly zone names', () => {
      const at = new Date('2026-09-07T19:00:00Z');
      expect(dayKeyIn('India', at)).toBe('2026-09-08');
    });
  });
});
