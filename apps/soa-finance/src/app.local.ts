import { serve } from "@restatedev/restate-sdk";
import { batchWorkflow, soaWorkflow } from "./engine/index.js";
import { initOracleClient } from "./infrastructure/database/database.js";
import { pipelineScheduler } from "./pipeline/scheduler.js";

const PORT = 9080;

async function main() {
  console.log("Testing Oracle connection...");
  await initOracleClient();
  console.log("✅ Oracle connection successful");

  const services = [soaWorkflow, batchWorkflow];

  await serve({
    services,
    port: PORT,
  });

  console.log(`✅ Server started on port ${PORT}`);
  console.log("Registered services:");
  for (const service of services) {
    console.log(`  - ${service.name}`);
  }

  await pipelineScheduler();
  console.log("✅ Pipeline scheduler started");
}

main().catch((err) => {
  console.error("Failed to start application:", err);
  process.exit(1);
});
