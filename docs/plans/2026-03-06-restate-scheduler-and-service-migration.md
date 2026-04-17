# Restate Scheduler & Service Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace raw `pipelineScheduler` with a durable Restate Virtual Object scheduler, wrap the pipeline in `ctx.run()`, convert `SoaWorkflow` from `workflow` to `service`, and chain pipeline → batch automatically.

**Architecture:** The `SoaScheduler` Virtual Object uses `ctx.sleep()` for durable cron scheduling on Lambda (Lambda suspends during sleep, zero cost). It runs the pipeline inside `ctx.run()`, then fires off `BatchWorkflow`. `SoaWorkflow` becomes `SoaService` (a Restate `service`) because it needs to process the same customer monthly — workflows enforce exactly-once per key which blocks re-execution.

**Safety guardrails (from oracle review):**
- Idempotency keys on service calls (`${accountId}:${timePeriod}:${processingType}`) to prevent duplicate processing
- Retry policy on service definition (preserving the existing maxAttempts: 3)
- Double-start guard on scheduler using `ctx.get("started")` state

**Tech Stack:** Restate SDK (`@restatedev/restate-sdk`), TypeScript, AWS Lambda

---

## Task 1: Convert SoaWorkflow from `workflow` to `service`

**Why:** `workflow.run` executes exactly once per key. Since the same customer is processed monthly, this blocks re-execution. A `service` gives all the same durability (`ctx.run`, retries, journaling) without the exactly-once constraint.

**Files:**
- Modify: `apps/soa-finance/src/modules/soa/workflows/soa-workflow.ts`

**Step 1: Change `workflow` to `service` and update types**

Replace the entire file content:

```typescript
import type { Context } from "@restatedev/restate-sdk";
import { TerminalError, service } from "@restatedev/restate-sdk";

import {
  getAccountById,
  getReminderByCustomerAndPeriod,
} from "../../../infrastructure/database/index.js";
import type { ISoaItem } from "../../../types";
import { processReminderLetter } from "../../reminder";
import { newSoa } from "../services";

type ISoaServiceResult = {
  customerId: string;
  status: "completed" | "failed";
};

export const soaService = service({
  name: "SoaService",
  options: {
    retryPolicy: {
      initialInterval: { seconds: 1 },
      maxInterval: { seconds: 30 },
      maxAttempts: 3,
    },
  },
  handlers: {
    process: async (
      ctx: Context,
      soaParams: ISoaItem
    ): Promise<ISoaServiceResult> => {
      const { customerId, timePeriod, processingType } = soaParams;

      ctx.console.log(`Starting SOA for customer: ${customerId}`);

      const customerData = await ctx.run("get-customer-data", () =>
        getAccountById(customerId)
      );

      if (!customerData) {
        throw new TerminalError(`Customer ${customerId} not found`);
      }

      const existingReminders = await ctx.run(
        "check-soa-history",
        async () =>
          await getReminderByCustomerAndPeriod(customerData.code, timePeriod)
      );

      const isReminderType = processingType !== 1;
      const hasExistingReminder = existingReminders.length > 0;
      const shouldFollowReminderPath = isReminderType || hasExistingReminder;

      if (shouldFollowReminderPath) {
        await processReminderLetter({
          ctx,
          customer: customerData,
          item: soaParams,
        });
      } else {
        await newSoa({
          ctx,
          customerData,
          params: soaParams,
        });
      }

      ctx.console.log(`completed: ${customerId}`);

      return {
        customerId,
        status: "completed",
      };
    },
  },
});

export type SoaService = typeof soaService;
```

**Step 2: Verify it compiles**

Run: `cd apps/soa-finance && bun run typecheck`

There will be errors from downstream files that reference `WorkflowContext` — we fix those in subsequent steps.

---

## Task 2: Update all functions that accept `WorkflowContext` to accept `Context`

**Why:** Functions called by `SoaService` receive `Context` (service context) instead of `WorkflowContext`. Both support `ctx.run()` and `ctx.console.log`. The `Context` type is the base type that `WorkflowContext` extends, so this is a safe widening.

