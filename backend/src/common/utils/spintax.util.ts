/**
 * Spintax — message text variation.
 *
 * `{Hi|Hello|Hey}` renders as one of the alternatives, chosen at random per render.
 * Two recipients therefore receive byte-different messages even from one template,
 * which matters because sending an identical string to many numbers in sequence is a
 * strong bulk-sender signal for WhatsApp's anti-abuse systems. Randomised timing
 * alone does not help if the payload is a constant.
 *
 * Supports nesting: `{Hi|{Hello|Hey}} {there|friend}`. Resolution is innermost-first,
 * so an inner group is settled before the outer group picks among its options.
 */

/** Longest allowed input, as a guard against pathological templates. */
const MAX_LENGTH = 20_000;

/**
 * Matches the innermost `{...}` group: a brace pair containing no further braces.
 * Anchoring on "no nested braces" is what makes repeated application terminate.
 */
const INNERMOST_GROUP = /\{([^{}]*)\}/;

/**
 * Template placeholders such as `{{contact_name}}`.
 *
 * These must be protected before spinning: the inner `{contact_name}` looks like a
 * single-option spintax group, so a naive pass rewrites it to `contact_name` and the
 * later variable substitution finds nothing to replace — every personalised message
 * would silently lose its merge fields.
 */
const PLACEHOLDER = /\{\{\s*[\w.]+\s*\}\}/g;
/** Sentinel that cannot occur in real copy and contains no braces. */
const PLACEHOLDER_TOKEN = '\u0000PH';

/**
 * Resolve every spintax group in `text`.
 *
 * Returns the input unchanged when there is no spintax, so it is safe to call on
 * every template body unconditionally. `{{placeholders}}` are preserved verbatim.
 *
 * @param text     Template text, possibly containing `{a|b|c}` groups.
 * @param random   Injectable RNG, for deterministic tests. Must return [0, 1).
 */
export function spin(text: string, random: () => number = Math.random): string {
  if (!text || !text.includes('{')) return text;
  if (text.length > MAX_LENGTH) return text;

  // Stash placeholders so brace-matching cannot see them.
  const stash: string[] = [];
  let out = text.replace(PLACEHOLDER, (match) => {
    stash.push(match);
    return `${PLACEHOLDER_TOKEN}${stash.length - 1}\u0000`;
  });

  // Each pass resolves one innermost group. Bounded by the number of groups, which
  // cannot exceed the input length, so this cannot spin forever on malformed input
  // such as an unclosed brace (no match -> loop exits immediately).
  let guard = 0;
  const limit = out.length;

  while (guard++ < limit) {
    const match = INNERMOST_GROUP.exec(out);
    if (!match) break;

    const options = match[1].split('|');
    // `{}` or `{single}` are not really choices; keep the literal content so a
    // template using braces for another purpose is not silently emptied.
    const choice =
      options.length > 1 ? options[Math.floor(random() * options.length)] : match[1];

    out = out.slice(0, match.index) + choice + out.slice(match.index + match[0].length);
  }

  // Restore placeholders.
  return out.replace(
    new RegExp(`${PLACEHOLDER_TOKEN}(\\d+)\u0000`, 'g'),
    (_, i) => stash[Number(i)] ?? '',
  );
}

/**
 * Count the distinct renderings a template can produce.
 *
 * Surfaced in the UI so an operator can see that a template with one variation is
 * effectively a constant string across the whole audience.
 */
export function countVariants(text: string): number {
  if (!text || !text.includes('{')) return 1;

  let total = 1;
  // Strip placeholders first, for the same reason spin() stashes them.
  let remaining = text.replace(PLACEHOLDER, '');
  let guard = 0;
  const limit = remaining.length;

  while (guard++ < limit) {
    const match = INNERMOST_GROUP.exec(remaining);
    if (!match) break;
    const options = match[1].split('|');
    if (options.length > 1) total *= options.length;
    // Drop the resolved group so the next iteration sees the enclosing one.
    remaining = remaining.slice(0, match.index) + remaining.slice(match.index + match[0].length);
  }

  return total;
}
