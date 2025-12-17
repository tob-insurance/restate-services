import type { Connection } from "oracledb";

export type OracleConfig = {
  user: string;
  password: string;
  connectString: string;
  instantClientPath?: string;
  isLambda?: boolean;
  poolMin?: number;
  poolMax?: number;
};

export type OracleClient = {
  getConnection(): Promise<Connection>;
  testConnection(): Promise<boolean>;
  close(): Promise<void>;
};
