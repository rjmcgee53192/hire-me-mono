# @repo/tensorgrid-core

Deterministic GPU-cluster simulation with a priority job scheduler and
threshold alerting — the engine behind the TensorGrid observability demo.

Everything is pure TypeScript (no React). Every stochastic process draws
from a seeded `mulberry32` stream, so a given seed replays the exact same
run: same utilization curves, same temperatures, same scheduling
decisions, same throughput figures.

## Modules

### `rng.ts`
- `mulberry32(seed): Rng` — seedable PRNG, uniform in `[0, 1)`.
- `uniform(rng, min, max)`, `intIn(rng, min, max)`, `pick(rng, items)` helpers.

### `cluster.ts`
`Cluster` models a homogeneous fleet of `GpuNode`s:

- **Utilization** — each node random-walks toward a load-implied target
  (`8 + 92 × allocated/total`); per-GPU utilizations walk toward ~90 for
  allocated GPUs and ~10 for idle ones.
- **Thermals** — temperature chases `55 + util × 0.35 °C` (+ noise) with a
  first-order lag (`THERMAL_TAU_SEC = 10` s). A fully loaded node settles
  near 90 °C, above the 85 °C alert limit; an idle node sits near 58 °C.
- **Power** — `powerW = gpusTotal × (400 + util × 9)` watts.

Key API:

```ts
const cluster = new Cluster({ nodeCount: 4, gpusPerNode: 8, seed: 42 });
cluster.tick(dtSec);                       // advance physics (optional rng override)
cluster.allocateGpus(10);                  // greedy across nodes → GpuAllocation[] | null
cluster.releaseGpus(alloc);
cluster.totalGpus / totalGpusUsed / totalGpusFree;
cluster.snapshot();                        // NodeSnapshot[] for the UI
```

### `scheduler.ts`
Priority scheduler over a `Cluster`:

- Queue ordered by **(priority 1→5, then submission time)**; each tick,
  jobs are first-fit allocated greedily across nodes — a single job may
  span nodes.
- Completions release GPUs **before** new allocations in the same tick,
  so freed capacity backfills immediately.
- Each started job gets a seeded `throughputTokensPerSec` figure
  (`gpus × 1500–3900`); completions record it in `CompletedJob`.
- `submit()` throws for jobs that can never fit (more GPUs than the
  cluster has) or invalid specs; `cancel(id)` frees GPUs for running jobs.

```ts
const sched = new Scheduler(cluster, { seed: 7 });
const job = sched.submit({ name: "llama-3-70b-sft", gpus: 8, priority: 2, durationSec: 300 });
sched.tick(dtSec);
sched.queue();     // scheduling order
sched.running();
sched.completed(); // completion order, with throughput
```

### `alerts.ts`
`AlertManager.evaluate(cluster, scheduler, t)` runs three rules per tick:

| Rule | Severity | Condition |
|---|---|---|
| Thermal | critical | any node `tempC > 85` |
| Sustained saturation | warn | any node `utilPct > 95` for N consecutive ticks (default 3) |
| Queue pressure | info | P1/P2 jobs queued while 0 GPUs are free |

Dedupe semantics: each condition has a stable key (`thermal:node-2`,
`hot-util:node-0`, `queue-pressure`). A key fires once when its condition
becomes true and stays silent while it holds; when the condition resolves
the key clears and may fire again later. `evaluate()` returns only newly
fired alerts; `activeAlerts()` returns everything currently true.

## Determinism

`Cluster`, `Scheduler`, and the alert streaks are all seeded. The test
suite asserts replay-identical physics, scheduling, and throughput for a
fixed seed, plus property-style invariants (never over-allocates) under
randomized churn.

## Scripts

- `pnpm test` / `vitest run` — unit tests (priority, over-allocation,
  thermal alerts, completion throughput, determinism).
- `pnpm typecheck` / `tsc --noEmit` — strict typecheck.
