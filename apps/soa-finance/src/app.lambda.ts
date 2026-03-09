import { createEndpointHandler } from "@restatedev/restate-sdk/lambda";
import { initOracleClient } from "./infrastructure/database/database.js";
import { batchWorkflow } from "./modules/soa/workflows/batch-workflow.js";
import { soaService } from "./modules/soa/workflows/soa-workflow.js";
import { SoaScheduler } from "./pipeline/scheduler.js";

initOracleClient();

export const handler = createEndpointHandler({
  services: [soaService, batchWorkflow, SoaScheduler],
});
