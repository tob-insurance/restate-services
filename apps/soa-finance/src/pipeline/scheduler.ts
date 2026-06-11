import {
  type ObjectContext,
  object,
  rpc,
  TerminalError,
} from "@restatedev/restate-sdk";
import { DateTime } from "luxon";
import { TIMEZONE } from "../constants/constants.js";
import { SCHEDULE_CONFIG, type ScheduleConfig } from "../constants/schedule.js";
import { batchWorkflow } from "../modules/soa/workflows/batch-workflow.js";
import { formatDuration } from "../utils/formatter/date.formatter.js";
import { generateSoaPipeline } from "./index.js";

export interface ScheduleTriggerResult {
  pipelineDuration: string;
  scheduleName: string;
  soaType: number;
}

export interface ScheduledTriggerPayload {
  scheduledFor: number; // ctx.date.now() timestamp when this run was scheduled
  scheduleName: string;
  soaType: number;
  version: 1;
}

interface NextRun {
  delayMs: number;
  schedule: ScheduleConfig;
  targetTime: DateTime;
}

export function computeNextRun(
  now: DateTime,
  schedules: ScheduleConfig[]
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
      const alreadyStarted = await ctx.get<boolean>("started");
      if (alreadyStarted) {
        ctx.console.log(
          "SoaScheduler already running — skipping duplicate start"
        );
        return;
      }
      ctx.set("started", true);
      ctx.console.log("Starting SoaScheduler");
      await scheduleNextRun(ctx);
    },

    trigger: async (
      ctx: ObjectContext,
      scheduled?: ScheduledTriggerPayload
    ): Promise<ScheduleTriggerResult> => {
      const now = DateTime.fromMillis(await ctx.date.now()).setZone(TIMEZONE);

      // Use scheduledFor for timing if present (late invocation recovery)
      // Fall back to now for backward compat with legacy scheduled payloads
      const referenceTime = scheduled?.scheduledFor
        ? DateTime.fromMillis(scheduled.scheduledFor).setZone(TIMEZONE)
        : now;

      const schedule = scheduled
        ? SCHEDULE_CONFIG.find((s) => s.soaType === scheduled.soaType)
        : SCHEDULE_CONFIG.find((s) => s.sendDay === now.day);

      if (!schedule) {
        const reason = scheduled
          ? `soaType ${scheduled.soaType} (${scheduled.scheduleName})`
          : `day ${now.day}`;
        throw new TerminalError(`No schedule configured for ${reason}`);
      }

      ctx.console.log(
        `Trigger fired for ${schedule.type} (scheduled for ${referenceTime.toFormat("yyyy-MM-dd HH:mm")}, actual ${now.toFormat("yyyy-MM-dd HH:mm")})`
      );

      // Schedule next run BEFORE pipeline so chain is not broken on failure
      await scheduleNextRun(ctx);

      // Use referenceTime so late invocations still use intended schedule
      return runPipelineAndBatch(ctx, referenceTime, schedule);
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
  schedule: ScheduleConfig
): Promise<ScheduleTriggerResult> {
  ctx.console.log(
    `Triggering ${schedule.type} (soaType ${schedule.soaType}): pipeline + batch`
  );

  const pipelineStartTime = await ctx.date.now();

  // No local timeout: a native setTimeout isn't durable (every replay arms a
  // fresh timer) and can't cancel the refresh anyway — the statement timeout
  // and the refresh manager's inactivity timeout already bound the work.
  const pipelineResult = await generateSoaPipeline(ctx, now.toJSDate());

  if (!pipelineResult.success) {
    throw new Error(
      `Pipeline returned success: false — aborting batch for ${schedule.type}`
    );
  }
  const pipelineEndTime = await ctx.date.now();
  const pipelineDuration = formatDuration(pipelineEndTime - pipelineStartTime);

  ctx.console.log(`Pipeline completed in ${pipelineDuration}, starting batch`);

  const workflowId = `${schedule.type}-${now.toFormat("yyyy-MM-dd")}`;

  try {
    await ctx
      .workflowSendClient(batchWorkflow, workflowId)
      .run({ type: schedule.soaType });
    ctx.console.log(`Batch workflow enqueued: ${workflowId}`);
  } catch (error: unknown) {
    ctx.console.log(
      `[ERROR] Failed to enqueue batch workflow ${workflowId}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    throw error;
  }

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

  const payload: ScheduledTriggerPayload = {
    version: 1,
    soaType: nextRun.schedule.soaType,
    scheduleName: nextRun.schedule.type,
    scheduledFor: nextRun.targetTime.toMillis(),
  };

  try {
    await ctx
      .objectSendClient(SoaScheduler, "main")
      .trigger(
        payload,
        rpc.sendOpts({ delay: { milliseconds: nextRun.delayMs } })
      );
    ctx.console.log(`Next run scheduled: ${nextRun.schedule.type}`);
  } catch (error: unknown) {
    ctx.console.log(
      `[ERROR] Failed to schedule next run: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    throw error;
  }
}

export type SoaSchedulerType = typeof SoaScheduler;
