import type {
  WorkflowContext,
  WorkflowSharedContext,
} from "@restatedev/restate-sdk";
import { DateTime } from "luxon";
import { getCalculationRunStatus } from "../../financial-metrics/index.js";
import type { WorkflowState, WorkflowStatus } from "./workflow-types.js";

export async function updateWorkflowState(
  ctx: WorkflowContext,
  updates: Partial<WorkflowState>
) {
  const currentState = (await ctx.get<WorkflowState>("state")) ?? {
    currentStep: "idle",
    lastUpdate: "",
  };

  ctx.set("state", {
    ...currentState,
    ...updates,
    lastUpdate: DateTime.fromMillis(await ctx.date.now()).toISO() ?? "",
  });
}

export async function getStatus(
  ctx: WorkflowSharedContext
): Promise<WorkflowStatus> {
  const state = (await ctx.get<WorkflowState>("state")) ?? {
    currentStep: "idle" as const,
    lastUpdate: "",
  };

  let metricsProgress: WorkflowStatus["metricsProgress"] = null;

  if (state.metricsRunId) {
    const metricsRunId = state.metricsRunId;
    const runStatus = await ctx.run(
      "get-metrics-status",
      async () => await getCalculationRunStatus(metricsRunId)
    );
    if (runStatus) {
      metricsProgress = {
        status: runStatus.status,
        completedSteps: runStatus.completedSteps,
        totalSteps: runStatus.totalSteps,
        errorCount: runStatus.errorCount,
        warningCount: runStatus.warningCount,
      };
    }
  }

  return {
    workflowId: ctx.key,
    currentStep: state.currentStep,
    geniusJobName: state.geniusJobName,
    metricsRunId: state.metricsRunId,
    metricsProgress,
    stepStartTime: state.stepStartTime,
    lastUpdate: state.lastUpdate,
  };
}
