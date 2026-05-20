import { Pool, type PoolClient } from "pg";
import type { PostgresClient, PostgresConfig } from "./types.js";

const SCHEMA_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export async function withConnection<T>(
  client: PostgresClient,
  operation: (poolClient: PoolClient) => Promise<T>
): Promise<T> {
  const poolClient = await client.pool.connect();
  let connectionError: Error | null = null;

  const onError = (err: Error) => {
    connectionError = err;
    console.error("PostgreSQL connection error during operation:", err.message);
  };
  poolClient.on("error", onError);

  try {
    return await operation(poolClient);
  } catch (err) {
    const captured = connectionError as Error | null;
    if (captured) {
      const wrapped = new Error(
        `PostgreSQL connection lost during operation: ${captured.message}`
      );
      wrapped.cause = err;
      throw wrapped;
    }
    throw err;
  } finally {
    poolClient.removeListener("error", onError);
    const captured = connectionError as Error | null;
    poolClient.release(captured ?? undefined);
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

  const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
  const pool = new Pool({
    max: 20,
    min: 2,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: false,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 300_000,
    query_timeout: 300_000,
    ...poolConfig,
    ...(isLambda ? { min: 0, max: 1 } : {}),
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
      } catch (error: unknown) {
        console.error("❌ PostgreSQL connection failed:", error);
        return false;
      }
    },

    async close(): Promise<void> {
      await pool.end();
      console.log("PostgreSQL pool closed");
    },

    async executeQuery<T>(
      sql: string,
      params?: unknown[]
    ): Promise<{ rows: T[]; rowCount: number | null }> {
      const conn = await pool.connect();
      try {
        const result = await conn.query(sql, params);
        return { rows: result.rows as T[], rowCount: result.rowCount ?? null };
      } finally {
        conn.release();
      }
    },
  };
}
