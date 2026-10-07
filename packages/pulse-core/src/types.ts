/**
 * @repo/pulse-core — shared vocabulary for the collaborative whiteboard.
 *
 * The op model is operation-based CRDT-lite: every mutation is an immutable
 * {@link Op} carrying a Lamport timestamp. Replicas exchange ops in any
 * order and converge to identical state (see `doc.ts`).
 */

/** A replica identity, e.g. "you", "bot-maya". Unique per editing peer. */
export type SiteId = string;

/** A point in canvas space (CSS pixels). */
export interface Point {
  x: number;
  y: number;
}

/**
 * A single drawn stroke. Strokes are immutable once created — "editing" a
 * stroke means issuing a new add-stroke op for the same id, which loses to a
 * concurrent delete (delete-wins).
 */
export interface Stroke {
  /** Globally unique, e.g. "bot-maya:stroke:7". */
  id: string;
  /** Site that originally drew the stroke. */
  siteId: SiteId;
  /** Lamport timestamp of the add op that created this version. */
  lamport: number;
  /** CSS color, e.g. "#38bdf8". */
  color: string;
  /** Brush width in canvas pixels. */
  width: number;
  points: Point[];
  /** True once a delete-stroke op has tombstoned this stroke. */
  deleted?: boolean;
}

export type OpKind = "add-stroke" | "delete-stroke";

/**
 * An immutable operation. `opId` is globally unique (`siteId@lamport`);
 * `lamport` orders ops for deterministic rendering. `stroke` is present on
 * add-stroke ops only.
 */
export interface Op {
  opId: string;
  siteId: SiteId;
  lamport: number;
  kind: OpKind;
  strokeId: string;
  stroke?: Stroke;
}
