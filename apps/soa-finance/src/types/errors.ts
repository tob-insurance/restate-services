import { TerminalError } from "@restatedev/restate-sdk";

/**
 * Base error for all SOA-specific errors.
 * Provides structured error codes and retryable flag for Restate retry logic.
 *
 * IMPORTANT: For non-retryable errors (retryable=false), throw as TerminalError
 * to prevent Restate retries. Use toTerminalIfNonRetryable() helper.
 */
export class SoaError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code: string, retryable: boolean) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.name = new.target.name; // Use subclass name, not "SoaError"
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
    super(
      `Failed to send email to ${recipient}`,
      "EMAIL_DELIVERY_FAILED",
      true
    );
    this.cause = cause;
  }
}

export class StagingDataError extends SoaError {
  constructor(customerId: string, branchCode: string) {
    super(
      `No staging data for customer ${customerId} branch ${branchCode}`,
      "STAGING_DATA_EMPTY",
      false
    );
  }
}

/**
 * Convert a SoaError to TerminalError if non-retryable.
 * Use this when throwing errors in Restate handlers:
 *
 *   throw toTerminalIfNonRetryable(error);
 */
export function toTerminalIfNonRetryable(error: unknown): Error {
  if (error instanceof SoaError && !error.retryable) {
    return new TerminalError(error.message);
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}
