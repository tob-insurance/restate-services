import type { WorkflowContext } from "@restatedev/restate-sdk";
import {
  RestatePromise,
  TerminalError,
  workflow,
} from "@restatedev/restate-sdk";
import { getAllAccounts } from "../../../infrastructure/database/index.js";
import type { IAccount, SoaType } from "../../../types";
import { formatDateToUnixTimestamp, formatTimePeriod } from "../../../utils";
import type { soaSchema } from "../types";
import { type SoaWorkflow, soaWorkflow } from "./soa-workflow";

const MAX_WORKERS = 5;
const PROGRESS_LOG_INTERVAL = 10;

type WorkerResult = {
  accountId: string;
  failed: boolean;
  error?: string;
};

type ActiveWorkerSlot = {
  accountId: string;
  promise: RestatePromise<WorkerResult>;
};

type IBatchWorkflowResult = {
  message: string;
  totalAccounts: number;
  status: "Completed";
};

/**
 * BatchWorkflow - Main workflow for processing Statement of Account (SOA) in batch.
 *
 * Purpose:
 * - Fetch all customer accounts from database
 * - Process each customer in parallel with max worker limit (5 concurrent)
 * - Manage customer queue using worker pool
 * - Return batch status after all customers are processed
 *
 * Related functions:
 * - Calls `getAllAccounts` from queries to fetch customer data
 * - Delegates per-customer processing to `soaWorkflow` as child workflow
 *
 * Process flow:
 * 1. Initialize date parameters (timePeriod, toDate, processingDate) used across services
 * 2. Fetch all customer accounts from database
 * 3. Process customers using worker pool (max 5 concurrent)
 * 4. Return batch result
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
      };

      // STEP 2: Fetch Customer Accounts
      const accountsToProcess = await ctx.run(
        "get-all-accounts",
        async (): Promise<IAccount[]> => {
          const accounts = await getAllAccounts();
          if (!accounts || accounts.length === 0) {
            throw new TerminalError("No customer accounts found");
          }
          return accounts;
        }
      );

      const totalAccounts = accountsToProcess.length;

      ctx.console.log(`Starting batch with ${totalAccounts} accounts`);

      // STEP 3: Process with Worker Pool
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
            classOfBusiness: soaOptions.classOfBusiness,
            branch: soaOptions.branch,
            toDate: processingDates.toDate,
            processingType: soaProcessingType,
          })
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

      // Fill worker pool until full or all accounts have been started
      while (
        workerPool.size < MAX_WORKERS &&
        nextAccountIndex < totalAccounts
      ) {
        startAccountProcessing(accountsToProcess[nextAccountIndex]);
        nextAccountIndex += 1;
      }

      // Process until all accounts are complete
      let failedAccountCount = 0;

      while (workerPool.size > 0) {
        const result = await RestatePromise.race(
          Array.from(workerPool.values()).map((slot) => slot.promise)
        );

        workerPool.delete(result.accountId);
        processedAccountCount += 1;

        if (result.failed) {
          failedAccountCount += 1;
          ctx.console.log(
            `[Batch] Worker failed for ${result.accountId}: ${result.error}`
          );
        }

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
        }
      }

      ctx.console.log(
        `Batch completed: ${processedAccountCount - failedAccountCount} succeeded, ${failedAccountCount} failed, out of ${totalAccounts} accounts`
      );

      return {
        message: "SOA batch processing completed successfully",
        totalAccounts,
        status: "Completed",
      };
    },
  },
});

export type BatchWorkflow = typeof batchWorkflow;
