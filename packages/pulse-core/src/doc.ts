import type { Op, Point, SiteId, Stroke } from "./types";

/**
 * How a single op was treated when it reached a replica.
 * - "applied":    the op changed replica state.
 * - "duplicate":  the opId was already seen — strict no-op (idempotent).
 * - "tombstoned": an add-stroke for an id a delete already claimed —
 *                  delete-wins, the add is dropped so every replica agrees.
 */
export type ApplyDecision = "applied" | "duplicate" | "tombstoned";

export interface ApplyReport {
  op: Op;
  decision: ApplyDecision;
}

interface StrokeRecord {
  stroke: Stroke;
  /** opId of the winning add — part of the deterministic render order. */
  addOpId: string;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Operation-based CRDT-lite for a collaborative whiteboard.
 *
 * Design:
 * - Each replica owns a Lamport clock. Local ops bump it; remote ops set
 *   `clock = max(clock, op.lamport) + 1`.
 * - `seen: Set<opId>` makes apply idempotent: re-applying an op is a no-op.
 * - Deletes are monotonic tombstones. Once an id is tombstoned, no add for
 *   that id is ever resurrected — this is what makes delete win over a
 *   concurrent re-add *regardless of arrival order*, so merge() commutes.
 * - Concurrent adds for the same id (same-id "edits") resolve by
 *   last-writer-wins on (lamport, siteId, opId) — deterministic on every
 *   replica without coordination.
 * - No wall-clock anywhere: callers pass timestamps in (see presence.ts).
 */
export class CrdtDoc {
  readonly siteId: SiteId;

  private lamport = 0;
  private strokes = new Map<string, StrokeRecord>();
  private tombstones = new Set<string>();
  private seen = new Set<string>();
  private opLog: Op[] = [];

  constructor(siteId: SiteId) {
    this.siteId = siteId;
  }

  /** Current Lamport clock value. */
  get clock(): number {
    return this.lamport;
  }

  /** Number of ops recorded in this replica's log. */
  get opCount(): number {
    return this.opLog.length;
  }

  // ------------------------------------------------------------------ local

  /**
   * Draw a stroke locally. Bumps the Lamport clock, records the op, and
   * returns it so the caller can broadcast it.
   */
  addStroke(points: Point[], color: string, width: number): Op {
    this.lamport += 1;
    const lamport = this.lamport;
    const stroke: Stroke = {
      id: `${this.siteId}:stroke:${lamport}`,
      siteId: this.siteId,
      lamport,
      color,
      width,
      points: points.map((p) => ({ x: p.x, y: p.y })),
      deleted: false,
    };
    const op: Op = {
      opId: `${this.siteId}@${lamport}`,
      siteId: this.siteId,
      lamport,
      kind: "add-stroke",
      strokeId: stroke.id,
      stroke,
    };
    this.recordNew(op);
    this.integrate(op);
    return op;
  }

  /**
   * Delete a stroke locally (tombstone). Delete-wins: a concurrent re-add
   * of the same id loses on every replica after merge. Returns the op for
   * broadcast. Deleting an unknown id still records the tombstone so a
   * later-arriving add for that id is dropped — merge order independence.
   */
  deleteStroke(strokeId: string): Op {
    this.lamport += 1;
    const lamport = this.lamport;
    const op: Op = {
      opId: `${this.siteId}@${lamport}`,
      siteId: this.siteId,
      lamport,
      kind: "delete-stroke",
      strokeId,
    };
    this.recordNew(op);
    this.integrate(op);
    return op;
  }

  // ----------------------------------------------------------------- remote

  /**
   * Apply a single remote op. Updates the Lamport clock (`max + 1`),
   * integrates the op if unseen, and returns the newly-applied ops
   * (`[]` when the op was a duplicate or a tombstoned add).
   */
  applyRemote(op: Op): Op[] {
    const report = this.applyIncoming(op);
    return report.decision === "applied" ? [op] : [];
  }

