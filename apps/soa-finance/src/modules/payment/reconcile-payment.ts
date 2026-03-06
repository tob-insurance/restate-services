import {
  getUnpaidReminderDetail,
  updatePaymentStatusBulk,
} from "../../infrastructure/database/index.js";

export const reconcilePayment = async (
  reminderId: string,
  currentDcNotes: string[]
): Promise<string[]> => {
  const unpaidDcNotes = await getUnpaidReminderDetail(reminderId);

  const currentDcNotesSet = new Set(
    currentDcNotes.map((dc) => dc.toLowerCase())
  );

  const paidDcNotes = unpaidDcNotes.filter(
    (dcNote) => !currentDcNotesSet.has(dcNote.toLowerCase())
  );

  await updatePaymentStatusBulk(paidDcNotes, "Y");

  return paidDcNotes;
};
