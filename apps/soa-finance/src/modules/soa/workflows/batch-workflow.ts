import type { WorkflowContext } from "@restatedev/restate-sdk";
import {
  RestatePromise,
  rpc,
  TerminalError,
  workflow,
} from "@restatedev/restate-sdk";
import { isDevelopment } from "../../../constants";
import { getAllAccounts } from "../../../infrastructure/database/index.js";
import type { IAccount, SoaType } from "../../../types";
import { formatDateToUnixTimestamp, formatTimePeriod } from "../../../utils";
import { soaCustomer } from "../objects/soa-customer";
import { soaSchema } from "../types";

const DEV_TEST_CUSTOMER_CODES = [
  "00004162",
  "00004829",
  "00005017",
  "00003758",
  "00003390",
  "00002844",
];

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
 * - Delegates per-customer processing to `SoaCustomer` virtual objects
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
      // Validate input
      const parseResult = soaSchema.safeParse(soaRequest);
      if (!parseResult.success) {
        throw new TerminalError(
          `Invalid SOA request: ${parseResult.error.message}`
        );
      }

      // STEP 1: Initialize Date Parameters
      const processingDates = await ctx.run("initialize-dates", () => {
        const currentDate = new Date();
        return {
          timePeriod: formatTimePeriod(currentDate),
          toDate: formatDateToUnixTimestamp(currentDate),
          processingDate: currentDate.toISOString(),
        };
      });

      const soaProcessingType = parseResult.data.type as SoaType;
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

          if (isDevelopment()) {
            const testCodes = new Set(DEV_TEST_CUSTOMER_CODES);
            const filtered = accounts.filter((a) => testCodes.has(a.code));
            ctx.console.log(
              `[Dev] Filtered ${accounts.length} accounts to ${filtered.length} test customers`
            );
            return filtered;
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
       * - Create an object client keyed by the customer account ID
       * - Call soaCustomer.process() with complete parameters and idempotency key
       * - Register the promise in worker pool for tracking
       *
       * Related functions:
       * - Called by main loop whenever a worker slot is available
       * - Uses `soaCustomer` for durable per-customer processing
       * - The created promise will be raced to detect completion
       */
      const startAccountProcessing = (account: IAccount): void => {
        const accountId = account.code;
        const idempotencyKey = `${accountId}:${processingDates.timePeriod}:${soaProcessingType}`;

        const workerPromise = ctx
          .objectClient(soaCustomer, accountId)
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
