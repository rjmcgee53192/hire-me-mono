import { describe, expect, it } from "vitest";
import { intIn, mulberry32, pick, uniform } from "./rng";

describe("mulberry32", () => {
  it("replays the same sequence for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 100 }, () => a());
    const seqB = Array.from({ length: 100 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces different streams for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it("stays in [0, 1)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("helpers", () => {
  it("uniform stays within bounds", () => {
    const rng = mulberry32(9);
    for (let i = 0; i < 500; i++) {
      const v = uniform(rng, 5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(10);
    }
  });

  it("intIn returns integers within inclusive bounds", () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 500; i++) {
      const v = intIn(rng, 2, 8);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(8);
    }
  });

  it("pick returns a member of the array", () => {
    const rng = mulberry32(13);
    const items = ["a", "b", "c"] as const;
    for (let i = 0; i < 100; i++) {
      expect(items).toContain(pick(rng, items));
    }
  });

  it("pick throws on an empty array", () => {
    expect(() => pick(mulberry32(1), [])).toThrow();
  });
});
