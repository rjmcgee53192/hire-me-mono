/**
 * Seeded pseudo-random number generation.
 *
 * The whole simulation is deterministic: every stochastic process
 * (utilization random walks, thermal noise, job throughput) draws from a
 * seeded mulberry32 stream, so a given seed always replays the same run.
 */

/** A function returning a uniform value in [0, 1). */
export type Rng = () => number;

/**
 * mulberry32 — a small, fast, seedable PRNG with a full 2^32 period.
 * Deterministic across V8/Node for the same seed.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform value in [min, max). */
export function uniform(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Random integer in [min, max] inclusive. */
export function intIn(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Pick a random element of a non-empty array. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error("pick() called with empty array");
  return item;
}
