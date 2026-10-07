/**
 * Minimal type shim for the vitest API surface used by this package's
 * tests. It exists so `tsc --noEmit` passes whether or not vitest is
 * installed in node_modules (the runtime is always real vitest, via
 * `npx vitest`). Wired up through the "vitest" paths mapping in
 * tsconfig.json. Keep in sync with the matchers the tests actually use.
 */

export type TestFn = () => void | Promise<void>;

export declare function describe(name: string, fn: () => void): void;
export declare function it(name: string, fn: TestFn): void;
export declare function test(name: string, fn: TestFn): void;

export interface Assertion<T = unknown> {
  toBe(expected: T): void;
  toBeNull(): void;
  toEqual(expected: unknown): void;
  toStrictEqual(expected: unknown): void;
  toHaveLength(n: number): void;
  toBeGreaterThan(n: number): void;
  toBeGreaterThanOrEqual(n: number): void;
  toBeLessThan(n: number): void;
  toBeLessThanOrEqual(n: number): void;
  toContain(item: unknown): void;
  toThrow(expected?: unknown): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  not: Assertion<T>;
}

export declare function expect<T>(actual: T): Assertion<T>;
