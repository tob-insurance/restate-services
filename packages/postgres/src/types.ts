import type { Pool, PoolConfig } from "pg";

export interface PostgresConfig extends PoolConfig {
  schema?: string;
}

export type PostgresClient = {
  pool: Pool;
  testConnection(): Promise<boolean>;
  close(): Promise<void>;
};
