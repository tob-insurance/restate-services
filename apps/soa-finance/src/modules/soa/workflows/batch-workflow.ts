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
import { isDevelopment } from "../../../constants/environment.js";
import { getAgentAccounts } from "../../../infrastructure/database/queries/customer-query.js";
import type { Account } from "../../../types/customer.type.js";
import type { SoaType } from "../../../types/soa.type.js";
import {
  formatDateToUnixTimestamp,
  formatTimePeriod,
} from "../../../utils/formatter/date.formatter.js";
import { soaCustomer } from "../objects/soa-customer.js";
import { soaSchema } from "../types.js";

function parseEnvInt(key: string, defaultVal: number): number {
  const raw = process.env[key];
  if (!raw) {
    return defaultVal;
  }
  const val = Number(raw);
  return Number.isFinite(val) && val > 0 ? val : defaultVal;
}

function parseEnvList(key: string): string[] | null {
  const raw = process.env[key];
  if (!raw) {
    return null;
  }
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : null;
}

const DEV_TEST_CUSTOMER_CODES = parseEnvList("SOA_TEST_CUSTOMERS") ?? [
  "00004162",
  "00004829",
  "00005017",
  "00003758",
  "00003390",
  "00002844",
];

const MAX_WORKERS = parseEnvInt("SOA_MAX_WORKERS", 5);
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
 * Fetches all customer accounts, then processes them in bounded chunks
 * (default 5 concurrent) using RestatePromise.all. Individual account
 * failures are isolated via .map() so one failure does not kill the batch.
 *
 * Process flow:
 * 1. Initialize date parameters
 * 2. Fetch all customer accounts from Oracle
 * 3. Process accounts in chunks of MAX_WORKERS
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

      const soaProcessingType = parseResult.data.type as SoaType;
      const soaOptions = {
        classOfBusiness: SENTINEL_ALL,
        branch: SENTINEL_ALL,
      };

      // STEP 2: Fetch Customer Accounts
      ctx.set("status", "started");

      const allAccounts = await ctx.run(
        "get-all-accounts",
        async (): Promise<Account[]> => {
          const accounts = await getAgentAccounts();
          if (!accounts || accounts.length === 0) {
            throw new Error("No customer accounts found");
          }

          return accounts;
        }
      );

      let accountsToProcess: Account[];
      if (isDevelopment()) {
        const testCodes = new Set(DEV_TEST_CUSTOMER_CODES);
        accountsToProcess = allAccounts.filter((a) => testCodes.has(a.code));
        ctx.console.log(
          `[Dev] Filtered ${allAccounts.length} accounts to ${accountsToProcess.length} test customers`
        );
      } else {
        accountsToProcess = allAccounts;
      }

      const totalAccounts = accountsToProcess.length;

      ctx.set("status", "fetching");
      ctx.set("progress", {
        processed: 0,
        total: totalAccounts,
        failed: 0,
      });

      ctx.console.log(`Starting batch with ${totalAccounts} accounts`);

      // STEP 3: Process with bounded concurrency
      // Process accounts in chunks of MAX_WORKERS. Errors from individual
      // accounts are isolated via .map() so one failure does not kill the batch.
      let failedAccountCount = 0;
      const failedAccounts: BatchWorkflowResult["failedAccounts"] = [];
      let processedAccountCount = 0;

      for (let i = 0; i < accountsToProcess.length; i += MAX_WORKERS) {
        const chunk = accountsToProcess.slice(i, i + MAX_WORKERS);

        const chunkPromises = chunk.map((account) => {
          const accountId = account.code;
          const idempotencyKey = `${accountId}:${processingDates.timePeriod}:${soaProcessingType}`;

          return ctx
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
        });

        const results = await RestatePromise.all(chunkPromises);

        for (const result of results) {
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
        }

        ctx.set("progress", {
          processed: processedAccountCount,
          total: totalAccounts,
          failed: failedAccountCount,
        });

        ctx.console.log(
          `[Batch] Progress: ${processedAccountCount}/${totalAccounts}`
        );
      }

      ctx.console.log(
        "[Batch] Failed accounts:",
        JSON.stringify(failedAccounts)
      );

      ctx.console.log(
        `Batch completed: ${processedAccountCount - failedAccountCount} succeeded, ${failedAccountCount} failed, out of ${totalAccounts} accounts`
      );

      const MAX_REPORTED_FAILURES = 10;
      const compactFailedAccounts = failedAccounts.slice(
        0,
        MAX_REPORTED_FAILURES
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
