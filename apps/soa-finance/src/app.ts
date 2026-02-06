import { serve } from "@restatedev/restate-sdk";
import { batchWorkflow, soaWorkflow } from "./engine";
import { pipelineScheduler } from "./pipeline/scheduler";

serve({
  services: [soaWorkflow, batchWorkflow],
  port: 9080,
});

pipelineScheduler().catch((err) => {
  console.error("Failed to start pipeline scheduler:", err);
});
