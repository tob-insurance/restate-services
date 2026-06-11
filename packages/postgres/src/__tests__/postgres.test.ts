import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";

let mockConnectBehavior: "success" | "fail" = "success";
let mockQueryResult: { rows: unknown[]; rowCount: number } = {
  rows: [{ now: "2024-01-01" }],
  rowCount: 1,
};
const poolClientErrorHandlers: Array<(err: Error) => void> = [];
const poolClientReleaseCalls: Array<Error | undefined> = [];

jest.mock("pg", () => ({
  Pool: class {
    connect = () => {
      if (mockConnectBehavior === "fail") {
        return Promise.reject(new Error("Connection failed"));
      }
      return Promise.resolve({
        query: () => Promise.resolve(mockQueryResult),
        release: (err?: Error) => {
          poolClientReleaseCalls.push(err);
        },
        on: (event: string, handler: (err: Error) => void) => {
          if (event === "error") {
            poolClientErrorHandlers.push(handler);
          }
        },
        // biome-ignore lint: mock stub
        removeListener: () => {},
      });
    };
    // biome-ignore lint: mock stub
    on = () => {};
    end = () => Promise.resolve();
  },
}));

jest.mock("pg-cursor", () => ({
  default: class {},
}));

import {
  Cursor,
  closeGlobalPostgresClient,
  createPostgresClient,
  DATA_INTEGRITY_ERROR_CODES,
  getGlobalPostgresClient,
  isDataIntegrityError,
  PG_ERROR_CODES,
  PG_STREAM,
  resetGlobalPostgresClient,
  withConnection,
  withConnectionGenerator,
} from "../index.js";

beforeEach(() => {
  mockConnectBehavior = "success";
  mockQueryResult = { rows: [{ now: "2024-01-01" }], rowCount: 1 };
  poolClientErrorHandlers.length = 0;
  poolClientReleaseCalls.length = 0;
  resetGlobalPostgresClient();
  process.env.DATABASE_URL = undefined;
  process.env.POSTGRES_URL = undefined;
  process.env.AWS_LAMBDA_FUNCTION_NAME = undefined;
});

afterEach(() => {
  process.env.DATABASE_URL = undefined;
  process.env.POSTGRES_URL = undefined;
  process.env.AWS_LAMBDA_FUNCTION_NAME = undefined;
});

describe("PG_ERROR_CODES", () => {
  it("contains expected error code constants", () => {
    expect(PG_ERROR_CODES.NOT_NULL_VIOLATION).toBe("23502");
    expect(PG_ERROR_CODES.FOREIGN_KEY_VIOLATION).toBe("23503");
    expect(PG_ERROR_CODES.UNIQUE_VIOLATION).toBe("23505");
    expect(PG_ERROR_CODES.CHECK_VIOLATION).toBe("23514");
  });

  it("has all values as string constants", () => {
    for (const value of Object.values(PG_ERROR_CODES)) {
      expect(typeof value).toBe("string");
    }
  });
});

describe("DATA_INTEGRITY_ERROR_CODES", () => {
  it("includes all PG_ERROR_CODES values", () => {
    expect(DATA_INTEGRITY_ERROR_CODES).toContain(
      PG_ERROR_CODES.NOT_NULL_VIOLATION
    );
    expect(DATA_INTEGRITY_ERROR_CODES).toContain(
      PG_ERROR_CODES.FOREIGN_KEY_VIOLATION
    );
    expect(DATA_INTEGRITY_ERROR_CODES).toContain(
      PG_ERROR_CODES.UNIQUE_VIOLATION
    );
    expect(DATA_INTEGRITY_ERROR_CODES).toContain(
      PG_ERROR_CODES.CHECK_VIOLATION
    );
  });

  it("has the same length as number of PG_ERROR_CODES keys", () => {
    expect(DATA_INTEGRITY_ERROR_CODES.length).toBe(
      Object.keys(PG_ERROR_CODES).length
    );
  });
});

