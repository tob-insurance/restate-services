import { createEndpointHandler } from "@restatedev/restate-sdk/lambda";
import { initOracleClient } from "./infrastructure/database/database.js";
import { batchWorkflow, soaWorkflow } from "./modules/soa/workflows/index.js";

initOracleClient();

export const handler = createEndpointHandler({
  services: [soaWorkflow, batchWorkflow],
});
