import { config } from "dotenv";
import oracledb, {
  type Connection,
  type ConnectionAttributes,
  type Pool,
  type PoolAttributes,
} from "oracledb";

config();

try {
  const instantClientPath = process.env.ORACLE_INSTANT_CLIENT_PATH;

  oracledb.initOracleClient({ libDir: instantClientPath });
  console.log("✅ Oracle Thick mode enabled");
  console.log(`   Using Instant Client from: ${instantClientPath}`);
} catch (err) {
  console.log("⚠️  Oracle Thick mode failed, running in Thin mode");
  console.log("   Thin mode only supports Oracle Database 12.1+");
  const errorMessage = err instanceof Error ? err.message : String(err);
  console.error("   Error:", errorMessage);

  if (
    errorMessage.includes("DPI-1047") ||
    errorMessage.includes("cannot load")
  ) {
    console.log("\n💡 To fix this:");
    console.log("   1. Download Oracle Instant Client from:");
    console.log(
      "      https://www.oracle.com/database/technologies/instant-client/downloads.html"
    );
    console.log(
      "   2. Extract to: C:\\oracle\\instantclient-basic-windows.x64-23.26.0.0.0"
    );
    console.log("   3. Or set ORACLE_INSTANT_CLIENT_PATH in .env file");
  }
}

const oracleConfig: ConnectionAttributes = {
  user: process.env.ORACLE_USER,
  password: process.env.ORACLE_PASSWORD,
  connectString: process.env.ORACLE_CONNECT_STRING,
};

const poolConfig: PoolAttributes = {
  ...oracleConfig,
  poolMin: 2,
  poolMax: 10,
  poolIncrement: 2,
  poolTimeout: 60,
};

let pool: Pool | null = null;

export async function initOraclePool(): Promise<void> {
  try {
    pool = await oracledb.createPool(poolConfig);
    console.log("✅ Oracle connection pool created successfully");
  } catch (error) {
    console.error("❌ Failed to create Oracle connection pool:", error);
    throw error;
  }
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
    try {
      await pool.close(10);
      console.log("Oracle connection pool closed");
      pool = null;
    } catch (error) {
      console.error("Error closing Oracle pool:", error);
    }
  }
}

export async function testOracleConnection(): Promise<boolean> {
  let connection: Connection | null = null;
  try {
    connection = await getOracleConnection();
    const result = await connection.execute("SELECT SYSDATE FROM DUAL");
    console.log("✅ Oracle connected successfully at:", result.rows?.[0]);
    return true;
  } catch (error) {
    console.error("❌ Oracle connection failed:", error);
    return false;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing connection:", err);
      }
    }
  }
}
