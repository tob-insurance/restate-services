import { Pool, type PoolClient } from "pg";
import type { PostgresClient, PostgresConfig } from "./types.js";

const SCHEMA_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

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

function validateSchemaName(schema: string): void {
  if (!SCHEMA_NAME_REGEX.test(schema)) {
    throw new Error(
      `Invalid schema name: "${schema}". Only alphanumeric characters and underscores allowed, must start with letter or underscore.`
    );
  }
}

export function createPostgresClient(config: PostgresConfig): PostgresClient {
  const { schema, ...poolConfig } = config;

  if (schema) {
    validateSchemaName(schema);
  }

  const pool = new Pool({
    max: 20,
    min: 2,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: false,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 300_000,
    query_timeout: 300_000,
    ...poolConfig,
  });

  pool.on("connect", (client) => {
    if (schema) {
      client.query(`SET search_path TO "${schema}"`);
    }
  });

  pool.on("error", (err) => {
    console.error("Unexpected error on idle PostgreSQL client", err);
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
