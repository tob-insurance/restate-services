import type { WorkflowContext } from "@restatedev/restate-sdk";
import { workflow } from "@restatedev/restate-sdk";
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
} from "../utils/formater";

import type { IAccount, SoaType, soaSchema } from "../utils/types";
import { type SoaWorkflow, soaWorkflow } from "./soa-workflow";

export const batchWorkflow = workflow({
  name: "BatchWorkflow",
  handlers: {
    run: async (ctx: WorkflowContext, type: soaSchema) => {
      ctx.console.log("Starting batch workflow");

      const dateNow = new Date();
      const timePeriod = formatTimePeriod(dateNow);
      const classOfBusiness = "ALL";
      const branch = "ALL";
      const toDate = formatDateToUnixTimestamp(dateNow);
      const maxRetries = 3;
      const processingDate = dateNow.toISOString();
      const processingType = type.type as SoaType;

      // Get Customers
      const customers = await ctx.run(
        "get-customers",
        async () => await getAllAccounts()
      );

      if (!customers || customers.length === 0) {
        throw new Error("No customers found");
      }

      const customerRows: IAccount[] = customers;
      const totalCustomers = customerRows.length;

      // Create Batch
      const batchId = await ctx.run("create-batch", async () => {
        const id = formatUUID(uuidv4());
        await insertBatch(id, totalCustomers, "Queued");

        return id;
      });

      ctx.console.log(`Batch created: ${batchId}, Total: ${totalCustomers}`);

      // Processing SOA for each customer
      await ctx.run("soa-processing", async () => {
        await updateBatchStatus(batchId, "Processing");
      });

      for (const customer of customerRows) {
        const customerId = customer.code;
        ctx.console.log(`Processing customer: ${customerId}`);

        ctx.workflowSendClient<SoaWorkflow>(soaWorkflow, customerId).run({
          customerId,
          timePeriod,
          processingDate,
          batchId,
          classOfBusiness,
          branch,
          toDate,
          maxRetries,
          processingType,
          testMode: type.testMode ?? false,
          skipAgingFilter: type.skipAgingFilter ?? false,
          skipDcNoteCheck: type.skipDcNoteCheck ?? false,
        });
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
