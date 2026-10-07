import type { Sample } from "./generator";

/**
 * Streaming latency statistics.
 *
 * StreamingHistogram keeps O(#buckets) memory while estimating percentiles
 * via linear interpolation inside buckets — the standard approach behind
 * Prometheus histograms and HdrHistogram-style bucketing. RollingStats keeps
 * a bounded ring buffer of recent samples for exact per-endpoint p50/p95/p99,
 * throughput, and error rate over a sliding window.
 */

/**
 * Fixed bucket upper bounds in milliseconds.
 *
 * Geometric series with ratio 1.2 from 1ms to 10s (51 buckets). Narrow
 * buckets keep the linear-interpolation percentile error under ~5% even for
 * spiky, multi-modal latency distributions — verified by the accuracy test in
 * stats.test.ts against a brute-force sorted computation.
 */
function buildBoundaries(): number[] {
  const bounds: number[] = [];
  let v = 1;
  while (v < 10000) {
    bounds.push(Math.round(v * 100) / 100);
    v *= 1.2;
  }
  bounds.push(10000);
  return bounds;
}

export const HISTOGRAM_BOUNDARIES: readonly number[] = buildBoundaries();

/** Binary search: index of the first boundary >= v (== length if none). */
function bucketIndex(v: number): number {
  let lo = 0;
  let hi = HISTOGRAM_BOUNDARIES.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (HISTOGRAM_BOUNDARIES[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class StreamingHistogram {
  /** counts[0..n-1] land in boundary buckets; counts[n] is the overflow bucket. */
  private readonly counts: number[];
  private total = 0;
  private sum = 0;

  constructor() {
    this.counts = new Array(HISTOGRAM_BOUNDARIES.length + 1).fill(0);
  }

  add(v: number): void {
    if (!Number.isFinite(v) || v < 0) return;
    this.counts[bucketIndex(v)] += 1;
    this.total += 1;
    this.sum += v;
  }

  get count(): number {
    return this.total;
  }

  get mean(): number {
    return this.total === 0 ? 0 : this.sum / this.total;
  }

  /**
   * Estimated p-th percentile (p in [0, 100]) via linear interpolation
   * within the bucket that contains the target rank, assuming values are
   * uniformly distributed inside each bucket. The overflow bucket extends
   * to 2x the last boundary.
   */
  percentile(p: number): number {
    if (this.total === 0) return 0;
    const rank = Math.min(
      this.total - 1,
      Math.max(0, Math.ceil((p / 100) * this.total) - 1),
    );
    let cumulative = 0;
    for (let i = 0; i < this.counts.length; i++) {
      const c = this.counts[i];
      const prevCumulative = cumulative;
      cumulative += c;
      if (rank < cumulative) {
        const lo = i === 0 ? 0 : HISTOGRAM_BOUNDARIES[i - 1];
        const hi =
          i < HISTOGRAM_BOUNDARIES.length
            ? HISTOGRAM_BOUNDARIES[i]
            : HISTOGRAM_BOUNDARIES[HISTOGRAM_BOUNDARIES.length - 1] * 2;
        const frac = c <= 1 ? 0.5 : (rank - prevCumulative + 0.5) / c;
        return lo + frac * (hi - lo);
      }
    }
    return HISTOGRAM_BOUNDARIES[HISTOGRAM_BOUNDARIES.length - 1];
  }

  /** Merge another histogram's counts into a new histogram. */
  merge(other: StreamingHistogram): StreamingHistogram {
    const merged = new StreamingHistogram();
    for (let i = 0; i < this.counts.length; i++) {
      merged.counts[i] = this.counts[i] + other.counts[i];
    }
    merged.total = this.total + other.total;
    merged.sum = this.sum + other.sum;
    return merged;
  }

  /** Snapshot of bucket counts (for debugging / tests). */
  bucketCounts(): readonly number[] {
    return this.counts;
  }
}

export interface EndpointStats {
  endpoint: string;
  count: number;
  p50: number;
  p95: number;
  p99: number;
  throughputRps: number;
  errorRate: number;
}

/** Exact percentile from a pre-sorted array, using linear interpolation. */
export function percentileSorted(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const rank = (p / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const frac = rank - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

export class RollingStats {
  private samples: Sample[] = [];
  private cursor = 0;
  private latestT = -Infinity;

  constructor(private readonly windowSec: number) {
    if (windowSec <= 0) throw new Error("windowSec must be positive");
  }

  /** Push new samples; evicts anything older than latestT - windowSec. */
  push(newSamples: Sample[]): void {
    for (const s of newSamples) {
      this.samples.push(s);
      if (s.t > this.latestT) this.latestT = s.t;
    }
    this.evict();
  }

  private evict(): void {
    const cutoff = this.latestT - this.windowSec;
    while (
      this.cursor < this.samples.length &&
      this.samples[this.cursor].t <= cutoff
    ) {
      this.cursor += 1;
    }
    // Compact the backing array so it never grows without bound.
    if (this.cursor > 20000) {
      this.samples = this.samples.slice(this.cursor);
      this.cursor = 0;
    }
  }

  private windowed(): Sample[] {
    return this.samples.slice(this.cursor);
  }

  private summarize(endpoint: string, rows: Sample[]): EndpointStats | null {
    if (rows.length === 0) return null;
    const latencies = rows.map((s) => s.latencyMs).sort((a, b) => a - b);
    const errors = rows.filter((s) => s.status !== 200).length;
    // Rate over the time actually covered by data, capped at the window and
    // floored at 1s so a nearly-empty window can't report an absurd rate.
    const spanSec = Math.max(
      1,
      Math.min(this.windowSec, rows[rows.length - 1].t - rows[0].t),
    );
    return {
      endpoint,
      count: rows.length,
      p50: percentileSorted(latencies, 50),
      p95: percentileSorted(latencies, 95),
      p99: percentileSorted(latencies, 99),
      throughputRps: rows.length / spanSec,
      errorRate: errors / rows.length,
    };
  }

  /** Stats for one endpoint over the window, or null when empty. */
  statsFor(endpoint: string): EndpointStats | null {
    const rows = this.windowed().filter((s) => s.endpoint === endpoint);
    return this.summarize(endpoint, rows);
  }

  /**
   * Per-endpoint stats for everything in the window, computed in a single
   * pass (one filter + one sort per endpoint instead of rescanning per call).
   */
  snapshot(): Map<string, EndpointStats> {
    const rows = this.windowed();
    const groups = new Map<string, Sample[]>();
    for (const s of rows) {
      const g = groups.get(s.endpoint);
      if (g) g.push(s);
      else groups.set(s.endpoint, [s]);
    }
    const out = new Map<string, EndpointStats>();
    for (const [endpoint, group] of groups) {
      const s = this.summarize(endpoint, group);
      if (s) out.set(endpoint, s);
    }
    return out;
  }

  /** Stats across all endpoints over the window. */
  overall(): EndpointStats | null {
    return this.summarize("all", this.windowed());
  }

  /** Distinct endpoint names currently in the window. */
  endpoints(): string[] {
    const seen = new Set<string>();
    for (let i = this.cursor; i < this.samples.length; i++) {
      seen.add(this.samples[i].endpoint);
    }
    return [...seen];
  }

  reset(): void {
    this.samples = [];
    this.cursor = 0;
    this.latestT = -Infinity;
  }
}
