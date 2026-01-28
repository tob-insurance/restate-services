import type { IAccount } from "../../../module/utils/types";
import { executeQuery } from "../database";

export const getAllAccounts = async () => {
  const query = `SELECT 
      CM_CODE AS "code", 
      CM_NAME AS "name",
      CM_FULLNAME AS "fullName",
      ACTING_CODE AS "actingCode"
    FROM MASTER_CM 
    WHERE IS_CUSTOMER = 'N' 
    AND ROWNUM <= 5`;

  const result = await executeQuery(query);
  const rows = (result.rows as IAccount[]) || [];

  return rows;
};

export const getAccountById = async (
  customerId: string
): Promise<IAccount | null> => {
  const query = `
    SELECT 
      CM_CODE AS "code", 
      CM_FULLNAME AS "fullName", 
      ACTING_CODE AS "actingCode", 
      EMAIL AS "email",
      VIRTUAL_ACC AS "virtualAccount"
    FROM MASTER_CM 
    WHERE CM_CODE = :customerId
  `;

  const result = await executeQuery(query, { customerId });
  const rows = (result.rows as IAccount[]) || [];

  return rows?.[0] ?? null;
};

type EmailRow = { EMAIL: string };

export const getAccountEmails = async (
  cmCode: string,
  officeCode?: string | null
): Promise<string[]> => {
  let query = `
    SELECT DISTINCT EMAIL 
    FROM MASTER_COLLECTION 
    WHERE CM_CODE = :cmCode 
      AND EMAIL IS NOT NULL
  `;

  const binds: Record<string, string> = { cmCode };

  if (officeCode && officeCode !== "ALL") {
    query += " AND OFFICE_CODE = :officeCode";
    binds.officeCode = officeCode;
  }

  const result = await executeQuery(query, binds);
  const rows =
    (result.rows as EmailRow[])?.map((r) => r.EMAIL).filter(Boolean) ?? [];

  return rows;
};
