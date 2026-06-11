import type { ObjectContext } from "@restatedev/restate-sdk";
import {
  createReminderDetails,
  upsertReminderHeader,
} from "../../infrastructure/database/queries/reminder-query.js";
import type { Account } from "../../types/customer.type.js";
import { parseDcNoteIds } from "../../utils/dc-note.js";

export interface CreateReminderParams {
  branchCode: string;
  ctx: ObjectContext;
  customer: Account;
  dcNoteNos: string[];
  processingDate: string;
  timePeriod: string;
}

export const createReminder = async (
  params: CreateReminderParams
): Promise<string> => {
  const { customer, timePeriod, branchCode, dcNoteNos, ctx } = params;
  ctx.console.log(
    `[Reminder] Creating SOA reminder for ${customer.code}, branch: ${branchCode}`
  );

  const reminderId = `${timePeriod}:${branchCode}`;
  // Parse all DC note IDs
  const allDcNoteIds: string[] = [];
  for (const dcNoteNo of dcNoteNos) {
    const dcNoteIds = parseDcNoteIds(dcNoteNo);
    allDcNoteIds.push(...dcNoteIds);
  }

  // Batch both DB operations in single ctx.run() to avoid journal bloat
  await ctx.run("create-reminder", async () => {
    await upsertReminderHeader(customer.code, timePeriod, branchCode);
    await createReminderDetails(
      customer.code,
      timePeriod,
      branchCode,
      reminderId,
      allDcNoteIds
    );
  });

  ctx.console.log(
    `[Reminder] Created reminder ${reminderId} with ${dcNoteNos.length} details for ${customer.code}`
  );

  return reminderId;
};
