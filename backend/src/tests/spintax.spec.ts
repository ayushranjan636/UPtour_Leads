import { describe, it, expect } from 'vitest';
import { spin, countVariants } from '../common/utils/spintax.util';

/**
 * Spintax exists so two recipients never receive a byte-identical message — an
 * identical string repeated across many numbers is a strong bulk-sender signal
 * regardless of how well the timing is randomised. These lock the behaviour,
 * especially the termination guards: a malformed template must not hang the worker
 * that renders it mid-send.
 */
describe('spin', () => {
  /** Deterministic RNG that always takes the first option. */
  const first = () => 0;
  /** Always takes the last option. */
  const last = () => 0.999999;

  it('picks one alternative from a group', () => {
    expect(spin('{Hi|Hello|Hey} there', first)).toBe('Hi there');
    expect(spin('{Hi|Hello|Hey} there', last)).toBe('Hey there');
  });

  it('resolves several groups independently', () => {
    expect(spin('{Hi|Hello} {there|friend}', first)).toBe('Hi there');
    expect(spin('{Hi|Hello} {there|friend}', last)).toBe('Hello friend');
  });

  it('resolves nested groups innermost-first', () => {
    expect(spin('{Hi|{Hello|Hey}}', last)).toBe('Hey');
    expect(spin('{{Good morning|Morning}|Hi}', first)).toBe('Good morning');
  });

  it('leaves text without spintax untouched and preserves {{placeholders}}', () => {
    // Merge fields must survive: the inner {contact_name} looks like a single-option
    // group, so an unprotected pass would rewrite it to `contact_name` and silently
    // break personalisation on every message.
    expect(spin('Hello {{contact_name}}, welcome!', first)).toBe('Hello {{contact_name}}, welcome!');
    expect(spin('{{city}} and {{state}}', first)).toBe('{{city}} and {{state}}');
    expect(spin('No braces at all', first)).toBe('No braces at all');
    expect(spin('', first)).toBe('');
  });

  it('spins around placeholders without disturbing them', () => {
    expect(spin('{Hi|Hello} {{contact_name}}, {welcome|greetings}!', first)).toBe(
      'Hi {{contact_name}}, welcome!',
    );
    expect(spin('{Hi|Hello} {{contact_name}}, {welcome|greetings}!', last)).toBe(
      'Hello {{contact_name}}, greetings!',
    );
  });

  it('keeps literal content for single-option and empty groups', () => {
    expect(spin('{only}', first)).toBe('only');
    expect(spin('a{}b', first)).toBe('ab');
  });

  it('terminates on an unclosed brace instead of looping', () => {
    // No complete group can match, so the loop must exit on the first pass.
    expect(spin('{Hi|Hello there', first)).toBe('{Hi|Hello there');
    expect(spin('Hi} there', first)).toBe('Hi} there');
  });

  it('produces more than one distinct output across many renders', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(spin('{Hi|Hello|Hey} {there|friend}'));
    }
    // 3 x 2 combinations; 200 draws should surface several. The guarantee that matters
    // is simply "not always the same string".
    expect(seen.size).toBeGreaterThan(1);
  });

  it('only ever emits declared alternatives', () => {
    const allowed = new Set(['Hi there', 'Hello there', 'Hi friend', 'Hello friend']);
    for (let i = 0; i < 100; i++) {
      expect(allowed.has(spin('{Hi|Hello} {there|friend}'))).toBe(true);
    }
  });
});

describe('countVariants', () => {
  it('counts the product of all groups', () => {
    expect(countVariants('{a|b|c} {d|e}')).toBe(6);
    expect(countVariants('{a|b}')).toBe(2);
  });

  it('returns 1 when there is no real choice', () => {
    expect(countVariants('plain text')).toBe(1);
    expect(countVariants('{single}')).toBe(1);
    expect(countVariants('')).toBe(1);
  });
});
