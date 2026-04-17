import {
  createOracleClientFromUrl,
  type OracleClient,
} from "@restate-tob/oracle";
import type { BindParameters, ExecuteOptions } from "oracledb";

let oracleClient: OracleClient | null = null;

function getOracleInstantClientPath(): string | undefined {
  return process.env.ORACLE_INSTANT_CLIENT_PATH ?? process.env.ORACLE_LIB_DIR;
}

export function getOracleClient(): OracleClient {
  if (!oracleClient) {
    const connectionString = process.env.ORACLE_URL;
    if (!connectionString) {
      throw new Error("ORACLE_URL environment variable is required");
    }

    oracleClient = createOracleClientFromUrl({
      connectionString,
      instantClientPath: getOracleInstantClientPath(),
      poolMin: 10,
      poolMax: 50,
    });
  }

  if (!oracleClient) {
    throw new Error("Failed to initialize Oracle client");
  }

  return oracleClient;
}

export function initOracleClient(): void {
  getOracleClient();
}

export function testOracleConnection(): Promise<boolean> {
  return getOracleClient().testConnection();
}

// Re-export convenience functions that use the singleton client
export async function executeQuery<T = Record<string, unknown>>(
  sql: string,
  binds?: BindParameters,
  options?: ExecuteOptions
) {
  const result = await getOracleClient().executeQuery<T>(sql, binds, options);
  // Return in the old format for backward compatibility
  return {
    rows: result.rows,
    rowsAffected: result.rowsAffected,
    metaData: result.metadata,
  };
}

export function executeMany(
  sql: string,
  binds: BindParameters[],
  options?: ExecuteOptions
) {
  return getOracleClient().executeMany(sql, binds, options);
}

// Keep the SOA-specific procedure for backward compatibility
// This wraps the generic executeProcedure with the specific bind structure used by SOA
export async function executeSoaProcedure(
  procedureName: string,
  binds?: BindParameters
) {
  const result = await getOracleClient().executeProcedure<
    unknown[],
    { p_status: string; p_error_message: string }
  >(
    `${procedureName}(:p_office, :p_class, :p_dc_account_code, :p_dc_account_name, :p_as_at_date, :p_userid, :p_cursor, :p_status, :p_error_message)`,
    binds,
    {
      p_cursor: "cursor",
      p_status: "string",
      p_error_message: "string",
    }
  );

  console.log(`[Database] StoredProcedure status: ${result.outBinds.p_status}`);
  console.log(
    `[Database] StoredProcedure error: ${result.outBinds.p_error_message}`
  );
  console.log(`[Database] StoredProcedure returned ${result.rows.length} rows`);

  if (result.rows.length > 0) {
    console.log(
      `[Database] StoredProcedure first row: ${JSON.stringify(result.rows[0], null, 2)}`
    );
  }

  return result.rows;
}

export async function closeConnections(): Promise<void> {
  if (oracleClient) {
    await oracleClient.close();
    oracleClient = null;
  }
}
