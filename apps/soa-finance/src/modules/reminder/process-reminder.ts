import type { ObjectContext } from "@restatedev/restate-sdk";
import type { IAccount } from "../../types/customer.type.js";
import { type ISoaItem, SoaTypeLabels } from "../../types/soa.type.js";
import type { ReminderHeader } from "../soa/objects/state";
import { readDcNoteIndex, stateKeys } from "../soa/objects/state";
import { generateReminderLetter } from "./generate-reminder-letter";
import type { IProcessReminder } from "./types";

type ProcessReminderParams = {
  ctx: ObjectContext;
  customer: IAccount;
  item: ISoaItem;
};

type SoaReminder = {
  id: string;
  customerCode: string;
  timePeriod: string;
  officeId: string;
};

export const processReminderLetter = async (
  params: ProcessReminderParams
): Promise<IProcessReminder> => {
  const { ctx, customer, item } = params;

  ctx.console.log(
    `[Reminder] Processing for ${customer.code}, type: ${
      SoaTypeLabels[item.processingType]
    }`
  );

  const dcNoteIndex = await readDcNoteIndex(ctx, item.timePeriod);

  if (Object.keys(dcNoteIndex).length === 0) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: no previous reminder records`
    );
    return { processed: false, remindersSent: 0, dcNotesPaid: [] };
  }

  const reminderIdsForPeriod = new Set(
    Object.values(dcNoteIndex).filter((id) =>
      id.startsWith(`${item.timePeriod}:`)
    )
  );

  if (reminderIdsForPeriod.size === 0) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: no reminders for period ${item.timePeriod}`
    );
    return { processed: false, remindersSent: 0, dcNotesPaid: [] };
  }

  const reminders: SoaReminder[] = [];
  for (const reminderId of reminderIdsForPeriod) {
    const [officeId] = reminderId.split(":").slice(1);
    const header = await ctx.get<ReminderHeader>(
      stateKeys.header(item.timePeriod, officeId)
    );
    if (header) {
      reminders.push({
        id: reminderId,
        customerCode: header.customerCode,
        timePeriod: header.timePeriod,
        officeId: header.officeId,
      });
    }
  }

  if (reminders.length === 0) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: no reminder headers found`
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
