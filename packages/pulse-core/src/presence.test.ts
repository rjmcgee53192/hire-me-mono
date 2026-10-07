import { describe, expect, it } from "vitest";
import { PresenceManager } from "./presence";

describe("PresenceManager", () => {
  it("prunes stale peers but keeps freshly-heartbeated ones", () => {
    const pm = new PresenceManager();
    pm.heartbeat("a", { x: 1, y: 2 }, "#f00", "Maya", 1000);
    pm.heartbeat("b", { x: 3, y: 4 }, "#0f0", "Leo", 1000);

    // A checks in again at t=4000; B goes silent.
    pm.heartbeat("a", { x: 9, y: 9 }, "#f00", "Maya", 4000);

    const removed = pm.prune(5000, 7000);
    expect(removed).toEqual(["b"]);
    expect(pm.list().map((p) => p.siteId)).toEqual(["a"]);
    expect(pm.size).toBe(1);
  });

  it("keeps peers inside the timeout and updates cursor on heartbeat", () => {
    const pm = new PresenceManager();
    pm.heartbeat("a", { x: 1, y: 1 }, "#f00", "Maya", 1000);
    expect(pm.prune(5000, 5999)).toEqual([]);

    pm.heartbeat("a", { x: 42, y: 7 }, "#f00", "Maya", 5999);
    const [peer] = pm.list();
    expect(peer.cursor).toEqual({ x: 42, y: 7 });
    expect(peer.lastSeen).toBe(5999);
    expect(pm.prune(5000, 11000)).toEqual(["a"]);
  });

  it("lists peers sorted by siteId and supports explicit removal", () => {
    const pm = new PresenceManager();
    pm.heartbeat("zeta", { x: 0, y: 0 }, "#f00", "Zed", 100);
    pm.heartbeat("alpha", { x: 0, y: 0 }, "#0f0", "Al", 100);
    expect(pm.list().map((p) => p.siteId)).toEqual(["alpha", "zeta"]);

    expect(pm.remove("alpha")).toBe(true);
    expect(pm.remove("alpha")).toBe(false);
    expect(pm.list().map((p) => p.siteId)).toEqual(["zeta"]);
  });
});
