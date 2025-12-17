import { serve } from "@restatedev/restate-sdk";
import { testConnections } from "./infrastructure/database.js";
import {
  DailyClosingScheduler,
  dailyClosingWorkflow,
} from "./modules/closing/index.js";

testConnections().then(({ postgres, oracle }) => {
  if (!postgres) {
    console.error(
      "⚠️  PostgreSQL connection failed, but server will continue..."
    );
  }
  if (!oracle) {
    console.error("⚠️  Oracle connection failed, but server will continue...");
  }

  serve({
    services: [dailyClosingWorkflow, DailyClosingScheduler],
    port: 9080,
  });

  console.log("✅ Server started on port 9080");
  console.log("   - DailyClosing Workflow");
  console.log("   - DailyClosing Scheduler (Virtual Object)");
});
