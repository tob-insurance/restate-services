import oracledb from "oracledb";
import { type Connection, withConnectionGenerator } from "./client.js";
import type { OpenBalance, OracleClient } from "./index.js";

export type IOpenBalanceRepository = {
  getList(
    year: number,
    month: number
  ): AsyncGenerator<OpenBalance, void, undefined>;
};

type OpenBalanceRow = {
  COACODE: unknown;
  DESCRIPTION: unknown;
  YEAR: unknown;
  MONTH: unknown;
  BRANCH: unknown;
  BEGINNINGDEBIT: unknown;
  BEGINNINGCREDIT: unknown;
  DEBITAMOUNT: unknown;
  CREDITAMOUNT: unknown;
  ENDINGDEBIT: unknown;
  ENDINGCREDIT: unknown;
  CREATEBY: unknown;
  CREATEDATE: unknown;
  CURRENCY: unknown;
};

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function toNumberValue(value: unknown): number {
  return Number.parseFloat(String(value ?? 0));
}

function toDateValue(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function mapOpenBalanceRow(row: OpenBalanceRow): OpenBalance {
  return {
    coaCode: toStringValue(row.COACODE),
    description: toStringValue(row.DESCRIPTION),
    year: toNumberValue(row.YEAR),
    month: toNumberValue(row.MONTH),
    branch: toStringValue(row.BRANCH),
    beginningDebit: toNumberValue(row.BEGINNINGDEBIT),
    beginningCredit: toNumberValue(row.BEGINNINGCREDIT),
    debitAmount: toNumberValue(row.DEBITAMOUNT),
    creditAmount: toNumberValue(row.CREDITAMOUNT),
    endingDebit: toNumberValue(row.ENDINGDEBIT),
    endingCredit: toNumberValue(row.ENDINGCREDIT),
    createBy: toStringValue(row.CREATEBY),
    createDate: toDateValue(row.CREATEDATE),
    currency: toStringValue(row.CURRENCY),
  };
}

export class OpenBalanceRepository implements IOpenBalanceRepository {
  private readonly oracleClient: OracleClient;

  constructor(oracleClient: OracleClient) {
    this.oracleClient = oracleClient;
  }

  getList(
    year: number,
    month: number
  ): AsyncGenerator<OpenBalance, void, undefined> {
    return withConnectionGenerator(
      this.oracleClient,
      async function* (connection: Connection) {
        const query = `
        SELECT
            op.COACODE,
            MAX(op.DESCRIPTION) DESCRIPTION,
            op.GLYEAR YEAR,
            op.GLMONTH MONTH,
            op.BRANCH,
            SUM(op.BEGINNING_DEBIT) BEGINNINGDEBIT,
            SUM(op.BEGINNING_CREDIT) BEGINNINGCREDIT,
            SUM(op.DEBIT_AMOUNT) DEBITAMOUNT,
            SUM(op.CREDIT_AMOUNT) CREDITAMOUNT,
            SUM(op.ENDING_DEBIT) ENDINGDEBIT,
            SUM(op.ENDING_CREDIT) ENDINGCREDIT,
            MAX(op.CREATEBY) CREATEBY,
            MAX(op.CREATEDATE) CREATEDATE,
            'IDR' CURRENCY
        FROM ACPDB.AC_GLOPENBALANCE op
        WHERE op.GLYEAR = :year AND op.GLMONTH = :month
        GROUP BY op.COACODE, op.BRANCH, op.GLYEAR, op.GLMONTH
      `;

        const result = await connection.execute(
          query,
          { year, month },
          {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            fetchArraySize: 1000,
          }
        );

        const rows = (result.rows ?? []) as OpenBalanceRow[];
        for (const row of rows) {
          yield mapOpenBalanceRow(row);
        }
      }
    );
  }
}
