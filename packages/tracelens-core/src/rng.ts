/**
 * Seeded pseudo-random helpers for reproducible synthetic load.
 *
 * mulberry32 is a small, fast, well-distributed PRNG. Seeding the load
 * generator with a fixed value makes dashboards and tests deterministic,
 * which is exactly what you want when you are demonstrating (or asserting
 * on) statistical behavior like percentiles.
 */

/** Deterministic PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Factory for standard-normal variates (mean 0, stddev 1) via the
 * Box–Muller transform. Uses the spare-variate trick so each call is
 * amortized O(1) and consumes at most one uniform pair.
 */
export function makeGaussian(uniform: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    // u must be > 0 for log(u); rejection sampling on the unit disk.
    let s = 0;
    do {
      u = uniform() * 2 - 1;
      v = uniform() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * mul;
    return u * mul;
  };
}

/** Convenience: a seeded gaussian generator in one call. */
export function seededGaussian(seed: number): () => number {
  return makeGaussian(mulberry32(seed));
}