**Files:**
- Modify: `apps/soa-finance/src/modules/soa/services/new-soa.ts`
- Modify: `apps/soa-finance/src/modules/soa/services/process-branches.ts`
- Modify: `apps/soa-finance/src/modules/soa/generate.ts`
- Modify: `apps/soa-finance/src/modules/reminder/process-reminder.ts`
- Modify: `apps/soa-finance/src/modules/reminder/generate-reminder-letter.ts`

**Step 1: Update each file's import and type**

In every file listed above, replace:
```typescript
import type { WorkflowContext } from "@restatedev/restate-sdk";
```
with:
```typescript
import type { Context } from "@restatedev/restate-sdk";
```

And replace all occurrences of `WorkflowContext` in type annotations with `Context`.

Specific changes per file:

**`new-soa.ts`** — change `ctx: WorkflowContext` → `ctx: Context` in type `newSoaParams`

**`process-branches.ts`** — change `ctx: WorkflowContext` → `ctx: Context` in type `ProcessSoaParams`

**`generate.ts`** — change `ctx: WorkflowContext` → `ctx: Context` in type `GenerateSoaOptions`

**`process-reminder.ts`** — change `ctx: WorkflowContext` → `ctx: Context` in type `ProcessReminderParams`

**`generate-reminder-letter.ts`** — change `ctx: WorkflowContext` → `ctx: Context` in:
  - type `GenerateReminderLetterParams`
  - function `validateReminderType` parameter
  - function `getUnpaidSoaData` parameter
  - type `CreateAndSendReminderParams`

**Step 2: Verify it compiles**

Run: `cd apps/soa-finance && bun run typecheck`

---

## Task 3: Update BatchWorkflow to call SoaService instead of SoaWorkflow

**Why:** BatchWorkflow currently uses `ctx.workflowClient(soaWorkflow, accountId).run(...)` which calls a workflow. Since we converted to a service, it needs `ctx.serviceClient(soaService).process(...)`.

**Files:**
- Modify: `apps/soa-finance/src/modules/soa/workflows/batch-workflow.ts`

**Step 1: Update imports**

Replace:
```typescript
import { type SoaWorkflow, soaWorkflow } from "./soa-workflow";
```
with:
```typescript
import { type SoaService, soaService } from "./soa-workflow";
```

Also add `rpc` to the Restate SDK import:
```typescript
import {
  RestatePromise,
  TerminalError,
  workflow,
  rpc,
} from "@restatedev/restate-sdk";
```

**Step 2: Update the `startAccountProcessing` function**

The current code uses `ctx.workflowClient` which returns a keyed workflow promise. With a service, we use `ctx.serviceClient` which returns a regular service call.

Replace `startAccountProcessing`:

```typescript
const startAccountProcessing = (account: IAccount): void => {
  const accountId = account.code;
  const idempotencyKey = `${accountId}:${processingDates.timePeriod}:${soaProcessingType}`;

  const workerPromise = ctx
    .serviceClient<SoaService>(soaService)
    .process(
      {
        customerId: accountId,
        timePeriod: processingDates.timePeriod,
        processingDate: processingDates.processingDate,
        classOfBusiness: soaOptions.classOfBusiness,
        branch: soaOptions.branch,
        toDate: processingDates.toDate,
        processingType: soaProcessingType,
      },
      rpc.opts({ idempotencyKey })
    )
    .map((_value, failure): WorkerResult => {
      if (failure) {
        return { accountId, failed: true, error: failure.message };
      }
      return { accountId, failed: false };
    });

  workerPool.set(accountId, {
    accountId,
    promise: workerPromise,
  });
};
```

**Step 3: Clean up unused import**

Remove `RestatePromise` from imports **only if** it's no longer used elsewhere in the file. Check: `RestatePromise.race` is still used in the while loop, so keep it.

Remove `SoaWorkflow` type import since we now use `SoaService`.

**Step 4: Verify it compiles**

Run: `cd apps/soa-finance && bun run typecheck`

---

## Task 4: Update barrel exports

**Files:**
- Modify: `apps/soa-finance/src/modules/soa/workflows/index.ts`

**Step 1: Update export**

The file currently exports `soaWorkflow`. Update to export the new name:

```typescript
export * from "./batch-workflow";
export * from "./soa-workflow";
```

