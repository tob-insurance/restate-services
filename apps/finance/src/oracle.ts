import os from "node:os";
import { config } from "dotenv";
import oracledb, {
  type Connection,
  type ConnectionAttributes,
  type Pool,
  type PoolAttributes,
} from "oracledb";

config();

const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
const isLinux = os.platform() === "linux";

try {
  if (isLambda || isLinux) {
    oracledb.initOracleClient();
    console.log("✅ Oracle Thick mode enabled (LD_LIBRARY_PATH)");
  } else {
    const libDir = process.env.ORACLE_INSTANT_CLIENT_PATH;
    oracledb.initOracleClient(libDir ? { libDir } : undefined);
    console.log(`✅ Oracle Thick mode enabled${libDir ? `: ${libDir}` : ""}`);
  }
} catch {
  console.warn(
    "⚠️  Oracle Thick mode failed, using Thin mode (requires Oracle 12.1+)"
  );
}

const oracleConfig: ConnectionAttributes = {
  user: process.env.ORACLE_USER,
  password: process.env.ORACLE_PASSWORD,
  connectString: process.env.ORACLE_CONNECT_STRING,
};

const poolConfig: PoolAttributes = {
  ...oracleConfig,
  poolMin: isLambda ? 0 : 2,
  poolMax: isLambda ? 1 : 10,
  poolIncrement: 1,
  poolTimeout: 60,
};

let pool: Pool | null = null;

export async function initOraclePool(): Promise<void> {
  pool = await oracledb.createPool(poolConfig);
  console.log("✅ Oracle connection pool created");
}

export async function getOracleConnection(): Promise<Connection> {
  if (!pool) {
    await initOraclePool();
  }
  if (!pool) {
    throw new Error("Failed to initialize Oracle connection pool");
  }
  return pool.getConnection();
}

export async function closeOraclePool(): Promise<void> {
  if (pool) {
    await pool.close(10);
    pool = null;
  }
}

export async function testOracleConnection(): Promise<boolean> {
  let connection: Connection | null = null;
  try {
    connection = await getOracleConnection();
    const result = await connection.execute("SELECT SYSDATE FROM DUAL");
    console.log("✅ Oracle connected:", result.rows?.[0]);
    return true;
  } catch (error) {
    console.error("❌ Oracle connection failed:", error);
    return false;
  } finally {
    await connection?.close();
  }
}
