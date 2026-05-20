import type { PostgresClient } from "./types.js";

export async function* withConnectionGenerator<T>(
  client: PostgresClient,
  operation: (poolClient: import("pg").PoolClient) => AsyncGenerator<T>
): AsyncGenerator<T> {
  const poolClient = await client.pool.connect();
  try {
    yield* operation(poolClient);
  } finally {
    poolClient.release();
  }
}

export const PG_STREAM = {
  FETCH_ARRAY_SIZE: 500,
} as const;

export { default as Cursor } from "pg-cursor";
