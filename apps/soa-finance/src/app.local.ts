import "varlock/auto-load";
import { serve } from "@restatedev/restate-sdk";
import { initOracleClient } from "./infrastructure/database/database.js";
import { batchWorkflow, soaWorkflow } from "./modules/soa/workflows/index.js";
import { pipelineScheduler } from "./pipeline/scheduler.js";

const PORT = 9080;

async function main() {
  console.log("[App] Testing Oracle connection...");
  await initOracleClient();
  console.log("[App] Oracle connection successful");

  const services = [soaWorkflow, batchWorkflow];

  await serve({
    services,
    port: PORT,
  });

  console.log(`[App] Server started on port ${PORT}`);
  console.log("[App] Registered services:");
  for (const service of services) {
    console.log(`[App]   - ${service.name}`);
  }

  await pipelineScheduler();
  console.log("[App] Pipeline scheduler started");
}

main().catch((err) => {
  console.error("[App] Failed to start application:", err);
  process.exit(1);
});
