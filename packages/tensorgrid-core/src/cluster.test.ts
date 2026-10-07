import { describe, expect, it } from "vitest";
import { Cluster, THERMAL_LIMIT_C } from "./cluster";
import { intIn, mulberry32 } from "./rng";

describe("Cluster", () => {
  it("rejects invalid configs", () => {
    expect(() => new Cluster({ nodeCount: 0, gpusPerNode: 8 })).toThrow();
    expect(() => new Cluster({ nodeCount: 4, gpusPerNode: 0 })).toThrow();
  });

  it("allocates greedily across nodes and never over-allocates", () => {
    const cluster = new Cluster({ nodeCount: 4, gpusPerNode: 8, seed: 1 });
    expect(cluster.totalGpus).toBe(32);

    const alloc = cluster.allocateGpus(10);
    expect(alloc).not.toBeNull();
    expect(alloc!.reduce((s, a) => s + a.gpus, 0)).toBe(10);
    expect(cluster.totalGpusUsed).toBe(10);
    expect(cluster.totalGpusFree).toBe(22);

    // Biggest single request fills most-free nodes first.
    for (const n of cluster.nodes) {
      expect(n.gpusUsed).toBeLessThanOrEqual(n.gpusTotal);
    }

    expect(cluster.allocateGpus(23)).toBeNull(); // only 22 free
    cluster.releaseGpus(alloc!);
    expect(cluster.totalGpusUsed).toBe(0);
  });

  it("keeps physical invariants under randomized allocation churn", () => {
    const rng = mulberry32(99);
    const cluster = new Cluster({ nodeCount: 4, gpusPerNode: 8, seed: 99 });
    const held: { nodeIndex: number; gpus: number }[][] = [];

    for (let step = 0; step < 500; step++) {
      if (rng() < 0.6) {
        const n = intIn(rng, 1, 12);
        const alloc = cluster.allocateGpus(n);
        if (alloc) held.push(alloc);
      } else if (held.length > 0) {
        const idx = Math.floor(rng() * held.length);
        const alloc = held.splice(idx, 1)[0];
        if (alloc) cluster.releaseGpus(alloc);
      }
      cluster.tick(1, rng);

      for (const node of cluster.nodes) {
        expect(node.gpusUsed).toBeGreaterThanOrEqual(0);
        expect(node.gpusUsed).toBeLessThanOrEqual(node.gpusTotal);
        expect(node.utilPct).toBeGreaterThanOrEqual(0);
        expect(node.utilPct).toBeLessThanOrEqual(100);
        expect(node.tempC).toBeGreaterThan(0);
        expect(node.powerW).toBeGreaterThan(0);
        expect(node.gpuUtil).toHaveLength(node.gpusTotal);
        for (const u of node.gpuUtil) {
          expect(u).toBeGreaterThanOrEqual(0);
          expect(u).toBeLessThanOrEqual(100);
        }
      }
      expect(cluster.totalGpusUsed).toBeLessThanOrEqual(cluster.totalGpus);
    }
  });

  it("drives utilization toward load and temperature with a lag", () => {
    const cluster = new Cluster({ nodeCount: 2, gpusPerNode: 4, seed: 5 });
    const rng = mulberry32(5);

    // Fully load node-0, leave node-1 idle.
    cluster.allocateGpus(4);
    expect(cluster.nodes[0]!.gpusUsed).toBe(4);

    const t0 = cluster.nodes[0]!.tempC;
    // One short tick: temp must move toward its (much hotter) target but
    // not jump straight to it — thermal inertia.
    cluster.tick(0.5, rng);
    const t1 = cluster.nodes[0]!.tempC;
    expect(t1).toBeGreaterThan(t0);
    expect(t1).toBeLessThan(55 + 100 * 0.35); // still far from the hot target

    // After sustained full load, the hot node approaches its target and
    // the idle node stays cool.
    for (let i = 0; i < 400; i++) cluster.tick(1, rng);
    const hot = cluster.nodes[0]!;
    const idle = cluster.nodes[1]!;
    expect(hot.utilPct).toBeGreaterThan(90);
    expect(hot.tempC).toBeGreaterThan(THERMAL_LIMIT_C); // full tilt → over the alert line
    expect(idle.utilPct).toBeLessThan(30);
    expect(idle.tempC).toBeLessThan(THERMAL_LIMIT_C);
  });

  it("replays identical physics for the same seed", () => {
    const run = (): number[] => {
      const cluster = new Cluster({ nodeCount: 2, gpusPerNode: 4, seed: 1234 });
      cluster.allocateGpus(5);
      for (let i = 0; i < 50; i++) cluster.tick(1);
      return cluster.snapshot().flatMap((n) => [n.utilPct, n.tempC, n.powerW]);
    };
    expect(run()).toEqual(run());
  });
});
