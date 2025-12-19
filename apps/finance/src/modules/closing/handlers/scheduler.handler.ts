import { type ObjectContext, object } from "@restatedev/restate-sdk";
import { DateTime } from "luxon";
import { JAKARTA_ZONE } from "../../../constants.js";
import { dailyClosingWorkflow } from "../workflows/index.js";

const TIME_FORMAT_REGEX = /^(\d{1,2}):(\d{2})$/;

function getScheduleConfig() {
  const scheduleTime = process.env.DAILY_CLOSING_SCHEDULE_TIME || "00:00";
  const timeMatch = scheduleTime.match(TIME_FORMAT_REGEX);

  if (!timeMatch) {
    throw new Error(
      `Invalid DAILY_CLOSING_SCHEDULE_TIME: "${scheduleTime}". Expected format: HH:mm (e.g., "02:30", "14:00")`
    );
  }

  const hour = Number.parseInt(timeMatch[1], 10);
  const minute = Number.parseInt(timeMatch[2], 10);

  if (hour < 0 || hour > 23) {
    throw new Error(
      `Invalid hour in DAILY_CLOSING_SCHEDULE_TIME: "${scheduleTime}". Hour must be 0-23.`
    );
  }

  if (minute < 0 || minute > 59) {
    throw new Error(
      `Invalid minute in DAILY_CLOSING_SCHEDULE_TIME: "${scheduleTime}". Minute must be 0-59.`
    );
  }

  return { hour, minute };
}

const SCHEDULE_CONFIG = getScheduleConfig();

console.log(
  `📅 Daily closing scheduled for ${String(SCHEDULE_CONFIG.hour).padStart(2, "0")}:${String(SCHEDULE_CONFIG.minute).padStart(2, "0")} Jakarta Time`
);

export const DailyClosingScheduler = object({
  name: "DailyClosingScheduler",
  handlers: {
    start: async (ctx: ObjectContext) => {
      ctx.console.log("🚀 Starting DailyClosingScheduler");
      await scheduleNextRun(ctx);
    },

    trigger: async (ctx: ObjectContext) => {
      const nowJakarta = DateTime.fromMillis(await ctx.date.now()).setZone(
        JAKARTA_ZONE
      );
      const dateStr = nowJakarta.toFormat("yyyy-MM-dd");

      ctx.console.log(
        `⏰ Triggering Daily Closing Workflow for date: ${dateStr}`
      );

      ctx.workflowSendClient(dailyClosingWorkflow, dateStr).run({
        date: dateStr,
        skipOracleClosing: false,
        skipFinancialMetrics: false,
        userId: "adm",
      });

      await scheduleNextRun(ctx);
    },
  },
});

async function scheduleNextRun(ctx: ObjectContext) {
  const currentTime = await ctx.date.now();
  const nowJakarta = DateTime.fromMillis(currentTime).setZone(JAKARTA_ZONE);

  ctx.console.log(
    `[DEBUG] Current Time (UTC): ${DateTime.fromMillis(currentTime).toISO()}`
  );
  ctx.console.log(
    `[DEBUG] Current Jakarta Time: ${nowJakarta.toFormat("yyyy-MM-dd HH:mm")}`
  );

  let targetTime = nowJakarta.set({
    hour: SCHEDULE_CONFIG.hour,
    minute: SCHEDULE_CONFIG.minute,
    second: 0,
    millisecond: 0,
  });

  if (targetTime <= nowJakarta) {
    targetTime = targetTime.plus({ days: 1 });
  }

  const delayMs = targetTime.diff(nowJakarta, "milliseconds").milliseconds;
  const targetTimeStr = `${targetTime.toFormat("yyyy-MM-dd HH:mm")} (Jakarta Time)`;

  ctx.console.log(
    `📅 Next run scheduled for: ${targetTimeStr} (in ${Math.round(delayMs / 1000 / 60)} minutes)`
  );

  ctx
    .objectSendClient(DailyClosingScheduler, "main", { delay: delayMs })
    .trigger();
}
