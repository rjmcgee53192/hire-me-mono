/**
 * Cluster alerting: threshold rules evaluated once per simulation tick.
 *
 * Rules:
 * - thermal (critical): any node with tempC > 85°C.
 * - sustained saturation (warn): any node with utilPct > 95 for N
 *   consecutive ticks (default N = 3).
 * - queue pressure (info): high-priority (P1/P2) jobs are queued while the
 *   cluster has zero free GPUs.
 *
 * Dedupe: each condition has a stable key (`thermal:node-2`,
 * `hot-util:node-0`, `queue-pressure`). A key fires once when its condition
 * becomes true and stays silent while it remains true; when the condition
 * resolves the key is cleared and may fire again later. `evaluate()` returns
 * only newly fired alerts; `activeAlerts()` returns everything currently
 * true.
 */

import type { Cluster } from "./cluster";
import { THERMAL_LIMIT_C } from "./cluster";
import type { Scheduler } from "./scheduler";

export type AlertSeverity = "critical" | "warn" | "info";

export interface ClusterAlert {
  /** Stable dedupe key, e.g. "thermal:node-2". */
  key: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  /** Simulated seconds at fire time. */
  t: number;
}

export interface AlertManagerOptions {
  /** Consecutive ticks above 95% util before the warn fires. */
  sustainedTicks?: number;
}

const SATURATION_UTIL = 95;

export class AlertManager {
  private readonly sustainedTicks: number;
  private readonly active = new Map<string, ClusterAlert>();
  private readonly hotStreak = new Map<string, number>();

  constructor(options: AlertManagerOptions = {}) {
    this.sustainedTicks = Math.max(1, options.sustainedTicks ?? 3);
  }

  /**
   * Evaluate all rules against current state. Returns the alerts that
   * fired on this tick (not every currently-active alert).
   */
  evaluate(cluster: Cluster, scheduler: Scheduler, t: number): ClusterAlert[] {
    const fired: ClusterAlert[] = [];
    const seen = new Set<string>();

    const fire = (alert: ClusterAlert): void => {
      seen.add(alert.key);
      if (!this.active.has(alert.key)) {
        this.active.set(alert.key, alert);
        fired.push(alert);
      }
    };

    for (const node of cluster.nodes) {
      if (node.tempC > THERMAL_LIMIT_C) {
        fire({
          key: `thermal:${node.id}`,
          severity: "critical",
          title: `Thermal limit exceeded — ${node.id}`,
          message: `${node.id} at ${node.tempC.toFixed(1)}°C, above the ${THERMAL_LIMIT_C}°C limit. Expect thermal throttling and degraded training throughput.`,
          t,
        });
      }

      const streak =
        node.utilPct > SATURATION_UTIL
          ? (this.hotStreak.get(node.id) ?? 0) + 1
          : 0;
      this.hotStreak.set(node.id, streak);
      if (streak >= this.sustainedTicks) {
        fire({
          key: `hot-util:${node.id}`,
          severity: "warn",
          title: `Sustained saturation — ${node.id}`,
          message: `${node.id} pinned above ${SATURATION_UTIL}% GPU utilization for ${streak} consecutive ticks. Consider rebalancing or preempting low-priority work.`,
          t,
        });
      }
    }

    const hpQueued = scheduler
      .queue()
      .filter((job) => job.priority <= 2).length;
    if (hpQueued > 0 && cluster.totalGpusFree === 0) {
      fire({
        key: "queue-pressure",
        severity: "info",
        title: "Queue pressure",
        message: `${hpQueued} high-priority (P1/P2) job${hpQueued === 1 ? " is" : "s are"} waiting with 0 GPUs free on the cluster.`,
        t,
      });
    }

    // Resolve: drop keys whose condition is no longer true so they can
    // fire again if the condition recurs.
    for (const key of [...this.active.keys()]) {
      if (!seen.has(key)) this.active.delete(key);
    }

    return fired;
  }

  /** Every alert whose condition is currently true. */
  activeAlerts(): ClusterAlert[] {
    return [...this.active.values()];
  }

  /** Clear all state (used on cluster reset). */
  reset(): void {
    this.active.clear();
    this.hotStreak.clear();
  }
}
