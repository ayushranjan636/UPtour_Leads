import { describe, it, expect } from 'vitest';
import { toChatId } from '../modules/openwa/openwa.service';

/**
 * Locks the phone -> WhatsApp JID conversion.
 *
 * This existed inline in two call sites that disagreed: the campaign processor
 * stripped the leading `+`, the manual send path did not. Since numbers are stored
 * E.164-normalised (`+91…`), the manual path produced `+919025867204@c.us`, which
 * the gateway rejects — so every ad-hoc message failed while campaigns worked.
 */
describe('toChatId', () => {
  it('strips the leading + from an E.164 number', () => {
    expect(toChatId('+919025867204')).toBe('919025867204@c.us');
  });

  it('leaves an already-bare number unchanged', () => {
    expect(toChatId('919025867204')).toBe('919025867204@c.us');
  });

  it('strips spaces, dashes and parentheses that survive user entry', () => {
    expect(toChatId('+91 90258-67204')).toBe('919025867204@c.us');
    expect(toChatId('+1 (555) 010-9999')).toBe('15550109999@c.us');
  });

  it('prefers an existing chat id over deriving one', () => {
    // Group and @lid chats cannot be reconstructed from a phone number, so a
    // stored chat id must always win.
    expect(toChatId('+919025867204', '147171903013114@lid')).toBe('147171903013114@lid');
    expect(toChatId('+919025867204', '120363001234567890@g.us')).toBe(
      '120363001234567890@g.us',
    );
  });

  it('ignores an empty existing chat id and derives instead', () => {
    expect(toChatId('+919025867204', '')).toBe('919025867204@c.us');
    expect(toChatId('+919025867204', null)).toBe('919025867204@c.us');
    expect(toChatId('+919025867204', undefined)).toBe('919025867204@c.us');
  });
});
