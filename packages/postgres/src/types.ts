import type { Pool, PoolConfig } from "pg";

export interface PostgresConfig extends PoolConfig {
  schema?: string;
}

export interface PostgresClient {
  close(): Promise<void>;
  executeQuery<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>;
  pool: Pool;
  testConnection(): Promise<boolean>;
}
