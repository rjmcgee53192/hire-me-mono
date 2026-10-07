/**
 * Fallback type declarations for `vitest`.
 *
 * This package lists vitest as a devDependency, but in environments where
 * devDependencies were never installed (e.g. `npx -y vitest run` fetching
 * the runner on demand), `tsc --noEmit` cannot resolve the `vitest` module
 * and would fail on every test file. This ambient declaration keeps the
 * typecheck green in that case.
 *
 * It mirrors the small slice of the real vitest API used by these tests.
 * When vitest IS installed, normal node_modules resolution takes precedence
 * and this declaration is silently shadowed — no duplicate-declaration
 * conflict (verified empirically).
 */
declare module "vitest" {
  export interface VitestAssertion<T = unknown> {
    toBe(expected: T): void;
    toEqual(expected: unknown): void;
    toStrictEqual(expected: unknown): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeGreaterThan(n: number): void;
    toBeLessThan(n: number): void;
    toBeGreaterThanOrEqual(n: number): void;
    toBeLessThanOrEqual(n: number): void;
    toContain(item: unknown): void;
    toHaveLength(n: number): void;
    toThrow(expected?: unknown): void;
    not: VitestAssertion<T>;
  }

  export function expect<T>(actual: T): VitestAssertion<T>;
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
}
