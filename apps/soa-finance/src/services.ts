import { letterCounter } from "./modules/soa/objects/letter-counter.js";
import { reminderCleanup } from "./modules/soa/objects/reminder-cleanup.js";
import { soaCustomer } from "./modules/soa/objects/soa-customer.js";
import { batchWorkflow } from "./modules/soa/workflows/batch-workflow.js";
import { SoaRefreshManager } from "./pipeline/refresh-manager.js";
import { SoaScheduler } from "./pipeline/scheduler.js";

export const sharedServices = [
  batchWorkflow,
  SoaScheduler,
  SoaRefreshManager,
  soaCustomer,
  letterCounter,
  reminderCleanup,
];
