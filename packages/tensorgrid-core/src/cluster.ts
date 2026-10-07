/**
 * GPU cluster model: nodes, per-GPU utilization, thermals, and power.
 *
 * Each node runs a mean-reverting random walk for utilization that is
 * coupled to its allocated load (allocated GPUs → high target util, idle
 * GPUs → low baseline). Temperature chases a utilization-derived target
 * with a first-order lag (thermal inertia, tau ≈ 10 s), and power draw
 * follows utilization. Everything stochastic draws from a seeded RNG, so
 * identical seeds replay identical physics.
 */

import { mulberry32, type Rng, uniform } from "./rng";

export interface ClusterConfig {
  /** Number of compute nodes. */
  nodeCount: number;
  /** GPUs per node (homogeneous cluster). */
  gpusPerNode: number;
  /** Seed for the cluster's internal RNG stream. */
  seed?: number;
}

/** GPUs taken from specific nodes by one job (a job may span nodes). */
export interface GpuAllocation {
  nodeIndex: number;
  gpus: number;
}

/** Plain, serializable per-node snapshot for UI / tests. */
export interface NodeSnapshot {
  id: string;
  index: number;
  gpusTotal: number;
  gpusUsed: number;
  gpusFree: number;
  utilPct: number;
  tempC: number;
  powerW: number;
  /** Per-GPU utilization, length === gpusTotal, values 0–100. */
  gpuUtil: number[];
}

/** Thermal time constant in seconds (first-order lag of temp behind util). */
export const THERMAL_TAU_SEC = 10;

/** Alerting-relevant temperature threshold in °C. */
export const THERMAL_LIMIT_C = 85;

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/** One compute node. Fields are public so tests/demos can inspect (and, in
 *  tests, force) physical state; the Cluster keeps them consistent. */
export class GpuNode {
  readonly id: string;
  readonly gpusTotal: number;
  gpusUsed = 0;
  /** Node-level utilization %, random-walked toward the load-implied target. */
  utilPct: number;
  /** Die temperature in °C, lags utilization with thermal inertia. */
  tempC: number;
  /** Node power draw in watts. */
  powerW: number;
  /** Per-GPU utilization %, length === gpusTotal. */
  gpuUtil: number[];

  constructor(id: string, gpusTotal: number, rng: Rng) {
    this.id = id;
    this.gpusTotal = gpusTotal;
    this.utilPct = uniform(rng, 6, 14);
    this.tempC = 55 + this.utilPct * 0.35;
    this.powerW = gpusTotal * (400 + this.utilPct * 9);
    this.gpuUtil = Array.from({ length: gpusTotal }, () =>
      uniform(rng, 4, 16),
    );
  }

  get gpusFree(): number {
    return this.gpusTotal - this.gpusUsed;
  }

  snapshot(index: number): NodeSnapshot {
    return {
      id: this.id,
      index,
      gpusTotal: this.gpusTotal,
      gpusUsed: this.gpusUsed,
      gpusFree: this.gpusFree,
      utilPct: this.utilPct,
      tempC: this.tempC,
      powerW: this.powerW,
      gpuUtil: [...this.gpuUtil],
    };
  }
}

export class Cluster {
  readonly nodeCount: number;
  readonly gpusPerNode: number;
  readonly nodes: GpuNode[];
  private readonly rng: Rng;

  constructor(config: ClusterConfig) {
    if (!Number.isInteger(config.nodeCount) || config.nodeCount < 1) {
      throw new Error("Cluster requires nodeCount >= 1");
    }
    if (!Number.isInteger(config.gpusPerNode) || config.gpusPerNode < 1) {
      throw new Error("Cluster requires gpusPerNode >= 1");
    }
    this.nodeCount = config.nodeCount;
    this.gpusPerNode = config.gpusPerNode;
    this.rng = mulberry32(config.seed ?? 0xC10C);
    this.nodes = Array.from(
      { length: config.nodeCount },
      (_, i) => new GpuNode(`node-${i}`, config.gpusPerNode, this.rng),
    );
  }

  get totalGpus(): number {
    return this.nodeCount * this.gpusPerNode;
  }

  get totalGpusUsed(): number {
    return this.nodes.reduce((sum, n) => sum + n.gpusUsed, 0);
  }

  get totalGpusFree(): number {
    return this.totalGpus - this.totalGpusUsed;
  }

  /**
   * Advance the physics by dtSec. Utilization random-walks toward the
   * load-implied target; temperature chases its utilization-derived target
   * with a first-order lag; power follows utilization.
   */
  tick(dtSec: number, rng: Rng = this.rng): void {
    if (!(dtSec > 0)) return;
    const thermalK = 1 - Math.exp(-dtSec / THERMAL_TAU_SEC);
    const utilK = Math.min(1, dtSec * 0.4);
    const gpuK = Math.min(1, dtSec * 0.8);
    const noiseScale = Math.sqrt(dtSec);

    for (const node of this.nodes) {
      const loadRatio = node.gpusUsed / node.gpusTotal;
      const targetUtil = 8 + loadRatio * 92;
      node.utilPct = clamp(
        node.utilPct +
          (targetUtil - node.utilPct) * utilK +
          (rng() - 0.5) * 6 * noiseScale,
        2,
        100,
      );

      for (let i = 0; i < node.gpusTotal; i++) {
        const allocated = i < node.gpusUsed;
        const target = allocated ? 90 : 10;
        const prev = node.gpuUtil[i] ?? 10;
        node.gpuUtil[i] = clamp(
          prev + (target - prev) * gpuK + (rng() - 0.5) * 8 * noiseScale,
          0,
          100,
        );
      }

      const targetTemp = 55 + node.utilPct * 0.35 + (rng() - 0.5) * 2;
      node.tempC += (targetTemp - node.tempC) * thermalK;

      node.powerW = node.gpusTotal * (400 + node.utilPct * 9);
    }
  }

  /**
   * Greedily allocate `count` GPUs across nodes (most-free node first),
   * committing the allocation. Returns null and changes nothing when the
   * cluster cannot satisfy the request.
   */
  allocateGpus(count: number): GpuAllocation[] | null {
    if (!Number.isInteger(count) || count < 1) return null;
    if (count > this.totalGpusFree) return null;
    const order = this.nodes
      .map((node, nodeIndex) => ({ node, nodeIndex }))
      .sort((a, b) => b.node.gpusFree - a.node.gpusFree);
    const alloc: GpuAllocation[] = [];
    let remaining = count;
    for (const { node, nodeIndex } of order) {
      if (remaining === 0) break;
      const take = Math.min(node.gpusFree, remaining);
      if (take > 0) {
        node.gpusUsed += take;
        alloc.push({ nodeIndex, gpus: take });
        remaining -= take;
      }
    }
    return alloc;
  }

  /** Release a previously committed allocation. */
  releaseGpus(alloc: readonly GpuAllocation[]): void {
    for (const { nodeIndex, gpus } of alloc) {
      const node = this.nodes[nodeIndex];
      if (!node) continue;
      node.gpusUsed = Math.max(0, node.gpusUsed - gpus);
    }
  }

  /** Plain snapshots of every node, in node order. */
  snapshot(): NodeSnapshot[] {
    return this.nodes.map((node, i) => node.snapshot(i));
  }
}
