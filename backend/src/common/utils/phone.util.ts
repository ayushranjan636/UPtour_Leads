import { PhoneNumberUtil, PhoneNumberFormat } from 'google-libphonenumber';

const phoneUtil = PhoneNumberUtil.getInstance();

export function normalizePhone(
  phone: string,
  defaultCountryCode: string = 'IN',
): string | null {
  try {
    const parsed = phoneUtil.parse(phone, defaultCountryCode);
    if (!phoneUtil.isValidNumber(parsed)) return null;
    return phoneUtil.format(parsed, PhoneNumberFormat.E164);
  } catch {
    return null;
  }
}
