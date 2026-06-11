# SOA Finance Comprehensive Improvements Design

**Date**: 2026-05-27
**Status**: Draft
**Approach**: Critical Path Focus (Approach C)

## Summary

Comprehensive improvements to the soa-finance app covering type safety, test coverage, error handling, performance, and observability. Uses a critical-path-first approach: improvements start with the core workflow (batch → customer → branches → reminder) and expand outward.

## Goals

1. **Reliability & correctness** — Better test coverage, error handling, edge cases
2. **Performance & scalability** — Parallel processing, timeouts, resource efficiency
3. **Developer experience** — Type safety, code organization, documentation
4. **Observability & debugging** — Logging, tracing, error reporting

## Constraints

- Breaking changes to internal APIs are acceptable
- Comprehensive batch changes (not incremental)
- Must maintain Restate durability guarantees (ctx.run(), no context methods inside callbacks)

## Non-Goals

- External API changes (handler signatures exposed to Restate clients)
- New features or business logic changes
- Infrastructure changes (Docker, deployment)

---

## Section 1: Type Safety & Constants Foundation

### 1.1 Branded types for IDs

**File**: `src/types/branded.ts` (new)

```typescript
type CustomerId = string & { readonly __brand: "CustomerId" };
type BranchCode = string & { readonly __brand: "BranchCode" };
type CorrelationId = string & { readonly __brand: "CorrelationId" };
```

**Rationale**: Prevents accidentally passing a branch code where a customer ID is expected. Zero runtime cost.

**Files affected**:
- `src/types/customer.type.ts` — Use `CustomerId` for `Account.code`
- `src/types/soa.type.ts` — Use `CustomerId` for `SoaItem.customerId`
- `src/modules/soa/objects/soa-customer.ts` — Update parameter types
- `src/modules/soa/workflows/batch-workflow.ts` — Update `accountId` type

### 1.2 Centralize env parsing

**File**: `src/constants/environment.ts` (modify)

Move `parseEnvInt` and `parseEnvList` from `batch-workflow.ts` to shared location.

```typescript
export function parseEnvInt(key: string, defaultVal: number): number {
  const raw = process.env[key];
  if (!raw) return defaultVal;
  const val = Number(raw);
  return Number.isFinite(val) && val > 0 ? val : defaultVal;
}

export function parseEnvList(key: string): string[] | null {
  const raw = process.env[key];
  if (!raw) return null;
  const items = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  return items.length > 0 ? items : null;
}
```

**Files affected**:
- `src/modules/soa/workflows/batch-workflow.ts` — Remove local copies, import from environment.ts

### 1.3 Stricter SoaType enum

**File**: `src/types/soa.type.ts` (modify)

```typescript
export const SoaType = {
  SOA: 1,
  RL1: 2,
  RL2: 3,
  WL: 4,
} as const;
export type SoaType = (typeof SoaType)[keyof typeof SoaType];
```

**Files affected**:
- `src/constants/schedule.ts` — Use `SoaType.SOA` etc. instead of magic numbers
- `src/modules/soa/workflows/batch-workflow.ts` — Use enum values

### 1.4 Move `toExcelDate` out of constants

**File**: `src/utils/formatter/date.formatter.ts` (modify)

Move `toExcelDate` and `parseSlashDate` from `constants.ts` to date formatter where other date utilities live.

**Files affected**:
- `src/constants/constants.ts` — Remove `toExcelDate`, `parseSlashDate`, `DATE_PATTERN`
- `src/modules/document-generation/excel-generator.ts` — Update import

---

## Section 2: Critical Path Test Coverage

### 2.1 `batch-workflow.test.ts` (new)

**File**: `src/modules/soa/workflows/batch-workflow.test.ts`

Test cases:
- Input validation: invalid `soaSchema` → `TerminalError`
- Dev mode filtering: only `SOA_TEST_CUSTOMERS` processed when `isDevelopment()`
- Chunk processing: verify `MAX_WORKERS` respected (accounts processed in chunks)
- Error isolation: one account failure doesn't kill batch, result includes failed accounts
- Empty accounts: throws Error when no accounts found

