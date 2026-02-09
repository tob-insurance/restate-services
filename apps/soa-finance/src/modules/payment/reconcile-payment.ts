import {
  getUnpaidReminderDetail,
  updatePaymentStatus,
} from "../../infrastructure/database/index.js";

export const reconcilePayment = async (
  reminderId: string,
  currentDcNotes: string[]
): Promise<string[]> => {
  const unpaidDcNotes = await getUnpaidReminderDetail(reminderId);

  const paidDcNotes = unpaidDcNotes.filter(
    (dcNote) =>
      !currentDcNotes.some(
        (pNote) => pNote.toLowerCase() === dcNote.toLowerCase()
      )
  );

  for (const dcNote of paidDcNotes) {
    await updatePaymentStatus(dcNote, "Y");
  }

  return paidDcNotes;
};
