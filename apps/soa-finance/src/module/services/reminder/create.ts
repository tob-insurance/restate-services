import type { WorkflowContext } from "@restatedev/restate-sdk";
import {
  insertReminder,
  insertReminderDetailsBulk,
} from "../../../infrastructure/database/queries";
import type { IAccount, IStatementOfAccountModel } from "../../utils/types";

export type CreateReminderParams = {
  customer: IAccount;
  timePeriod: string;
  branchCode: string;
  soaList: IStatementOfAccountModel[];
  ctx?: WorkflowContext;
};

export const createReminder = async (
  params: CreateReminderParams
): Promise<string> => {
  const { customer, timePeriod, branchCode, soaList, ctx } = params;
  console.log(
    `Creating SOA reminder for ${customer.code}, branch: ${branchCode}`
  );

  // 1. Insert reminder and get ID (Always deterministic since reminderId is generated inside)
  const reminderId = await (async () => {
    if (ctx) {
      return await ctx.run(
        "insert-reminder-header",
        async () => await insertReminder(customer.code, timePeriod, branchCode)
      );
    }
    return await insertReminder(customer.code, timePeriod, branchCode);
  })();

  // 2. Insert details in chunks using bulk insert (Batch of 5000 is safe and fast)
  const chunkSize = 5000;
  for (let i = 0; i < soaList.length; i += chunkSize) {
    const chunk = soaList.slice(i, i + chunkSize);
    const chunkNo = Math.floor(i / chunkSize) + 1;

    console.log(
      `Inserting reminder details chunk ${chunkNo} (${chunk.length} items)`
    );

    const details = chunk.map((soa) => ({
      dcNoteId: soa.debitAndCreditNoteNo,
      reminderId,
    }));

    if (ctx) {
      await ctx.run(
        `insert-reminder-details-chunk-${chunkNo}`,
        async () => await insertReminderDetailsBulk(details)
      );
    } else {
      await insertReminderDetailsBulk(details);
    }
  }

  console.log(
    `Created reminder ${reminderId} with ${soaList.length} details for ${customer.code}`
  );

  return reminderId;
};
