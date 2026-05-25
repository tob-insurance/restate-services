import type { ObjectContext } from "@restatedev/restate-sdk";
import { SENTINEL_ALL } from "../../constants/constants.js";
import type { IAccount } from "../../types/customer.type.js";
import type { IStatementOfAccountModel } from "../../types/soa.type.js";
import { getStagingSoaData } from "../data-access/staging-reader";
import type { ISoaReminder } from "../reminder/types";
import type { ReminderDetail } from "../soa/objects/state";
import { stateKeys } from "../soa/objects/state";
import { reconcilePayment } from "./reconcile-payment";

export async function getUnpaidSoaData(
  ctx: ObjectContext,
  customer: IAccount,
  reminder: ISoaReminder
): Promise<{
  unpaidItems: IStatementOfAccountModel[];
  dcNotesPaid: string[];
} | null> {
  const branchCode = reminder.officeId || SENTINEL_ALL;

  const soaList = (await ctx.run("read-soa-staging", () =>
    getStagingSoaData(customer.code, branchCode)
  )) as IStatementOfAccountModel[];

  if (soaList.length === 0) {
    return null;
  }

  const currentDcNotes = soaList.map((s) => s.debitAndCreditNoteNo);

  const [timePeriod, officeId] = reminder.id.split(":");
  const details = await ctx.get<Record<string, ReminderDetail>>(
    stateKeys.details(timePeriod, officeId)
  );

  const { paidDcNoteIds, updatedDetails, bulkPaymentSkipped } = await ctx.run(
    "reconcile-payment",
    () => reconcilePayment(details, currentDcNotes)
  );

  if (bulkPaymentSkipped) {
    const detailsCount = Object.keys(details ?? {}).length;
    ctx.console.log(
      `[Payment] Skipping bulk payment: ${detailsCount}/${detailsCount} would be marked paid — possible data issue`
    );
  }

  if (Object.keys(updatedDetails).length > 0) {
    ctx.set(stateKeys.details(timePeriod, officeId), updatedDetails);
  }

  const dcNotesPaid = paidDcNoteIds;

  const paidSet = new Set(dcNotesPaid.map((dc) => dc.toLowerCase()));

  const unpaidDcNotes = currentDcNotes.filter((dc) => {
    const noteIds = (dc || "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    const isProcessed =
      noteIds.length > 0 &&
      noteIds.every((id) => paidSet.has(id.toLowerCase()));

    return !isProcessed;
  });

  if (unpaidDcNotes.length === 0) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: all ${dcNotesPaid.length} DC notes paid`
    );
    return { unpaidItems: [], dcNotesPaid };
  }

  ctx.console.log(
    `[Reminder] DC notes for ${customer.code}: ${dcNotesPaid.length} paid, ${unpaidDcNotes.length} unpaid`
  );

  const unpaidSet = new Set(unpaidDcNotes.map((dc) => dc.toLowerCase()));
  const unpaidItems = soaList.filter((soaItem) => {
    const noteIds = (soaItem.debitAndCreditNoteNo || "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    const isProcessed =
      noteIds.length > 0 &&
      noteIds.every((id) => unpaidSet.has(id.toLowerCase()));

    return isProcessed;
  });

  return { unpaidItems, dcNotesPaid };
}
