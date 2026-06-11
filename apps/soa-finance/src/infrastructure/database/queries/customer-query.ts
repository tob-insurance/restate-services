import { SENTINEL_ALL } from "../../../constants/constants.js";
import type { Account } from "../../../types/customer.type.js";
import { executeQuery } from "../postgres.js";

/**
 * Fetch all agent accounts for SOA processing.
 *
 * Queries `IS_CUSTOMER = 'N'` — these are agent/broker accounts that receive
 * SOA statements (4,831 rows out of 13.7M total in MASTER_CM).
 * Only populates `code`, `name`, and `actingCode`; other Account fields
 * are `undefined` at runtime.
 *
 * Performance: Uses `idx_master_cm_customer_code(is_customer, cm_code)`
 * index scan. ~11.6ms for 4,831 rows. No sort step needed — index covers
 * the ORDER BY.
 */
export const getAgentAccounts = async (): Promise<Account[]> => {
  const query = `SELECT 
      CM_CODE AS "code", 
      CM_NAME AS "name",
      ACTING_CODE AS "actingCode"
    FROM MASTER_CM 
    WHERE IS_CUSTOMER = 'N'
    ORDER BY CM_CODE`;

  const result = await executeQuery<Account>(query);
  return result.rows;
};

export const getAccountById = async (
  customerId: string
): Promise<Account | null> => {
  const query = `
    SELECT 
      CM_CODE AS "code", 
      CM_NAME AS "name",
      CM_FULLNAME AS "fullName", 
      ACTING_CODE AS "actingCode", 
      EMAIL AS "email",
      VIRTUAL_ACC AS "virtualAccount"
    FROM MASTER_CM 
    WHERE CM_CODE = $1
  `;

  const result = await executeQuery<Account>(query, [customerId]);
  return result.rows?.[0] ?? null;
};

interface EmailRow {
  EMAIL: string;
}

export const getAccountEmails = async (
  cmCode: string,
  officeCode?: string | null
): Promise<string[]> => {
  let query = `
    SELECT DISTINCT EMAIL 
    FROM MASTER_COLLECTION 
    WHERE CM_CODE = $1 
      AND EMAIL IS NOT NULL
    ORDER BY EMAIL
  `;

  const params: unknown[] = [cmCode];

  if (officeCode && officeCode !== SENTINEL_ALL) {
    query += " AND OFFICE_CODE = $2";
    params.push(officeCode);
  }

  const result = await executeQuery<EmailRow>(query, params);
  return result.rows.map((r) => r.EMAIL).filter(Boolean);
};
