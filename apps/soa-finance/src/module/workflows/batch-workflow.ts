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

const POST_COMPLETION_DELAY = 30_000;
const WORKER_START_DELAY = 30_000;
const MAX_WORKERS = 10;
const PROGRESS_LOG_INTERVAL = 10;

type ActiveWorkerSlot = {
  accountId: string;
  promise: RestatePromise<string>;
};

interface IBatchWorkflowResult {
  batchId: string;
  message: string;
  totalAccounts: number;
  status: "Completed";
}

/**
 * BatchWorkflow - Workflow utama untuk memproses Statement of Account (SOA) secara batch.
 *
 * Tujuan:
 * - Mengambil semua akun customer dari database
 * - Membuat record batch baru untuk tracking status proses
 * - Memproses setiap customer secara paralel dengan batasan maksimum worker (10 concurrent)
 * - Mengelola antrian customer menggunakan worker pool
 * - Mengembalikan status batch setelah semua customer selesai diproses
 *
 * Hubungan ke fungsi lain:
 * - Memanggil `getAllAccounts` dari queries untuk mengambil data customer
 * - Memanggil `insertBatch` untuk membuat record batch baru di database
 * - Memanggil `updateBatchStatus` untuk update status batch (Processing → Completed)
 * - Mendelegasi proses per-customer ke `soaWorkflow` sebagai child workflow
 *
 * Alur proses:
 * 1. Inisialisasi parameter tanggal (timePeriod, toDate, processingDate) > karena nilainya akan digunakan untuk beberapa service
 * 2. Ambil semua akun customer dari database
 * 3. Buat record batch dengan status "Queued"
 * 4. Update status batch menjadi "Processing"
 * 5. Proses customer menggunakan worker pool (max 10 concurrent)
 * 6. Update status batch menjadi "Completed"
 * 7. Return hasil batch
 */

export const batchWorkflow = workflow({
  name: "BatchWorkflow",
  handlers: {
    run: async (
      ctx: WorkflowContext,
      soaRequest: soaSchema
    ): Promise<IBatchWorkflowResult> => {
      // STEP 1: Inisialisasi Parameter Tanggal
      const processingDates = await ctx.run("initialize-dates", () => {
        const currentDate = new Date();
        return {
          timePeriod: formatTimePeriod(currentDate),
          toDate: formatDateToUnixTimestamp(currentDate),
          processingDate: currentDate.toISOString(),
        };
      });

      const soaProcessingType = soaRequest.type as SoaType;
      const soaOptions = {
        classOfBusiness: "ALL",
        branch: "ALL",
        maxRetries: 3,
        testMode: soaRequest.testMode ?? false,
        skipAgingFilter: soaRequest.skipAgingFilter ?? false,
        skipDcNoteCheck: soaRequest.skipDcNoteCheck ?? false,
      };

      // STEP 2: Ambil Data Akun Customer
      const accountsToProcess = await ctx.run(
        "get-all-accounts",
        async (): Promise<IAccount[]> => {
          const accounts = await getAllAccounts();
          if (!accounts || accounts.length === 0) {
            throw new Error("Tidak ada akun customer yang ditemukan");
          }
          return accounts;
        }
      );

      const totalAccounts = accountsToProcess.length;

      // STEP 3: Buat Record Batch
      const batchId = await ctx.run("create-batch", async () => {
        const newBatchId = formatUUID(uuidv4());
        await insertBatch(newBatchId, totalAccounts, "Queued");
        return newBatchId;
      });

      ctx.console.log(`mulai: ${batchId} dengan total ${totalAccounts} akun`);

      // STEP 4: Update Status ke Processing
      await ctx.run("processing-status-update", async () => {
        await updateBatchStatus(batchId, "Processing");
      });

      // STEP 5: Proses dengan Worker Pool
      const workerPool: Map<string, ActiveWorkerSlot> = new Map();
      let nextAccountIndex = 0;
      let processedAccountCount = 0;

      /**
       * Memulai proses SOA untuk satu akun customer.
       *
       * Tujuan:
       * - Membuat workflow client untuk customer berdasarkan accountId
       * - Memanggil soaWorkflow.run() dengan parameter lengkap
       * - Mendaftarkan promise ke worker pool untuk tracking
       *
       * Hubungan ke fungsi lain:
       * - Dipanggil oleh main loop setiap kali ada slot worker kosong
       * - Menggunakan `soaWorkflow` sebagai child workflow untuk proses detail
       * - Promise yang dibuat akan di-race untuk mendeteksi completion
       */
      const startAccountProcessing = (account: IAccount): void => {
        const accountId = account.code;

        const workerPromise = ctx
          .workflowClient<SoaWorkflow>(soaWorkflow, accountId)
          .run({
            customerId: accountId,
            timePeriod: processingDates.timePeriod,
            processingDate: processingDates.processingDate,
            batchId,
            classOfBusiness: soaOptions.classOfBusiness,
            branch: soaOptions.branch,
            toDate: processingDates.toDate,
            maxRetries: soaOptions.maxRetries,
            processingType: soaProcessingType,
            testMode: soaOptions.testMode,
            skipAgingFilter: soaOptions.skipAgingFilter,
            skipDcNoteCheck: soaOptions.skipDcNoteCheck,
          })
          .map(() => accountId);

        workerPool.set(accountId, {
          accountId,
          promise: workerPromise,
        });
      };

      // Isi worker pool sampai penuh atau semua akun sudah dimulai
      while (
        workerPool.size < MAX_WORKERS &&
        nextAccountIndex < totalAccounts
      ) {
        startAccountProcessing(accountsToProcess[nextAccountIndex]);
        nextAccountIndex++;
        await ctx.sleep(WORKER_START_DELAY);
      }

      // Proses sampai semua akun selesai
      while (workerPool.size > 0) {
        // Tunggu salah satu worker selesai
        const completedAccountId = await RestatePromise.race(
          Array.from(workerPool.values()).map((slot) => slot.promise)
        );

        // Hapus dari pool dan update counter
        workerPool.delete(completedAccountId);
        processedAccountCount++;

        // Log progress setiap N akun
        if (processedAccountCount % PROGRESS_LOG_INTERVAL === 0) {
          ctx.console.log(
            `[Batch] Progress: ${processedAccountCount}/${totalAccounts}`
          );
        }

        await ctx.sleep(POST_COMPLETION_DELAY);

        // Mulai proses akun berikutnya jika masih ada
        if (nextAccountIndex < totalAccounts) {
          startAccountProcessing(accountsToProcess[nextAccountIndex]);
          nextAccountIndex++;
          await ctx.sleep(WORKER_START_DELAY);
        }
      }

      // STEP 6: Update Status ke Completed
      await ctx.run("completed-status-update", async () => {
        await updateBatchStatus(batchId, "Completed");
      });

      ctx.console.log(
        `${batchId} selesai, proses: ${processedAccountCount} akun`
      );

      // STEP 7: Return Hasil Batch
      return {
        batchId,
        message: "Proses SOA batch berhasil diselesaikan",
        totalAccounts,
        status: "Completed",
      };
    },
  },
});
