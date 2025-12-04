import * as restate from "@restatedev/restate-sdk";
import { testConnection } from "./db";
import { testOracleConnection } from "./oracle";
import { dailyClosingWorkflow } from "./workflows/dailyClosing";
import { DailyClosingScheduler } from "./services/scheduler";

Promise.all([
  testConnection(),
  testOracleConnection(),
]).then(([pgConnected, oracleConnected]) => {
  if (!pgConnected) {
    console.error('⚠️  PostgreSQL connection failed, but server will continue...');
  }
  if (!oracleConnected) {
    console.error('⚠️  Oracle connection failed, but server will continue...');
  }

  restate.serve({
    services: [dailyClosingWorkflow, DailyClosingScheduler],
    port: 9080,
  });

  console.log('✅ Server started on port 9080');
  console.log('   - DailyClosing Workflow');
  console.log('   - DailyClosing Scheduler (Virtual Object)');
});
