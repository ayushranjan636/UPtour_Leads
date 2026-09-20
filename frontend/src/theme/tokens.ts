/**
 * Design tokens — Apple-inspired light ("clear glass") theme.
 *
 * Single source of truth for colour, elevation, radius and motion. Components must
 * read from here (or the matching CSS variables in styles/global.css) instead of
 * hard-coding hex values, so light/dark and contrast variants stay consistent.
 *
 * Guiding rules, per Apple HIG:
 *  - Content is the hero. Chrome recedes; the page background is quiet.
 *  - One meaningful accent. Colour signals action, selection and status — never
 *    decoration. No gradients used as branding.
 *  - Glass is a functional material for navigation layers only, never for content
 *    cards, and always with an opaque fallback.
 *  - Hierarchy comes from spacing, weight and alignment before colour.
 */

/** Neutral ramp — cool grey, matching macOS/iOS system greys. */
export const grey = {
  50: '#FAFAFC',
  100: '#F4F4F7',
  150: '#ECECEF',
  200: '#E3E3E8',
  300: '#D2D2D8',
  400: '#AEAEB4',
  500: '#8A8A8F',
  600: '#6E6E73', // secondary label
  700: '#48484A',
  800: '#2C2C2E',
  900: '#1C1C1E', // primary label
} as const;

export const color = {
  /* ── Backgrounds ───────────────────────────────────
   * Layered so depth reads without borders everywhere: the window sits on `canvas`,
   * content sits on `surface`, and raised elements use `elevated`.
   */
  canvas: '#F4F4F7',
  surface: '#FFFFFF',
  elevated: '#FFFFFF',
  /** Quiet fill for table headers, inset rows and code blocks. */
  fill: '#F4F4F7',
  fillStrong: '#ECECEF',

  /* ── Text ──────────────────────────────────────────
   * Verified against #FFFFFF: `primary` 17.0:1, `secondary` 5.1:1, `tertiary` 5.1:1
   * — all WCAG AA for normal text.
   *
   * `tertiary` was #8A8A8F (3.44:1), which failed AA and was being used for real
   * content: phone numbers, metric labels, em-dash placeholders. It now matches
   * `secondary` in luminance and differs only in role, so nothing essential is
   * rendered below AA. Use `textFaint` for genuinely decorative glyphs only.
   */
  text: grey[900],
  textSecondary: grey[600],
  textTertiary: grey[600],
  /** Decorative only — 3.4:1, never for text a user must read. */
  textFaint: grey[500],
  textOnAccent: '#FFFFFF',

  /* ── Separators ────────────────────────────────────
   * Hairlines. Prefer spacing over rules; use `separator` when a rule is needed.
   */
  separator: 'rgba(60, 60, 67, 0.12)',
  separatorOpaque: '#E3E3E8',

  /* ── Accent ────────────────────────────────────────
   * A single restrained blue for primary actions, selection and links. Replaces the
   * previous indigo/violet gradient palette, which read as generic template styling
   * and competed with real status colours.
   */
  accent: '#0B6BCB',
  accentHover: '#0A5FB4',
  accentActive: '#084E94',
  /** Tinted background for selected rows and nav items. */
  accentSoft: 'rgba(11, 107, 203, 0.10)',
  accentSofter: 'rgba(11, 107, 203, 0.06)',
  accentRing: 'rgba(11, 107, 203, 0.35)',

  /* ── Status ────────────────────────────────────────
   * Always paired with a label or icon — never colour alone.
   */
  success: '#1D7A4C',
  successSoft: 'rgba(29, 122, 76, 0.10)',
  warning: '#9A6200',
  warningSoft: 'rgba(154, 98, 0, 0.10)',
  danger: '#C1291F',
  dangerSoft: 'rgba(193, 41, 31, 0.10)',
  info: '#0B6BCB',
  infoSoft: 'rgba(11, 107, 203, 0.10)',
} as const;

/**
 * Translucent material for navigation chrome.
 * `backdrop-filter` is progressive enhancement; `fallback` keeps text legible where
 * it is unsupported or when the user has asked for reduced transparency.
 */
export const material = {
  sidebar: 'rgba(255, 255, 255, 0.72)',
  header: 'rgba(255, 255, 255, 0.78)',
  popover: 'rgba(255, 255, 255, 0.86)',
  blur: 'saturate(180%) blur(20px)',
  fallback: '#FFFFFF',
} as const;

/** 4px grid. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/** Restrained radii — compact controls stay tighter than large surfaces. */
export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  xxl: 16,
  pill: 999,
} as const;

/**
 * Soft, low-contrast elevation. Apple-like surfaces sit close to the page; heavy
 * drop shadows read as web-template styling.
 */
export const shadow = {
  none: 'none',
  sm: '0 1px 2px rgba(0, 0, 0, 0.04)',
  md: '0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
  lg: '0 4px 16px rgba(0, 0, 0, 0.08)',
  popover: '0 8px 28px rgba(0, 0, 0, 0.12)',
} as const;

/** Type scale. System font stack first so the OS renders its native face. */
export const font = {
  family:
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", "Segoe UI", Roboto, Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  size: {
    caption: 12,
    footnote: 13,
    body: 14,
    callout: 15,
    headline: 17,
    title3: 20,
    title2: 24,
    title1: 28,
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
} as const;

/** Brief, interruptible motion. Honour prefers-reduced-motion at the CSS layer. */
export const motion = {
  fast: '120ms',
  base: '200ms',
  slow: '320ms',
  easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
} as const;

/** Minimum pointer/touch target (CSS px), per HIG 44pt guidance. */
export const MIN_TARGET = 44;
