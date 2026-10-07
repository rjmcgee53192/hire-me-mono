/**
 * Seeded pseudo-random number generation for @repo/astra-core.
 *
 * Determinism is the whole point of this module: given the same seed, the
 * engine must produce byte-identical telemetry on every run so that
 * `Flight.scrubTo(t)` can re-simulate from t=0 and land on exactly the same
 * samples. mulberry32 is small, fast, and has no hidden global state.
 */

/** A uniform [0, 1) random number generator. */
export type Rng = () => number;

/**
 * mulberry32 seeded RNG.
 *
 * @param seed Any 32-bit integer seed. The same seed always yields the same
 * sequence.
 */
export function mulberry32(seed: number): Rng {
  let a: number = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t: number = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard-normal (mean 0, stddev 1) sample via Box–Muller.
 *
 * Draws exactly two uniforms per call (the spare is discarded on purpose) so
 * the draw count stays predictable and scrub-replay stays deterministic.
 */
export function gaussian(rng: Rng): number {
  let u1 = 0;
  // u1 must be > 0 for log to be defined.
  while (u1 === 0) {
    u1 = rng();
  }
  const u2 = rng();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}
