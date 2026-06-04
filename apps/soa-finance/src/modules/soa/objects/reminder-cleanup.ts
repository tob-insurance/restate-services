import { type ObjectContext, object } from "@restatedev/restate-sdk";
import { DateTime } from "luxon";
import { TIMEZONE } from "../../../constants/constants.js";
import { executeQuery } from "../../../infrastructure/database/postgres.js";
import logger from "../../../utils/logger.js";

/**
 * ReminderCleanup — scheduled cleanup service for old reminder data.
 *
 * Runs daily at 2 AM to delete reminder data older than 3 months.
 * Uses Restate's self-scheduling pattern.
 */
export const reminderCleanup = object({
  name: "ReminderCleanup",
  handlers: {
    start: async (ctx: ObjectContext) => {
      const alreadyStarted = await ctx.get<boolean>("started");
      if (alreadyStarted) {
        ctx.console.log(
          "ReminderCleanup already running — skipping duplicate start"
        );
        return;
      }
      ctx.set("started", true);
      ctx.console.log("Starting ReminderCleanup");
      await scheduleNextCleanup(ctx);
    },

    cleanup: async (ctx: ObjectContext) => {
      ctx.console.log("Starting reminder cleanup");

      const now = DateTime.now().setZone(TIMEZONE);
      const cutoffDate = now.minus({ months: 3 }).toISODate();

      if (!cutoffDate) {
        ctx.console.log("Failed to compute cutoff date");
        return;
      }

      ctx.console.log(`Cleaning up reminders older than ${cutoffDate}`);

      const result = await ctx.run("delete-old-reminders", () =>
        deleteOldRemindersByDate(cutoffDate)
      );

      ctx.console.log(
        `Cleanup completed: ${result.deletedCount} records deleted`
      );

      // Schedule next cleanup
      await scheduleNextCleanup(ctx);
    },
  },
});

async function deleteOldRemindersByDate(
  cutoffDate: string
): Promise<{ deletedCount: number }> {
  // Delete details first (foreign key)
  const detailsResult = await executeQuery(
    "DELETE FROM soa_reminder_details WHERE created_at < $1::date",
    [cutoffDate]
  );

  // Delete headers
  const headersResult = await executeQuery(
    "DELETE FROM soa_reminder_headers WHERE created_at < $1::date",
    [cutoffDate]
  );

  const deletedCount =
    (detailsResult.rowCount ?? 0) + (headersResult.rowCount ?? 0);

  logger.info(
    { component: "ReminderCleanup", cutoffDate, deletedCount },
    "Reminder cleanup completed"
  );

  return { deletedCount };
}

async function scheduleNextCleanup(ctx: ObjectContext): Promise<void> {
  const now = DateTime.now().setZone(TIMEZONE);
  const nextRun = now
    .plus({ days: 1 })
    .set({ hour: 2, minute: 0, second: 0, millisecond: 0 });
  const delayMs = nextRun.diff(now, "milliseconds").milliseconds;

  ctx.console.log(`Next cleanup scheduled for ${nextRun.toISO()}`);

  // Sleep until next cleanup time, then trigger cleanup
  await ctx.sleep(delayMs);
  ctx.objectSendClient(reminderCleanup, "self").cleanup();
}

export type ReminderCleanup = typeof reminderCleanup;
