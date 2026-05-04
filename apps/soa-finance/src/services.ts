import { letterCounter } from "./modules/soa/objects/letter-counter.js";
import { soaCustomer } from "./modules/soa/objects/soa-customer.js";
import { batchWorkflow } from "./modules/soa/workflows/batch-workflow.js";
import { SoaScheduler } from "./pipeline/scheduler.js";

export const sharedServices = [
  batchWorkflow,
  SoaScheduler,
  soaCustomer,
  letterCounter,
];
