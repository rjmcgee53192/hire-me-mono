# @repo/tracelens-core

Synthetic load generation + observability statistics in pure TypeScript — no
React, no DOM. It powers the [TraceLens demo](/demos/tracelens): a live API
observability dashboard that simulates traffic, computes streaming latency
percentiles, tracks SLO error budgets, synthesizes distributed traces, and
evaluates threshold alert rules in real time.

## Modules

| Module | Exports | What it does |
|---|---|---|
| `rng.ts` | `mulberry32`, `makeGaussian`, `seededGaussian` | Seeded PRNG + Box–Muller normal variates, so runs are reproducible |
| `generator.ts` | `LoadGen`, `MockEndpoint`, `Sample` | Emits per-request samples at a caller-controlled RPS with per-endpoint latency/error profiles, load-dependent queueing inflation, and overload 429s |
| `stats.ts` | `StreamingHistogram`, `RollingStats`, `percentileSorted` | O(buckets) streaming percentile estimation + exact rolling-window per-endpoint stats |
| `budget.ts` | `ErrorBudget` | SLO error-budget accounting and burn-down series |
| `traces.ts` | `makeTrace`, `Trace`, `Span` | Synthesizes a realistic span tree (edge → auth → handler → cache/db → serialize) scaled to each sample's latency |
| `alerts.ts` | `AlertEngine`, `AlertRule`, `FiredAlert` | Threshold alerting with per-rule cooldowns and warn/critical escalation |

## The statistics approach

Two complementary paths, mirroring how real observability stacks work:

- **StreamingHistogram** — constant-memory percentile estimation. Latencies
  land in a fixed geometric bucket series (ratio 1.2, 1ms–10s, 51 buckets);
  `percentile(p)` finds the bucket holding the target rank and linearly
  interpolates inside it. Two histograms `merge()` losslessly (counts just
  add), so edge agents can ship pre-aggregated histograms upstream — the same
  trick behind Prometheus histograms. Accuracy: p50/p95/p99 stay within 5%
  of a brute-force sorted computation on 10k spiky bimodal samples (see
  `stats.test.ts`).
- **RollingStats** — a bounded ring buffer of recent samples (evicted past
  `windowSec`) for *exact* per-endpoint p50/p95/p99, throughput, and error
  rate. Exactness costs O(n log n) per snapshot, which is fine at dashboard
  scale (tens of thousands of samples).

## Error-budget math

For an SLO target like 99.9%, the allowed error ratio is `1 − 0.999 = 0.001`.
Over `N` requests the budget permits `N × 0.001` errors:

- `burnRate = actualErrors / allowedErrors` — `1.0` means spending the budget
  exactly at the SLO pace; `> 1.0` is a breach.
- `budgetPctRemaining = max(0, 1 − burnRate) × 100`.
- `burnDown(history, windowTotal)` sizes the allowance once for the whole
  window and returns the remaining-budget series, for charting.

Example: 10 errors out of 10,000 requests against a 99.9% SLO → burn rate
1.0, budget ~0% remaining, not breaching. 100 errors → burn rate 10,
breaching.

## API sketch

```ts
import {
  LoadGen, RollingStats, ErrorBudget, AlertEngine, makeTrace,
} from "@repo/tracelens-core";

const gen = new LoadGen(
  [{ name: "GET /api/search", baseLatencyMs: 45, jitterMs: 18, errorRate: 0.002 }],
  42, // seed
);
const stats = new RollingStats(60); // 60s window
const budget = new ErrorBudget(0.999, 60);
const alerts = new AlertEngine(30); // 30s per-rule cooldown

const samples = gen.tick(0.5, 400, 1); // 0.5s at 400 rps, no chaos
stats.push(samples);

const overall = stats.overall();
const b = budget.consume(overall.count, overall.count * overall.errorRate);
const fired = alerts.evaluate(
  [{ id: "e1", name: "Error spike", metric: "errorRate", threshold: 0.01, windowSec: 30 }],
  stats, b.burnRate, gen.now(),
);

const trace = makeTrace(samples[samples.length - 1], { baseLatencyMs: 45 });
```

## Tests

`vitest run` — 20 tests covering histogram accuracy vs brute force, histogram
merge equivalence, budget boundary math, alert firing/silence/cooldown, and
trace-tree structural invariants (span containment, dominant-db-span on slow
samples).
