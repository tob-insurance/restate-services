export const PG_ERROR_CODES = {
  NOT_NULL_VIOLATION: "23502",
  FOREIGN_KEY_VIOLATION: "23503",
  UNIQUE_VIOLATION: "23505",
  CHECK_VIOLATION: "23514",
} as const;

export type PgErrorCode = (typeof PG_ERROR_CODES)[keyof typeof PG_ERROR_CODES];

export const DATA_INTEGRITY_ERROR_CODES: readonly PgErrorCode[] = [
  PG_ERROR_CODES.NOT_NULL_VIOLATION,
  PG_ERROR_CODES.FOREIGN_KEY_VIOLATION,
  PG_ERROR_CODES.UNIQUE_VIOLATION,
  PG_ERROR_CODES.CHECK_VIOLATION,
];

export function isDataIntegrityError(code: string | undefined): boolean {
  return DATA_INTEGRITY_ERROR_CODES.includes(code as PgErrorCode);
}
