import type { CorrelationId } from "../types/branded.js";

export { logger as default } from "@restate-tob/shared/utils";

/**
 * Create structured log context for workflow handlers.
 * Pure function — accepts known values, does NOT call async ctx.get().
 */
export function workflowLog(opts: {
  component: string;
  correlationId?: CorrelationId;
  workflowId?: string;
}) {
  return {
    component: opts.component,
    correlationId: opts.correlationId,
    workflowId: opts.workflowId,
  };
}
