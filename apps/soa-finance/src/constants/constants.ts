export { CONTENT_TYPES, TIMEZONE } from "@restate-tob/shared";

export const ROMAN_MONTHS = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
] as const;

export const INFRASTRUCTURE_TIMEOUTS = {
  GOTENBERG_PDF_MS: 60_000,
} as const;

export const NUMBER_FORMATS = {
  number: "#,##0",
  currency: "#,##0.00",
  date: "dd/mm/yyyy",
  text: "@",
} as const;

// ── Business Rules ──────────────────────────────────────────
export const AGING_THRESHOLD = 60;
export const PERIODS_TO_KEEP = 3;
export const SENTINEL_ALL = "ALL";
export const DOTNET_TICKS_EPOCH_OFFSET = 621_355_968_000_000_000;
