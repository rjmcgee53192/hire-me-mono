/**
 * @repo/tensorgrid-core — deterministic GPU-cluster simulation with a
 * priority job scheduler and threshold alerting.
 *
 * Modules:
 * - rng: mulberry32 seeded PRNG (+ small helpers).
 * - cluster: Cluster / GpuNode — per-GPU utilization random walks coupled
 *   to load, first-order thermal lag, utilization-driven power draw.
 * - scheduler: Scheduler — priority-ordered first-fit allocation across
 *   nodes, seeded per-job throughput, cancel, completion records.
 * - alerts: AlertManager — thermal / sustained-saturation / queue-pressure
 *   rules with fire-once dedupe and resolve-and-refire semantics.
 */

export { mulberry32, uniform, intIn, pick } from "./rng";
export type { Rng } from "./rng";

export { Cluster, GpuNode, THERMAL_LIMIT_C, THERMAL_TAU_SEC } from "./cluster";
export type {
  ClusterConfig,
  GpuAllocation,
  NodeSnapshot,
} from "./cluster";

export { Scheduler, randomJobSpec } from "./scheduler";
export type {
  CompletedJob,
  Job,
  JobPriority,
  JobSpec,
  SchedulerOptions,
} from "./scheduler";

export { AlertManager } from "./alerts";
export type {
  AlertManagerOptions,
  AlertSeverity,
  ClusterAlert,
} from "./alerts";