Mock strategy:
- Mock `getAgentAccounts` to return test data
- Mock `soaCustomer.process` to simulate success/failure
- Mock `ctx.date.now()`, `ctx.set()`, `ctx.console.log()`

### 2.2 `soa-customer.test.ts` (new)

**File**: `src/modules/soa/objects/soa-customer.test.ts`

Test cases:
- Key mismatch: `ctx.key !== customerId` → `TerminalError`
- Branching logic: `processingType === 1` → SOA path, else → reminder path
- `hasRemindersForPeriod`: returns true when reminders exist for period
- `cleanupOldPeriodState`: removes keys older than `PERIODS_TO_KEEP`
- Customer not found: `getAccountById` returns null → `TerminalError`

Mock strategy:
- Mock `getAccountById`
- Mock `processBranchSoa`, `processReminderLetter`
- Mock `readDcNoteIndex` for reminder check
- Mock `ctx.stateKeys()`, `ctx.clear()` for cleanup

### 2.3 `process-branches.test.ts` (new)

**File**: `src/modules/soa/services/process-branches.test.ts`

Test cases:
- Single branch: routes to `processSingleBranchDirect`
- Multi branch: routes to `processMultiBranchSoa`
- Empty staging data: returns `{ hasDocuments: false }`
- Branch error isolation: one branch failure doesn't kill others
- `TerminalError` propagation: re-throws terminal errors

Mock strategy:
- Mock `getAllBranches`, `getStagingSoaData`
- Mock `generateAndUploadDocuments`, `sendWithAttachments`
- Mock `createReminder`
- Mock `isDevelopment()` for multi-branch check

### 2.4 `generate-reminder-letter.test.ts` (new)

**File**: `src/modules/reminder/generate-reminder-letter.test.ts`

Test cases:
- `validateReminderType`: skip when type is SOA, skip when already sent, skip when exceeds max
- Dev mode email: uses `customer.email` or `DEV_TEST_EMAIL` fallback
- All paid scenario: returns `{ sent: false, reason: "ALL_PAID" }`
- Normal flow: generates, uploads, sends, updates letter status

Mock strategy:
- Mock `getAccountEmails`, `getUnpaidSoaData`
- Mock `assignLetterRecord`, `updateLetterStatus`
- Mock `generateAndUploadDocuments`, `sendWithAttachments`

---

## Section 3: Error Handling Consistency

### 3.1 Structured error types

**File**: `src/types/errors.ts` (new)

```typescript
export class SoaError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "SoaError";
  }
}

export class CustomerNotFoundError extends SoaError {
  constructor(customerId: string) {
    super(`Customer ${customerId} not found`, "CUSTOMER_NOT_FOUND", false);
  }
}

export class PipelineTimeoutError extends SoaError {
  constructor(durationMs: number) {
    super(`Pipeline timed out after ${durationMs}ms`, "PIPELINE_TIMEOUT", true);
  }
}

export class EmailDeliveryError extends SoaError {
  constructor(recipient: string, cause?: Error) {
    super(`Failed to send email to ${recipient}`, "EMAIL_DELIVERY_FAILED", true);
    this.cause = cause;
  }
}
```

### 3.2 Health check improvements

**File**: `src/utils/health.ts` (modify)

```typescript
interface HealthCheckResult {
  ok: boolean;
  error?: string;
  latencyMs: number;
}

export async function checkS3BucketAccess(): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const client = getS3Client();
    const bucket = getBucketName();
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.warn({ component: "HealthCheck", bucket: getBucketName(), err: error }, "S3 check failed");
    return { ok: false, error: message, latencyMs: Date.now() - start };
  }
}
```

**Files affected**:
- `src/app.local.ts` — Update to use new return type

### 3.3 Error context helper

**File**: `src/utils/error-context.ts` (new)

```typescript
export function errorToContext(error: unknown): Record<string, unknown> {
  if (error instanceof SoaError) {
    return { code: error.code, retryable: error.retryable, message: error.message };
  }
  if (error instanceof Error) {
    return { message: error.message, name: error.name };
  }
  return { message: String(error) };
}
```

**Files affected**:
- `src/modules/soa/workflows/batch-workflow.ts` — Use `errorToContext` in catch blocks
- `src/modules/soa/objects/soa-customer.ts` — Use `errorToContext` in catch blocks
- `src/modules/soa/services/process-branches.ts` — Use `errorToContext` in catch blocks