No change needed — the barrel re-exports everything. The consuming files (`app.lambda.ts`, `app.local.ts`) will be updated in Task 6.

---

## Task 5: Create SoaScheduler Virtual Object

**Why:** Replaces the raw `while(true)` + `setTimeout` scheduler with a durable Restate cron. Uses `ctx.sleep()` which suspends Lambda (zero cost during sleep). Wraps `generateSoaPipeline` in `ctx.run()` for crash recovery. Chains to BatchWorkflow automatically.

**Files:**
- Create: `apps/soa-finance/src/modules/scheduler/soa-scheduler.ts`
- Create: `apps/soa-finance/src/modules/scheduler/index.ts`

**Step 1: Create the Virtual Object**

Create `apps/soa-finance/src/modules/scheduler/soa-scheduler.ts`:

```typescript
import type { ObjectContext, ObjectSharedContext } from "@restatedev/restate-sdk";
import { object, handlers } from "@restatedev/restate-sdk";

import { SCHEDULE_CONFIG } from "../../constants/schedule";
import { generateSoaPipeline } from "../../pipeline/index.js";
import type { SoaType } from "../../types";
import { calculateWaitUntilDay } from "../../utils/formatter";
import { batchWorkflow } from "../soa/workflows/batch-workflow";

type ScheduleInfo = {
  type: string;
  soaType: SoaType;
  waitMs: number;
};

export const soaScheduler = object({
  name: "SoaScheduler",
  handlers: {
    start: async (ctx: ObjectContext): Promise<string> => {
      // Guard against double-start
      const started = await ctx.get<boolean>("started");
      if (started) {
        ctx.console.log("[Scheduler] Already running, ignoring duplicate start");
        return "Scheduler already running";
      }
      ctx.set("started", true);

      const schedule = await ctx.run(
        "calculate-next-schedule",
        (): ScheduleInfo => {
          const scheduleRuns = SCHEDULE_CONFIG.map((s) => ({
            type: s.type,
            soaType: s.soaType,
            waitMs: calculateWaitUntilDay(s.sendDay, 5, 0),
          }));

          scheduleRuns.sort((a, b) => a.waitMs - b.waitMs);
          return scheduleRuns[0];
        }
      );

      ctx.console.log(
        `[Scheduler] Next run: ${schedule.type} in ${Math.round(schedule.waitMs / 3600000)}h`
      );

      // Durable sleep — Lambda suspends, zero cost
      await ctx.sleep(schedule.waitMs);

      ctx.console.log(`[Scheduler] Executing pipeline for: ${schedule.type}`);

      // Run pipeline with crash recovery
      const pipelineResult = await ctx.run("run-pipeline", async () => {
        const result = await generateSoaPipeline(new Date());
        return { success: result.success, duration: result.duration };
      });

      ctx.console.log(
        `[Scheduler] Pipeline completed in ${pipelineResult.duration}`
      );

      // Chain to BatchWorkflow (fire-and-forget)
      const batchId = `batch-${schedule.type}-${ctx.date.now()}`;
      ctx.workflowSendClient(batchWorkflow, batchId).run({
        type: schedule.soaType,
      });

      ctx.console.log(`[Scheduler] Triggered batch: ${batchId}`);

      // Clear started flag before re-invoking so next iteration sets it again
      ctx.clear("started");

      // Re-invoke self for next cycle
      ctx.objectSendClient(soaScheduler, ctx.key).start();

      return `Completed ${schedule.type}, batch ${batchId} triggered`;
    },

    stop: handlers.object.shared(
      async (ctx: ObjectSharedContext): Promise<string> => {
        return "Use Restate admin API to cancel the current invocation";
      }
    ),

    status: handlers.object.shared(
      async (ctx: ObjectSharedContext): Promise<string> => {
        const started = await ctx.get<boolean>("started");
        return started ? "Scheduler is active (sleeping until next run)" : "Scheduler is idle";
      }
    ),
  },
});

export type SoaScheduler = typeof soaScheduler;
```

**Step 2: Create barrel export**

Create `apps/soa-finance/src/modules/scheduler/index.ts`:

```typescript
export { soaScheduler } from "./soa-scheduler";
```

**Step 3: Verify it compiles**

Run: `cd apps/soa-finance && bun run typecheck`

