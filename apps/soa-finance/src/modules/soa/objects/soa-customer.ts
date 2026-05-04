import {
  type ObjectContext,
  object,
  TerminalError,
} from "@restatedev/restate-sdk";

import { getAccountById } from "../../../infrastructure/database/index.js";
import type { ISoaItem } from "../../../types";
import { processReminderLetter } from "../../reminder";
import { newSoa } from "../services";
import type { DcNoteIndex } from "./state";
import { stateKeys } from "./state";

type SoaCustomerResult = {
  customerId: string;
  status: "completed" | "failed";
};

type SoaCustomerBackfillData = {
  headers: Array<{ timePeriod: string; officeId: string; createdAt: string }>;
  details: Record<string, Array<{ dcNoteId: string; isPaid: boolean }>>;
  letters: Record<
    string,
    Array<{ type: string; letterNo: string; sentDate: string }>
  >;
  dcNoteIndex: Record<string, string>;
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
        await newSoa({ ctx, customerData, params: soaParams });
      }

      ctx.console.log(`[SoaCustomer] Completed for customer: ${customerId}`);

      return { customerId, status: "completed" };
    },

    backfill: async (ctx: ObjectContext, data: SoaCustomerBackfillData) => {
      for (const header of data.headers) {
        ctx.set(stateKeys.header(header.timePeriod, header.officeId), {
          customerCode: ctx.key,
          ...header,
        });
      }

      for (const [reminderId, detailList] of Object.entries(data.details)) {
        const [timePeriod, officeId] = reminderId.split(":");
        const detailsMap: Record<
          string,
          { dcNoteId: string; reminderId: string; isPaid: boolean }
        > = {};

        for (const detail of detailList) {
          detailsMap[detail.dcNoteId] = {
            dcNoteId: detail.dcNoteId,
            reminderId,
            isPaid: detail.isPaid,
          };
        }

        ctx.set(stateKeys.details(timePeriod, officeId), detailsMap);
      }

      for (const [reminderId, letterList] of Object.entries(data.letters)) {
        const [timePeriod, officeId] = reminderId.split(":");
        ctx.set(stateKeys.letters(timePeriod, officeId), letterList);
      }

      const existingIndex =
        (await ctx.get<Record<string, string>>(stateKeys.dcNoteIndex)) ?? {};
      ctx.set(stateKeys.dcNoteIndex, {
        ...existingIndex,
        ...data.dcNoteIndex,
      });
    },
  },
});

export type SoaCustomer = typeof soaCustomer;

async function hasRemindersForPeriod(
  ctx: ObjectContext,
  timePeriod: string
): Promise<boolean> {
  const dcNoteIndex = await ctx.get<DcNoteIndex>(stateKeys.dcNoteIndex);

  if (!dcNoteIndex) {
    return false;
  }

  return Object.values(dcNoteIndex).some((reminderId) =>
    reminderId.startsWith(`${timePeriod}:`)
  );
}
