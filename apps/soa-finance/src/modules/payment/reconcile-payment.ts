import type { ObjectContext } from "@restatedev/restate-sdk";
import type { ReminderDetail } from "../soa/objects/state";
import { stateKeys } from "../soa/objects/state";

export const reconcilePayment = async (
  ctx: ObjectContext,
  reminderId: string,
  currentDcNotes: string[]
): Promise<string[]> => {
  const [timePeriod, officeId] = reminderId.split(":");

  const details = await ctx.get<Record<string, ReminderDetail>>(
    stateKeys.details(timePeriod, officeId)
  );

  if (!details) {
    return [];
  }

  const currentDcNotesSet = new Set(
    currentDcNotes.map((dc) => dc.toLowerCase())
  );

  const paidDcNotes = Object.values(details).filter(
    (detail) =>
      !(detail.isPaid || currentDcNotesSet.has(detail.dcNoteId.toLowerCase()))
  );

  if (paidDcNotes.length === 0) {
    return [];
  }

  // Safety: don't mark ALL reminders as paid at once (likely data issue)
  if (
    paidDcNotes.length === Object.keys(details).length &&
    paidDcNotes.length > 5
  ) {
    ctx.console.log(
      `[Payment] Skipping bulk payment: ${paidDcNotes.length}/${Object.keys(details).length} would be marked paid — possible data issue`
    );
    return [];
  }

  const updatedDetails = { ...details };
  for (const paid of paidDcNotes) {
    updatedDetails[paid.dcNoteId] = { ...paid, isPaid: true };
  }
  ctx.set(stateKeys.details(timePeriod, officeId), updatedDetails);

  return paidDcNotes.map((d) => d.dcNoteId);
};
