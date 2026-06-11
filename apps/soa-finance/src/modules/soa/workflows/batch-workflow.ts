import type {
  WorkflowContext,
  WorkflowSharedContext,
} from "@restatedev/restate-sdk";
import {
  RestatePromise,
  rpc,
  TerminalError,
  workflow,
} from "@restatedev/restate-sdk";
import { SENTINEL_ALL } from "../../../constants/constants.js";
import {
  isDevelopment,
  parseEnvInt,
  parseEnvList,
} from "../../../constants/environment.js";
import { getAgentAccounts } from "../../../infrastructure/database/queries/customer-query.js";
import { asCorrelationId, asCustomerId } from "../../../types/branded.js";
import {
  formatDateToUnixTimestamp,
  formatTimePeriod,
} from "../../../utils/formatter/date.formatter.js";
import { soaCustomer } from "../objects/soa-customer.js";
import { soaSchema } from "../types.js";

const DEV_TEST_CUSTOMER_CODES = parseEnvList("SOA_TEST_CUSTOMERS") ?? [];

const MAX_WORKERS = parseEnvInt("SOA_MAX_WORKERS", 10);
const INACTIVITY_TIMEOUT_HOURS = parseEnvInt("SOA_INACTIVITY_TIMEOUT_HOURS", 6);

interface WorkerResult {
  accountId: string;
  error?: string;
  failed: boolean;
}

export interface BatchWorkflowResult {
  failedAccountCount: number;
  failedAccounts: Array<{
    accountId: string;
    error: string;
  }>;
  message: string;
  status: "Completed";
  totalAccounts: number;
}

/**
 * BatchWorkflow - Main workflow for processing Statement of Account (SOA) in batch.
 *
 * Fetches all customer accounts, then processes them with a sliding window
 * of MAX_WORKERS (default 10) concurrent invocations: RestatePromise.race
 * fills each freed slot immediately. Individual account failures are
 * isolated via .map() so one failure does not kill the batch.
 *
 * Process flow:
 * 1. Initialize date parameters
 * 2. Fetch all customer accounts
 * 3. Process accounts with a sliding window of MAX_WORKERS
 * 4. Return batch result with success/failure counts
 */

