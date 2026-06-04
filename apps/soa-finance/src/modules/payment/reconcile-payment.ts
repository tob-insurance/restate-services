import type { ReminderDetailRow } from "../../infrastructure/database/queries/reminder-query.js";
import { parseDcNoteIds } from "../../utils/dc-note.js";

const BULK_PAYMENT_MIN_COUNT = 5;
const BULK_PAYMENT_RATIO_THRESHOLD = 0.8;

export const reconcilePayment = (
  details: ReminderDetailRow[] | null,
  currentDcNotes: string[]
): {
  paidDcNoteIds: string[];
  bulkPaymentSkipped: boolean;
} => {
  if (!details || details.length === 0) {
    return { paidDcNoteIds: [], bulkPaymentSkipped: false };
  }

  const currentDcNotesSet = new Set(
    currentDcNotes.flatMap((dc) => parseDcNoteIds(dc))
  );

  // Notes that disappeared from staging = newly detected as paid
  const newlyDetectedPaid = details.filter(
    (detail) =>
      !(
        detail.is_paid || currentDcNotesSet.has(detail.dc_note_id.toLowerCase())
      )
  );

  if (newlyDetectedPaid.length === 0) {
    return { paidDcNoteIds: [], bulkPaymentSkipped: false };
  }

  // Safety: don't mark most reminders as paid at once (likely data issue)
  const totalDetails = details.length;

  if (totalDetails > BULK_PAYMENT_MIN_COUNT) {
    const paidRatio = newlyDetectedPaid.length / totalDetails;
    if (paidRatio >= BULK_PAYMENT_RATIO_THRESHOLD) {
      return {
        paidDcNoteIds: [],
        bulkPaymentSkipped: true,
      };
    }
  }

  return {
    paidDcNoteIds: newlyDetectedPaid.map((d) => d.dc_note_id),
    bulkPaymentSkipped: false,
  };
};
