import { serve } from "@restatedev/restate-sdk";
import { batchWorkflow } from "./module/workflows/batch-workflow";
import { soaWorkflow } from "./module/workflows/soa-workflow";

serve({
  services: [soaWorkflow, batchWorkflow],
  port: 9080,
});
