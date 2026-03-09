import "varlock/auto-load";
import { serve } from "@restatedev/restate-sdk";
import { initOracleClient } from "./infrastructure/database/database.js";
import { batchWorkflow } from "./modules/soa/workflows/batch-workflow.js";
import { soaService } from "./modules/soa/workflows/soa-workflow.js";

const PORT = 9080;

async function main() {
  console.log("[App] Testing Oracle connection...");
  await initOracleClient();
  console.log("[App] Oracle connection successful");

  const services = [soaService, batchWorkflow];

  await serve({
    services,
    port: PORT,
  });

  console.log(`[App] Server started on port ${PORT}`);
  console.log("[App] Registered services:");
  for (const service of services) {
    console.log(`[App]   - ${service.name}`);
  }
}

main().catch((err) => {
  console.error("[App] Failed to start application:", err);
  process.exit(1);
});