---

## Section 4: Performance — Parallel Branch Processing

### 4.1 Parallelize multi-branch processing

**File**: `src/modules/soa/services/process-branches.ts` (modify)

**Current** (sequential):
```typescript
const branchResults: BranchResult[] = [];
for (const [index, b] of branches.entries()) {
  const result = await processBranchWithIsolation(b, index, stagingDataList, soaParams);
  branchResults.push(result);
}
```

**After** (parallel with error isolation):
```typescript
const branchPromises = branches.map((b, index) =>
  processBranchWithIsolation(b, index, stagingDataList, soaParams)
    .map((_value, failure): BranchResult => {
      if (failure) {
        ctx.console.log(`[Branch] Failed ${b.officeCode}: ${failure.message}`);
        return { hasDocuments: false };
      }
      return _value;
    })
);
const branchResults = await RestatePromise.all(branchPromises);
```

**Rationale**: Uses the same `.map(value, failure)` pattern as batch-workflow for consistency. Branches process concurrently, failures isolated. Staging data reads are already parallelized (line 129-136), this completes the picture.

**Risk**: Medium — Changes execution order, but each branch is independent.

---

## Section 5: Observability — Structured Logging & Correlation

### 5.1 Correlation ID propagation

**Files affected**:
- `src/types/soa.type.ts` — Add `correlationId?: string` to `SoaItem`
- `src/modules/soa/workflows/batch-workflow.ts` — Generate and set correlation ID
- `src/modules/soa/objects/soa-customer.ts` — Pass correlation ID through

**Implementation**:
```typescript
// In batch-workflow.ts
const correlationId = `batch:${processingDates.timePeriod}:${Date.now()}` as CorrelationId;
ctx.set("correlationId", correlationId);

// Pass to soa-customer
ctx.objectClient(soaCustomer, accountId).process({
  ...soaParams,
  correlationId,
});
```

### 5.2 Structured log context helper

**File**: `src/utils/logger.ts` (modify)

```typescript
export function workflowLog(ctx: ObjectContext, component: string) {
  return {
    component,
    correlationId: ctx.get<string>("correlationId"),
    workflowId: ctx.key,
  };
}
```

**Files affected**:
- `src/modules/soa/workflows/batch-workflow.ts` — Use `workflowLog`
- `src/modules/soa/objects/soa-customer.ts` — Use `workflowLog`
- `src/modules/soa/services/process-branches.ts` — Use `workflowLog`

### 5.3 Timing metrics for critical paths

**Files affected**:
- `src/modules/soa/services/process-branches.ts` — Add timing around branch processing
- `src/modules/reminder/generate-reminder-letter.ts` — Add timing around generate+send

**Implementation**:
```typescript
const start = await ctx.date.now();
// ... do work ...
const duration = await ctx.date.now() - start;
ctx.console.log({ component: "Branch", durationMs: duration }, "Branch completed");
```

---

## Summary

| Section | Files Changed | New Files | Risk |
|---------|--------------|-----------|------|
| 1. Type Safety | 4-5 | 1 (branded.ts) | Low |
| 2. Test Coverage | 0 | 4 | Low |
| 3. Error Handling | 5-6 | 2 (errors.ts, error-context.ts) | Medium |
| 4. Parallel Branches | 1 | 0 | Medium |
| 5. Observability | 3-4 | 0 | Low |
| **Total** | ~15 | ~7 | |

## Implementation Order

1. **Section 1** (Type Safety) — Foundation, no behavior changes
2. **Section 2** (Tests) — Validates current behavior before changes
3. **Section 3** (Error Handling) — Improves error patterns
4. **Section 4** (Parallel Branches) — Performance improvement
5. **Section 5** (Observability) — Adds debugging capabilities

## Success Criteria

- [ ] All existing tests pass
- [ ] New tests cover critical path (batch → customer → branches → reminder)
- [ ] `bun run typecheck` passes
- [ ] `bun run check` (lint) passes
- [ ] Multi-branch processing uses `RestatePromise.all`
- [ ] Correlation IDs flow through workflow chain
- [ ] Error types are structured with codes and retryable flag
