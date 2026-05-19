import {
  createPostgresClient,
  type PostgresClient,
} from "@restate-tob/postgres";
import type { PoolConfig } from "pg";

let postgresClient: PostgresClient | null = null;
let geniusClient: PostgresClient | null = null;

type ParsedConnection = PoolConfig & { schema?: string };

const ADO_KEY_MAP: Record<string, keyof ParsedConnection> = {
  host: "host",
  server: "host",
  port: "port",
  database: "database",
  username: "user",
  "user id": "user",
  userid: "user",
  user: "user",
  password: "password",
  searchpath: "schema",
  "search path": "schema",
};

function parseConnection(value: string): ParsedConnection {
  const trimmed = value.trim();
  if (
    trimmed.startsWith("postgres://") ||
    trimmed.startsWith("postgresql://")
  ) {
    return { connectionString: trimmed };
  }

  const config: ParsedConnection = {};
  for (const segment of trimmed.split(";")) {
    if (!segment.trim()) {
      continue;
    }
    const eq = segment.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const rawKey = segment.slice(0, eq).trim().toLowerCase();
    const rawValue = segment.slice(eq + 1).trim();
    const mapped = ADO_KEY_MAP[rawKey];
    if (!mapped) {
      continue;
    }
    if (mapped === "port") {
      config.port = Number.parseInt(rawValue, 10);
    } else {
      (config as Record<string, unknown>)[mapped] = rawValue;
    }
  }
  return config;
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export function getPostgresClient(): PostgresClient {
  if (!postgresClient) {
    const raw = process.env.POSTGRES_URL;
    if (!raw) {
      throw new Error("POSTGRES_URL environment variable is required");
    }
    postgresClient = createPostgresClient({
      ...parseConnection(raw),
      ssl: { rejectUnauthorized: false },
    });
  }
  return postgresClient;
}

export function getGeniusClient(): PostgresClient {
  if (!geniusClient) {
    const raw = process.env.GENIUS_URL;
    if (!raw) {
      throw new Error("GENIUS_URL environment variable is required");
    }
    geniusClient = createPostgresClient({
      ...parseConnection(raw),
      ssl: { rejectUnauthorized: false },
      // Sized for the longest legitimate query on this pool (Genius closing
      // procedure, up to 6h). Short queries finish in ms and never approach it.
      query_timeout: SIX_HOURS_MS,
    });
  }
  return geniusClient;
}

/**
 * Warms up the PostgreSQL connection pools on Lambda cold start.
 */
export function initPostgresClient(): void {
  getPostgresClient();
  getGeniusClient();
}

export async function testConnections(): Promise<{
  postgres: boolean;
  genius: boolean;
}> {
  const [postgres, genius] = await Promise.all([
    getPostgresClient().testConnection(),
    getGeniusClient().testConnection(),
  ]);
  return { postgres, genius };
}

export async function closeConnections(): Promise<void> {
  await Promise.all([postgresClient?.close(), geniusClient?.close()]);
  postgresClient = null;
  geniusClient = null;
}
