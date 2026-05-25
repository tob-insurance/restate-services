import { withConnection as withPostgresConnection } from "@restate-tob/postgres";
import { TerminalError } from "@restatedev/restate-sdk";
import type { PoolClient } from "pg";
import { getPostgresClient } from "../../infrastructure/index.js";
import { processCoaHierarchy } from "./coa-hierarchy.js";

/**
 * Represents a calculated trial balance record.
 */
export interface CalculatedTrialBalance {
  branchCode: string;
  coaCode: string;
  description: string;
  endBalance: number;
  endCredit: number;
  endDebit: number;
  hasAnyValue: boolean;
  movementBalance: number;
  movementCredit: number;
  movementDebit: number;
  startBalance: number;
  startCredit: number;
  startDebit: number;
}

/**
 * Represents a raw open balance record from the Genius PostgreSQL database.
 */
interface OpenBalanceRow {
  beginningcredit: string;
  beginningdebit: string;
  branch: string;
  coacode: string;
  creditamount: string;
  debitamount: string;
  description: string;
  endingcredit: string;
  endingdebit: string;
  month: number;
  year: number;
}

const YEAR_PATTERN = /^\d{4}$/;
const MONTH_PATTERN = /^\d{1,2}$/;

export interface SyncTrialBalanceResult {
  duration: number;
  endTime: Date;
  geniusDataSize?: number;
  message: string;
  recordsProcessed: number;
  startTime: Date;
  success: boolean;
}

export async function syncTrialBalanceFromGenius(
  year: string,
  month: string,
  currentTimeMillis: number
): Promise<SyncTrialBalanceResult> {
  const startTime = new Date(currentTimeMillis);
  validateSyncPeriod(year, month);

  const geniusData = new Map<string, CalculatedTrialBalance>();

  await withPostgresConnection(
    getPostgresClient(),
    async (client: PoolClient) => {
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
        FROM acpdb.AC_GLOPENBALANCE op
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

  const calculatedData = await processCoaHierarchy(geniusData);

  if (calculatedData.length > 0) {
    await withPostgresConnection(
      getPostgresClient(),
      async (client: PoolClient) => {
        await client.query("BEGIN");

        try {
          await client.query(
            `DELETE FROM financial_report.legacy_trial_balances 
             WHERE year = $1 AND month = $2`,
            [year, month]
          );

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
              INSERT INTO financial_report.legacy_trial_balances (
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
        } catch (error: unknown) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
    );
  }

  const endTime = new Date(currentTimeMillis);
  const duration = endTime.getTime() - startTime.getTime();

  return {
    success: true,
    recordsProcessed: calculatedData.length,
    message: `Successfully synchronized ${calculatedData.length} trial balance records`,
    geniusDataSize: geniusData.size,
    startTime,
    endTime,
    duration,
  };
}

function validateSyncPeriod(year: string, month: string): void {
  if (!YEAR_PATTERN.test(year)) {
    throw new TerminalError(`Invalid trial balance year: ${year}`);
  }

  const monthNumber = Number.parseInt(month, 10);

  if (!MONTH_PATTERN.test(month) || monthNumber < 1 || monthNumber > 12) {
    throw new TerminalError(`Invalid trial balance month: ${month}`);
  }
}
