import { withConnectionGenerator } from "@restate-tob/oracle";
import { TerminalError } from "@restatedev/restate-sdk";
import oracledb from "oracledb";
import { ORACLE_STREAM } from "../../constants";
import { getOracleClient } from "../../infrastructure/database/database.js";
import type { IOracleStreamOptions } from "../types";

type OracleBinds = {
  p_status: string;
  p_error_message: string;
  p_cursor: oracledb.ResultSet<unknown[]>;
};

// biome-ignore lint/suspicious/useAwait: async generator delegates to async iterable via yield*
export async function* streamFromOracle(
  options: IOracleStreamOptions
): AsyncGenerator<unknown[], void, unknown> {
  const client = getOracleClient();

  yield* withConnectionGenerator(client, async function* (connection) {
    const result = await connection.execute(
      `BEGIN ${options.procedureName}(
        :p_office, :p_class, :p_dc_account_code, :p_dc_account_name,
        :p_as_at_date, :p_userid, :p_cursor, :p_status, :p_error_message
      ); END;`,
      {
        ...options.binds,
        p_cursor: { type: oracledb.CURSOR, dir: oracledb.BIND_OUT },
        p_status: {
          type: oracledb.STRING,
          dir: oracledb.BIND_OUT,
          maxSize: 200,
        },
        p_error_message: {
          type: oracledb.STRING,
          dir: oracledb.BIND_OUT,
          maxSize: 200,
        },
      }
    );

    const outBinds = result.outBinds as OracleBinds;

    if (outBinds.p_status !== "1") {
      throw new TerminalError(`Procedure error: ${outBinds.p_error_message}`);
    }

    const cursor = outBinds.p_cursor;
    try {
      let rows = await cursor.getRows(ORACLE_STREAM.FETCH_ARRAY_SIZE);

      while (rows.length > 0) {
        for (const row of rows) {
          yield row;
        }
        rows = await cursor.getRows(ORACLE_STREAM.FETCH_ARRAY_SIZE);
      }
    } finally {
      await cursor.close();
    }
  });
}

// biome-ignore lint/suspicious/useAwait: async generator delegates to async iterable via yield*
export async function* streamQueryFromOracle(
  sql: string,
  binds: Record<string, unknown>
): AsyncGenerator<unknown[], void, unknown> {
  const client = getOracleClient();

  yield* withConnectionGenerator(client, async function* (connection) {
    const result = await connection.execute<unknown[]>(
      sql,
      binds as oracledb.BindParameters,
      {
        resultSet: true,
        fetchArraySize: ORACLE_STREAM.FETCH_ARRAY_SIZE,
      }
    );

    const resultSet = result.resultSet;

    if (!resultSet) {
      throw new TerminalError("No result set returned from query");
    }

    try {
      let rows = await resultSet.getRows(ORACLE_STREAM.FETCH_ARRAY_SIZE);

      while (rows.length > 0) {
        for (const row of rows) {
          yield row;
        }
        rows = await resultSet.getRows(ORACLE_STREAM.FETCH_ARRAY_SIZE);
      }
    } finally {
      await resultSet.close();
    }
  });
}
