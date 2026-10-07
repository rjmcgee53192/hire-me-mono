import { describe, it, expect } from "vitest";
import { mulberry32, gaussian } from "./rng";

describe("mulberry32", () => {
  it("produces identical sequences for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it("stays within [0, 1)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("gaussian", () => {
  it("is deterministic for a fixed seed", () => {
    const g1 = Array.from({ length: 30 }, () => gaussian(mulberry32(99)));
    const g2 = Array.from({ length: 30 }, () => gaussian(mulberry32(99)));
    expect(g1).toEqual(g2);
  });

  it("roughly follows a standard normal distribution", () => {
    const rng = mulberry32(1234);
    const n = 20_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = gaussian(rng);
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.abs(variance - 1)).toBeLessThan(0.05);
  });
});