describe("isDataIntegrityError", () => {
  it("returns true for NOT_NULL_VIOLATION", () => {
    expect(isDataIntegrityError("23502")).toBe(true);
  });

  it("returns true for FOREIGN_KEY_VIOLATION", () => {
    expect(isDataIntegrityError("23503")).toBe(true);
  });

  it("returns true for UNIQUE_VIOLATION", () => {
    expect(isDataIntegrityError("23505")).toBe(true);
  });

  it("returns true for CHECK_VIOLATION", () => {
    expect(isDataIntegrityError("23514")).toBe(true);
  });

  it("returns false for non-integrity error codes", () => {
    expect(isDataIntegrityError("08006")).toBe(false);
    expect(isDataIntegrityError("57014")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isDataIntegrityError(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isDataIntegrityError("")).toBe(false);
  });
});

describe("createPostgresClient", () => {
  it("returns a PostgresClient with expected shape", () => {
    const client = createPostgresClient({
      connectionString: "postgres://localhost/test",
    });
    expect(client.pool).toBeDefined();
    expect(typeof client.testConnection).toBe("function");
    expect(typeof client.close).toBe("function");
    expect(typeof client.executeQuery).toBe("function");
  });

  it("validates schema name with valid input", () => {
    expect(() =>
      createPostgresClient({
        connectionString: "postgres://localhost/test",
        schema: "my_schema",
      })
    ).not.toThrow();
    expect(() =>
      createPostgresClient({
        connectionString: "postgres://localhost/test",
        schema: "MySchema",
      })
    ).not.toThrow();
  });

  it("throws on invalid schema name with special characters", () => {
    expect(() =>
      createPostgresClient({
        connectionString: "postgres://localhost/test",
        schema: "bad; schema",
      })
    ).toThrow('Invalid schema name: "bad; schema"');
  });

  it("throws on invalid schema name starting with digit", () => {
    expect(() =>
      createPostgresClient({
        connectionString: "postgres://localhost/test",
        schema: "1bad",
      })
    ).toThrow('Invalid schema name: "1bad"');
  });

  it("uses Lambda pool config when AWS_LAMBDA_FUNCTION_NAME is set", () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "my-function";
    const client = createPostgresClient({
      connectionString: "postgres://localhost/test",
    });
    expect(client.pool).toBeDefined();
  });

  it("testConnection returns true on successful connection", async () => {
    mockConnectBehavior = "success";
    mockQueryResult = { rows: [{ now: "2024-01-01T00:00:00Z" }], rowCount: 1 };
    const client = createPostgresClient({
      connectionString: "postgres://localhost/test",
    });
    const result = await client.testConnection();
    expect(result).toBe(true);
  });

  it("testConnection returns false on connection failure", async () => {
    mockConnectBehavior = "fail";
    const client = createPostgresClient({
      connectionString: "postgres://localhost/test",
    });
    const result = await client.testConnection();
    expect(result).toBe(false);
  });

  it("executeQuery returns rows and rowCount", async () => {
    mockQueryResult = { rows: [{ id: 1, name: "test" }], rowCount: 1 };
    const client = createPostgresClient({
      connectionString: "postgres://localhost/test",
    });
    const result = await client.executeQuery("SELECT * FROM users");
    expect(result.rows).toEqual([{ id: 1, name: "test" }]);
    expect(result.rowCount).toBe(1);
  });

  it("close calls pool.end", async () => {
    const client = createPostgresClient({
      connectionString: "postgres://localhost/test",
    });
    await expect(client.close()).resolves.toBeUndefined();
  });
});

