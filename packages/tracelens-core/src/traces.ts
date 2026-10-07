import type { Sample } from "./generator";
import { mulberry32 } from "./rng";

/**
 * Distributed-trace synthesis.
 *
 * Given one request sample, makeTrace fabricates the span tree a real
 * tracing backend would record: edge → auth → handler → cache/db → serialize.
 * Span durations are scaled to the sample's latency so slow requests visibly
 * show a dominant span (almost always the database), which is the whole
 * point of a waterfall view.
 */

export interface Span {
  name: string;
  service: string;
  /** Offset from trace start, in milliseconds. */
  startMs: number;
  durationMs: number;
  children?: Span[];
}

export interface Trace {
  traceId: string;
  endpoint: string;
  durationMs: number;
  failed: boolean;
  spans: Span[];
}

export interface MakeTraceOptions {
  /** Idle-latency baseline for the endpoint; used to detect "slow". */
  baseLatencyMs?: number;
  /** PRNG for the synthetic jitter; defaults to Math.random. */
  rng?: () => number;
  seed?: number;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

export function makeTrace(sample: Sample, opts: MakeTraceOptions = {}): Trace {
  const rng = opts.rng ?? (opts.seed !== undefined ? mulberry32(opts.seed) : Math.random);
  const wobble = (): number => 0.85 + rng() * 0.3;
  const total = sample.latencyMs;
  const base = opts.baseLatencyMs ?? 100;
  const slow = total > Math.max(3 * base, 250);
  const failed = sample.status !== 200;

  const authDur = Math.max(0.5, round2(total * 0.04 * wobble()));
  const serializeDur = Math.max(0.5, round2(total * 0.05 * wobble()));
  const serializeStart = round2(total - serializeDur);

  const handlerStart = authDur;
  const handlerDur = round2(total - authDur);

  const cacheDur = Math.max(0.3, round2(total * 0.06 * wobble()));
  const dbTarget = total * (slow ? 0.62 : 0.18) * wobble();
  const dbStart = round2(handlerStart + cacheDur);
  // Clamp so the db span never bleeds into serialization.
  const dbDur = Math.max(0.5, round2(Math.min(dbTarget, serializeStart - dbStart - 0.5)));

  const dbSpan: Span = {
    name: failed ? "db.query.primary · error" : "db.query.primary",
    service: "postgres",
    startMs: dbStart,
    durationMs: dbDur,
  };
  const cacheSpan: Span = {
    name: "cache.lookup",
    service: "redis",
    startMs: round2(handlerStart),
    durationMs: cacheDur,
  };
  const serializeSpan: Span = {
    name: "response.serialize",
    service: "handler",
    startMs: serializeStart,
    durationMs: serializeDur,
  };
  const handlerSpan: Span = {
    name: failed ? "request.handler · error" : "request.handler",
    service: "handler",
    startMs: round2(handlerStart),
    durationMs: handlerDur,
    children: [cacheSpan, dbSpan, serializeSpan],
  };
  const authSpan: Span = {
    name: "auth.verify",
    service: "auth",
    startMs: 0,
    durationMs: authDur,
  };
  const root: Span = {
    name: `edge ${sample.endpoint}`,
    service: "edge",
    startMs: 0,
    durationMs: round2(total),
    children: [authSpan, handlerSpan],
  };

  return {
    traceId: sample.traceId,
    endpoint: sample.endpoint,
    durationMs: round2(total),
    failed,
    spans: [root],
  };
}
