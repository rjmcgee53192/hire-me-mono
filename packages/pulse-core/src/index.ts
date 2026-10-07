/**
 * @repo/pulse-core — operation-based CRDT-lite for a collaborative whiteboard.
 *
 * - {@link CrdtDoc}: the replica. Lamport clock, op log, tombstone deletes,
 *   deterministic render order. Merge in any order, converge always.
 * - {@link PresenceManager}: peer heartbeats with caller-supplied timestamps.
 * - {@link OpStats}: send→ack latency stats (avg, p95).
 */
export type { Point, SiteId, Stroke, Op, OpKind } from "./types";

export { CrdtDoc } from "./doc";
export type { ApplyDecision, ApplyReport } from "./doc";

export { PresenceManager } from "./presence";
export type { PeerInfo } from "./presence";

export { OpStats } from "./stats";
