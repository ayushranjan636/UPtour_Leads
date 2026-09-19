/**
 * TIMEZONE UTILITIES
 *
 * `send_window_timezone` is free-form text on the campaign, so values like
 * "India" or "IST" get stored even though `Intl.DateTimeFormat` only accepts IANA
 * zone names ("Asia/Kolkata"). Passing an invalid zone throws a RangeError, which
 * previously aborted the whole send-distribution run for that campaign.
 *
 * These helpers normalise the common aliases and always fall back to a safe
 * default instead of throwing.
 */

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/**
 * Friendly names/abbreviations we accept in addition to real IANA zones,
 * mapped to their canonical IANA equivalent.
 */
const TIMEZONE_ALIASES: Record<string, string> = {
  india: 'Asia/Kolkata',
  ist: 'Asia/Kolkata',
  kolkata: 'Asia/Kolkata',
  calcutta: 'Asia/Kolkata',
  delhi: 'Asia/Kolkata',
  mumbai: 'Asia/Kolkata',
  thailand: 'Asia/Bangkok',
  bangkok: 'Asia/Bangkok',
  japan: 'Asia/Tokyo',
  tokyo: 'Asia/Tokyo',
  jst: 'Asia/Tokyo',
  uae: 'Asia/Dubai',
  dubai: 'Asia/Dubai',
  'united arab emirates': 'Asia/Dubai',
  singapore: 'Asia/Singapore',
  malaysia: 'Asia/Kuala_Lumpur',
  indonesia: 'Asia/Jakarta',
  jakarta: 'Asia/Jakarta',
  bali: 'Asia/Makassar',
  vietnam: 'Asia/Ho_Chi_Minh',
  'sri lanka': 'Asia/Colombo',
  nepal: 'Asia/Kathmandu',
  china: 'Asia/Shanghai',
  'south korea': 'Asia/Seoul',
  seoul: 'Asia/Seoul',
  australia: 'Australia/Sydney',
  sydney: 'Australia/Sydney',
  uk: 'Europe/London',
  'united kingdom': 'Europe/London',
  london: 'Europe/London',
  gmt: 'UTC',
  germany: 'Europe/Berlin',
  france: 'Europe/Paris',
  paris: 'Europe/Paris',
  italy: 'Europe/Rome',
  spain: 'Europe/Madrid',
  russia: 'Europe/Moscow',
  moscow: 'Europe/Moscow',
  israel: 'Asia/Jerusalem',
  usa: 'America/New_York',
  'united states': 'America/New_York',
  est: 'America/New_York',
  pst: 'America/Los_Angeles',
  utc: 'UTC',
};

/** True when `Intl` recognises the zone. */
export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve any user-supplied timezone string to a usable IANA zone.
 * Never throws — falls back to `fallback` when the value cannot be resolved.
 *
 * The alias map is consulted BEFORE the validity check on purpose: ICU accepts
 * some ambiguous legacy abbreviations (notably "IST", which could mean India,
 * Ireland or Israel), so our explicit mapping must take precedence over
 * whatever the platform happens to guess.
 */
export function resolveTimezone(
  tz: string | null | undefined,
  fallback: string = DEFAULT_TIMEZONE,
): string {
  if (!tz || typeof tz !== 'string') return fallback;

  const trimmed = tz.trim();
  if (!trimmed) return fallback;

  const alias = TIMEZONE_ALIASES[trimmed.toLowerCase()];
  if (alias && isValidTimezone(alias)) return alias;

  if (isValidTimezone(trimmed)) return trimmed;

  return fallback;
}

/**
 * Current wall-clock minutes-since-midnight in the given timezone.
 *
 * Uses `formatToParts` rather than `new Date(toLocaleString(...))`, which is
 * locale-dependent and parses incorrectly in several Node/ICU builds.
 */
export function minutesSinceMidnightIn(
  tz: string,
  now: Date = new Date(),
): number {
  const zone = resolveTimezone(tz);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');

  // hour12:false can emit "24" for midnight in some ICU versions.
  return (hour % 24) * 60 + minute;
}

/** Parse "HH:mm" into minutes since midnight, tolerating junk input. */
export function parseTimeToMinutes(
  time: string | null | undefined,
  fallbackMinutes: number,
): number {
  if (!time || typeof time !== 'string') return fallbackMinutes;

  const match = time.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallbackMinutes;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return fallbackMinutes;

  return hours * 60 + minutes;
}

/** Today's date key (YYYY-MM-DD) in the given timezone. */
export function dayKeyIn(tz: string, now: Date = new Date()): string {
  const zone = resolveTimezone(tz);
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
