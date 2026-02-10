import { executeQuery } from "../database";
import type { IBranch } from "../types";

export const getAllBranches = async (): Promise<IBranch[]> => {
  const sQuery = `SELECT OFFICE_CODE AS "officeCode", CONTACT_PERSON AS "name" FROM MASTER_BRANCH`;

  const result = await executeQuery(sQuery);
  const rows = result.rows as IBranch[];
  return rows;
};
