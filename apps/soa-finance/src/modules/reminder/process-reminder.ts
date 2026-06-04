import type { ObjectContext } from "@restatedev/restate-sdk";
import {
  getReminderHeadersForPeriod,
  getReminderIdsForPeriod,
} from "../../infrastructure/database/queries/reminder-query.js";
import type { Account } from "../../types/customer.type.js";
import { type SoaItem, SoaTypeLabels } from "../../types/soa.type.js";
import { generateReminderLetter } from "./generate-reminder-letter.js";
import type { ProcessReminder } from "./types.js";

interface ProcessReminderParams {
  ctx: ObjectContext;
  customer: Account;
  item: SoaItem;
}

interface SoaReminder {
  customerCode: string;
  id: string;
  officeId: string;
  timePeriod: string;
}

export const processReminderLetter = async (
  params: ProcessReminderParams
): Promise<ProcessReminder> => {
  const { ctx, customer, item } = params;

  ctx.console.log(
    `[Reminder] Processing for ${customer.code}, type: ${
      SoaTypeLabels[item.processingType]
    }`
  );

  // Combined read: reminder IDs + headers in single ctx.run()
  const { reminderIds, reminderHeaders } = await ctx.run(
    "get-reminder-ids-and-headers",
    async () => {
      const [ids, headers] = await Promise.all([
        getReminderIdsForPeriod(customer.code, item.timePeriod),
        getReminderHeadersForPeriod(customer.code, item.timePeriod),
      ]);
      return { reminderIds: ids, reminderHeaders: headers };
    }
  );

  if (reminderIds.length === 0) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: no reminders for period ${item.timePeriod}`
    );
    return { processed: false, remindersSent: 0 };
  }

  const reminders: SoaReminder[] = reminderHeaders.map((header) => ({
    id: `${header.time_period}:${header.office_id}`,
    customerCode: header.customer_code,
    timePeriod: header.time_period,
    officeId: header.office_id,
  }));

  if (reminders.length === 0) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: no reminder headers found`
    );
    return { processed: false, remindersSent: 0 };
  }

  let remindersSent = 0;

  for (const reminder of reminders) {
    const result = await generateReminderLetter({
      ctx,
      customer,
      item,
      reminder,
    });

    if (result?.sent) {
      remindersSent += 1;
    }
  }

  return { processed: true, remindersSent };
};
