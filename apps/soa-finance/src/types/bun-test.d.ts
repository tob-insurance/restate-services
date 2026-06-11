declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function expect<T>(actual: T): {
    toBe(expected: unknown): void;
    toStrictEqual(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeGreaterThan(n: number): void;
    toBeLessThan(n: number): void;
    toContain(item: unknown): void;
    not: {
      toBe(expected: unknown): void;
      toStrictEqual(expected: unknown): void;
    };
    rejects: Promise<T> & {
      toThrow(expected?: string): Promise<void>;
    };
    resolves: Promise<T>;
  };
}
