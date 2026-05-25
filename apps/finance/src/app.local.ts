import "dotenv/config";
import { serve } from "@restatedev/restate-sdk";
import { testConnection } from "./infrastructure/database.js";
import {
  DailyClosingScheduler,
  dailyClosingWorkflow,
} from "./modules/closing/index.js";
import logger from "./utils/logger.js";

testConnection().then((postgres) => {
  if (!postgres) {
    logger.error(
      { component: "App" },
      "⚠️  PostgreSQL connection failed, but server will continue..."
    );
  }

  serve({
    services: [dailyClosingWorkflow, DailyClosingScheduler],
    port: 9080,
  });

  logger.info({ component: "App", port: 9080 }, "Server started");
  logger.info({ component: "App" }, "Registered services");
  logger.info(
    { component: "App", service: "DailyClosing" },
    "Registered service"
  );
  logger.info(
    { component: "App", service: "DailyClosingScheduler" },
    "Registered service"
  );
});
