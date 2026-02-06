import type { IBranch } from "../../types";
import { executeQuery } from "../database";

export const getAllBranches = async (): Promise<IBranch[]> => {
  const sQuery = `SELECT OFFICE_CODE AS "officeCode", CONTACT_PERSON AS "name" FROM MASTER_BRANCH`;

  const result = await executeQuery(sQuery);
  const rows = result.rows as IBranch[];
  return rows;
};