describe("withConnection", () => {
  it("runs the operation and returns its result", async () => {
    const client = createPostgresClient({
      connectionString: "postgres://localhost/test",
    });
    const result = await withConnection(client, (_: unknown) =>
      Promise.resolve("operation-result")
    );
    expect(result).toBe("operation-result");
    expect(poolClientReleaseCalls.length).toBeGreaterThan(0);
  });

  it("releases connection after successful operation", async () => {
    const client = createPostgresClient({
      connectionString: "postgres://localhost/test",
    });
    const releaseCountBefore = poolClientReleaseCalls.length;
    await withConnection(client, () => Promise.resolve("ok"));
    expect(poolClientReleaseCalls.length).toBe(releaseCountBefore + 1);
  });

  it("propagates errors thrown by the operation", async () => {
    const client = createPostgresClient({
      connectionString: "postgres://localhost/test",
    });
    await expect(
      withConnection(client, () =>
        Promise.reject(new Error("Operation failed"))
      )
    ).rejects.toThrow("Operation failed");
  });

  it("releases connection even when operation throws", async () => {
    const client = createPostgresClient({
      connectionString: "postgres://localhost/test",
    });
    const releaseCountBefore = poolClientReleaseCalls.length;
    await expect(
      withConnection(client, () =>
        Promise.reject(new Error("Operation failed"))
      )
    ).rejects.toThrow();
    expect(poolClientReleaseCalls.length).toBe(releaseCountBefore + 1);
  });

  it("wraps error when connection error occurs during operation", async () => {
    const client = createPostgresClient({
      connectionString: "postgres://localhost/test",
    });
    const connLostError = new Error("Connection lost mid-operation");
    const resultPromise = withConnection(client, () => {
      poolClientErrorHandlers[0]?.(connLostError);
      return Promise.reject(new Error("Operation failed"));
    });
    await expect(resultPromise).rejects.toThrow(
      "PostgreSQL connection lost during operation"
    );
  });

  it("passes connection error to release when error captured", async () => {
    const client = createPostgresClient({
      connectionString: "postgres://localhost/test",
    });
    const connError = new Error("Connection lost mid-operation");
    await expect(
      withConnection(client, () => {
        poolClientErrorHandlers[0]?.(connError);
        return Promise.reject(new Error("Operation failed"));
      })
    ).rejects.toThrow();
    expect(poolClientReleaseCalls.at(-1)).toBe(connError);
  });
});

describe("getGlobalPostgresClient", () => {
  it("throws when DATABASE_URL and POSTGRES_URL are not set", () => {
    expect(() => getGlobalPostgresClient()).toThrow(
      "DATABASE_URL or POSTGRES_URL must be set"
    );
  });

  it("creates client when DATABASE_URL is set", () => {
    process.env.DATABASE_URL = "postgres://localhost/test";
    const client = getGlobalPostgresClient();
    expect(client.pool).toBeDefined();
    expect(typeof client.testConnection).toBe("function");
  });

  it("creates client when POSTGRES_URL is set", () => {
    process.env.POSTGRES_URL = "postgres://localhost/test-pg";
    const client = getGlobalPostgresClient();
    expect(client.pool).toBeDefined();
  });

  it("returns same instance on subsequent calls", () => {
    process.env.DATABASE_URL = "postgres://localhost/test";
    const client1 = getGlobalPostgresClient();
    const client2 = getGlobalPostgresClient();
    expect(client1).toBe(client2);
  });

  it("uses options.connectionString over env vars", () => {
    process.env.DATABASE_URL = "postgres://localhost/env";
    const client = getGlobalPostgresClient({
      connectionString: "postgres://localhost/options",
    });
    expect(client.pool).toBeDefined();
  });
});

describe("resetGlobalPostgresClient", () => {
  it("clears the global client so next call creates a new one", () => {
    process.env.DATABASE_URL = "postgres://localhost/test";
    const client1 = getGlobalPostgresClient();
    resetGlobalPostgresClient();
    const client2 = getGlobalPostgresClient();
    expect(client1).not.toBe(client2);
  });
});

