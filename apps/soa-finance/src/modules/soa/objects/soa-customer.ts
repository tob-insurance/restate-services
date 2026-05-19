import {
  type ObjectContext,
  object,
  TerminalError,
} from "@restatedev/restate-sdk";

import { getAccountById } from "../../../infrastructure/database/index.js";
import type { ISoaItem } from "../../../types";
import { sendWithAttachments } from "../../email";
import { processReminderLetter } from "../../reminder";
import { processBranchSoa } from "../services/process-branches";
import { readDcNoteIndex } from "./state";

type SoaCustomerResult = {
  customerId: string;
  status: "completed" | "failed";
};

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
      soaParams: ISoaItem
    ): Promise<SoaCustomerResult> => {
      const { customerId, timePeriod, processingType } = soaParams;

      if (ctx.key !== customerId) {
        throw new TerminalError(
          `Key mismatch: ctx.key="${ctx.key}" but params.customerId="${customerId}"`
        );
      }

      ctx.console.log(`[SoaCustomer] Starting for customer: ${customerId}`);

      const customerData = await ctx.run("get-customer-data", () =>
        getAccountById(customerId)
      );

      if (!customerData) {
        throw new TerminalError(`Customer ${customerId} not found`);
      }

      const hasExistingReminder = await hasRemindersForPeriod(ctx, timePeriod);

      if (processingType !== 1 || hasExistingReminder) {
        await processReminderLetter({
          ctx,
          customer: customerData,
          item: soaParams,
        });
      } else {
        const dateNow = new Date(soaParams.processingDate);
        const hasDocuments = await processBranchSoa({
          ctx,
          customerData,
          params: soaParams,
        });

        if (hasDocuments) {
          await ctx.run(
            "send-email",
            async () =>
              await sendWithAttachments({
                customerId: soaParams.customerId,
                customerData,
                date: dateNow,
              })
          );
        } else {
          ctx.console.log(
            `Skipping email for ${soaParams.customerId}: no documents generated`
          );
        }
      }

      ctx.console.log(`[SoaCustomer] Completed for customer: ${customerId}`);

      return { customerId, status: "completed" };
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
