import { serve } from "@restatedev/restate-sdk";
import { testOracleConnection } from "./oracle";
import { testConnection } from "./pg";
import { DailyClosingScheduler } from "./services/scheduler";
import { dailyClosingWorkflow } from "./workflows/daily-closing";

Promise.all([testConnection(), testOracleConnection()]).then(
  ([pgConnected, oracleConnected]) => {
    if (!pgConnected) {
      console.error(
        "⚠️  PostgreSQL connection failed, but server will continue..."
      );
    }
    if (!oracleConnected) {
      console.error("⚠️  Oracle connection failed, but server will continue...");
    }

    serve({
      services: [dailyClosingWorkflow, DailyClosingScheduler],
      port: 9080,
      // identityKeys: ['']
    });

    console.log("✅ Server started on port 9080");
    console.log("   - DailyClosing Workflow");
    console.log("   - DailyClosing Scheduler (Virtual Object)");
  }
);
