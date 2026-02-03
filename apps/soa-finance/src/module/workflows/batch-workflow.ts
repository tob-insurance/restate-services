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

      // Worker Pool Pattern: Maintain 10 concurrent workers at all times
      const maxConcurrency = 10;
      let customerIndex = 0;
      let completedCount = 0;

      // Track active workers with their customer IDs
      type WorkerSlot = {
        customerId: string;
        promise: RestatePromise<unknown>;
      };

      const activeWorkers: Map<string, WorkerSlot> = new Map();

      // Helper function to start processing a customer
      const startCustomerProcessing = (customer: IAccount) => {
        const customerId = customer.code;

        const promise = ctx
          .workflowClient<SoaWorkflow>(soaWorkflow, customerId)
          .run({
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

        activeWorkers.set(customerId, { customerId, promise });
        ctx.console.log(
          `Started: ${customerId} (Active: ${activeWorkers.size}, Remaining: ${totalCustomers - customerIndex})`
        );
      };

      while (
        activeWorkers.size < maxConcurrency &&
        customerIndex < customerRows.length
      ) {
        startCustomerProcessing(customerRows[customerIndex]);
        customerIndex++;
        await ctx.sleep(30_000); // Small delay between starting workers
      }

      // Process until all customers are completed
      while (activeWorkers.size > 0) {
        // Wait for ANY one to complete using RestatePromise.race
        // Each promise returns its customerId so we know which one finished
        const finishedCustomerId = (await RestatePromise.race(
          Array.from(activeWorkers.values()).map((w) =>
            w.promise.map(() => w.customerId)
          )
        )) as string;

        // Process the finished customer
        activeWorkers.delete(finishedCustomerId);
        completedCount++;
        ctx.console.log(
          `[Queue] Completed: ${finishedCustomerId} (${completedCount}/${totalCustomers})`
        );

        // Delay 1 minute after completing each customer
        ctx.console.log("[Queue] Waiting 1 minute before next customer...");
        await ctx.sleep(30_000);

        // If there are more customers, start the next one
        if (customerIndex < customerRows.length) {
          startCustomerProcessing(customerRows[customerIndex]);
          customerIndex++;
          await ctx.sleep(30_000);
        }
      }

      ctx.console.log(`[Queue] All ${completedCount} customers processed`);

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
