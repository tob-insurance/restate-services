import {
  type ObjectContext,
  object,
  TerminalError,
} from "@restatedev/restate-sdk";
import { getAccountById } from "../../../infrastructure/database/queries/customer-query.js";
import { hasRemindersForPeriod as hasRemindersForPeriodDb } from "../../../infrastructure/database/queries/reminder-query.js";
import type { SoaItem } from "../../../types/soa.type.js";
import { workflowLog } from "../../../utils/logger.js";
import { processReminderLetter } from "../../reminder";
import { processBranchSoa } from "../services/process-branches.js";
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

      ctx.console.log(
        workflowLog({
          component: "SoaCustomer",
          correlationId: soaParams.correlationId,
          workflowId: ctx.key,
        }),
        `Starting for customer: ${customerId}`
      );
      ctx.set("status", "processing");

      // Combined read: customer data + reminder check in single ctx.run()
      const { customerData, hasExistingReminder } = await ctx.run(
        "get-customer-and-reminders",
        async () => {
          const [customer, hasReminder] = await Promise.all([
            getAccountById(customerId),
            hasRemindersForPeriodDb(ctx.key, timePeriod),
          ]);
          return { customerData: customer, hasExistingReminder: hasReminder };
        }
      );

      if (!customerData) {
        throw new TerminalError(`Customer ${customerId} not found`);
      }

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

        ctx.console.log(
          workflowLog({
            component: "SoaCustomer",
            correlationId: soaParams.correlationId,
            workflowId: ctx.key,
          }),
          `Completed for customer: ${customerId}`
        );

        // Cleanup is now handled by PostgreSQL (no Restate state to clean)

        return { customerId, status: "completed" };
      } catch (error) {
        ctx.set("status", "failed");
        throw error;
      }
    },
  },
});

export type SoaCustomer = typeof soaCustomer;
