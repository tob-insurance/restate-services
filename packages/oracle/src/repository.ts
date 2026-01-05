import oracledb from "oracledb";
import { type Connection, withConnectionGenerator } from "./client.js";
import type { OpenBalance, OracleClient } from "./index.js";

export type IOpenBalanceRepository = {
  getList(
    year: number,
    month: number
  ): AsyncGenerator<OpenBalance, void, undefined>;
};

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

        if (result.rows) {
          // biome-ignore lint/suspicious/noExplicitAny: oracledb rows
          for (const row of result.rows as any[]) {
            yield {
              coaCode: row.COACODE as string,
              description: row.DESCRIPTION as string,
              year: row.YEAR as number,
              month: row.MONTH as number,
              branch: row.BRANCH as string,
              beginningDebit: Number.parseFloat(String(row.BEGINNINGDEBIT)),
              beginningCredit: Number.parseFloat(String(row.BEGINNINGCREDIT)),
              debitAmount: Number.parseFloat(String(row.DEBITAMOUNT)),
              creditAmount: Number.parseFloat(String(row.CREDITAMOUNT)),
              endingDebit: Number.parseFloat(String(row.ENDINGDEBIT)),
              endingCredit: Number.parseFloat(String(row.ENDINGCREDIT)),
              createBy: row.CREATEBY as string,
              createDate: row.CREATEDATE as Date,
              currency: row.CURRENCY as string,
            };
          }
        }
      }
    );
  }
}
