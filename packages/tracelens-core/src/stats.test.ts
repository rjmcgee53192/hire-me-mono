import { describe, expect, it } from "vitest";
import {
  StreamingHistogram,
  RollingStats,
  percentileSorted,
} from "./stats";
import { LoadGen } from "./generator";
import type { MockEndpoint, Sample } from "./generator";
import { seededGaussian, mulberry32 } from "./rng";

const relErr = (est: number, exact: number): number =>
  Math.abs(est - exact) / Math.max(exact, 1e-9);

describe("StreamingHistogram percentile accuracy", () => {
  it("matches brute-force percentiles within 5% on 10k spiky bimodal samples", () => {
    // Adversarial but realistic: 70% fast requests clustered at ~50ms and
    // 30% slow ones around ~800ms. Sharp intra-bucket clustering is the hard
    // case for bucket interpolation.
    const gaussian = seededGaussian(1234);
    const uniform = mulberry32(555);
    const values: number[] = [];
    for (let i = 0; i < 10000; i++) {
      const fast = uniform() < 0.7;
      const v = fast
        ? 50 + Math.abs(gaussian()) * 15
        : 800 + Math.abs(gaussian()) * 200;
      values.push(Math.max(0.5, v));
    }

    const hist = new StreamingHistogram();
    for (const v of values) hist.add(v);

    const sorted = [...values].sort((a, b) => a - b);
    for (const p of [50, 95, 99]) {
      const est = hist.percentile(p);
      const exact = percentileSorted(sorted, p);
      expect(relErr(est, exact)).toBeLessThanOrEqual(0.05);
    }
  });

  it("matches brute-force percentiles within 5% on lognormal latencies", () => {
    const gaussian = seededGaussian(7);
    const values: number[] = [];
    for (let i = 0; i < 10000; i++) {
      values.push(Math.max(0.5, Math.exp(3.5 + gaussian() * 0.8)));
    }
    const hist = new StreamingHistogram();
    for (const v of values) hist.add(v);
    const sorted = [...values].sort((a, b) => a - b);
    for (const p of [50, 95, 99]) {
      expect(relErr(hist.percentile(p), percentileSorted(sorted, p))).toBeLessThanOrEqual(0.05);
    }
  });
});

describe("StreamingHistogram merge", () => {
  it("merged histogram equals a single histogram fed all samples", () => {
    const gaussian = seededGaussian(2026);
    const a = new StreamingHistogram();
    const b = new StreamingHistogram();
    const all = new StreamingHistogram();
    for (let i = 0; i < 6000; i++) {
      const v = Math.max(0.5, 120 + Math.abs(gaussian()) * 40);
      (i % 2 === 0 ? a : b).add(v);
      all.add(v);
    }
    const merged = a.merge(b);
    expect(merged.count).toBe(all.count);
    for (const p of [50, 90, 95, 99]) {
      expect(merged.percentile(p)).toBe(all.percentile(p));
    }
  });
});

const ENDPOINTS: MockEndpoint[] = [
  { name: "GET /api/search", baseLatencyMs: 45, jitterMs: 18, errorRate: 0.002 },
  { name: "POST /api/checkout", baseLatencyMs: 120, jitterMs: 60, errorRate: 0.005 },
];

function feed(gen: LoadGen, stats: RollingStats, ticks: number, rps: number, mult: number): Sample[] {
  let out: Sample[] = [];
  for (let i = 0; i < ticks; i++) {
    const s = gen.tick(0.5, rps, mult);
    stats.push(s);
    out = out.concat(s);
  }
  return out;
}

describe("RollingStats", () => {
  it("computes per-endpoint percentiles, throughput and error rate", () => {
    const gen = new LoadGen(ENDPOINTS, 42);
    const stats = new RollingStats(60);
    feed(gen, stats, 20, 200, 1);

    const s = stats.statsFor("GET /api/search");
    expect(s).not.toBeNull();
    if (!s) return;
    expect(s.count).toBeGreaterThan(0);
    expect(s.p50).toBeLessThan(s.p95);
    expect(s.p95).toBeLessThanOrEqual(s.p99);
    // 0.5s * 200rps * 20 ticks split across 2 endpoints ≈ 1000 each
    expect(s.throughputRps).toBeGreaterThan(50);
    expect(s.errorRate).toBeGreaterThanOrEqual(0);
    expect(s.errorRate).toBeLessThan(0.1);

    const overall = stats.overall();
    expect(overall).not.toBeNull();
    expect(overall!.count).toBe(s.count + stats.statsFor("POST /api/checkout")!.count);
  });

  it("evicts samples outside the window", () => {
    const gen = new LoadGen(ENDPOINTS, 11);
    const stats = new RollingStats(5);
    feed(gen, stats, 4, 100, 1); // 2s of data
    const before = stats.overall()!.count;
    feed(gen, stats, 20, 100, 1); // +10s, first 2s should age out
    const after = stats.overall()!.count;
    expect(after).toBeLessThan(before + 20 * 50);
    expect(after).toBeGreaterThan(0);
  });

  it("reset() clears everything", () => {
    const gen = new LoadGen(ENDPOINTS, 11);
    const stats = new RollingStats(60);
    feed(gen, stats, 4, 100, 1);
    stats.reset();
    expect(stats.overall()).toBeNull();
    expect(stats.endpoints()).toEqual([]);
  });
});
