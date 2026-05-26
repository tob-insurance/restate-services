import type { SoaError } from "../types/errors.js";

/**
 * Convert an error to a structured context object for logging.
 * Extracts code and retryable flag from SoaError instances.
 */
export function errorToContext(error: unknown): Record<string, unknown> {
  if (error instanceof Error && "code" in error && "retryable" in error) {
    const soaError = error as SoaError;
    return {
      code: soaError.code,
      message: soaError.message,
      name: soaError.name,
      retryable: soaError.retryable,
    };
  }
  if (error instanceof Error) {
    return { message: error.message, name: error.name };
  }
  return { message: String(error) };
}
