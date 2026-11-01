/**
 * Plain-language fixes for the WhatsApp Cloud API errors an operator actually meets.
 *
 * Meta's own messages ("(#132001) Template name does not exist in the translation")
 * name the symptom, not the fix, and they arrive both from the send call and later
 * through the status webhook. One table serves both, so a failed campaign row always
 * says what to do next.
 *
 * Codes: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
const HINTS: Record<number, string> = {
  0: 'Meta could not authenticate the request. Check the access token in Settings → WhatsApp.',
  10: 'The access token lacks permission for this number. Give the system user full control of the app and the WhatsApp account, then generate a new token.',
  100: 'Meta rejected a value in the request. Check the template name, language and blank values.',
  190: 'The access token is invalid or expired. Paste a new permanent token under Settings → WhatsApp → Edit credentials.',
  200: 'The access token lacks permission for this number. Regenerate it with whatsapp_business_messaging and whatsapp_business_management.',
  368: 'Meta has temporarily blocked this account for policy violations. Check Account Quality in WhatsApp Manager.',
  130429: 'Sending faster than Meta allows for this number. The campaign will retry; lower the daily limit if it persists.',
  131000: 'Meta had an internal error. Retry the failed messages in a few minutes.',
  131005: 'The access token lacks permission. Regenerate it with whatsapp_business_messaging.',
  131008: 'A required value is missing. Check that every template blank has a value.',
  131009: 'A value is not valid. Check template blank values and media links.',
  131021: 'You cannot message your own business number.',
  131026: 'Not delivered: this number may not use WhatsApp, or has not accepted WhatsApp’s latest terms.',
  131030: 'This recipient is not on the allowed list. With Meta’s test number you can only message numbers added under WhatsApp → API Setup → “To”. Use your real business number to message anyone.',
  131031: 'Meta has locked or restricted this business account. Check Account Quality in WhatsApp Manager.',
  131042: 'Meta has a payment problem on this account. Add a valid payment method in WhatsApp Manager → Payment settings.',
  131045: 'The phone number is not registered or its certificate is invalid. Register the number in Settings → WhatsApp.',
  131047: 'More than 24 hours since this person last wrote, so only an approved template can be sent. Set a Meta template on this step.',
  131048: 'Meta’s spam limit was hit: too many recent messages were blocked or reported. Slow down and make the message more relevant.',
  131049: 'Meta held back this marketing message to protect engagement with this person. It may go through later; do not resend immediately.',
  131050: 'This person has stopped receiving marketing messages from you.',
  131051: 'This message type is not supported.',
  131052: 'Meta could not download the media this person sent.',
  131053: 'Meta could not fetch the media link. Make sure the file URL is public and the file type is supported.',
  131056: 'Too many messages to the same number in a short time. Wait before sending to them again.',
  132000: 'The number of values does not match the template’s blanks. Edit the step’s Meta template values.',
  132001: 'This template does not exist in that language, or is not approved yet. Check it under Settings → WhatsApp → Message templates and that the language matches.',
  132005: 'The template text is too long once the values are filled in. Shorten the values.',
  132007: 'The filled-in text breaks Meta’s content policy. Change the values or the template.',
  132012: 'A value does not match the template’s format, for example text where media is expected.',
  132015: 'This template is paused by Meta because of low quality. Create a new one.',
  132016: 'This template is disabled by Meta. Create a new one.',
  133000: 'The number’s registration did not finish. Register it again in Settings → WhatsApp.',
  133010: 'This phone number is not registered with the Cloud API yet. Register it in Settings → WhatsApp with a 6-digit PIN.',
  135000: 'Meta could not process the request. Retry later.',
};

/** The fix for a Meta error code, or null when there is no specific advice. */
export function metaErrorHint(code: number | string | null | undefined): string | null {
  const n = typeof code === 'string' ? Number(code) : code;
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return HINTS[n] ?? null;
}

/** Pull the `(#123)` code back out of a stored failure reason. */
export function metaErrorCodeOf(reason: string | null | undefined): number | null {
  const m = /\(#(\d+)\)/.exec(reason ?? '');
  return m ? Number(m[1]) : null;
}