---

## Task 6: Update entry points to register new services

**Files:**
- Modify: `apps/soa-finance/src/app.lambda.ts`
- Modify: `apps/soa-finance/src/app.local.ts`

**Step 1: Update `app.lambda.ts`**

```typescript
import { createEndpointHandler } from "@restatedev/restate-sdk/lambda";
import { initOracleClient } from "./infrastructure/database/database.js";
import { soaScheduler } from "./modules/scheduler/index.js";
import { batchWorkflow } from "./modules/soa/workflows/batch-workflow.js";
import { soaService } from "./modules/soa/workflows/soa-workflow.js";

initOracleClient();

export const handler = createEndpointHandler({
  services: [soaService, batchWorkflow, soaScheduler],
});
```

**Step 2: Update `app.local.ts`**

Remove `pipelineScheduler()` call — the scheduler is now a Restate Virtual Object, not a raw loop.

```typescript
import "varlock/auto-load";
import { serve } from "@restatedev/restate-sdk";
import { initOracleClient } from "./infrastructure/database/database.js";
import { soaScheduler } from "./modules/scheduler/index.js";
import { batchWorkflow } from "./modules/soa/workflows/batch-workflow.js";
import { soaService } from "./modules/soa/workflows/soa-workflow.js";

const PORT = 9080;

async function main() {
  console.log("[App] Testing Oracle connection...");
  await initOracleClient();
  console.log("[App] Oracle connection successful");

  const services = [soaService, batchWorkflow, soaScheduler];

  await serve({
    services,
    port: PORT,
  });

  console.log(`[App] Server started on port ${PORT}`);
  console.log("[App] Registered services:");
  for (const service of services) {
    console.log(`[App]   - ${service.name}`);
  }

  console.log(
    "[App] Trigger scheduler: curl localhost:8080/SoaScheduler/main/start"
  );
}

main().catch((err) => {
  console.error("[App] Failed to start application:", err);
  process.exit(1);
});
```

**Step 3: Verify it compiles**

Run: `cd apps/soa-finance && bun run typecheck`

---

## Task 7: Final verification and lint

**Step 1: Typecheck**

Run: `cd apps/soa-finance && bun run typecheck`
Expected: No errors

**Step 2: Lint**

Run: `bun run check`
Expected: No errors (or fix with `bun run fix`)

**Step 3: Commit**

```bash
git add apps/soa-finance/src/modules/soa/workflows/soa-workflow.ts \
       apps/soa-finance/src/modules/soa/services/new-soa.ts \
       apps/soa-finance/src/modules/soa/services/process-branches.ts \
       apps/soa-finance/src/modules/soa/generate.ts \
       apps/soa-finance/src/modules/reminder/process-reminder.ts \
       apps/soa-finance/src/modules/reminder/generate-reminder-letter.ts \
       apps/soa-finance/src/modules/soa/workflows/batch-workflow.ts \
       apps/soa-finance/src/modules/scheduler/soa-scheduler.ts \
       apps/soa-finance/src/modules/scheduler/index.ts \
       apps/soa-finance/src/app.lambda.ts \
       apps/soa-finance/src/app.local.ts
git commit -m "refactor(soa-finance): migrate to restate service and durable scheduler

- Convert SoaWorkflow to SoaService (service type) for monthly re-execution
- Create SoaScheduler Virtual Object with ctx.sleep() for durable cron
- Wrap pipeline in ctx.run() for crash recovery
- Chain pipeline → BatchWorkflow automatically
- Remove raw while(true) pipelineScheduler"
```

---

## Post-migration: How to use

**Start the scheduler (once, ever):**
```bash
curl localhost:8080/SoaScheduler/main/start
```

This triggers the durable cron loop. On Lambda, it sleeps at zero cost until the next schedule day, then:
1. Runs the pipeline (Oracle → Parquet → S3)
2. Triggers BatchWorkflow
3. Re-invokes itself for the next cycle

**Check scheduler status:**
```bash
curl localhost:8080/SoaScheduler/main/status
```

**Manually trigger batch (if needed):**
```bash
curl localhost:8080/BatchWorkflow/manual-run/run \
  -H 'content-type: application/json' \
  -d '{"type": 1}'
```
