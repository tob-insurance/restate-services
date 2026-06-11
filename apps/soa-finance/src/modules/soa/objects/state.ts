// ── State value types ──────────────────────────────────────────

export interface LetterRecord {
  letterNo: string;
  referenceLetterNo?: string;
  sentDate: string;
  status: "pending" | "sent" | "failed" | "skipped";
  type: string;
}

// ── State key helpers ──────────────────────────────────────────

export const stateKeys = {
  header: (timePeriod: string, officeId: string) =>
    `header:${timePeriod}:${officeId}` as const,
  details: (timePeriod: string, officeId: string) =>
    `details:${timePeriod}:${officeId}` as const,
  letters: (timePeriod: string, officeId: string) =>
    `letters:${timePeriod}:${officeId}` as const,
} as const;
