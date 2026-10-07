import type { RollingStats } from "./stats";

/**
 * Threshold alerting over live rolling statistics.
 *
 * AlertEngine evaluates declarative rules (metric + threshold + optional
 * endpoint scope) against the current RollingStats snapshot. Each rule has a
 * cooldown so a sustained violation produces one alert per cooldown period
 * instead of one per tick. Severity escalates to "critical" when the observed
 * value exceeds twice the threshold.
 */

export type AlertMetric = "p99" | "errorRate" | "burnRate";

export interface AlertRule {
  id: string;
  name: string;
  metric: AlertMetric;
  /** Endpoint name to scope to; undefined means "all endpoints". */
  endpoint?: string;
  threshold: number;
  /** Nominal window the rule reasons about (used in messages). */
  windowSec: number;
}

export interface FiredAlert {
  ruleId: string;
  ruleName: string;
  /** Simulation time when the alert fired, in seconds. */
  t: number;
  message: string;
  severity: "warn" | "critical";
}

const METRIC_LABEL: Record<AlertMetric, string> = {
  p99: "p99 latency",
  errorRate: "error rate",
  burnRate: "error-budget burn rate",
};

function formatValue(metric: AlertMetric, v: number): string {
  if (metric === "p99") return `${v.toFixed(1)}ms`;
  if (metric === "errorRate") return `${(v * 100).toFixed(2)}%`;
  return `${v.toFixed(2)}x`;
}

function formatThreshold(metric: AlertMetric, v: number): string {
  return formatValue(metric, v);
}

export class AlertEngine {
  private lastFired = new Map<string, number>();

  /** @param cooldownSec minimum seconds between firings of the same rule */
  constructor(private readonly cooldownSec = 30) {}

  /**
   * Evaluate rules against current stats.
   * @param burnRate current error-budget burn rate (for burnRate rules)
   * @param now simulation time in seconds
   */
  evaluate(
    rules: AlertRule[],
    stats: RollingStats,
    burnRate: number,
    now: number,
  ): FiredAlert[] {
    const fired: FiredAlert[] = [];
    for (const rule of rules) {
      const value = this.readMetric(rule, stats, burnRate);
      if (value === null) continue; // no data for the scoped endpoint yet
      if (value <= rule.threshold) continue;
      const last = this.lastFired.get(rule.id);
      if (last !== undefined && now - last < this.cooldownSec) continue;
      this.lastFired.set(rule.id, now);
      fired.push({
        ruleId: rule.id,
        ruleName: rule.name,
        t: now,
        severity: value > rule.threshold * 2 ? "critical" : "warn",
        message:
          `${rule.name}: ${METRIC_LABEL[rule.metric]} is ${formatValue(rule.metric, value)} ` +
          `(threshold ${formatThreshold(rule.metric, rule.threshold)}) ` +
          `on ${rule.endpoint ?? "all endpoints"} — ${rule.windowSec}s window`,
      });
    }
    return fired;
  }

  private readMetric(
    rule: AlertRule,
    stats: RollingStats,
    burnRate: number,
  ): number | null {
    if (rule.metric === "burnRate") return burnRate;
    const s = rule.endpoint ? stats.statsFor(rule.endpoint) : stats.overall();
    if (!s) return null;
    return rule.metric === "p99" ? s.p99 : s.errorRate;
  }

  reset(): void {
    this.lastFired.clear();
  }
}

/** Tiny id helper for dashboard-created rules. */
let ruleSeq = 0;
export function makeRuleId(prefix = "rule"): string {
  ruleSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${ruleSeq}`;
}
