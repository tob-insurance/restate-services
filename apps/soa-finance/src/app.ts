import { serve } from "@restatedev/restate-sdk";
import { batchWorkflow, soaWorkflow } from "./engine";

serve({
  services: [soaWorkflow, batchWorkflow],
  port: 9080,
});
