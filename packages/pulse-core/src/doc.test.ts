import { describe, expect, it } from "vitest";
import { CrdtDoc } from "./doc";
import type { Op, Point, Stroke } from "./types";

function pts(x0: number, y0: number): Point[] {
  return [
    { x: x0, y: y0 },
    { x: x0 + 10, y: y0 + 10 },
  ];
}

function snapshot(doc: CrdtDoc): string {
  return JSON.stringify(doc.getStrokes());
}

describe("CrdtDoc convergence / commutativity", () => {
  it("concurrent ops merged in opposite orders converge to identical state", () => {
    const a = new CrdtDoc("a");
    const b = new CrdtDoc("b");

    const a1 = a.addStroke(pts(0, 0), "#ff0000", 3);
    const a2 = a.addStroke(pts(20, 20), "#00ff00", 4);
    const b1 = b.addStroke(pts(40, 40), "#0000ff", 2);
    const del = b.deleteStroke(b1.strokeId);

    // Replica A receives B's ops in log order; B receives everything reversed,
    // including duplicates of its own ops.
    a.merge([b1, del]);
    b.merge([del, b1, a2, a1]);

    expect(snapshot(a)).toBe(snapshot(b));
    // B's stroke was deleted, so only A's two strokes remain…
    expect(a.getStrokes().map((s) => s.id)).toEqual([a1.strokeId, a2.strokeId]);
    // …and both logs hold exactly the four unique ops.
    expect(a.getOps().length).toBe(4);
    expect(b.getOps().length).toBe(4);
  });

  it("merge is order-independent across many random permutations", () => {
    const mk = (site: string): Op[] => {
      const d = new CrdtDoc(site);
      const ops: Op[] = [
        d.addStroke(pts(0, 0), "#ff0000", 3),
        d.addStroke(pts(50, 50), "#00ff00", 5),
      ];
      ops.push(d.deleteStroke(ops[0].strokeId));
      return ops;
    };
    const all = [...mk("a"), ...mk("b"), ...mk("c")];

    const shuffled = [...all].reverse();
    const x = new CrdtDoc("x");
    const y = new CrdtDoc("y");
    x.merge(all);
    y.merge(shuffled);

    expect(snapshot(x)).toBe(snapshot(y));
    // Each site deleted its own first stroke: 3 survivors, one per site.
    expect(x.getStrokes().length).toBe(3);
  });
});

describe("CrdtDoc idempotency", () => {
  it("re-applying the same op is a strict no-op", () => {
    const doc = new CrdtDoc("x");
    const op = doc.addStroke(pts(0, 0), "#ffffff", 2);
    const del = doc.deleteStroke(op.strokeId);

    const beforeStrokes = snapshot(doc);
    const beforeOps = doc.getOps().length;
    const beforeClock = doc.clock;

    expect(doc.applyRemote(op)).toEqual([]);
    expect(doc.applyRemote(del)).toEqual([]);
    expect(doc.merge([op, del, op])).toEqual([
      { op, decision: "duplicate" },
      { op: del, decision: "duplicate" },
      { op, decision: "duplicate" },
    ]);

    expect(snapshot(doc)).toBe(beforeStrokes);
    expect(doc.getOps().length).toBe(beforeOps);
    expect(doc.clock).toBe(beforeClock);
  });
});

describe("CrdtDoc delete-wins", () => {
  it("a delete beats a concurrent same-id re-add on every replica", () => {
    const docA = new CrdtDoc("a");
    const docB = new CrdtDoc("b");

    const addOp = docA.addStroke(pts(0, 0), "#ffffff", 3);
    docB.applyRemote(addOp); // B has seen the stroke…

    const delOp = docA.deleteStroke(addOp.strokeId); // …then A deletes it.

    // …but B concurrently "edits" it: a fresh add-stroke op for the SAME id,
    // emitted without ever seeing A's delete.
    const evilStroke: Stroke = {
      id: addOp.strokeId,
      siteId: "b",
      lamport: 2,
      color: "#ff0000",
      width: 6,
      points: [{ x: 9, y: 9 }],
      deleted: false,
    };
    const evilOp: Op = {
      opId: "b@evil",
      siteId: "b",
      lamport: 2,
      kind: "add-stroke",
      strokeId: addOp.strokeId,
      stroke: evilStroke,
    };

    // A merges the hostile add after its own delete…
    const reportsA = docA.merge([evilOp]);
    // …B merges delete-then-add (opposite order).
    const reportsB = docB.merge([evilOp, delOp]);

    expect(reportsA[0].decision).toBe("tombstoned");
    expect(reportsB.map((r) => r.decision)).toEqual(["applied", "applied"]);

    // Delete wins on both replicas: the stroke is gone everywhere.
    expect(docA.getStrokes().length).toBe(0);
    expect(docB.getStrokes().length).toBe(0);
    expect(docA.isTombstoned(addOp.strokeId)).toBe(true);
    expect(docB.isTombstoned(addOp.strokeId)).toBe(true);
    expect(docB.getStroke(addOp.strokeId)?.deleted).toBe(true);
    expect(snapshot(docA)).toBe(snapshot(docB));
  });

  it("a delete arriving before its add still wins (order independence)", () => {
    const doc = new CrdtDoc("z");
    const author = new CrdtDoc("a");
    const add = author.addStroke(pts(0, 0), "#ffffff", 3);
    const del = author.deleteStroke(add.strokeId);

    doc.merge([del, add]); // delete first
    expect(doc.getStrokes().length).toBe(0);
    expect(doc.isTombstoned(add.strokeId)).toBe(true);
  });
});

