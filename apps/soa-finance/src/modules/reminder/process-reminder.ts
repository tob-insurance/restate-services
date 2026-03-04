import type { WorkflowContext } from "@restatedev/restate-sdk";

import { getReminderByCustomerAndPeriod } from "../../infrastructure/database/index.js";
import { type IAccount, type ISoaItem, SoaType } from "../../types";
import { generateReminderLetter } from "./generate-reminder-letter";
import type { IProcessReminder, ISoaReminder } from "./types";

type ProcessReminderParams = {
  ctx: WorkflowContext;
  customer: IAccount;
  item: ISoaItem;
};

export const processReminderLetter = async (
  params: ProcessReminderParams
): Promise<IProcessReminder> => {
  const { ctx, customer, item } = params;

  ctx.console.log(
    `[Reminder] Processing for ${customer.code}, type: ${
      SoaType[item.processingType]
    }`
  );

  const reminders = (await ctx.run("get-reminders-by-customer-period", () =>
    getReminderByCustomerAndPeriod(customer.code, item.timePeriod)
  )) as ISoaReminder[];

  if (!reminders || reminders.length === 0) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: no previous reminder records`
    );
    return { processed: false, remindersSent: 0, dcNotesPaid: [] };
  }

  const allDcNotesPaid: string[] = [];
  let remindersSent = 0;

  for (const reminder of reminders) {
    const result = await generateReminderLetter({
      ctx,
      customer,
      reminder,
      item,
    });

    if (result) {
      if (result.sent) {
        remindersSent += 1;
      }
      if (result.dcNotesPaid?.length > 0) {
        allDcNotesPaid.push(...result.dcNotesPaid);
      }
    }
  }

  return { processed: true, remindersSent, dcNotesPaid: allDcNotesPaid };
};
