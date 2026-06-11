import { withConnection as withPostgresConnection } from "@restate-tob/postgres";
import type { PoolClient } from "pg";
import { getPostgresClient } from "../../infrastructure/index.js";
import type { CalculatedTrialBalance } from "./sync.service.js";

interface CoaRow {
  code: string;
  level: number;
  name: string;
  parent_code: string | null;
}

interface CoaAndBranchesRow {
  code: string;
  level: number | null;
  name: string | null;
  parent_code: string | null;
  row_type: "coa" | "branch";
}

interface CoaAndBranches {
  branches: Set<string>;
  coaList: CoaRow[];
}

async function fetchCoaAndBranches(): Promise<CoaAndBranches> {
  const coaList: CoaRow[] = [];
  const branches = new Set<string>();

  await withPostgresConnection(
    getPostgresClient(),
    async (client: PoolClient) => {
      const result = await client.query<CoaAndBranchesRow>(
        `
        SELECT
          'coa'::text AS row_type,
          code,
          parent_code,
          level,
          name
        FROM financial_report.legacy_chart_of_accounts
        UNION ALL
        SELECT
          'branch'::text AS row_type,
          code,
          NULL AS parent_code,
          NULL AS level,
          NULL AS name
        FROM financial_report.branches
        ORDER BY row_type, level DESC NULLS LAST, code ASC
        `
      );

      for (const row of result.rows) {
        if (row.row_type === "coa") {
          coaList.push({
            code: row.code,
            parent_code: row.parent_code,
            level: row.level ?? 0,
            name: row.name ?? "",
          });
        } else {
          branches.add(row.code);
        }
      }
    }
  );

  return { coaList, branches };
}

function buildHierarchyMaps(coaList: CoaRow[]): {
  childrenLookup: Map<string, CoaRow[]>;
  coaByLevel: Map<number, CoaRow[]>;
} {
  const childrenLookup = new Map<string, CoaRow[]>();
  const coaByLevel = new Map<number, CoaRow[]>();

  for (const coa of coaList) {
    if (coa.parent_code) {
      const children = childrenLookup.get(coa.parent_code) ?? [];
      children.push(coa);
      childrenLookup.set(coa.parent_code, children);
    }

    const levelList = coaByLevel.get(coa.level) ?? [];
    levelList.push(coa);
    coaByLevel.set(coa.level, levelList);
  }

  return { childrenLookup, coaByLevel };
}

function extractGeniusBranches(
  geniusData: Map<string, CalculatedTrialBalance>
): Set<string> {
  const branches = new Set<string>();
  for (const key of geniusData.keys()) {
    const [, branch] = key.split("|");
    if (branch) {
      branches.add(branch);
    }
  }
  return branches;
}

function createZeroBalance(
  coaCode: string,
  branchCode: string,
  description: string
): CalculatedTrialBalance {
  return {
    coaCode,
    branchCode,
    description,
    startDebit: 0,
    startCredit: 0,
    startBalance: 0,
    movementDebit: 0,
    movementCredit: 0,
    movementBalance: 0,
    endDebit: 0,
    endCredit: 0,
    endBalance: 0,
    hasAnyValue: false,
  };
}

function aggregateBalances(
  coaCode: string,
  branchCode: string,
  description: string,
  children: CalculatedTrialBalance[]
): CalculatedTrialBalance {
  const agg = createZeroBalance(coaCode, branchCode, description);

  for (const child of children) {
    agg.startDebit += child.startDebit;
    agg.startCredit += child.startCredit;
    agg.startBalance += child.startBalance;
    agg.movementDebit += child.movementDebit;
    agg.movementCredit += child.movementCredit;
    agg.movementBalance += child.movementBalance;
    agg.endDebit += child.endDebit;
    agg.endCredit += child.endCredit;
    agg.endBalance += child.endBalance;
  }

  agg.hasAnyValue =
    agg.startDebit !== 0 ||
    agg.startCredit !== 0 ||
    agg.startBalance !== 0 ||
    agg.movementDebit !== 0 ||
    agg.movementCredit !== 0 ||
    agg.movementBalance !== 0 ||
    agg.endDebit !== 0 ||
    agg.endCredit !== 0 ||
    agg.endBalance !== 0;

  return agg;
}

function calculateBalanceForCoa(
  coa: CoaRow,
  branch: string,
  geniusData: Map<string, CalculatedTrialBalance>,
  calculatedLookup: Map<string, CalculatedTrialBalance>,
  children: CoaRow[] | undefined
): CalculatedTrialBalance {
  const isLeaf = !children || children.length === 0;

  if (isLeaf) {
    const key = `${coa.code}|${branch}`;
    return geniusData.get(key) ?? createZeroBalance(coa.code, branch, coa.name);
  }

  const childValues = children
    .map((child) => calculatedLookup.get(`${child.code}|${branch}`))
    .filter((val): val is CalculatedTrialBalance => Boolean(val));

  if (childValues.length === 0) {
    return createZeroBalance(coa.code, branch, coa.name);
  }

  return aggregateBalances(coa.code, branch, coa.name, childValues);
}

export async function processCoaHierarchy(
  geniusData: Map<string, CalculatedTrialBalance>
): Promise<CalculatedTrialBalance[]> {
  const { coaList, branches: dbBranches } = await fetchCoaAndBranches();

  const { childrenLookup, coaByLevel } = buildHierarchyMaps(coaList);

  const geniusBranches = extractGeniusBranches(geniusData);
  const branches = geniusBranches.size > 0 ? geniusBranches : dbBranches;

  const sortedLevels = Array.from(coaByLevel.keys()).sort((a, b) => b - a);
  const calculatedLookup = new Map<string, CalculatedTrialBalance>(geniusData);
  const result: CalculatedTrialBalance[] = [];

  for (const level of sortedLevels) {
    const coasInLevel = coaByLevel.get(level) ?? [];

    for (const coa of coasInLevel) {
      const children = childrenLookup.get(coa.code);

      for (const branch of branches) {
        const balance = calculateBalanceForCoa(
          coa,
          branch,
          geniusData,
          calculatedLookup,
          children
        );

        calculatedLookup.set(`${coa.code}|${branch}`, balance);

        if (balance.hasAnyValue) {
          result.push(balance);
        }
      }
    }
  }

  return result;
}
