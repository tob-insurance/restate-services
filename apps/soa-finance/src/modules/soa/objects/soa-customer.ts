import {
  type ObjectContext,
  object,
  TerminalError,
} from "@restatedev/restate-sdk";

import { PERIODS_TO_KEEP } from "../../../constants/constants.js";
import { getAccountById } from "../../../infrastructure/database/queries/customer-query.js";
import type { SoaItem } from "../../../types/soa.type.js";
import { processReminderLetter } from "../../reminder";
import { processBranchSoa } from "../services/process-branches.js";
import { readDcNoteIndex } from "./state.js";

const PERIOD_STATE_KEY_REGEX = /^[^:]+:(\d{4}-\d{2})(?::|$)/;

export interface SoaCustomerResult {
  customerId: string;
  status: "completed" | "failed";
}

export const soaCustomer = object({
  name: "SoaCustomer",
  options: {
    retryPolicy: {
      initialInterval: { seconds: 1 },
      maxInterval: { seconds: 30 },
      maxAttempts: 3,
    },
  },
  handlers: {
    process: async (
      ctx: ObjectContext,
      soaParams: SoaItem
    ): Promise<SoaCustomerResult> => {
      const { customerId, timePeriod, processingType } = soaParams;

      if (ctx.key !== customerId) {
        throw new TerminalError(
          `Key mismatch: ctx.key="${ctx.key}" but params.customerId="${customerId}"`
        );
      }

      ctx.console.log(`[SoaCustomer] Starting for customer: ${customerId}`);
      ctx.set("status", "processing");

      const customerData = await ctx.run("get-customer-data", () =>
        getAccountById(customerId)
      );

      if (!customerData) {
        throw new TerminalError(`Customer ${customerId} not found`);
      }

      ctx.set("status", "fetched-customer");

      const hasExistingReminder = await hasRemindersForPeriod(ctx, timePeriod);

      ctx.set("status", "branch-processing");

      try {
        if (processingType !== 1 || hasExistingReminder) {
          await processReminderLetter({
            ctx,
            customer: customerData,
            item: soaParams,
          });
        } else {
          // Email is sent inside processBranchSoa (generate+upload+send in one ctx.run)
          const branchResult = await processBranchSoa({
            ctx,
            customerData,
            params: soaParams,
          });

          if (!branchResult.hasDocuments) {
            ctx.console.log(
              `Skipping email for ${soaParams.customerId}: no documents generated`
            );
          }
        }

        ctx.set("status", "completed");

        ctx.console.log(`[SoaCustomer] Completed for customer: ${customerId}`);

        await cleanupOldPeriodState(ctx, timePeriod);

        return { customerId, status: "completed" };
      } catch (error) {
        ctx.set("status", "failed");
        throw error;
      }
    },
  },
});

export type SoaCustomer = typeof soaCustomer;

async function hasRemindersForPeriod(
  ctx: ObjectContext,
  timePeriod: string
): Promise<boolean> {
  const dcNoteIndex = await readDcNoteIndex(ctx, timePeriod);

  return Object.values(dcNoteIndex).some((reminderId) =>
    reminderId.startsWith(`${timePeriod}:`)
  );
}

async function cleanupOldPeriodState(
  ctx: ObjectContext,
  currentTimePeriod: string
): Promise<void> {
  const cutoffPeriodIndex =
    getPeriodIndex(currentTimePeriod) - PERIODS_TO_KEEP + 1;
  const keys = await ctx.stateKeys();

  for (const key of keys) {
    const match = key.match(PERIOD_STATE_KEY_REGEX);
    if (!match) {
      continue;
    }

    const periodIndex = getPeriodIndex(match[1]);
    if (periodIndex < cutoffPeriodIndex) {
      ctx.clear(key);
    }
  }
}

function getPeriodIndex(timePeriod: string): number {
  const [year, month] = timePeriod.split("-").map(Number);
  return year * 12 + month;
}
