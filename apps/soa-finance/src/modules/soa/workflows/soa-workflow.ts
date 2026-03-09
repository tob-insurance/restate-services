import type { Context } from "@restatedev/restate-sdk";
import { service, TerminalError } from "@restatedev/restate-sdk";

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
