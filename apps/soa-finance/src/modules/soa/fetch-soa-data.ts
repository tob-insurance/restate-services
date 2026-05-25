import { AGING_THRESHOLD } from "../../constants/constants.js";
import type { StatementOfAccountModel } from "../../types/soa.type.js";

/**
 * Filters SOA data to aging-qualified items.
 * No ctx calls, no side effects. Safe to call inside or outside ctx.run().
 */
export function filterAgingData(
  soaList: StatementOfAccountModel[]
): StatementOfAccountModel[] | null {
  const filtered = soaList.filter((soa) => soa.aging >= AGING_THRESHOLD);
  return filtered.length > 0 ? filtered : null;
}
