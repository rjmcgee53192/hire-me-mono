/**
 * Priority job scheduler over a Cluster.
 *
 * Scheduling policy: on every tick, the queue is ordered by (priority
 * ascending — 1 is highest — then submission time) and jobs are first-fit
 * allocated greedily across nodes; a single job may span nodes. Running
 * jobs count down their remaining time and release GPUs on completion,
 * recording a seeded tokens/sec throughput figure. Completions release
 * before new allocations in the same tick, so freed GPUs backfill
 * immediately.
 *
 * All time is simulated seconds; the scheduler is deterministic for a
 * given seed and submission/tick sequence.
 */

import { type Cluster, type GpuAllocation } from "./cluster";
import { intIn, mulberry32, type Rng, uniform } from "./rng";

/** 1 = highest priority, 5 = lowest. */
export type JobPriority = 1 | 2 | 3 | 4 | 5;

export interface JobSpec {
  name: string;
  gpus: number;
  priority: JobPriority;
  /** Requested wall-clock time in simulated seconds. */
  durationSec: number;
}

export interface Job extends JobSpec {
  id: string;
  /** Simulated submission time (seconds). */
  submittedAt: number;
  /** Simulated start time, null while queued. */
  startedAt: number | null;
  /** Simulated seconds remaining (counts down once running). */
  remainingSec: number;
  allocation: GpuAllocation[];
  nodeIds: string[];
  /** Seeded tokens/sec figure, assigned at start; null while queued. */
  throughputTokensPerSec: number | null;
}

export interface CompletedJob {
  jobId: string;
  name: string;
  gpus: number;
  priority: JobPriority;
  submittedAt: number;
  startedAt: number;
  completedAt: number;
  durationSec: number;
  throughputTokensPerSec: number;
  nodeIds: string[];
}

export interface SchedulerOptions {
  seed?: number;
}

const isPriority = (p: number): p is JobPriority =>
  Number.isInteger(p) && p >= 1 && p <= 5;

/** Mean per-GPU training throughput used for the seeded figure (tok/s). */
const TOK_PER_SEC_PER_GPU_MEAN = 2700;

export class Scheduler {
  private readonly cluster: Cluster;
  private readonly rng: Rng;
  private queued: Job[] = [];
  private active: Job[] = [];
  private done: CompletedJob[] = [];
  private nextId = 1;
  private now = 0;

  constructor(cluster: Cluster, options: SchedulerOptions = {}) {
    this.cluster = cluster;
    this.rng = mulberry32(options.seed ?? 0x5C4);
  }

  /** Simulated clock in seconds. */
  get time(): number {
    return this.now;
  }

  /** Submit a job. Throws if the job can never fit on this cluster. */
  submit(spec: JobSpec): Job {
    const name = spec.name.trim() === "" ? `job-${this.nextId}` : spec.name;
    if (!Number.isInteger(spec.gpus) || spec.gpus < 1) {
      throw new Error("Job must request at least 1 GPU");
    }
    if (spec.gpus > this.cluster.totalGpus) {
      throw new Error(
        `Job requests ${spec.gpus} GPUs but the cluster only has ${this.cluster.totalGpus}`,
      );
    }
    if (!isPriority(spec.priority)) {
      throw new Error("Job priority must be an integer 1–5");
    }
    if (!(spec.durationSec > 0)) {
      throw new Error("Job durationSec must be positive");
    }
    const job: Job = {
      id: `job-${this.nextId++}`,
      name,
      gpus: spec.gpus,
      priority: spec.priority,
      durationSec: spec.durationSec,
      submittedAt: this.now,
      startedAt: null,
      remainingSec: spec.durationSec,
      allocation: [],
      nodeIds: [],
      throughputTokensPerSec: null,
    };
    this.queued.push(job);
    return job;
  }

  /**
   * Advance the simulation by dtSec: finish due jobs (releasing GPUs),
   * then start queued jobs in (priority, submittedAt) order.
   */
  tick(dtSec: number): void {
    if (!(dtSec > 0)) return;
    this.now += dtSec;

    // 1. Advance running jobs; complete and release before allocating.
    const stillRunning: Job[] = [];
    for (const job of this.active) {
      job.remainingSec -= dtSec;
      if (job.remainingSec <= 0) {
        this.cluster.releaseGpus(job.allocation);
        this.done.push({
          jobId: job.id,
          name: job.name,
          gpus: job.gpus,
          priority: job.priority,
          submittedAt: job.submittedAt,
          startedAt: job.startedAt ?? this.now,
          completedAt: this.now,
          durationSec: job.durationSec,
          throughputTokensPerSec: job.throughputTokensPerSec ?? 0,
          nodeIds: [...job.nodeIds],
        });
      } else {
        stillRunning.push(job);
      }
    }
    this.active = stillRunning;

    // 2. Start queued jobs, highest priority (then oldest) first.
    const ordered = [...this.queued].sort(
      (a, b) => a.priority - b.priority || a.submittedAt - b.submittedAt,
    );
    const started = new Set<string>();
    for (const job of ordered) {
      const alloc = this.cluster.allocateGpus(job.gpus);
      if (!alloc) continue; // first-fit: skip jobs that don't fit right now
      job.allocation = alloc;
      job.nodeIds = alloc.map((a) => `node-${a.nodeIndex}`);
      job.startedAt = this.now;
      job.throughputTokensPerSec = Math.round(
        job.gpus * uniform(this.rng, 1500, 3900),
      );
      this.active.push(job);
      started.add(job.id);
    }
    if (started.size > 0) {
      this.queued = this.queued.filter((j) => !started.has(j.id));
    }
  }

  /**
   * Cancel a queued or running job. Running jobs release their GPUs.
   * Returns false when no job with that id exists.
   */
  cancel(jobId: string): boolean {
    const qi = this.queued.findIndex((j) => j.id === jobId);
    if (qi >= 0) {
      this.queued.splice(qi, 1);
      return true;
    }
    const ri = this.active.findIndex((j) => j.id === jobId);
    if (ri >= 0) {
      const [job] = this.active.splice(ri, 1);
      if (job) this.cluster.releaseGpus(job.allocation);
      return true;
    }
    return false;
  }

  /** Queued jobs in scheduling order: priority ascending, then FIFO. */
  queue(): Job[] {
    return [...this.queued].sort(
      (a, b) => a.priority - b.priority || a.submittedAt - b.submittedAt,
    );
  }

  /** Currently running jobs (start order). */
  running(): Job[] {
    return [...this.active];
  }

  /** Completed jobs in completion order. */
  completed(): CompletedJob[] {
    return [...this.done];
  }
}

/** Build a deterministic pseudo-random training-job spec for load testing. */
export function randomJobSpec(rng: Rng, counter: number): JobSpec {
  const names = [
    "llama-3-70b-sft",
    "whisper-large-finetune",
    "sdxl-distill",
    "rlhf-reward-model",
    "e5-contrastive",
    "moe-pretrain-8x22b",
    "dino-vision-backbone",
    "dpo-align-run",
  ];
  const name = names[counter % names.length] ?? `train-${counter}`;
  const gpus = [1, 1, 2, 2, 4, 4, 8][Math.floor(rng() * 7)] ?? 1;
  const priority = ([3, 3, 4, 2, 5, 3, 4] as const)[
    Math.floor(rng() * 7)
  ] as JobPriority;
  return {
    name: `${name}-${counter}`,
    gpus,
    priority,
    durationSec: intIn(rng, 45, 300),
  };
}
