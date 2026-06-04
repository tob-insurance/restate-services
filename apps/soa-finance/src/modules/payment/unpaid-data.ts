import type { ObjectContext } from "@restatedev/restate-sdk";
import { SENTINEL_ALL } from "../../constants/constants.js";
import {
  getReminderDetails,
  markDcNotesAsPaid,
} from "../../infrastructure/database/queries/reminder-query.js";
import type { Account } from "../../types/customer.type.js";
import { areAllDcNotesPaid } from "../../utils/dc-note.js";
import { getStagingSoaData } from "../data-access/staging-reader.js";
import type { SoaReminder } from "../reminder/types.js";
import { reconcilePayment } from "./reconcile-payment.js";

export async function getUnpaidSoaData(
  ctx: ObjectContext,
  customer: Account,
  reminder: SoaReminder
): Promise<{
  branchName: string;
  unpaidCount: number;
} | null> {
  const branchCode = reminder.officeId || SENTINEL_ALL;

  // Parse reminder ID once
  const parts = reminder.id.split(":");
  if (parts.length !== 2) {
    throw new Error(`Invalid reminder ID format: ${reminder.id}`);
  }
  const [timePeriod, officeId] = parts;

  // All processing inside ctx.run() — return only minimal result to avoid journal bloat
  const result = await ctx.run("process-unpaid-data", async () => {
    const [soaList, details] = await Promise.all([
      getStagingSoaData(customer.code, branchCode),
      getReminderDetails(customer.code, timePeriod, officeId),
    ]);

    if (soaList.length === 0) {
      return null;
    }

    const currentDcNotes = soaList.map((s) => s.debitAndCreditNoteNo);
    const { paidDcNoteIds, bulkPaymentSkipped } = reconcilePayment(
      details,
      currentDcNotes
    );

    if (bulkPaymentSkipped) {
      // Log inside callback — won't appear in journal but helps debugging
      console.warn(`[Payment] Skipping bulk payment for ${customer.code}`);
    }

    // Update paid status in PostgreSQL
    if (paidDcNoteIds.length > 0) {
      await markDcNotesAsPaid(customer.code, paidDcNoteIds);
    }

    const paidSet = new Set(paidDcNoteIds.map((dc) => dc.toLowerCase()));
    const unpaidItems = soaList.filter(
      (soaItem) => !areAllDcNotesPaid(soaItem.debitAndCreditNoteNo, paidSet)
    );

    // Return only minimal data — not full soaList
    const branchName = unpaidItems.length > 0 ? unpaidItems[0].branch : "";
    return {
      branchName,
      unpaidCount: unpaidItems.length,
    };
  });

  if (!result) {
    return null;
  }

  const { branchName, unpaidCount } = result;

  if (unpaidCount === 0) {
    ctx.console.log(`[Reminder] Skipping ${customer.code}: all DC notes paid`);
  } else {
    ctx.console.log(
      `[Reminder] DC notes for ${customer.code}: ${unpaidCount} items unpaid`
    );
  }

  return { branchName, unpaidCount };
}