describe("CrdtDoc deterministic render order", () => {
  it("identical op sets always produce the same stroke order", () => {
    const a = new CrdtDoc("a");
    const b = new CrdtDoc("b");
    const ops: Op[] = [
      a.addStroke(pts(0, 0), "#ff0000", 3),
      b.addStroke(pts(10, 10), "#00ff00", 3),
      a.addStroke(pts(20, 20), "#0000ff", 3),
      b.addStroke(pts(30, 30), "#ffff00", 3),
    ];

    const x = new CrdtDoc("x");
    const y = new CrdtDoc("y");
    x.merge([ops[0], ops[1], ops[2], ops[3]]);
    y.merge([ops[3], ops[2], ops[1], ops[0]]);

    const orderX = x.getStrokes().map((s) => s.id);
    const orderY = y.getStrokes().map((s) => s.id);
    expect(orderX).toEqual(orderY);
    expect(orderX.length).toBe(4);
    // Sanity: the order is the (lamport, siteId, opId) sort, not arrival order.
    const byKey = [...ops].sort(
      (p, q) =>
        p.lamport - q.lamport ||
        (p.siteId < q.siteId ? -1 : 1) ||
        (p.opId < q.opId ? -1 : 1),
    );
    expect(orderX).toEqual(byKey.map((o) => o.strokeId));
  });
});

describe("CrdtDoc lamport clock", () => {
  it("remote ops advance the clock via max+1", () => {
    const a = new CrdtDoc("a");
    const b = new CrdtDoc("b");
    b.addStroke(pts(0, 0), "#fff", 2); // b@1
    b.addStroke(pts(0, 0), "#fff", 2); // b@2
    const bOps = b.getOps();

    a.applyRemote(bOps[1]); // lamport 2 arrives first
    expect(a.clock).toBe(3);
    a.applyRemote(bOps[0]); // stale lamport 1
    expect(a.clock).toBe(4);
  });
});

describe("CrdtDoc partition scenario (mirrors the demo)", () => {
  function shuffled<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  it("queued ops merged on heal converge, even with a concurrent delete", () => {
    const you = new CrdtDoc("you");
    const maya = new CrdtDoc("bot-maya");

    // Pre-partition: Maya draws a stroke both replicas share.
    const shared = maya.addStroke(pts(0, 0), "#f472b6", 4);
    you.applyRemote(shared);

    // Partition starts: Maya's new ops queue instead of merging.
    const m1 = maya.addStroke(pts(40, 40), "#f472b6", 4);
    const m2 = maya.addStroke(pts(80, 80), "#f472b6", 5);
    const queued: Op[] = [m1, m2];

    // Meanwhile you draw locally AND delete the shared stroke.
    const y1 = you.addStroke(pts(10, 90), "#38bdf8", 4);
    const delShared = you.deleteStroke(shared.strokeId);

    // Maya concurrently "edits" the shared stroke without seeing the delete.
    const hostile: Op = {
      opId: "bot-maya@hostile",
      siteId: "bot-maya",
      lamport: 3,
      kind: "add-stroke",
      strokeId: shared.strokeId,
      stroke: {
        id: shared.strokeId,
        siteId: "bot-maya",
        lamport: 3,
        color: "#f472b6",
        width: 9,
        points: [{ x: 1, y: 1 }],
        deleted: false,
      },
    };

    // Heal: merge everything in shuffled order.
    const reports = you.merge(shuffled([...queued, hostile]));
    expect(
      reports.find((r) => r.op.opId === "bot-maya@hostile")?.decision,
    ).toBe("tombstoned");

    // Delete wins: shared stroke gone; m1, m2, y1 survive.
    const ids = you.getStrokes().map((s) => s.id).sort();
    expect(ids).toEqual([m1.strokeId, m2.strokeId, y1.strokeId].sort());
    expect(delShared.kind).toBe("delete-stroke");

    // The demo's convergence proof: a fresh replica replaying the full log
    // in random order must produce byte-identical strokes.
    const verifier = new CrdtDoc("verifier");
    verifier.merge(shuffled(you.getOps()));
    expect(snapshot(verifier)).toBe(snapshot(you));
  });
});
