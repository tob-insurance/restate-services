/**
 * Branded types for type-safe ID handling.
 * Zero runtime cost — compile-time safety only.
 */

export type CustomerId = string & { readonly __brand: "CustomerId" };
export type BranchCode = string & { readonly __brand: "BranchCode" };
export type CorrelationId = string & { readonly __brand: "CorrelationId" };

/**
 * Helper to cast a string to a branded type.
 * Use at system boundaries (DB queries, API inputs) only.
 */
export function asCustomerId(code: string): CustomerId {
  return code as CustomerId;
}

export function asBranchCode(code: string): BranchCode {
  return code as BranchCode;
}

export function asCorrelationId(id: string): CorrelationId {
  return id as CorrelationId;
}
