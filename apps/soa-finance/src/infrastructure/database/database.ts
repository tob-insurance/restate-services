import oracledb, { type BindParameters, type ExecuteOptions } from "oracledb";

type ProcedureOutBinds = {
  p_status: string;
  p_error_message: string;
  p_cursor: oracledb.ResultSet<unknown[]>;
};

const pool: oracledb.Pool | null = null;

export const initOracleClient = async () => {
  if (pool) {
    return;
  }

  await oracledb.createPool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECT_STRING,
  });

  console.log("Oracle DB Pool Initialized");

  return pool;
};

export async function executeQuery(
  sql: string,
  binds: BindParameters = {},
  options: ExecuteOptions = {}
) {
  await initOracleClient();

  const connection = await oracledb.getConnection("default");
  const result = await connection.execute(sql, binds, {
    outFormat: oracledb.OUT_FORMAT_OBJECT,
    ...options,
  });

  await connection.close();
  return result;
}

export async function executeProcedure(
  procedureName: string,
  binds: BindParameters = {}
) {
  await initOracleClient();
  const connection = await oracledb.getConnection("default");

  try {
    const bindParams = {
      ...binds,
      p_cursor: { type: oracledb.CURSOR, dir: oracledb.BIND_OUT },
      p_status: { type: oracledb.STRING, dir: oracledb.BIND_OUT, maxSize: 200 },
      p_error_message: {
        type: oracledb.STRING,
        dir: oracledb.BIND_OUT,
        maxSize: 200,
      },
    };

    const result = await connection.execute(
      `BEGIN ${procedureName}(:p_office, :p_class, :p_dc_account_code, :p_dc_account_name, :p_as_at_date, :p_userid, :p_cursor, :p_status, :p_error_message); END;`,
      bindParams
    );

    const outBinds = result.outBinds as ProcedureOutBinds;
    console.log(`StoredProcedure Status: ${outBinds.p_status}`);
    console.log(`StoredProcedure Error Message: ${outBinds.p_error_message}`);

    const cursor = outBinds.p_cursor;
    const rows: unknown[] = [];

    if (cursor) {
      let row: unknown[] | undefined = await cursor.getRow();
      while (row) {
        rows.push(row);
        row = await cursor.getRow();
      }
      await cursor.close();
    }

    console.log(`StoredProcedure Returned ${rows.length} rows`);

    if (rows.length > 0) {
      console.log(
        "StoredProcedure First row sample:",
        JSON.stringify(rows[0], null, 2)
      );
    }

    return rows;
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`StoredProcedure Error: ${errorMessage}`);
    throw error;
  } finally {
    await connection.close();
  }
}