  /**
   * Same as applyRemote, but reports *how* the op was treated. Powers the
   * demo's merge inspector.
   */
  inspectApply(op: Op): ApplyReport {
    return this.applyIncoming(op);
  }

  /**
   * Merge a batch of ops in any order. Because tombstones are monotonic and
   * adds are dropped-if-tombstoned, every permutation converges to the same
   * state. Returns a per-op report in input order.
   */
  merge(ops: Op[]): ApplyReport[] {
    return ops.map((op) => this.applyIncoming(op));
  }

  // ------------------------------------------------------------------ reads

  /**
   * Visible strokes, sorted deterministically by (lamport, siteId, opId)
   * so every replica renders the same z-order.
   */
  getStrokes(): Stroke[] {
    const records = [...this.strokes.values()].filter((r) => !r.stroke.deleted);
    records.sort(
      (a, b) =>
        a.stroke.lamport - b.stroke.lamport ||
        compareStrings(a.stroke.siteId, b.stroke.siteId) ||
        compareStrings(a.addOpId, b.addOpId),
    );
    return records.map((r) => this.cloneStroke(r.stroke));
  }

  /** A stroke by id, including tombstoned ones. */
  getStroke(strokeId: string): Stroke | undefined {
    const rec = this.strokes.get(strokeId);
    return rec ? this.cloneStroke(rec.stroke) : undefined;
  }

  /** True once a delete-stroke op has been seen for this id. */
  isTombstoned(strokeId: string): boolean {
    return this.tombstones.has(strokeId);
  }

  /** The full op log in arrival order. */
  getOps(): Op[] {
    return [...this.opLog];
  }

  // --------------------------------------------------------------- internals

  private recordNew(op: Op): void {
    this.seen.add(op.opId);
    this.opLog.push(op);
  }

  private applyIncoming(op: Op): ApplyReport {
    if (this.seen.has(op.opId)) {
      return { op, decision: "duplicate" };
    }
    // Lamport receive rule — only for genuinely new ops, so re-applying an
    // op is a strict no-op (clock included).
    this.lamport = Math.max(this.lamport, op.lamport) + 1;
    this.recordNew(op);
    const decision = this.integrate(op);
    return { op, decision };
  }

  /**
   * Fold an op into state. Returns "tombstoned" when an add arrives for an
   * id a delete already claimed (delete-wins); otherwise "applied".
   */
  private integrate(op: Op): ApplyDecision {
    if (op.kind === "delete-stroke") {
      this.tombstones.add(op.strokeId);
      const rec = this.strokes.get(op.strokeId);
      if (rec) rec.stroke.deleted = true;
      return "applied";
    }

    // add-stroke — delete-wins: a tombstoned id never comes back to life.
    // Fresh draws always mint fresh ids, so this only drops concurrent
    // re-adds of an id a delete already claimed.
    if (this.tombstones.has(op.strokeId)) {
      return "tombstoned";
    }
    if (!op.stroke) {
      return "applied"; // malformed add: logged, nothing to insert
    }
    const existing = this.strokes.get(op.strokeId);
    if (!existing || this.addWinsOver(op, existing)) {
      this.strokes.set(op.strokeId, {
        stroke: this.cloneStroke(op.stroke),
        addOpId: op.opId,
      });
    }
    return "applied";
  }

  /** Last-writer-wins among concurrent adds: (lamport, siteId, opId). */
  private addWinsOver(op: Op, existing: StrokeRecord): boolean {
    const e = existing.stroke;
    return (
      op.lamport > e.lamport ||
      (op.lamport === e.lamport &&
        (compareStrings(op.siteId, e.siteId) > 0 ||
          (op.siteId === e.siteId && compareStrings(op.opId, existing.addOpId) > 0)))
    );
  }

  private cloneStroke(s: Stroke): Stroke {
    return {
      ...s,
      points: s.points.map((p) => ({ x: p.x, y: p.y })),
    };
  }
}
