import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Display-side phone formatter. Strips non-digits, formats 10-digit
 * North-American numbers as `(xxx) xxx-xxxx`. 11-digit numbers starting
 * with "1" drop the leading 1 first. Anything else (international, short,
 * partial) is returned as-is so legacy data still renders.
 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return value;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/**
 * Live formatter for typing into a phone input. Accepts whatever the user
 * has typed and renders the best partial form of `(xxx) xxx-xxxx`. Caps
 * at 10 digits so paste-in junk gets trimmed.
 */
export function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Returns the count of digits in a phone string. Use to validate that
 * a phone is a complete 10-digit NANP number before submit.
 */
export function phoneDigitCount(value: string | null | undefined): number {
  if (!value) return 0;
  return value.replace(/\D/g, "").length;
}
