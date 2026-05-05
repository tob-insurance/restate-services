import type {
  BindParameters,
  Connection,
  ExecuteOptions,
  Result,
} from "oracledb";

export type OracleConfig = {
  user: string;
  password: string;
  connectString: string;
  instantClientPath?: string;
  isLambda?: boolean;
  poolMin?: number;
  poolMax?: number;
};

export type ExecuteQueryResult<T = Record<string, unknown>> = {
  rows: T[];
  rowsAffected?: number;
  metadata?: Result<unknown>["metaData"];
};

export type ExecuteManyResult = {
  rowsAffected: number;
  batchErrors?: Error[];
};

export type ProcedureOutBindDef = {
  [key: string]: "string" | "number" | "date" | "cursor" | "clob" | "blob";
};

export type ProcedureResult<
  TRow = unknown,
  TOutBinds = Record<string, unknown>,
> = {
  rows: TRow[];
  outBinds: TOutBinds;
};

export type OracleClient = {
  getConnection(): Promise<Connection>;
  testConnection(): Promise<boolean>;
  close(): Promise<void>;

  executeQuery<T = Record<string, unknown>>(
    sql: string,
    binds?: BindParameters,
    options?: ExecuteOptions
  ): Promise<ExecuteQueryResult<T>>;

  executeMany(
    sql: string,
    binds: BindParameters[],
    options?: ExecuteOptions
  ): Promise<ExecuteManyResult>;

  executeProcedure<TRow = unknown, TOutBinds = Record<string, unknown>>(
    procedureCall: string,
    binds?: BindParameters,
    outBindDefs?: ProcedureOutBindDef
  ): Promise<ProcedureResult<TRow, TOutBinds>>;
};
