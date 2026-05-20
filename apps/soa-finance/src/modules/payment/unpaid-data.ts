import type { ObjectContext } from "@restatedev/restate-sdk";
import { SENTINEL_ALL } from "../../constants/constants.js";
import type { IAccount } from "../../types/customer.type.js";
import type { IStatementOfAccountModel } from "../../types/soa.type.js";
import { getStagingSoaData } from "../data-access/staging-reader";
import type { ISoaReminder } from "../reminder/types";
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

  const soaList = await ctx.run("read-soa-staging", { timeout: 30_000 }, () =>
    getStagingSoaData(customer.code, branchCode)
  );

  if (soaList.length === 0) {
    return null;
  }

  const currentDcNotes = soaList.map((s) => s.debitAndCreditNoteNo);
  const dcNotesPaid = await reconcilePayment(ctx, reminder.id, currentDcNotes);

  const paidSet = new Set(dcNotesPaid.map((dc) => dc.toLowerCase()));

  const unpaidDcNotes = currentDcNotes.filter(
    (dc) => !paidSet.has(dc.toLowerCase())
  );

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
  const unpaidItems = soaList.filter((soaItem) =>
    unpaidSet.has(soaItem.debitAndCreditNoteNo.toLowerCase())
  );

  return { unpaidItems, dcNotesPaid };
}
