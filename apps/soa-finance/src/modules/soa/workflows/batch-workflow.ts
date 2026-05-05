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

type WorkerResult = {
  accountId: string;
  failed: boolean;
  error?: string;
};

type IBatchWorkflowResult = {
  message: string;
  totalAccounts: number;
  failedAccountCount: number;
  status: "Completed";
};

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
      const allAccounts = await ctx.run(
        "get-all-accounts",
        async (): Promise<IAccount[]> => {
          const accounts = await getAllAccounts();
          if (!accounts || accounts.length === 0) {
            throw new TerminalError("No customer accounts found");
          }

          return accounts;
        }
      );

      let accountsToProcess: IAccount[];
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

      ctx.console.log(`Starting batch with ${totalAccounts} accounts`);

      // STEP 3: Process with bounded concurrency
      // Process accounts in chunks of MAX_WORKERS. Errors from individual
      // accounts are isolated via .map() so one failure does not kill the batch.
      let failedAccountCount = 0;
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
            ctx.console.log(
              `[Batch] Worker failed for ${result.accountId}: ${result.error}`
            );
          }
        }

        ctx.console.log(
          `[Batch] Progress: ${processedAccountCount}/${totalAccounts}`
        );
      }

      ctx.console.log(
        `Batch completed: ${processedAccountCount - failedAccountCount} succeeded, ${failedAccountCount} failed, out of ${totalAccounts} accounts`
      );

      return {
        message: "SOA batch processing completed successfully",
        totalAccounts,
        failedAccountCount,
        status: "Completed",
      };
    },
  },
});

export type BatchWorkflow = typeof batchWorkflow;
