import { executeQuery } from "../postgres.js";
import type { Branch } from "../types.js";

export const getAllBranches = async (): Promise<Branch[]> => {
  const sQuery = `SELECT OFFICE_CODE AS "officeCode", DESCRIPTION AS "name" FROM MASTER_BRANCH ORDER BY OFFICE_CODE`;
  const result = await executeQuery<Branch>(sQuery);
  return result.rows;
};
