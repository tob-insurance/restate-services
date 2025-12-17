import { Pool, type PoolClient } from "pg";
import type { PostgresClient, PostgresConfig } from "./types.js";

export async function withConnection<T>(
  client: PostgresClient,
  operation: (poolClient: PoolClient) => Promise<T>
): Promise<T> {
  const poolClient = await client.pool.connect();
  try {
    return await operation(poolClient);
  } finally {
    poolClient.release();
  }
}

export function createPostgresClient(config: PostgresConfig): PostgresClient {
  const { schema, ...poolConfig } = config;

  const pool = new Pool({
    max: 20,
    min: 2,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: false,
    ...poolConfig,
  });

  pool.on("connect", (client) => {
    if (schema) {
      client.query(`SET search_path TO ${schema}`);
    }
  });

  pool.on("error", (err) => {
    console.error("Unexpected error on idle PostgreSQL client", err);
    process.exit(-1);
  });

  return {
    pool,

    async testConnection(): Promise<boolean> {
      try {
        const client = await pool.connect();
        const result = await client.query("SELECT NOW()");
        console.log(
          "✅ PostgreSQL connected successfully at:",
          result.rows[0].now
        );
        client.release();
        return true;
      } catch (error) {
        console.error("❌ PostgreSQL connection failed:", error);
        return false;
      }
    },

    async close(): Promise<void> {
      await pool.end();
      console.log("PostgreSQL pool closed");
    },
  };
}
