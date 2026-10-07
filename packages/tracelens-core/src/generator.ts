import { mulberry32, makeGaussian } from "./rng";

/**
 * Synthetic API load generation.
 *
 * LoadGen models a small set of HTTP endpoints, each with a characteristic
 * latency distribution and failure rate, and emits per-request samples at a
 * caller-controlled request rate. Latency grows with offered load (a simple
 * queueing approximation), and a per-tick error multiplier lets a dashboard
 * inject chaos on demand.
 */

export interface MockEndpoint {
  /** e.g. "GET /api/search" */
  name: string;
  /** Median-ish latency at idle load, in milliseconds. */
  baseLatencyMs: number;
  /** Standard deviation of the latency noise, in milliseconds. */
  jitterMs: number;
  /** Baseline probability that a request fails with a 5xx. */
  errorRate: number;
}

export type HttpStatus = 200 | 500 | 429;

export interface Sample {
  /** Simulation clock time of the sample, in seconds. */
  t: number;
  endpoint: string;
  latencyMs: number;
  status: HttpStatus;
  traceId: string;
}

const HEX = "0123456789abcdef";

export class LoadGen {
  private readonly rng: () => number;
  private readonly gaussian: () => number;
  private t = 0;
  private seq = 0;
  private carry = 0;

  constructor(
    private readonly endpoints: MockEndpoint[],
    seed: number,
  ) {
    if (endpoints.length === 0) {
      throw new Error("LoadGen requires at least one endpoint");
    }
    this.rng = mulberry32(seed);
    this.gaussian = makeGaussian(this.rng);
  }

  /** Current simulation time in seconds. */
  now(): number {
    return this.t;
  }

  private nextTraceId(): string {
    let hex = "";
    for (let i = 0; i < 12; i++) {
      hex += HEX[Math.floor(this.rng() * 16)];
    }
    return `tl-${(this.seq++).toString(36)}-${hex}`;
  }

  /**
   * Advance the simulation by dtSec seconds at the given request rate.
   * Returns one Sample per request that "arrived" during the interval.
   */
  tick(dtSec: number, rps: number, errorMultiplier = 1): Sample[] {
    if (dtSec <= 0 || rps <= 0) {
      this.t += Math.max(0, dtSec);
      return [];
    }
    const total = rps * dtSec + this.carry;
    const count = Math.floor(total);
    this.carry = total - count;

    // Queueing approximation: latency inflates as the offered load grows.
    const queueFactor = 1 + rps / 500;
    // Overload: beyond ~800 rps the edge starts shedding with 429s.
    const overloadP = rps > 800 ? Math.min(0.25, (rps - 800) / 4000) : 0;

    const samples: Sample[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const ep = this.endpoints[Math.floor(this.rng() * this.endpoints.length)];
      const noise = Math.abs(this.gaussian()) * ep.jitterMs;
      const base = Math.max(0.5, ep.baseLatencyMs + noise);
      const u = this.rng();
      let status: HttpStatus = 200;
      let latencyMs = base * queueFactor;
      if (u < overloadP) {
        status = 429;
        latencyMs = base * 0.4; // rejected fast at the edge
      } else if (u < overloadP + ep.errorRate * errorMultiplier) {
        status = 500;
        latencyMs = base * (0.6 + this.rng() * 0.6); // failed mid-flight
      }
      // Spread samples evenly across the tick interval.
      const t = this.t + (dtSec * (i + 1)) / Math.max(1, count);
      samples[i] = {
        t,
        endpoint: ep.name,
        latencyMs: Math.round(latencyMs * 100) / 100,
        status,
        traceId: this.nextTraceId(),
      };
    }
    this.t += dtSec;
    return samples;
  }
}
