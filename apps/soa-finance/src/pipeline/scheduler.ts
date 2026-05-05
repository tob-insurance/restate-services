import {
  type ObjectContext,
  object,
  TerminalError,
} from "@restatedev/restate-sdk";
import { DateTime } from "luxon";
import {
  type IScheduleConfig,
  SCHEDULE_CONFIG,
  TIMEZONE,
} from "../constants/index.js";
import { batchWorkflow } from "../modules/soa/workflows/batch-workflow.js";
import type { SoaType } from "../types/index.js";
import { formatDuration } from "../utils/index.js";
import { generateSoaPipeline } from "./index.js";

type ScheduleTriggerResult = {
  pipelineDuration: string;
  soaType: number;
  scheduleName: string;
};

type NextRun = {
  schedule: IScheduleConfig;
  targetTime: DateTime;
  delayMs: number;
};

export function computeNextRun(
  now: DateTime,
  schedules: IScheduleConfig[]
): NextRun {
  const sortedSchedules = [...schedules].sort((a, b) => a.sendDay - b.sendDay);

  for (const schedule of sortedSchedules) {
    const candidate = now.set({
      day: schedule.sendDay,
      hour: 1,
      minute: 0,
      second: 0,
      millisecond: 0,
    });

    if (candidate.isValid && candidate > now) {
      return {
        schedule,
        targetTime: candidate,
        delayMs: candidate.diff(now, "milliseconds").milliseconds,
      };
    }
  }

  const nextMonth = now.plus({ months: 1 }).startOf("month");

  for (const schedule of sortedSchedules) {
    const candidate = nextMonth.set({
      day: schedule.sendDay,
      hour: 1,
      minute: 0,
      second: 0,
      millisecond: 0,
    });

    if (candidate.isValid) {
      return {
        schedule,
        targetTime: candidate,
        delayMs: candidate.diff(now, "milliseconds").milliseconds,
      };
    }
  }

  throw new TerminalError("No valid future schedule could be computed");
}

export const SoaScheduler = object({
  name: "SoaScheduler",
  handlers: {
    start: async (ctx: ObjectContext) => {
      ctx.console.log("Starting SoaScheduler");
      await scheduleNextRun(ctx);
    },

    trigger: async (
      ctx: ObjectContext,
      scheduled?: { soaType: SoaType; scheduleName: string }
    ): Promise<ScheduleTriggerResult> => {
      const now = DateTime.fromMillis(await ctx.date.now()).setZone(TIMEZONE);
      const currentDay = now.day;

      const schedule = scheduled
        ? SCHEDULE_CONFIG.find((s) => s.soaType === scheduled.soaType)
        : SCHEDULE_CONFIG.find((s) => s.sendDay === currentDay);

      if (!schedule) {
        const reason = scheduled
          ? `soaType ${scheduled.soaType} (${scheduled.scheduleName})`
          : `day ${currentDay}`;
        throw new TerminalError(`No schedule configured for ${reason}`);
      }

      // Schedule next run BEFORE the pipeline and batch so that even if either
      // fails, the chain is not broken. Restate ensures this journaled send is
      // not duplicated on handler retry.
      await scheduleNextRun(ctx);

      return runPipelineAndBatch(ctx, now, schedule);
    },

    manualTrigger: async (
      ctx: ObjectContext,
      soaType: number
    ): Promise<ScheduleTriggerResult> => {
      const schedule = SCHEDULE_CONFIG.find((s) => s.soaType === soaType);

      if (!schedule) {
        throw new TerminalError(
          `Invalid soaType: ${soaType}. Valid values: ${SCHEDULE_CONFIG.map((s) => `${s.soaType} (${s.type})`).join(", ")}`
        );
      }

      const now = DateTime.fromMillis(await ctx.date.now()).setZone(TIMEZONE);
      return runPipelineAndBatch(ctx, now, schedule);
    },
  },
});

async function runPipelineAndBatch(
  ctx: ObjectContext,
  now: DateTime,
  schedule: IScheduleConfig
): Promise<ScheduleTriggerResult> {
  ctx.console.log(
    `Triggering ${schedule.type} (soaType ${schedule.soaType}): pipeline + batch`
  );

  const pipelineStartTime = await ctx.date.now();

  // Wrap the pipeline in ctx.run() so Oracle reads and storage uploads are journaled.
  await ctx.run("generate-soa-pipeline", () =>
    generateSoaPipeline(now.toJSDate())
  );
  const pipelineEndTime = await ctx.date.now();
  const pipelineDuration = formatDuration(pipelineEndTime - pipelineStartTime);

  ctx.console.log(`Pipeline completed in ${pipelineDuration}, starting batch`);

  const workflowId = `${schedule.type}-${now.toFormat("yyyy-MM-dd")}`;

  ctx
    .workflowSendClient(batchWorkflow, workflowId)
    .run({ type: schedule.soaType });

  ctx.console.log(`Batch workflow started: ${workflowId}`);

  return {
    pipelineDuration,
    soaType: schedule.soaType,
    scheduleName: schedule.type,
  };
}

async function scheduleNextRun(ctx: ObjectContext) {
  const currentTime = await ctx.date.now();
  const now = DateTime.fromMillis(currentTime).setZone(TIMEZONE);
  const nextRun = computeNextRun(now, SCHEDULE_CONFIG);

  ctx.console.log(
    `Next run: ${nextRun.schedule.type} on ${nextRun.targetTime.toFormat("yyyy-MM-dd HH:mm")} (${TIMEZONE}, in ${Math.round(nextRun.delayMs / 1000 / 60 / 60)} hours)`
  );

  ctx
    .objectSendClient(SoaScheduler, "main", { delay: nextRun.delayMs })
    .trigger({
      soaType: nextRun.schedule.soaType,
      scheduleName: nextRun.schedule.type,
    });
}

export type SoaSchedulerType = typeof SoaScheduler;