export const batchWorkflow = workflow({
  name: "BatchWorkflow",
  options: {
    inactivityTimeout: { hours: INACTIVITY_TIMEOUT_HOURS },
  },
  handlers: {
    run: async (
      ctx: WorkflowContext,
      soaRequest: soaSchema
    ): Promise<BatchWorkflowResult> => {
      // Validate input
      const parseResult = soaSchema.safeParse(soaRequest);
      if (!parseResult.success) {
        throw new TerminalError(
          `Invalid SOA request: ${parseResult.error.message}`
        );
      }

      // STEP 1: Initialize Date Parameters (deterministic timestamp from Restate context)
      const now = await ctx.date.now();
      const currentDate = new Date(now);
      const processingDates = {
        timePeriod: formatTimePeriod(currentDate),
        toDate: formatDateToUnixTimestamp(currentDate),
        processingDate: currentDate.toISOString(),
      };
      const correlationId = asCorrelationId(
        `batch:${processingDates.timePeriod}:${now}`
      );

      const soaProcessingType = parseResult.data.type;
      const soaOptions = {
        classOfBusiness: SENTINEL_ALL,
        branch: SENTINEL_ALL,
      };

      // STEP 2: Fetch Customer Accounts
      ctx.set("status", "started");

      const accountCodes = await ctx.run(
        "get-all-account-codes",
        async (): Promise<string[]> => {
          const accounts = await getAgentAccounts();
          if (!accounts || accounts.length === 0) {
            throw new Error("No customer accounts found");
          }

          // Return only codes — not full Account objects
          let codes = accounts.map((a) => a.code);

          // Filter to test customers in development
          if (isDevelopment() && DEV_TEST_CUSTOMER_CODES.length > 0) {
            const testCodes = new Set(DEV_TEST_CUSTOMER_CODES);
            codes = codes.filter((code) => testCodes.has(code));
          }

          return codes;
        }
      );

      const totalAccounts = accountCodes.length;

      ctx.set("status", "processing");
      ctx.set("progress", {
        processed: 0,
        total: totalAccounts,
        failed: 0,
      });

      ctx.console.log(`Starting batch with ${totalAccounts} accounts`);

      // STEP 3: Process with bounded concurrency
      // Sliding window of MAX_WORKERS accounts: each completion immediately
      // frees its slot for the next account, so the window never idles on a
      // slow account the way per-chunk barriers do (account sizes are heavily
      // skewed). Losing a race leaves the other invocations running untouched
      // — they re-enter the next race with their work intact — and the race
      // itself can never reject because .map() converts each failure into a
      // WorkerResult, isolating it from the batch.
      let failedAccountCount = 0;
      const failedAccounts: BatchWorkflowResult["failedAccounts"] = [];
      let processedAccountCount = 0;

      const startAccount = (accountId: string) => {
        const idempotencyKey = `${accountId}:${processingDates.timePeriod}:${soaProcessingType}`;

        return ctx
          .objectClient(soaCustomer, accountId)
          .process(
            {
              customerId: asCustomerId(accountId),
              timePeriod: processingDates.timePeriod,
              processingDate: processingDates.processingDate,
              classOfBusiness: soaOptions.classOfBusiness,
              branch: soaOptions.branch,
              toDate: processingDates.toDate,
              processingType: soaProcessingType,
              correlationId,
            },
            rpc.opts({ idempotencyKey })
          )
          .map((_value, failure): WorkerResult => {
            if (failure) {
              return { accountId, failed: true, error: failure.message };
            }
            return { accountId, failed: false };
          });
      };

      const queue = [...accountCodes];
      const pending = new Map<string, RestatePromise<WorkerResult>>();

      while (queue.length > 0 || pending.size > 0) {
        while (pending.size < MAX_WORKERS && queue.length > 0) {
          const accountId = queue.shift() as string;
          pending.set(accountId, startAccount(accountId));
        }

        const result = await RestatePromise.race([...pending.values()]);
        pending.delete(result.accountId);

        processedAccountCount += 1;
        if (result.failed) {
          failedAccountCount += 1;
          failedAccounts.push({
            accountId: result.accountId,
            error: result.error ?? "Unknown error",
          });
          ctx.console.log(
            `[Batch] Worker failed for ${result.accountId}: ${result.error}`
          );
        }

        // Throttle state writes to reduce journal bloat
        if (
          processedAccountCount % 10 === 0 ||
          processedAccountCount === totalAccounts
        ) {
          ctx.set("progress", {
            processed: processedAccountCount,
            total: totalAccounts,
            failed: failedAccountCount,
          });
        }
        if (
          processedAccountCount % MAX_WORKERS === 0 ||
          processedAccountCount === totalAccounts
        ) {
          ctx.console.log(
            `[Batch] Progress: ${processedAccountCount}/${totalAccounts}`
          );
        }
      }

      const MAX_REPORTED_FAILURES = 10;
      const compactFailedAccounts = failedAccounts.slice(
        0,
        MAX_REPORTED_FAILURES
      );
      ctx.console.log(
        `[Batch] Failed accounts (${failedAccounts.length} total): ${JSON.stringify(compactFailedAccounts)}`
      );

      ctx.console.log(
        `Batch completed: ${processedAccountCount - failedAccountCount} succeeded, ${failedAccountCount} failed, out of ${totalAccounts} accounts`
      );

      ctx.set("status", "completed");

      const batchResult = {
        message: "SOA batch processing completed successfully",
        totalAccounts,
        failedAccountCount,
        failedAccounts: compactFailedAccounts,
        status: "Completed" as const,
      };

      return batchResult;
    },

    getStatus: async (ctx: WorkflowSharedContext) => {
      const status = (await ctx.get<string>("status")) ?? "unknown";
      const progress = await ctx.get<{
        processed: number;
        total: number;
        failed: number;
      }>("progress");

      return { status, progress: progress ?? null };
    },
  },
});

export type BatchWorkflow = typeof batchWorkflow;
