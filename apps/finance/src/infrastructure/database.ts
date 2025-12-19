import { createOracleClient, type OracleClient } from "@restate-tob/oracle";
import {
  createPostgresClient,
  type PostgresClient,
} from "@restate-tob/postgres";

let postgresClient: PostgresClient | null = null;
let oracleClient: OracleClient | null = null;

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

    // Parse oracle://user:password@host:port/service
    const url = new URL(connectionString);
    oracleClient = createOracleClient({
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      connectString: `${url.hostname}:${url.port || "1521"}${url.pathname}`,
      instantClientPath: process.env.ORACLE_INSTANT_CLIENT_PATH,
    });
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
