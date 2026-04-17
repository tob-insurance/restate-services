import "varlock/auto-load";
import { serve } from "@restatedev/restate-sdk";
import {
  initOracleClient,
  testOracleConnection,
} from "./infrastructure/database/database.js";
import { batchWorkflow } from "./modules/soa/workflows/batch-workflow.js";
import { soaService } from "./modules/soa/workflows/soa-workflow.js";
import { SoaScheduler } from "./pipeline/scheduler.js";

const PORT = 9080;

async function main() {
  console.log("[App] Testing Oracle connection...");
  initOracleClient();

  const oracle = await testOracleConnection();
  if (!oracle) {
    console.error("⚠️  Oracle connection failed, but server will continue...");
  }

  const services = [soaService, batchWorkflow, SoaScheduler];

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
