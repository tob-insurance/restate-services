import { createOracleClient, type OracleClient } from "@restate-tob/oracle";
import {
  createPostgresClient,
  type PostgresClient,
} from "@restate-tob/postgres";
import { config } from "dotenv";

config();

let postgresClient: PostgresClient | null = null;
let oracleClient: OracleClient | null = null;

export function getPostgresClient(): PostgresClient {
  if (!postgresClient) {
    postgresClient = createPostgresClient({
      host: process.env.PG_HOST || "127.0.0.1",
      port: Number.parseInt(process.env.PG_PORT || "5432", 10),
      database: process.env.PG_DATABASE || "postgres",
      user: process.env.PG_USER || "postgres",
      password: process.env.PG_PASSWORD,
      schema: process.env.PG_SCHEMA || "public",
    });
  }
  return postgresClient;
}

export function getOracleClient(): OracleClient {
  if (!oracleClient) {
    oracleClient = createOracleClient({
      user: process.env.ORACLE_USER || "",
      password: process.env.ORACLE_PASSWORD || "",
      connectString: process.env.ORACLE_CONNECT_STRING || "",
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
