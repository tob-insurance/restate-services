/**
 * Run the reminder schedule (RL1, RL2, RL3)
 * Waits for interval then sends reminder if outstanding reminders exist
 */

import type { WorkflowContext } from "@restatedev/restate-sdk";

import {
  getAllBranches,
  getReminderByCustomerAndPeriod,
} from "../../../infrastructure/database/queries";
import { processReminderLetter } from "../../services";

import type { IAccount, ISoaItem, SoaType } from "../../utils/types";

export type ReminderScheduleParams = {
  ctx: WorkflowContext;
  customerData: IAccount;
  params: ISoaItem;
};

export async function runReminderSchedule({
  ctx,
  customerData,
  params,
}: ReminderScheduleParams): Promise<number> {
  const reminderInterval = params.testMode
    ? 2 * 60 * 1000 // 2 minutes for testing
    : 14 * 24 * 60 * 60 * 1000; // 2 weeks for production

  const maxReminders = 3;
  let currentReminderCount = 0;

  ctx.console.log(
    `Starting reminder schedule, interval: ${
      params.testMode ? "2 minutes" : "2 weeks"
    }`
  );

  // Map reminder count to SoaType (RL1=2, RL2=3, RL3=4)
  const reminderTypeMap: Record<number, SoaType> = { 1: 2, 2: 3, 3: 4 };

  while (currentReminderCount < maxReminders) {
    ctx.console.log(`Waiting for RL${currentReminderCount + 1}...`);

    await ctx.sleep(reminderInterval);

    const outstandingReminders = await ctx.run(
      `check-payment-rl${currentReminderCount + 1}`,
      async () =>
        await getReminderByCustomerAndPeriod(
          customerData.code,
          params.timePeriod
        )
    );

    if (!outstandingReminders || outstandingReminders.length === 0) {
      ctx.console.log("All SOA paid, stopping reminders");
      break;
    }

    currentReminderCount += 1;
    const reminderType: SoaType = reminderTypeMap[currentReminderCount] ?? 4;

    ctx.console.log(`Processing RL${currentReminderCount}`);

    const branchesForReminder = await ctx.run(
      `get-branches-for-reminder-rl${currentReminderCount}`,
      async () => await getAllBranches()
    );

    const reminderProcessingItem: ISoaItem = {
      ...params,
      processingType: reminderType,
    };

    await ctx.run(
      `send-reminder-rl${currentReminderCount}`,
      async () =>
        await processReminderLetter({
          customer: customerData,
          branches: branchesForReminder,
          item: reminderProcessingItem,
        })
    );

    ctx.console.log(`RL${currentReminderCount} completed`);
  }

  ctx.console.log(
    `Reminder schedule completed, sent ${currentReminderCount} reminders`
  );

  return currentReminderCount;
}
