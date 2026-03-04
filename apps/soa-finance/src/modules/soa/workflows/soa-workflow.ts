import type { WorkflowContext } from "@restatedev/restate-sdk";
import { TerminalError, workflow } from "@restatedev/restate-sdk";

import {
  getAccountById,
  getReminderByCustomerAndPeriod,
} from "../../../infrastructure/database/index.js";
import type { ISoaItem } from "../../../types";
import { processReminderLetter } from "../../reminder";
import { newSoa } from "../services";

type ISoaWorkflowResult = {
  customerId: string;
  status: "completed" | "failed";
};

export const soaWorkflow = workflow({
  name: "SoaWorkflow",
  options: {
    retryPolicy: {
      initialInterval: { seconds: 1 },
      maxInterval: { seconds: 30 },
      maxAttempts: 3,
    },
  },
  handlers: {
    run: async (
      ctx: WorkflowContext,
      soaParams: ISoaItem
    ): Promise<ISoaWorkflowResult> => {
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

      const hasExistingReminder = existingReminders.length > 0;
      const shouldCreateReminder = hasExistingReminder || processingType !== 1;

      if (shouldCreateReminder) {
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

export type SoaWorkflow = typeof soaWorkflow;
