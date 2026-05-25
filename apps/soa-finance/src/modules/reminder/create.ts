import type { ObjectContext } from "@restatedev/restate-sdk";
import type { Account } from "../../types/customer.type.js";
import type { StatementOfAccountModel } from "../../types/soa.type.js";
import type { ReminderDetail, ReminderHeader } from "../soa/objects/state.js";
import { stateKeys } from "../soa/objects/state.js";

export interface CreateReminderParams {
  branchCode: string;
  ctx: ObjectContext;
  customer: Account;
  processingDate: string;
  soaList: StatementOfAccountModel[];
  timePeriod: string;
}

export const createReminder = async (
  params: CreateReminderParams
): Promise<string> => {
  const { customer, timePeriod, branchCode, soaList, ctx } = params;
  ctx.console.log(
    `[Reminder] Creating SOA reminder for ${customer.code}, branch: ${branchCode}`
  );

  const reminderId = `${timePeriod}:${branchCode}`;

  const header: ReminderHeader = {
    customerCode: customer.code,
    timePeriod,
    officeId: branchCode,
    createdAt: params.processingDate,
  };
  ctx.set(stateKeys.header(timePeriod, branchCode), header);

  const detailsMap: Record<string, ReminderDetail> = {};
  const newIndexEntries: Record<string, string> = {};

  for (const soa of soaList) {
    const dcNoteIds = (soa.debitAndCreditNoteNo || "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    for (const dcNoteId of dcNoteIds) {
      detailsMap[dcNoteId] = { dcNoteId, reminderId, isPaid: false };
      newIndexEntries[dcNoteId] = reminderId;
    }
  }

  const existingIndex =
    (await ctx.get<Record<string, string>>(
      stateKeys.dcNoteIndex(timePeriod)
    )) ?? {};
  const mergedIndex = { ...existingIndex, ...newIndexEntries };

  ctx.set(stateKeys.details(timePeriod, branchCode), detailsMap);
  ctx.set(stateKeys.dcNoteIndex(timePeriod), mergedIndex);

  ctx.console.log(
    `[Reminder] Created reminder ${reminderId} with ${soaList.length} details for ${customer.code}`
  );

  return reminderId;
};
