import type {
  ObjectContext,
  ObjectSharedContext,
} from "@restatedev/restate-sdk";

// ── State value types ──────────────────────────────────────────

export interface ReminderHeader {
  createdAt: string;
  customerCode: string;
  officeId: string;
  timePeriod: string;
}

export interface ReminderDetail {
  dcNoteId: string;
  isPaid: boolean;
  reminderId: string; // composite: "{timePeriod}:{officeId}"
}

export interface LetterRecord {
  letterNo: string;
  referenceLetterNo?: string;
  sentDate: string;
  status: "pending" | "sent" | "failed";
  type: string;
}

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
  dcNoteIndex: (timePeriod: string) => `dcNoteIndex:${timePeriod}` as const,
} as const;

export async function readDcNoteIndex(
  ctx: ObjectContext | ObjectSharedContext,
  currentTimePeriod?: string
): Promise<DcNoteIndex> {
  if (!currentTimePeriod) {
    return {};
  }
  return (
    (await ctx.get<DcNoteIndex>(stateKeys.dcNoteIndex(currentTimePeriod))) ?? {}
  );
}
