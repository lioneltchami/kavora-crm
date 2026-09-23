/**
 * Phone-number utilities. All numbers are stored in E.164 form internally.
 */

import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export function toE164(
  input: string,
  defaultCountry: CountryCode = "US",
): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  return parsed?.isValid() ? parsed.number : null;
}

export function isValidPhone(
  input: string,
  defaultCountry: CountryCode = "US",
): boolean {
  return toE164(input, defaultCountry) !== null;
}

export function formatPhoneForDisplay(e164: string | null | undefined): string {
  if (!e164) return "—";
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed?.isValid()) return e164;
  return parsed.formatNational();
}
