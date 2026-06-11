import { createPostgresClient } from "./client.js";
import type { PostgresClient, PostgresConfig } from "./types.js";

interface SingletonOptions {
  connectionString?: string;
  poolOverrides?: Partial<PostgresConfig>;
}

let globalClient: PostgresClient | null = null;

export function getGlobalPostgresClient(
  options?: SingletonOptions
): PostgresClient {
  if (!globalClient) {
    const url =
      options?.connectionString ??
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL;
    if (!url) {
      throw new Error("DATABASE_URL or POSTGRES_URL must be set");
    }
    globalClient = createPostgresClient({
      connectionString: url,
      ...options?.poolOverrides,
    });
  }
  return globalClient;
}

export async function closeGlobalPostgresClient(): Promise<void> {
  if (globalClient) {
    await globalClient.close();
    globalClient = null;
  }
}

export function resetGlobalPostgresClient(): void {
  globalClient = null;
}
