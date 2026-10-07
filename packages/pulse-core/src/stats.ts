/**
 * Rolling op-latency statistics (send → ack round-trip, milliseconds).
 * Feeds the demo's avg/p95 tiles and the live latency chart.
 */
export class OpStats {
  private samples: number[] = [];

  /** Record one measured round-trip. Non-finite values are ignored; negatives clamp to 0. */
  record(latencyMs: number): void {
    if (!Number.isFinite(latencyMs)) return;
    this.samples.push(Math.max(0, latencyMs));
  }

  count(): number {
    return this.samples.length;
  }

  /** Mean latency, 0 when empty. */
  avg(): number {
    if (this.samples.length === 0) return 0;
    let sum = 0;
    for (const s of this.samples) sum += s;
    return sum / this.samples.length;
  }

  /** 95th percentile via nearest-rank, 0 when empty. */
  p95(): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const rank = Math.ceil(0.95 * sorted.length) - 1;
    return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
  }

  /** The last `n` samples, oldest first — for sparklines/charts. */
  recent(n: number): number[] {
    if (n <= 0) return [];
    return this.samples.slice(Math.max(0, this.samples.length - n));
  }

  reset(): void {
    this.samples = [];
  }
}
