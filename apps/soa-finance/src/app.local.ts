import "varlock/auto-load";
import { serve } from "@restatedev/restate-sdk";
import {
  initPostgresClient,
  testPostgresConnection,
} from "./infrastructure/database/postgres.js";
import { sharedServices } from "./services.js";
import {
  checkGotenbergConnectivity,
  checkS3BucketAccess,
} from "./utils/health.js";
import logger from "./utils/logger.js";

const PORT = 9080;

async function main() {
  logger.info({ component: "App" }, "Testing PostgreSQL connection...");
  initPostgresClient();

  const postgres = await testPostgresConnection();
  if (!postgres) {
    logger.error(
      { component: "App" },
      "⚠️  PostgreSQL connection failed, but server will continue..."
    );
  }

  const [s3Ok, gotenbergOk] = await Promise.all([
    checkS3BucketAccess(),
    checkGotenbergConnectivity(),
  ]);
  logger.info(
    {
      component: "HealthCheck",
      postgres: !!postgres,
      s3: s3Ok,
      gotenberg: gotenbergOk,
    },
    "External service health"
  );

  await serve({
    services: sharedServices,
    port: PORT,
  });

  logger.info({ component: "App", port: PORT }, "Server started");
  logger.info({ component: "App" }, "Registered services");
  for (const service of sharedServices) {
    logger.info(
      { component: "App", service: service.name },
      "Registered service"
    );
  }
}

main().catch((err) => {
  logger.error({ component: "App", err }, "Failed to start application");
  process.exit(1);
});
