import "varlock/auto-load";
import { serve } from "@restatedev/restate-sdk";
import {
  initOracleClient,
  testOracleConnection,
} from "./infrastructure/database/database.js";
import { sharedServices } from "./services.js";

const PORT = 9080;

async function main() {
  console.log("[App] Testing Oracle connection...");
  initOracleClient();

  const oracle = await testOracleConnection();
  if (!oracle) {
    console.error("⚠️  Oracle connection failed, but server will continue...");
  }

  await serve({
    services: sharedServices,
    port: PORT,
  });

  console.log(`[App] Server started on port ${PORT}`);
  console.log("[App] Registered services:");
  for (const service of sharedServices) {
    console.log(`[App]   - ${service.name}`);
  }
}

main().catch((err) => {
  console.error("[App] Failed to start application:", err);
  process.exit(1);
});
