import { executeQuery } from "../postgres.js";
import type { Branch } from "../types.js";

export const getAllBranches = async (): Promise<Branch[]> => {
  const sQuery = `SELECT OFFICE_CODE AS "officeCode", CONTACT_PERSON AS "name" FROM MASTER_BRANCH`;
  const result = await executeQuery<Branch>(sQuery);
  return result.rows;
};
