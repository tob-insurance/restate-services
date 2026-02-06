import type { WorkflowContext } from "@restatedev/restate-sdk";
import { workflow } from "@restatedev/restate-sdk";

import {
  getReminderByCustomerAndPeriod,
  updateJobStatus,
} from "../../database";

import {
  ensureJobExists,
  getCustomerData,
  shouldProcessReminder,
} from "../../modules";

import type { ISoaItem } from "../../types";
import {
  completeWorkflow,
  handleErrorWithRetry,
  newSoa,
  processReminder,
} from "../handlers";

interface ISoaWorkflowResult {
  customerId: string;
  status: "completed" | "failed";
  jobId: string;
}

/**
 * SoaWorkflow - Workflow untuk memproses Statement of Account (SOA) per customer.
 *
 * Tujuan:
 * - Memproses SOA untuk satu customer tertentu
 * - Menentukan apakah customer perlu diproses sebagai SOA baru atau reminder letter
 * - Mengelola retry logic jika terjadi error
 * - Melaporkan hasil proses ke batch workflow
 *
 * Hubungan ke fungsi lain:
 * - Dipanggil oleh `batchWorkflow` sebagai child workflow untuk setiap customer
 * - Memanggil `ensureJobExists` untuk membuat/mendapatkan job record di database
 * - Memanggil `getCustomerData` untuk mengambil data lengkap customer
 * - Memanggil `getReminderByCustomerAndPeriod` untuk cek histori SOA
 * - Memanggil `shouldProcessReminder` untuk menentukan tipe proses (SOA baru vs Reminder)
 * - Memanggil `newSoa` atau `processReminder` berdasarkan keputusan di atas
 * - Memanggil `completeWorkflow` untuk finalisasi dan update status batch
 * - Memanggil `handleErrorWithRetry` untuk error handling dengan retry mechanism
 *
 * Alur proses:
 * 1. Buat/ambil job record untuk customer ini
 * 2. Loop retry sampai sukses atau max retry tercapai:
 *    a. Update status job ke "Processing"
 *    b. Ambil data customer dari database
 *    c. Cek histori reminder untuk periode ini
 *    d. Tentukan apakah proses sebagai reminder atau SOA baru
 *    e. Jalankan proses yang sesuai
 *    f. Tandai workflow selesai
 * 3. Return hasil dengan status completed/failed
 */
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
      const { customerId, batchId, timePeriod, maxRetries, processingType } =
        soaParams;

      ctx.console.log(`Starting SOA for customer: ${customerId}`);

      const { jobId, retryAttempt } = await ctx.run(
        "get-or-create-job",
        async () => await ensureJobExists(batchId, customerId)
      );

      const processingItem: ISoaItem = {
        ...soaParams,
        jobId,
      };

      let isProcessingSuccess = false;
      const currentRetryAttempt = retryAttempt;

      // STEP 2: Loop retry sampai sukses atau max retry
      while (!isProcessingSuccess && currentRetryAttempt <= maxRetries) {
        try {
          // STEP 2a: Update status job ke Processing
          await ctx.run("update-job-processing", async () => {
            await updateJobStatus(jobId, "Processing");
          });

          // STEP 2b: Ambil data customer
          const customerData = await ctx.run(
            "get-customer-data",
            async () => await getCustomerData(jobId, customerId)
          );

          if (!customerData) {
            throw new Error(`Customer ${customerId} tidak ditemukan`);
          }

          // STEP 2c: Cek histori reminder untuk periode ini
          const existingReminders = await ctx.run(
            "check-soa-history",
            async () =>
              await getReminderByCustomerAndPeriod(
                customerData.code,
                timePeriod
              )
          );

          // STEP 2d: Tentukan tipe proses
          const hasExistingReminder = existingReminders.length > 0;
          const shouldCreateReminder = shouldProcessReminder(
            hasExistingReminder,
            processingType
          );

          // STEP 2e: Jalankan proses yang sesuai
          if (shouldCreateReminder) {
            await processReminder({
              ctx,
              customerData,
              params: processingItem,
            });
          } else {
            await newSoa({
              ctx,
              customerData,
              params: processingItem,
              jobId,
            });
          }

          isProcessingSuccess = true;

          // STEP 2f: Finalisasi workflow
          await completeWorkflow({
            ctx,
            jobId,
            batchId,
          });

          ctx.console.log(`selesai: ${customerId}`);
        } catch (error: unknown) {
          const errorResult = await handleErrorWithRetry({
            ctx,
            error,
            jobId,
            batchId,
            customerId,
            currentRetryAttempt,
            maxRetries,
          });

          if (!errorResult.shouldContinue) {
            return errorResult.result as unknown as ISoaWorkflowResult;
          }
        }
      }

      // STEP 3: Return hasil
      return {
        customerId,
        status: "completed",
        jobId,
      };
    },
  },
});

export type SoaWorkflow = typeof soaWorkflow;
