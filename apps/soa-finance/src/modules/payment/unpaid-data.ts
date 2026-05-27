import type { ObjectContext } from "@restatedev/restate-sdk";
import { SENTINEL_ALL } from "../../constants/constants.js";
import type { Account } from "../../types/customer.type.js";
import type { StatementOfAccountModel } from "../../types/soa.type.js";
import { areAllDcNotesPaid } from "../../utils/dc-note.js";
import { getStagingSoaData } from "../data-access/staging-reader.js";
import type { SoaReminder } from "../reminder/types.js";
import type { ReminderDetail } from "../soa/objects/state.js";
import { stateKeys } from "../soa/objects/state.js";
import { reconcilePayment } from "./reconcile-payment.js";

export async function getUnpaidSoaData(
  ctx: ObjectContext,
  customer: Account,
  reminder: SoaReminder
): Promise<{
  unpaidItems: StatementOfAccountModel[];
  dcNotesPaid: string[];
} | null> {
  const branchCode = reminder.officeId || SENTINEL_ALL;

  const soaList = await ctx.run("read-soa-staging", () =>
    getStagingSoaData(customer.code, branchCode)
  );

  if (soaList.length === 0) {
    return null;
  }

  const currentDcNotes = soaList.map((s) => s.debitAndCreditNoteNo);

  const parts = reminder.id.split(":");
  if (parts.length !== 2) {
    throw new Error(`Invalid reminder ID format: ${reminder.id}`);
  }
  const [timePeriod, officeId] = parts;
  const details = await ctx.get<Record<string, ReminderDetail>>(
    stateKeys.details(timePeriod, officeId)
  );

  const { paidDcNoteIds, updatedDetails, bulkPaymentSkipped } =
    reconcilePayment(details, currentDcNotes);

  if (bulkPaymentSkipped) {
    const detailsCount = Object.keys(details ?? {}).length;
    ctx.console.log(
      `[Payment] Skipping bulk payment: all ${detailsCount} details would be marked paid — possible data issue`
    );
  }

  if (Object.keys(updatedDetails).length > 0) {
    ctx.set(stateKeys.details(timePeriod, officeId), updatedDetails);
  }

  const paidSet = new Set(paidDcNoteIds.map((dc) => dc.toLowerCase()));

  // Filter unpaid items directly using the helper — handles comma-separated DC notes correctly
  const unpaidItems = soaList.filter(
    (soaItem) => !areAllDcNotesPaid(soaItem.debitAndCreditNoteNo, paidSet)
  );

  if (unpaidItems.length === 0) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: all ${paidDcNoteIds.length} DC notes paid`
    );
    return { unpaidItems: [], dcNotesPaid: paidDcNoteIds };
  }

  ctx.console.log(
    `[Reminder] DC notes for ${customer.code}: ${paidDcNoteIds.length} paid, ${unpaidItems.length} items unpaid`
  );

  return { unpaidItems, dcNotesPaid: paidDcNoteIds };
}