describe("closeGlobalPostgresClient", () => {
  it("closes and nullifies the client", async () => {
    process.env.DATABASE_URL = "postgres://localhost/test";
    getGlobalPostgresClient();
    await closeGlobalPostgresClient();
    const client = getGlobalPostgresClient();
    expect(client).toBeDefined();
  });

  it("is a no-op when no client has been created", async () => {
    await expect(closeGlobalPostgresClient()).resolves.toBeUndefined();
  });
});

describe("PG_STREAM", () => {
  it("has FETCH_ARRAY_SIZE set to 500", () => {
    expect(PG_STREAM.FETCH_ARRAY_SIZE).toBe(500);
  });

  it("FETCH_ARRAY_SIZE is a positive integer", () => {
    expect(Number.isInteger(PG_STREAM.FETCH_ARRAY_SIZE)).toBe(true);
    expect(PG_STREAM.FETCH_ARRAY_SIZE).toBeGreaterThan(0);
  });
});

describe("withConnectionGenerator", () => {
  it("yields results from the async generator operation", async () => {
    const client = createPostgresClient({
      connectionString: "postgres://localhost/test",
    });

    // biome-ignore lint: async required for AsyncGenerator type
    async function* mockData() {
      yield { id: 1 };
      yield { id: 2 };
      yield { id: 3 };
    }

    const results: Array<{ id: number }> = [];
    for await (const row of withConnectionGenerator(client, () => mockData())) {
      results.push(row);
    }
    expect(results).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it("releases connection even when generator throws", async () => {
    const client = createPostgresClient({
      connectionString: "postgres://localhost/test",
    });
    const releaseCountBefore = poolClientReleaseCalls.length;

    // biome-ignore lint: async required for AsyncGenerator type
    async function* throwingGenerator() {
      yield 1;
      throw new Error("Generator error");
    }

    const generator = withConnectionGenerator(client, () =>
      throwingGenerator()
    );
    await generator.next();
    await expect(generator.next()).rejects.toThrow("Generator error");

    expect(poolClientReleaseCalls.length).toBe(releaseCountBefore + 1);
  });
});

describe("Cursor", () => {
  it("is exported from the package", () => {
    expect(Cursor).toBeDefined();
    expect(typeof Cursor).toBe("function");
  });
});

describe("index exports", () => {
  it("re-exports PG_ERROR_CODES", () => {
    expect(PG_ERROR_CODES).toBeDefined();
    expect(PG_ERROR_CODES.UNIQUE_VIOLATION).toBe("23505");
  });

  it("re-exports DATA_INTEGRITY_ERROR_CODES", () => {
    expect(DATA_INTEGRITY_ERROR_CODES).toBeDefined();
    expect(Array.isArray(DATA_INTEGRITY_ERROR_CODES)).toBe(true);
  });

  it("re-exports isDataIntegrityError", () => {
    expect(typeof isDataIntegrityError).toBe("function");
  });

  it("re-exports createPostgresClient", () => {
    expect(typeof createPostgresClient).toBe("function");
  });

  it("re-exports withConnection", () => {
    expect(typeof withConnection).toBe("function");
  });

  it("re-exports getGlobalPostgresClient", () => {
    expect(typeof getGlobalPostgresClient).toBe("function");
  });

  it("re-exports resetGlobalPostgresClient", () => {
    expect(typeof resetGlobalPostgresClient).toBe("function");
  });

  it("re-exports closeGlobalPostgresClient", () => {
    expect(typeof closeGlobalPostgresClient).toBe("function");
  });

  it("re-exports Cursor", () => {
    expect(Cursor).toBeDefined();
  });

  it("re-exports PG_STREAM", () => {
    expect(PG_STREAM).toBeDefined();
    expect(PG_STREAM.FETCH_ARRAY_SIZE).toBe(500);
  });

  it("re-exports withConnectionGenerator", () => {
    expect(typeof withConnectionGenerator).toBe("function");
  });
});
