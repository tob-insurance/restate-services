import type {
  ObjectContext,
  ObjectSharedContext,
} from "@restatedev/restate-sdk";

// ── State value types ──────────────────────────────────────────

export type ReminderHeader = {
  customerCode: string;
  timePeriod: string;
  officeId: string;
  createdAt: string;
};

export type ReminderDetail = {
  dcNoteId: string;
  reminderId: string; // composite: "{timePeriod}:{officeId}"
  isPaid: boolean;
};

export type LetterRecord = {
  type: string;
  letterNo: string;
  referenceLetterNo?: string;
  sentDate: string;
  status: "pending" | "sent" | "failed";
};

/**
 * dcNoteIndex maps DC_NOTE_ID to reminderId ("{timePeriod}:{officeId}").
 * This enables cross-period lookup without scanning all state keys.
 */
export type DcNoteIndex = Record<string, string>; // dcNoteId → reminderId

// ── State key helpers ──────────────────────────────────────────

export const stateKeys = {
  header: (timePeriod: string, officeId: string) =>
    `header:${timePeriod}:${officeId}` as const,
  details: (timePeriod: string, officeId: string) =>
    `details:${timePeriod}:${officeId}` as const,
  letters: (timePeriod: string, officeId: string) =>
    `letters:${timePeriod}:${officeId}` as const,
  dcNoteIndex: "dcNoteIndex" as const,
} as const;

// ── Context type alias for SoaCustomer handlers ─────────────────

export type CustomerContext = ObjectContext;
export type CustomerSharedContext = ObjectSharedContext;

// ── Handler parameter types ─────────────────────────────────────

export type CreateReminderInput = {
  timePeriod: string;
  officeId: string;
  dcNotes: Array<{ dcNoteId: string }>;
};

export type AddLetterInput = {
  timePeriod: string;
  officeId: string;
  type: string;
  letterNo: string;
  referenceLetterNo?: string;
  sentDate: string;
};

export type MarkDcNotesPaidInput = {
  dcNoteIds: string[];
};
