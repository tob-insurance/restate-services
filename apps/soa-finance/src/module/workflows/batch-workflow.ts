import type { WorkflowContext } from "@restatedev/restate-sdk";
import { RestatePromise, workflow } from "@restatedev/restate-sdk";
import { v4 as uuidv4 } from "uuid";

import {
  getAllAccounts,
  insertBatch,
  updateBatchStatus,
} from "../../infrastructure/database/queries";
import {
  formatDateToUnixTimestamp,
  formatTimePeriod,
  formatUUID,
} from "../utils/formatter";
import type { IAccount, SoaType, soaSchema } from "../utils/types";
import { type SoaWorkflow, soaWorkflow } from "./soa-workflow";

export const batchWorkflow = workflow({
  name: "BatchWorkflow",
  handlers: {
    run: async (ctx: WorkflowContext, type: soaSchema) => {
      ctx.console.log("Starting batch workflow");

      const { timePeriod, toDate, processingDate } = await ctx.run(
        "get-processing-date",
        () => {
          const dateNow = new Date();
          return {
            timePeriod: formatTimePeriod(dateNow),
            toDate: formatDateToUnixTimestamp(dateNow),
            processingDate: dateNow.toISOString(),
          };
        }
      );

      const processingType = type.type as SoaType;
      const classOfBusiness = "ALL";
      const branch = "ALL";
      const maxRetries = 3;

      const customers = await ctx.run(
        "get-customers",
        async () => await getAllAccounts()
      );

      // const customer = customers.find((c) => c.code === "00000318");

      if (!customers || customers.length === 0) {
        throw new Error("No customers found");
      }

      // if (!customer) {
      //   throw new Error("No customers found");
      // }

      const customerRows: IAccount[] = customers;
      // const customerRows: IAccount[] = [customer];
      const totalCustomers = customerRows.length;

      const batchId = await ctx.run("create-batch", async () => {
        const id = formatUUID(uuidv4());
        await insertBatch(id, totalCustomers, "Queued");

        return id;
      });

      ctx.console.log(`Batch created: ${batchId}, Total: ${totalCustomers}`);

      // Processing SOA for each customer in sequential chunks of 50
      await ctx.run("soa-processing", async () => {
        await updateBatchStatus(batchId, "Processing");
      });

      const chunkSize = 10;
      for (let i = 0; i < customerRows.length; i += chunkSize) {
        const start = i + 1;
        const end = Math.min(i + chunkSize, customerRows.length);
        const chunkNumber = Math.floor(i / chunkSize) + 1;

        ctx.console.log(
          `Processing chunk ${chunkNumber}: ${start}-${end}, size: ${chunkSize}`
        );

        const chunk = customerRows.slice(i, i + chunkSize);
        const promises: RestatePromise<unknown>[] = [];

        for (const customer of chunk) {
          const customerId = customer.code;
          promises.push(
            ctx.workflowClient<SoaWorkflow>(soaWorkflow, customerId).run({
              customerId,
              timePeriod,
              processingDate,
              batchId,
              chunkNumber,
              classOfBusiness,
              branch,
              toDate,
              maxRetries,
              processingType,
              testMode: type.testMode ?? false,
              skipAgingFilter: type.skipAgingFilter ?? false,
              skipDcNoteCheck: type.skipDcNoteCheck ?? false,
            })
          );

          await ctx.sleep(500);
        }

        await RestatePromise.allSettled(promises);

        await ctx.sleep(1000);
      }

      ctx.console.log("Finished batch workflow");

      return {
        batchId,
        message: "SOA processing started successfully",
        totalCustomers,
        Status: "Queued",
      };
    },
  },
});
