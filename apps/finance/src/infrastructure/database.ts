import {
  createOracleClientFromUrl,
  type OracleClient,
} from "@restate-tob/oracle";
import {
  createPostgresClient,
  type PostgresClient,
} from "@restate-tob/postgres";

let postgresClient: PostgresClient | null = null;
let oracleClient: OracleClient | null = null;

function getOracleInstantClientPath(): string | undefined {
  return process.env.ORACLE_INSTANT_CLIENT_PATH ?? process.env.ORACLE_LIB_DIR;
}

export function getPostgresClient(): PostgresClient {
  if (!postgresClient) {
    const connectionString = process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error("POSTGRES_URL environment variable is required");
    }
    postgresClient = createPostgresClient({ connectionString });
  }
  return postgresClient;
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
    });
  }

  if (!oracleClient) {
    throw new Error("Failed to initialize Oracle client");
  }

  return oracleClient;
}

/**
 * Initializes the Oracle connection pool.
 * Call this at module load time to warm up the connection pool on Lambda cold start.
 */
export function initOracleClient(): void {
  getOracleClient();
}

export async function testConnections(): Promise<{
  postgres: boolean;
  oracle: boolean;
}> {
  const [postgres, oracle] = await Promise.all([
    getPostgresClient().testConnection(),
    getOracleClient().testConnection(),
  ]);
  return { postgres, oracle };
}

export async function closeConnections(): Promise<void> {
  await Promise.all([postgresClient?.close(), oracleClient?.close()]);
  postgresClient = null;
  oracleClient = null;
}
