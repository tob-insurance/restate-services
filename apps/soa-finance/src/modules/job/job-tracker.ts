import type { WorkflowContext } from "@restatedev/restate-sdk";
import {
  completeJobPhase,
  insertJobPhase,
} from "../../infrastructure/database/index.js";
import type { SoaPhase } from "../../types";

export async function trackPhase<T>(
  ctx: WorkflowContext,
  jobId: string,
  phase: SoaPhase,
  fn: () => Promise<T>
): Promise<T> {
  await ctx.run(`phase-${phase}-start`, () => insertJobPhase(jobId, phase));
  const result = await fn();
  await ctx.run(`phase-${phase}-complete`, () =>
    completeJobPhase(jobId, phase)
  );
  return result;
}
