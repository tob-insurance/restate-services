import { parseDcNoteIds } from "../../utils/dc-note.js";
import type { ReminderDetail } from "../soa/objects/state.js";

const BULK_PAYMENT_MIN_COUNT = 5;
const BULK_PAYMENT_RATIO_THRESHOLD = 0.8;

export const reconcilePayment = (
  details: Record<string, ReminderDetail> | null,
  currentDcNotes: string[]
): {
  paidDcNoteIds: string[];
  updatedDetails: Record<string, ReminderDetail>;
  bulkPaymentSkipped: boolean;
} => {
  if (!details) {
    return { paidDcNoteIds: [], updatedDetails: {}, bulkPaymentSkipped: false };
  }

  const currentDcNotesSet = new Set(
    currentDcNotes.flatMap((dc) => parseDcNoteIds(dc))
  );

  // Notes that disappeared from staging = newly detected as paid
  const newlyDetectedPaid = Object.values(details).filter(
    (detail) =>
      !(detail.isPaid || currentDcNotesSet.has(detail.dcNoteId.toLowerCase()))
  );

  if (newlyDetectedPaid.length === 0) {
    return { paidDcNoteIds: [], updatedDetails: {}, bulkPaymentSkipped: false };
  }

  // Safety: don't mark most reminders as paid at once (likely data issue)
  const totalDetails = Object.keys(details).length;

  if (totalDetails > BULK_PAYMENT_MIN_COUNT) {
    const paidRatio = newlyDetectedPaid.length / totalDetails;
    if (paidRatio >= BULK_PAYMENT_RATIO_THRESHOLD) {
      return {
        paidDcNoteIds: [],
        updatedDetails: {},
        bulkPaymentSkipped: true,
      };
    }
  }

  const updatedDetails = { ...details };
  for (const paid of newlyDetectedPaid) {
    updatedDetails[paid.dcNoteId] = { ...paid, isPaid: true };
  }

  return {
    paidDcNoteIds: newlyDetectedPaid.map((d) => d.dcNoteId),
    updatedDetails,
    bulkPaymentSkipped: false,
  };
};
