import type { ObjectContext } from "@restatedev/restate-sdk";
import type { IAccount, IStatementOfAccountModel } from "../../types";
import type { ReminderDetail, ReminderHeader } from "../soa/objects/state";
import { stateKeys } from "../soa/objects/state";

export type CreateReminderParams = {
  ctx: ObjectContext;
  customer: IAccount;
  timePeriod: string;
  branchCode: string;
  soaList: IStatementOfAccountModel[];
};

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
    createdAt: new Date().toISOString(),
  };
  ctx.set(stateKeys.header(timePeriod, branchCode), header);

  const detailsMap: Record<string, ReminderDetail> = {};
  const newIndexEntries: Record<string, string> = {};

  for (const soa of soaList) {
    const dcNoteId = soa.debitAndCreditNoteNo;
    detailsMap[dcNoteId] = {
      dcNoteId,
      reminderId,
      isPaid: false,
    };
    newIndexEntries[dcNoteId] = reminderId;
  }

  const existingIndex =
    (await ctx.get<Record<string, string>>(stateKeys.dcNoteIndex)) ?? {};
  const mergedIndex = { ...existingIndex, ...newIndexEntries };

  ctx.set(stateKeys.details(timePeriod, branchCode), detailsMap);
  ctx.set(stateKeys.dcNoteIndex, mergedIndex);

  ctx.console.log(
    `[Reminder] Created reminder ${reminderId} with ${soaList.length} details for ${customer.code}`
  );

  return reminderId;
};
