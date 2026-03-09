import {
  type ObjectContext,
  object,
  TerminalError,
} from "@restatedev/restate-sdk";
import { DateTime } from "luxon";
import { SCHEDULE_CONFIG, TIMEZONE } from "../constants/index.js";
import { batchWorkflow } from "../modules/soa/workflows/batch-workflow.js";
import { generateSoaPipeline } from "./index.js";

type ScheduleTriggerResult = {
  pipelineDuration: string;
  soaType: number;
  scheduleName: string;
};

export const SoaScheduler = object({
  name: "SoaScheduler",
  handlers: {
    start: async (ctx: ObjectContext) => {
      ctx.console.log("Starting SoaScheduler");
      await scheduleNextRun(ctx);
    },

    trigger: async (ctx: ObjectContext): Promise<ScheduleTriggerResult> => {
      const now = DateTime.fromMillis(await ctx.date.now()).setZone(TIMEZONE);
      const currentDay = now.day;

      const schedule = SCHEDULE_CONFIG.find((s) => s.sendDay === currentDay);

      if (!schedule) {
        throw new TerminalError(`No schedule configured for day ${currentDay}`);
      }

      ctx.console.log(
        `Triggering ${schedule.type} (day ${currentDay}): pipeline + batch`
      );

      // Phase 1: Run data pipeline (Oracle → Parquet → S3)
      const pipelineResult = await ctx.run(
        "run-pipeline",
        async () => await generateSoaPipeline(now.toJSDate())
      );

      ctx.console.log(
        `Pipeline completed in ${pipelineResult.duration}, starting batch`
      );

      // Phase 2: Trigger batch workflow with the scheduled SOA type
      const workflowId = `${schedule.type}-${now.toFormat("yyyy-MM-dd")}`;

      ctx
        .workflowSendClient(batchWorkflow, workflowId)
        .run({ type: schedule.soaType });

      ctx.console.log(`Batch workflow started: ${workflowId}`);

      // Schedule next run
      await scheduleNextRun(ctx);

      return {
        pipelineDuration: pipelineResult.duration,
        soaType: schedule.soaType,
        scheduleName: schedule.type,
      };
    },
  },
});

async function scheduleNextRun(ctx: ObjectContext) {
  const currentTime = await ctx.date.now();
  const now = DateTime.fromMillis(currentTime).setZone(TIMEZONE);

  const sortedDays = SCHEDULE_CONFIG.map((s) => s.sendDay).sort(
    (a, b) => a - b
  );

  // Find the next sendDay after today
  let targetDay = sortedDays.find((day) => day > now.day);
  let targetMonth = now;

  if (!targetDay) {
    // All sendDays this month have passed — move to next month's first sendDay
    targetDay = sortedDays[0];
    targetMonth = now.plus({ months: 1 });
  }

  const targetTime = targetMonth.set({
    day: targetDay,
    hour: 1,
    minute: 0,
    second: 0,
    millisecond: 0,
  });

  const delayMs = targetTime.diff(now, "milliseconds").milliseconds;
  const schedule = SCHEDULE_CONFIG.find((s) => s.sendDay === targetDay);

  ctx.console.log(
    `Next run: ${schedule?.type} on ${targetTime.toFormat("yyyy-MM-dd HH:mm")} (${TIMEZONE}, in ${Math.round(delayMs / 1000 / 60 / 60)} hours)`
  );

  ctx.objectSendClient(SoaScheduler, "main", { delay: delayMs }).trigger();
}

export type SoaSchedulerType = typeof SoaScheduler;
