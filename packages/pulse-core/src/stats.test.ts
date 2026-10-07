import { describe, expect, it } from "vitest";
import { OpStats } from "./stats";

describe("OpStats", () => {
  it("computes count, avg, and p95 over recorded latencies", () => {
    const stats = new OpStats();
    for (const ms of [10, 20, 30, 40, 50]) stats.record(ms);

    expect(stats.count()).toBe(5);
    expect(stats.avg()).toBe(30);
    // nearest-rank: ceil(0.95 * 5) = 5th value → 50
    expect(stats.p95()).toBe(50);
  });

  it("returns zeros when empty and clamps negatives", () => {
    const stats = new OpStats();
    expect(stats.count()).toBe(0);
    expect(stats.avg()).toBe(0);
    expect(stats.p95()).toBe(0);

    stats.record(-25);
    stats.record(Number.NaN);
    expect(stats.count()).toBe(1); // NaN ignored, -25 clamped to 0
    expect(stats.avg()).toBe(0);
  });

  it("p95 picks the nearest-rank element on larger samples", () => {
    const stats = new OpStats();
    for (let i = 1; i <= 100; i++) stats.record(i);
    // ceil(0.95 * 100) = 95th value → 95
    expect(stats.p95()).toBe(95);
    expect(stats.avg()).toBe(50.5);
  });

  it("recent() returns the trailing window for charts", () => {
    const stats = new OpStats();
    for (const ms of [10, 20, 30, 40, 50]) stats.record(ms);
    expect(stats.recent(3)).toEqual([30, 40, 50]);
    expect(stats.recent(99)).toEqual([10, 20, 30, 40, 50]);
    expect(stats.recent(0)).toEqual([]);
  });

  it("reset() clears all samples", () => {
    const stats = new OpStats();
    stats.record(12);
    stats.reset();
    expect(stats.count()).toBe(0);
    expect(stats.avg()).toBe(0);
  });
});
