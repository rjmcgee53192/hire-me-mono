import { describe, expect, it } from "vitest";
import { LoadGen } from "./generator";
import type { MockEndpoint } from "./generator";
import { RollingStats } from "./stats";
import { ErrorBudget } from "./budget";
import { AlertEngine } from "./alerts";
import type { AlertRule } from "./alerts";

const ENDPOINTS: MockEndpoint[] = [
  { name: "GET /api/search", baseLatencyMs: 45, jitterMs: 18, errorRate: 0.002 },
  { name: "POST /api/checkout", baseLatencyMs: 120, jitterMs: 60, errorRate: 0.005 },
];

function drive(errorMultiplier: number, ticks = 12): { stats: RollingStats; now: number } {
  const gen = new LoadGen(ENDPOINTS, 777);
  const stats = new RollingStats(60);
  for (let i = 0; i < ticks; i++) {
    stats.push(gen.tick(0.5, 300, errorMultiplier));
  }
  return { stats, now: gen.now() };
}

const errorRule: AlertRule = {
  id: "err-1",
  name: "High error rate",
  metric: "errorRate",
  threshold: 0.01, // 1%
  windowSec: 30,
};

describe("AlertEngine", () => {
  it("fires an errorRate rule under chaos and stays silent at normal rates", () => {
    const engine = new AlertEngine(30);

    const calm = drive(1);
    const calmBudget = new ErrorBudget(0.999, 60);
    const calmOverall = calm.stats.overall();
    const calmBurn = calmBudget.consume(calmOverall!.count, calmOverall!.count * calmOverall!.errorRate).burnRate;
    expect(engine.evaluate([errorRule], calm.stats, calmBurn, calm.now)).toEqual([]);

    const chaos = drive(10);
    const chaosOverall = chaos.stats.overall();
    const chaosBurn = new ErrorBudget(0.999, 60).consume(
      chaosOverall!.count,
      chaosOverall!.count * chaosOverall!.errorRate,
    ).burnRate;
    const fired = engine.evaluate([errorRule], chaos.stats, chaosBurn, chaos.now);
    expect(fired).toHaveLength(1);
    expect(fired[0].ruleId).toBe("err-1");
    expect(fired[0].message).toContain("High error rate");
  });

  it("cooldown suppresses repeat firings of the same rule", () => {
    const engine = new AlertEngine(30);
    const { stats, now } = drive(10);
    const first = engine.evaluate([errorRule], stats, 5, now);
    expect(first).toHaveLength(1);
    // Same tick / shortly after: suppressed.
    expect(engine.evaluate([errorRule], stats, 5, now + 1)).toEqual([]);
    // After the cooldown: fires again.
    expect(engine.evaluate([errorRule], stats, 5, now + 31)).toHaveLength(1);
  });

  it("p99 rule fires per-endpoint and reports the scope in the message", () => {
    const engine = new AlertEngine(0);
    const { stats, now } = drive(1);
    const rule: AlertRule = {
      id: "p99-1",
      name: "Checkout p99",
      metric: "p99",
      endpoint: "POST /api/checkout",
      threshold: 50, // far below the real ~p99, must fire
      windowSec: 30,
    };
    const fired = engine.evaluate([rule], stats, 0, now);
    expect(fired).toHaveLength(1);
    expect(fired[0].message).toContain("POST /api/checkout");
    expect(fired[0].message).toContain("p99 latency");
  });

  it("skips rules scoped to endpoints with no data yet", () => {
    const engine = new AlertEngine(0);
    const stats = new RollingStats(60); // empty
    const fired = engine.evaluate([errorRule], stats, 0, 0);
    expect(fired).toEqual([]);
  });

  it("escalates to critical when the value exceeds 2x the threshold", () => {
    const engine = new AlertEngine(0);
    const { stats, now } = drive(10);
    const fired = engine.evaluate([errorRule], stats, 50, now);
    expect(fired).toHaveLength(1);
    expect(fired[0].severity).toBe("critical");
  });
});
