import { describe, expect, it } from "vitest";
import { Cluster } from "./cluster";
import { mulberry32 } from "./rng";
import { Scheduler, type JobPriority } from "./scheduler";

const makeScheduler = (seed = 42): { cluster: Cluster; sched: Scheduler } => {
  const cluster = new Cluster({ nodeCount: 2, gpusPerNode: 4, seed });
  return { cluster, sched: new Scheduler(cluster, { seed }) };
};

describe("Scheduler", () => {
  it("honors priority: a later high-priority job starts before an earlier low-priority one", () => {
    const { sched } = makeScheduler();
    // Only 8 GPUs total; each job wants all 8, so only one can run.
    const low = sched.submit({ name: "low", gpus: 8, priority: 5, durationSec: 100 });
    const high = sched.submit({ name: "high", gpus: 8, priority: 1, durationSec: 100 });

    sched.tick(1);

    const running = sched.running().map((j) => j.id);
    const queued = sched.queue().map((j) => j.id);
    expect(running).toEqual([high.id]);
    expect(queued).toEqual([low.id]);
    expect(high.startedAt).toBe(1);
  });

  it("never over-allocates GPUs in a randomized run", () => {
    const rng = mulberry32(2026);
    const cluster = new Cluster({ nodeCount: 4, gpusPerNode: 8, seed: 2026 });
    const sched = new Scheduler(cluster, { seed: 2026 });
    const priorities: JobPriority[] = [1, 2, 3, 4, 5];

    for (let tick = 0; tick < 600; tick++) {
      if (rng() < 0.35) {
        try {
          sched.submit({
            name: `job-${tick}`,
            gpus: 1 + Math.floor(rng() * 12),
            priority: priorities[Math.floor(rng() * priorities.length)]!,
            durationSec: 5 + Math.floor(rng() * 60),
          });
        } catch {
          // oversized requests are rejected by submit(); that's fine
        }
      }
      // Occasionally cancel something live.
      if (rng() < 0.05) {
        const live = [...sched.queue(), ...sched.running()];
        if (live.length > 0) {
          sched.cancel(live[Math.floor(rng() * live.length)]!.id);
        }
      }
      cluster.tick(1, rng);
      sched.tick(1);

      const allocated = sched.running().reduce((s, j) => s + j.gpus, 0);
      expect(allocated).toBeLessThanOrEqual(cluster.totalGpus);
      expect(cluster.totalGpusUsed).toBe(allocated);
    }
  });

  it("records completed jobs with positive seeded throughput", () => {
    const { cluster, sched } = makeScheduler();
    sched.submit({ name: "quick", gpus: 2, priority: 3, durationSec: 10 });

    cluster.tick(5);
    sched.tick(5);
    expect(sched.running()).toHaveLength(1);
    expect(sched.completed()).toHaveLength(0);

    cluster.tick(5);
    sched.tick(5);
    expect(sched.running()).toHaveLength(1); // 5s remaining

    cluster.tick(5);
    sched.tick(5);
    expect(sched.running()).toHaveLength(0);
    expect(cluster.totalGpusUsed).toBe(0); // GPUs released on completion

    const done = sched.completed();
    expect(done).toHaveLength(1);
    expect(done[0]!.throughputTokensPerSec).toBeGreaterThan(0);
    expect(done[0]!.completedAt).toBe(15);
    expect(done[0]!.nodeIds.length).toBeGreaterThan(0);
  });

  it("lets a job span nodes", () => {
    const { sched } = makeScheduler(); // 2 nodes x 4 GPUs
    sched.submit({ name: "wide", gpus: 6, priority: 2, durationSec: 30 });
    sched.tick(1);
    const job = sched.running()[0]!;
    expect(job.allocation.reduce((s, a) => s + a.gpus, 0)).toBe(6);
    expect(job.allocation.length).toBeGreaterThan(1);
  });

  it("cancels queued and running jobs and frees their GPUs", () => {
    const { cluster, sched } = makeScheduler();
    const a = sched.submit({ name: "a", gpus: 8, priority: 1, durationSec: 100 });
    const b = sched.submit({ name: "b", gpus: 8, priority: 5, durationSec: 100 });
    sched.tick(1);

    expect(sched.cancel(b.id)).toBe(true); // queued
    expect(sched.cancel(a.id)).toBe(true); // running
    expect(cluster.totalGpusUsed).toBe(0);
    expect(sched.queue()).toHaveLength(0);
    expect(sched.running()).toHaveLength(0);
    expect(sched.completed()).toHaveLength(0); // cancelled ≠ completed
    expect(sched.cancel("job-999")).toBe(false);
  });

  it("rejects jobs that can never fit and invalid specs", () => {
    const { sched } = makeScheduler(); // 8 GPUs total
    expect(() =>
      sched.submit({ name: "big", gpus: 9, priority: 1, durationSec: 10 }),
    ).toThrow();
    expect(() =>
      sched.submit({ name: "zero", gpus: 0, priority: 1, durationSec: 10 }),
    ).toThrow();
    expect(() =>
      sched.submit({ name: "neg", gpus: 1, priority: 1, durationSec: -5 }),
    ).toThrow();
  });

  it("is deterministic for a fixed seed and workload", () => {
    const run = (): number[] => {
      const cluster = new Cluster({ nodeCount: 4, gpusPerNode: 8, seed: 7 });
      const sched = new Scheduler(cluster, { seed: 7 });
      const rng = mulberry32(7);
      for (let t = 0; t < 200; t++) {
        if (rng() < 0.4) {
          sched.submit({
            name: `j${t}`,
            gpus: 1 + Math.floor(rng() * 8),
            priority: (1 + Math.floor(rng() * 5)) as JobPriority,
            durationSec: 10 + Math.floor(rng() * 50),
          });
        }
        cluster.tick(1, rng);
        sched.tick(1);
      }
      return sched.completed().map((c) => c.throughputTokensPerSec);
    };
    expect(run()).toEqual(run());
  });
});
