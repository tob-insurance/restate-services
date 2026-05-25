import { type ObjectContext, object, rpc } from "@restatedev/restate-sdk";
import { DateTime } from "luxon";
import { DAILY_CLOSING_SCHEDULE_TIME, TIMEZONE } from "../../../constants.js";
import { dailyClosingWorkflow } from "../workflows/daily-closing.workflow.js";

function getScheduleConfig() {
  const [hourStr, minuteStr] = DAILY_CLOSING_SCHEDULE_TIME.split(":");
  return {
    hour: Number.parseInt(hourStr, 10),
    minute: Number.parseInt(minuteStr, 10),
  };
}

export const DailyClosingScheduler = object({
  name: "DailyClosingScheduler",
  handlers: {
    start: async (ctx: ObjectContext) => {
      const alreadyStarted = await ctx.get<boolean>("started");
      if (alreadyStarted) {
        ctx.console.log(
          "DailyClosingScheduler already running — skipping duplicate start"
        );
        return;
      }
      ctx.set("started", true);
      ctx.console.log("🚀 Starting DailyClosingScheduler");
      await scheduleNextRun(ctx);
    },

    trigger: async (ctx: ObjectContext) => {
      const now = DateTime.fromMillis(await ctx.date.now()).setZone(TIMEZONE);
      const dateStr = now.toFormat("yyyy-MM-dd");

      ctx.console.log(
        `⏰ Triggering Daily Closing Workflow for date: ${dateStr}`
      );

      await scheduleNextRun(ctx);

      try {
        await ctx.workflowSendClient(dailyClosingWorkflow, dateStr).run({
          date: dateStr,
          skipGeniusClosing: false,
          skipFinancialMetrics: false,
          userId: "adm",
        });
        ctx.console.log(`Daily closing workflow enqueued for ${dateStr}`);
      } catch (error: unknown) {
        ctx.console.log(
          `[ERROR] Failed to enqueue daily closing for ${dateStr}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
        throw error;
      }
    },
  },
});

async function scheduleNextRun(ctx: ObjectContext) {
  const scheduleConfig = getScheduleConfig();
  const currentTime = await ctx.date.now();
  const now = DateTime.fromMillis(currentTime).setZone(TIMEZONE);

  ctx.console.log(
    `[DEBUG] Current Time (UTC): ${DateTime.fromMillis(currentTime).toISO()}`
  );
  ctx.console.log(
    `[DEBUG] Current Local Time: ${now.toFormat("yyyy-MM-dd HH:mm")}`
  );

  let targetTime = now.set({
    hour: scheduleConfig.hour,
    minute: scheduleConfig.minute,
    second: 0,
    millisecond: 0,
  });

  if (targetTime <= now) {
    targetTime = targetTime.plus({ days: 1 });
  }

  const delayMs = targetTime.diff(now, "milliseconds").milliseconds;
  const targetTimeStr = `${targetTime.toFormat("yyyy-MM-dd HH:mm")} (${TIMEZONE})`;

  ctx.console.log(
    `📅 Next run scheduled for: ${targetTimeStr} (in ${Math.round(delayMs / 1000 / 60)} minutes)`
  );

  try {
    await ctx
      .objectSendClient(DailyClosingScheduler, "main")
      .trigger(rpc.sendOpts({ delay: { milliseconds: delayMs } }));
  } catch (error: unknown) {
    ctx.console.log(
      `[ERROR] Failed to schedule next closing run: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    throw error;
  }
}
