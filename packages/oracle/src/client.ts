import os from "node:os";
import oracledb, { type Connection, type Pool } from "oracledb";
import type { OracleClient, OracleConfig } from "./types.js";

export async function withConnection<T>(
  client: OracleClient,
  operation: (connection: Connection) => Promise<T>
): Promise<T> {
  let connection: Connection | null = null;
  try {
    connection = await client.getConnection();
    return await operation(connection);
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing Oracle connection:", err);
      }
    }
  }
}

function initThickMode(instantClientPath?: string): void {
  const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
  const isLinux = os.platform() === "linux";

  try {
    if (isLambda || isLinux) {
      oracledb.initOracleClient();
      console.log("✅ Oracle Thick mode enabled (LD_LIBRARY_PATH)");
    } else {
      oracledb.initOracleClient(
        instantClientPath ? { libDir: instantClientPath } : undefined
      );
      console.log(
        `✅ Oracle Thick mode enabled${instantClientPath ? `: ${instantClientPath}` : ""}`
      );
    }
  } catch {
    console.warn(
      "⚠️  Oracle Thick mode failed, using Thin mode (requires Oracle 12.1+)"
    );
  }
}

export function createOracleClient(config: OracleConfig): OracleClient {
  const isLambda = config.isLambda ?? !!process.env.AWS_LAMBDA_FUNCTION_NAME;

  initThickMode(config.instantClientPath);

  let pool: Pool | null = null;

  const poolConfig = {
    user: config.user,
    password: config.password,
    connectString: config.connectString,
    poolMin: config.poolMin ?? (isLambda ? 0 : 2),
    poolMax: config.poolMax ?? (isLambda ? 1 : 10),
    poolIncrement: 1,
    poolTimeout: 60,
  };

  async function initPool(): Promise<void> {
    pool = await oracledb.createPool(poolConfig);
    console.log("✅ Oracle connection pool created");
  }

  return {
    async getConnection(): Promise<Connection> {
      if (!pool) {
        await initPool();
      }
      if (!pool) {
        throw new Error("Failed to initialize Oracle connection pool");
      }
      return pool.getConnection();
    },

    async testConnection(): Promise<boolean> {
      let connection: Connection | null = null;
      try {
        connection = await this.getConnection();
        const result = await connection.execute("SELECT SYSDATE FROM DUAL");
        console.log("✅ Oracle connected:", result.rows?.[0]);
        return true;
      } catch (error) {
        console.error("❌ Oracle connection failed:", error);
        return false;
      } finally {
        await connection?.close();
      }
    },

    async close(): Promise<void> {
      if (pool) {
        await pool.close(10);
        pool = null;
        console.log("Oracle pool closed");
      }
    },
  };
}
