import { describe, expect, it } from "vitest";
import { AlertManager } from "./alerts";
import { Cluster } from "./cluster";
import { Scheduler } from "./scheduler";

const makeWorld = (seed = 3): { cluster: Cluster; sched: Scheduler; alerts: AlertManager } => {
  const cluster = new Cluster({ nodeCount: 2, gpusPerNode: 4, seed });
  const sched = new Scheduler(cluster, { seed });
  return { cluster, sched, alerts: new AlertManager() };
};

describe("AlertManager", () => {
  it("fires a critical thermal alert once, clears on resolve, and can refire", () => {
    const { cluster, sched, alerts } = makeWorld();

    // Synthetic hot node — bypass the thermal model for determinism.
    cluster.nodes[0]!.tempC = 90;

    const first = alerts.evaluate(cluster, sched, 10);
    expect(first).toHaveLength(1);
    expect(first[0]!.severity).toBe("critical");
    expect(first[0]!.key).toBe("thermal:node-0");
    expect(first[0]!.message).toContain("thermal");

    // Same condition on the next tick must NOT re-fire (dedupe).
    const second = alerts.evaluate(cluster, sched, 11);
    expect(second).toHaveLength(0);
    expect(alerts.activeAlerts()).toHaveLength(1);

    // Resolve → key cleared → refires if the condition recurs.
    cluster.nodes[0]!.tempC = 70;
    expect(alerts.evaluate(cluster, sched, 12)).toHaveLength(0);
    expect(alerts.activeAlerts()).toHaveLength(0);

    cluster.nodes[0]!.tempC = 88;
    const refired = alerts.evaluate(cluster, sched, 13);
    expect(refired).toHaveLength(1);
    expect(refired[0]!.key).toBe("thermal:node-0");
  });

  it("fires a warn only after sustained saturation", () => {
    const { cluster, sched, alerts } = makeWorld();

    cluster.nodes[1]!.utilPct = 98;
    expect(alerts.evaluate(cluster, sched, 1)).toHaveLength(0);
    expect(alerts.evaluate(cluster, sched, 2)).toHaveLength(0);
    const third = alerts.evaluate(cluster, sched, 3);
    expect(third).toHaveLength(1);
    expect(third[0]!.severity).toBe("warn");
    expect(third[0]!.key).toBe("hot-util:node-1");

    // A dip below the threshold resets the streak.
    cluster.nodes[1]!.utilPct = 50;
    alerts.evaluate(cluster, sched, 4);
    cluster.nodes[1]!.utilPct = 98;
    expect(alerts.evaluate(cluster, sched, 5)).toHaveLength(0);
  });

  it("fires queue-pressure info when P1/P2 jobs wait with zero free GPUs", () => {
    const { cluster, sched, alerts } = makeWorld();

    // Fill the cluster completely.
    sched.submit({ name: "fill", gpus: 8, priority: 4, durationSec: 1000 });
    sched.tick(1);
    expect(cluster.totalGpusFree).toBe(0);

    // Low-priority queue alone → no pressure alert.
    sched.submit({ name: "bulk", gpus: 4, priority: 5, durationSec: 100 });
    expect(alerts.evaluate(cluster, sched, 2)).toHaveLength(0);

    // High-priority job joins the queue → info fires once.
    sched.submit({ name: "urgent", gpus: 4, priority: 1, durationSec: 100 });
    const fired = alerts.evaluate(cluster, sched, 3);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.severity).toBe("info");
    expect(fired[0]!.key).toBe("queue-pressure");

    // Freeing a GPU resolves the pressure.
    sched.cancel(sched.running()[0]!.id);
    expect(alerts.evaluate(cluster, sched, 4)).toHaveLength(0);
    expect(alerts.activeAlerts()).toHaveLength(0);
  });

  it("drives a thermal alert end-to-end through the real simulation", () => {
    const { cluster, sched, alerts } = makeWorld();
    // Saturate the cluster and let thermals climb naturally.
    sched.submit({ name: "burn", gpus: 8, priority: 1, durationSec: 10_000 });
    let firedCritical = false;
    for (let t = 1; t <= 300; t++) {
      cluster.tick(1);
      sched.tick(1);
      const fired = alerts.evaluate(cluster, sched, t);
      if (fired.some((a) => a.severity === "critical")) firedCritical = true;
    }
    expect(firedCritical).toBe(true);
  });
});
