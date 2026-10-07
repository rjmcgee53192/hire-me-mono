import { describe, expect, it } from "vitest";
import { LoadGen } from "./generator";
import type { MockEndpoint } from "./generator";
import { makeTrace } from "./traces";
import type { Span } from "./traces";

const ENDPOINTS: MockEndpoint[] = [
  { name: "GET /api/search", baseLatencyMs: 45, jitterMs: 18, errorRate: 0.002 },
];

function countSpans(spans: Span[]): number {
  return spans.reduce((n, s) => n + 1 + countSpans(s.children ?? []), 0);
}

function findSpan(spans: Span[], prefix: string): Span | null {
  for (const s of spans) {
    if (s.name.startsWith(prefix)) return s;
    const found = findSpan(s.children ?? [], prefix);
    if (found) return found;
  }
  return null;
}

/** Every child must be contained within its parent's time range. */
function assertContained(span: Span, parentStart: number, parentEnd: number): void {
  expect(span.startMs).toBeGreaterThanOrEqual(parentStart - 1e-6);
  expect(span.startMs + span.durationMs).toBeLessThanOrEqual(parentEnd + 1e-6);
  for (const child of span.children ?? []) {
    assertContained(child, span.startMs, span.startMs + span.durationMs);
  }
}

describe("makeTrace", () => {
  it("builds a 4–7 span tree scaled to the sample latency", () => {
    const gen = new LoadGen(ENDPOINTS, 5);
    const [sample] = gen.tick(0.1, 100, 1);
    const trace = makeTrace(sample, { baseLatencyMs: 45, seed: 9 });

    expect(trace.traceId).toBe(sample.traceId);
    expect(trace.endpoint).toBe(sample.endpoint);
    expect(trace.durationMs).toBeCloseTo(sample.latencyMs, 1);

    const total = countSpans(trace.spans);
    expect(total).toBeGreaterThanOrEqual(4);
    expect(total).toBeLessThanOrEqual(7);

    const root = trace.spans[0];
    expect(root.startMs).toBe(0);
    expect(root.durationMs).toBeCloseTo(sample.latencyMs, 1);
    for (const child of root.children ?? []) {
      assertContained(child, 0, root.durationMs);
    }
  });

  it("gives slow samples a dominant database span", () => {
    const gen = new LoadGen(ENDPOINTS, 5);
    const samples = gen.tick(1, 2000, 1); // high load => queueing inflation
    const slowSample = samples.reduce((a, b) => (a.latencyMs > b.latencyMs ? a : b));
    const trace = makeTrace(slowSample, { baseLatencyMs: 45, seed: 3 });
    const db = findSpan(trace.spans, "db.query");
    expect(db).not.toBeNull();
    // Dominant: the db span owns more than half the trace on slow samples.
    expect(db!.durationMs / trace.durationMs).toBeGreaterThan(0.5);
  });

  it("marks failed samples' spans", () => {
    const gen = new LoadGen(
      [{ name: "POST /api/boom", baseLatencyMs: 50, jitterMs: 10, errorRate: 1 }],
      5,
    );
    const [sample] = gen.tick(0.1, 100, 1);
    expect(sample.status).toBe(500);
    const trace = makeTrace(sample, { baseLatencyMs: 50, seed: 1 });
    expect(trace.failed).toBe(true);
    expect(findSpan(trace.spans, "db.query.primary · error")).not.toBeNull();
  });
});
