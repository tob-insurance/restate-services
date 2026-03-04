import type { WorkflowContext } from "@restatedev/restate-sdk";
import { RestatePromise, workflow } from "@restatedev/restate-sdk";
import {
  getAllAccounts,
  insertBatch,
  updateBatchStatus,
} from "../../../infrastructure/database/index.js";
import type { IAccount, SoaType } from "../../../types";
import {
  formatDateToUnixTimestamp,
  formatTimePeriod,
  formatUUID,
} from "../../../utils";
import type { soaSchema } from "../types";
import { type SoaWorkflow, soaWorkflow } from "./soa-workflow";

const MAX_WORKERS = 10;
const PROGRESS_LOG_INTERVAL = 10;

type ActiveWorkerSlot = {
  accountId: string;
  promise: RestatePromise<string>;
};

type IBatchWorkflowResult = {
  batchId: string;
  message: string;
  totalAccounts: number;
  status: "Completed";
};

/**
 * BatchWorkflow - Main workflow for processing Statement of Account (SOA) in batch.
 *
 * Purpose:
 * - Fetch all customer accounts from database
 * - Create a new batch record for tracking process status
 * - Process each customer in parallel with max worker limit (10 concurrent)
 * - Manage customer queue using worker pool
 * - Return batch status after all customers are processed
 *
 * Related functions:
 * - Calls `getAllAccounts` from queries to fetch customer data
 * - Calls `insertBatch` to create a new batch record in database
 * - Calls `updateBatchStatus` to update batch status (Processing → Completed)
 * - Delegates per-customer processing to `soaWorkflow` as child workflow
 *
 * Process flow:
 * 1. Initialize date parameters (timePeriod, toDate, processingDate) used across services
 * 2. Fetch all customer accounts from database
 * 3. Create batch record with status "Queued"
 * 4. Update batch status to "Processing"
 * 5. Process customers using worker pool (max 10 concurrent)
 * 6. Update batch status to "Completed"
 * 7. Return batch result
 */

export const batchWorkflow = workflow({
  name: "BatchWorkflow",
  handlers: {
    run: async (
      ctx: WorkflowContext,
      soaRequest: soaSchema
    ): Promise<IBatchWorkflowResult> => {
      // STEP 1: Initialize Date Parameters
      const processingDates = await ctx.run("initialize-dates", () => {
        const currentDate = new Date();
        return {
          timePeriod: formatTimePeriod(currentDate),
          toDate: formatDateToUnixTimestamp(currentDate),
          processingDate: currentDate.toISOString(),
        };
      });

      const soaProcessingType = soaRequest.type as SoaType;
      const soaOptions = {
        classOfBusiness: "ALL",
        branch: "ALL",
        skipAgingFilter: soaRequest.skipAgingFilter ?? false,
        skipDcNoteCheck: soaRequest.skipDcNoteCheck ?? false,
      };

      // STEP 2: Fetch Customer Accounts
      const accountsToProcess = await ctx.run(
        "get-all-accounts",
        async (): Promise<IAccount[]> => {
          const accounts = await getAllAccounts();
          if (!accounts || accounts.length === 0) {
            throw new Error("No customer accounts found");
          }
          return accounts;
        }
      );

      const totalAccounts = accountsToProcess.length;

      // STEP 3: Create Batch Record
      const batchId = formatUUID(ctx.rand.uuidv4());
      await ctx.run("create-batch", async () => {
        await insertBatch(batchId, totalAccounts, "Queued");
      });

      ctx.console.log(`start: ${batchId} with ${totalAccounts} accounts`);

      // STEP 4: Update Status to Processing
      await ctx.run("processing-status-update", async () => {
        await updateBatchStatus(batchId, "Processing");
      });

      // STEP 5: Process with Worker Pool
      const workerPool: Map<string, ActiveWorkerSlot> = new Map();
      let nextAccountIndex = 0;
      let processedAccountCount = 0;

      /**
       * Start SOA processing for a single customer account.
       *
       * Purpose:
       * - Create a workflow client for the customer based on accountId
       * - Call soaWorkflow.run() with complete parameters
       * - Register the promise in worker pool for tracking
       *
       * Related functions:
       * - Called by main loop whenever a worker slot is available
       * - Uses `soaWorkflow` as child workflow for detailed processing
       * - The created promise will be raced to detect completion
       */
      const startAccountProcessing = (account: IAccount): void => {
        const accountId = account.code;

        const workerPromise = ctx
          .workflowClient<SoaWorkflow>(soaWorkflow, accountId)
          .run({
            customerId: accountId,
            timePeriod: processingDates.timePeriod,
            processingDate: processingDates.processingDate,
            batchId,
            classOfBusiness: soaOptions.classOfBusiness,
            branch: soaOptions.branch,
            toDate: processingDates.toDate,
            processingType: soaProcessingType,
            skipAgingFilter: soaOptions.skipAgingFilter,
            skipDcNoteCheck: soaOptions.skipDcNoteCheck,
          })
          .map(() => accountId);

        workerPool.set(accountId, {
          accountId,
          promise: workerPromise,
        });
      };

      // Fill worker pool until full or all accounts have been started
      while (
        workerPool.size < MAX_WORKERS &&
        nextAccountIndex < totalAccounts
      ) {
        startAccountProcessing(accountsToProcess[nextAccountIndex]);
        nextAccountIndex += 1;
        // Delay 30 seconds between customers to reduce database load
        // await ctx.sleep(30_000);
      }

      // Process until all accounts are complete
      while (workerPool.size > 0) {
        // Wait for any worker to finish
        const completedAccountId = await RestatePromise.race(
          Array.from(workerPool.values()).map((slot) => slot.promise)
        );

        // Remove from pool and update counter
        workerPool.delete(completedAccountId);
        processedAccountCount += 1;

        // Log progress every N accounts
        if (processedAccountCount % PROGRESS_LOG_INTERVAL === 0) {
          ctx.console.log(
            `[Batch] Progress: ${processedAccountCount}/${totalAccounts}`
          );
        }

        // Start processing next account if available
        if (nextAccountIndex < totalAccounts) {
          startAccountProcessing(accountsToProcess[nextAccountIndex]);
          nextAccountIndex += 1;
          // Delay 30 seconds between customers to reduce database load
          // await ctx.sleep(30_000);
        }
      }

      // STEP 6: Update Status to Completed
      await ctx.run("completed-status-update", async () => {
        await updateBatchStatus(batchId, "Completed");
      });

      ctx.console.log(
        `${batchId} completed, processed: ${processedAccountCount} accounts`
      );

      // STEP 7: Return Batch Result
      return {
        batchId,
        message: "SOA batch processing completed successfully",
        totalAccounts,
        status: "Completed",
      };
    },
  },
});

export type BatchWorkflow = typeof batchWorkflow;
