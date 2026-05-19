import { withConnection as withPostgresConnection } from "@restate-tob/postgres";
import type { PoolClient } from "pg";
import { getPostgresClient } from "../../infrastructure/index.js";

/**
 * Represents a calculated trial balance record.
 * Previously imported from @restate-tob/oracle, now defined locally
 * since Oracle dependency has been removed.
 */
export type CalculatedTrialBalance = {
  coaCode: string;
  branchCode: string;
  description: string;
  startDebit: number;
  startCredit: number;
  startBalance: number;
  movementDebit: number;
  movementCredit: number;
  movementBalance: number;
  endDebit: number;
  endCredit: number;
  endBalance: number;
  hasAnyValue: boolean;
};

/**
 * Represents a raw open balance record from the Genius PostgreSQL database.
 */
type OpenBalanceRow = {
  coacode: string;
  description: string;
  year: number;
  month: number;
  branch: string;
  beginningdebit: string;
  beginningcredit: string;
  debitamount: string;
  creditamount: string;
  endingdebit: string;
  endingcredit: string;
};

export type SyncTrialBalanceResult = {
  success: boolean;
  recordsProcessed: number;
  message: string;
  startTime: Date;
  endTime: Date;
  duration: number;
};

export async function syncTrialBalanceFromGenius(
  year: number,
  month: number
): Promise<SyncTrialBalanceResult> {
  const startTime = new Date();
  console.log(
    `🔄 Syncing trial balance data for year: ${year}, month: ${month}`
  );

  try {
    // Delete existing data for the period from financial_report PostgreSQL
    await withPostgresConnection(
      getPostgresClient(),
      async (client: PoolClient) => {
        await client.query("SET search_path TO financial_report");
        const deleteResult = await client.query(
          `DELETE FROM legacy_trial_balances 
         WHERE year = $1 AND month = $2`,
          [year, month]
        );
        console.log(
          `🗑️  Deleted ${deleteResult.rowCount} existing records for ${year}-${month}`
        );
      }
    );

    // Extract data from Genius PostgreSQL (replaces Oracle OpenBalanceRepository)
    const geniusData = new Map<string, CalculatedTrialBalance>();

    await withPostgresConnection(
      getPostgresClient(),
      async (client: PoolClient) => {
        // AC_GLOPENBALANCE lives in the acpdb schema (legacy Genius data).
        await client.query("SET search_path TO acpdb");
        const query = `
          SELECT
              op.COACODE,
              MAX(op.DESCRIPTION) AS description,
              op.GLYEAR AS year,
              op.GLMONTH AS month,
              op.BRANCH,
              SUM(op.BEGINNING_DEBIT) AS beginningdebit,
              SUM(op.BEGINNING_CREDIT) AS beginningcredit,
              SUM(op.DEBIT_AMOUNT) AS debitamount,
              SUM(op.CREDIT_AMOUNT) AS creditamount,
              SUM(op.ENDING_DEBIT) AS endingdebit,
              SUM(op.ENDING_CREDIT) AS endingcredit
          FROM AC_GLOPENBALANCE op
          WHERE op.GLYEAR = $1 AND op.GLMONTH = $2
          GROUP BY op.COACODE, op.BRANCH, op.GLYEAR, op.GLMONTH
        `;

        const result = await client.query<OpenBalanceRow>(query, [year, month]);

        for (const row of result.rows) {
          const key = `${row.coacode}|${row.branch}`;
          geniusData.set(key, {
            coaCode: row.coacode,
            branchCode: row.branch,
            description: row.description,
            startDebit: Number.parseFloat(String(row.beginningdebit)),
            startCredit: Number.parseFloat(String(row.beginningcredit)),
            startBalance:
              Number.parseFloat(String(row.beginningdebit)) -
              Number.parseFloat(String(row.beginningcredit)),
            movementDebit: Number.parseFloat(String(row.debitamount)),
            movementCredit: Number.parseFloat(String(row.creditamount)),
            movementBalance:
              Number.parseFloat(String(row.debitamount)) -
              Number.parseFloat(String(row.creditamount)),
            endDebit: Number.parseFloat(String(row.endingdebit)),
            endCredit: Number.parseFloat(String(row.endingcredit)),
            endBalance:
              Number.parseFloat(String(row.endingdebit)) -
              Number.parseFloat(String(row.endingcredit)),
            hasAnyValue: true,
          });
        }
      }
    );

    console.log(`📊 Extracted ${geniusData.size} records from Genius system`);

    const calculatedData = await processCoaHierarchy(geniusData);

    // Insert the calculated data into PostgreSQL
    if (calculatedData.length > 0) {
      await withPostgresConnection(
        getPostgresClient(),
        async (client: PoolClient) => {
          await client.query("SET search_path TO financial_report");

          // Use a transaction for bulk insert
          await client.query("BEGIN");

          try {
            const BATCH_SIZE = 1000;
            for (let i = 0; i < calculatedData.length; i += BATCH_SIZE) {
              const batch = calculatedData.slice(i, i + BATCH_SIZE);
              const values: (string | number)[] = [];
              const placeholders: string[] = [];

              batch.forEach((record, idx) => {
                const offset = idx * 15;
                placeholders.push(`(
                  gen_random_uuid(), $${offset + 1}, $${offset + 2}, ${`$${offset + 3}`}, $${offset + 4}, $${offset + 5}, $${offset + 6}, ${`$${offset + 7}`}, $${offset + 8}, $${offset + 9}, 
                  $${offset + 10}, $${offset + 11}, $${offset + 12}, ${`$${offset + 13}`}, $${offset + 14}, $${offset + 15}, NOW(), NOW()
                )`);

                values.push(
                  record.coaCode,
                  record.description,
                  record.branchCode,
                  year,
                  month,
                  "IDR",
                  record.startDebit,
                  record.startCredit,
                  record.startBalance,
                  record.movementDebit,
                  record.movementCredit,
                  record.movementBalance,
                  record.endDebit,
                  record.endCredit,
                  record.endBalance
                );
              });

              const query = `
                INSERT INTO legacy_trial_balances (
                  id, chart_of_account_code, description, branch_code, year, month, 
                  currency_code, start_debit, start_credit, start_balance, 
                  movement_debit, movement_credit, movement_balance, 
                  end_debit, end_credit, end_balance, created_at, updated_at
                ) VALUES ${placeholders.join(", ")}
                ON CONFLICT (chart_of_account_code, year, month, branch_code, currency_code)
                DO UPDATE SET
                  description = EXCLUDED.description,
                  start_debit = EXCLUDED.start_debit,
                  start_credit = EXCLUDED.start_credit,
                  start_balance = EXCLUDED.start_balance,
                  movement_debit = EXCLUDED.movement_debit,
                  movement_credit = EXCLUDED.movement_credit,
                  movement_balance = EXCLUDED.movement_balance,
                  end_debit = EXCLUDED.end_debit,
                  end_credit = EXCLUDED.end_credit,
                  end_balance = EXCLUDED.end_balance,
                  updated_at = NOW()
              `;

              await client.query(query, values);
            }

            await client.query("COMMIT");
            console.log(
              `✅ Inserted ${calculatedData.length} records into PostgreSQL`
            );
          } catch (error) {
            await client.query("ROLLBACK");
            console.error("❌ Failed to insert trial balance records:", error);
            throw error;
          }
        }
      );
    }

    const endTime = new Date();
    const duration = endTime.getTime() - startTime.getTime();

    console.log(
      `✅ Trial balance sync completed in ${duration}ms. Records processed: ${calculatedData.length}`
    );

    return {
      success: true,
      recordsProcessed: calculatedData.length,
      message: `Successfully synchronized ${calculatedData.length} trial balance records`,
      startTime,
      endTime,
      duration,
    };
  } catch (error) {
    const endTime = new Date();
    const duration = endTime.getTime() - startTime.getTime();

    console.error("❌ Trial balance sync failed:", error);
    return {
      success: false,
      recordsProcessed: 0,
      message:
        error instanceof Error ? error.message : "Unknown error occurred",
      startTime,
      endTime,
      duration,
    };
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex hierarchy logic
async function processCoaHierarchy(
  geniusData: Map<string, CalculatedTrialBalance>
): Promise<CalculatedTrialBalance[]> {
  console.log("🔄 Processing COA hierarchy...");

  // 1. Fetch COA structure from Postgres
  const coaList: Array<{
    code: string;
    parent_code: string | null;
    level: number;
    name: string;
  }> = [];

  await withPostgresConnection(
    getPostgresClient(),
    async (client: PoolClient) => {
      await client.query("SET search_path TO financial_report");
      const result = await client.query(
        `SELECT code, parent_code, level, name 
       FROM legacy_chart_of_accounts 
       ORDER BY level DESC, code ASC`
      );
      coaList.push(...result.rows);
    }
  );

  console.log(
    `POK: Loaded ${coaList.length} COA records for hierarchy processing`
  );

  // 2. Build relationships
  const childrenLookup = new Map<string, typeof coaList>();
  const coaByLevel = new Map<number, typeof coaList>();

  for (const coa of coaList) {
    if (coa.parent_code) {
      const children = childrenLookup.get(coa.parent_code) || [];
      children.push(coa);
      childrenLookup.set(coa.parent_code, children);
    }

    const levelList = coaByLevel.get(coa.level) || [];
    levelList.push(coa);
    coaByLevel.set(coa.level, levelList);
  }

  // Get distinct branches from Genius data
  const branches = new Set<string>();
  for (const key of geniusData.keys()) {
    const [, branch] = key.split("|");
    if (branch) {
      branches.add(branch);
    }
  }

  // If no branches in Genius data, try fetching from DB (rare case if Genius has data)
  if (branches.size === 0) {
    await withPostgresConnection(
      getPostgresClient(),
      async (client: PoolClient) => {
        const res = await client.query("SELECT DISTINCT code FROM branches");
        for (const row of res.rows) {
          branches.add(row.code);
        }
      }
    );
  }

  const sortedLevels = Array.from(coaByLevel.keys()).sort((a, b) => b - a);
  const calculatedLookup = new Map<string, CalculatedTrialBalance>();
  const result: CalculatedTrialBalance[] = [];

  // Initialize lookup with Genius data (Leaf nodes)
  for (const [key, value] of geniusData) {
    calculatedLookup.set(key, value);
  }

  // 3. Iterate levels bottom-up
  for (const level of sortedLevels) {
    const coasInLevel = coaByLevel.get(level) || [];

    for (const coa of coasInLevel) {
      for (const branch of branches) {
        const key = `${coa.code}|${branch}`;

        // Check if it's a leaf node (no children in lookup) OR explicitly in Genius data
        // Note: C# logic prioritizes Genius data for leaves, and calculates for Parents

        let calculatedBalance: CalculatedTrialBalance;

        const children = childrenLookup.get(coa.code);
        const isLeaf = !children || children.length === 0;

        if (isLeaf) {
          // It's a leaf. Use Genius data if exists, else zero.
          const geniusValue = geniusData.get(key);
          if (geniusValue) {
            calculatedBalance = geniusValue;
          } else {
            calculatedBalance = createZeroBalance(coa.code, branch, coa.name);
          }
        } else {
          // It's a parent. Aggregate children.
          // Children should have been processed already because we iterate level DESC
          const childValues = children
            ?.map((child) => calculatedLookup.get(`${child.code}|${branch}`))
            .filter((val): val is CalculatedTrialBalance => !!val);

          if (childValues.length === 0) {
            calculatedBalance = createZeroBalance(coa.code, branch, coa.name);
          } else {
            calculatedBalance = aggregateBalances(
              coa.code,
              branch,
              coa.name,
              childValues
            );
          }
        }

        // Store for parent calculations
        calculatedLookup.set(key, calculatedBalance);

        // Add to result if has value
        if (calculatedBalance.hasAnyValue) {
          result.push(calculatedBalance);
        }
      }
    }
  }

  console.log(
    `📊 Processed ${result.length} records after hierarchy calculation (Parents included)`
  );

  return result;
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
  const agg = {
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
