import type { ReminderDetail } from "../soa/objects/state.js";

const BULK_PAYMENT_SAFETY_THRESHOLD = 5;

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
    currentDcNotes.map((dc) => dc.toLowerCase())
  );

  const paidDcNotes = Object.values(details).filter(
    (detail) =>
      !(detail.isPaid || currentDcNotesSet.has(detail.dcNoteId.toLowerCase()))
  );

  if (paidDcNotes.length === 0) {
    return { paidDcNoteIds: [], updatedDetails: {}, bulkPaymentSkipped: false };
  }

  // Safety: don't mark ALL reminders as paid at once (likely data issue)
  if (
    paidDcNotes.length === Object.keys(details).length &&
    paidDcNotes.length > BULK_PAYMENT_SAFETY_THRESHOLD
  ) {
    return { paidDcNoteIds: [], updatedDetails: {}, bulkPaymentSkipped: true };
  }

  const updatedDetails = { ...details };
  for (const paid of paidDcNotes) {
    updatedDetails[paid.dcNoteId] = { ...paid, isPaid: true };
  }

  return {
    paidDcNoteIds: paidDcNotes.map((d) => d.dcNoteId),
    updatedDetails,
    bulkPaymentSkipped: false,
  };
};
