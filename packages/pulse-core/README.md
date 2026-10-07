# @repo/pulse-core

Operation-based **CRDT-lite** for a realtime collaborative whiteboard — the
engine behind the [Pulse demo](/demos/pulse) in the showcase app.

Pure TypeScript, zero dependencies, zero React. No wall-clock inside the
document logic: every timestamp is either a Lamport tick or passed in by the
caller, which makes the whole thing deterministic and trivially testable.

## The op model

Every mutation is an immutable `Op`:

```ts
interface Op {
  opId: string;      // globally unique: `${siteId}@${lamport}`
  siteId: SiteId;    // replica identity, e.g. "you", "bot-maya"
  lamport: number;   // Lamport timestamp — orders ops, never wall-clock
  kind: "add-stroke" | "delete-stroke";
  strokeId: string;  // which stroke this op targets
  stroke?: Stroke;   // the stroke payload (add-stroke only)
}
```

Replicas broadcast ops and apply them in **any order** — network partitions,
retries, and duplicates are all fine. State converges because:

1. **Idempotency** — a `seen: Set<opId>` makes re-applying an op a strict
   no-op (Lamport clock included).
2. **Delete-wins** — deletes are monotonic tombstones. Once an id is
   tombstoned, no add for that id is ever resurrected, so a delete always
   beats a concurrent same-id re-add *regardless of arrival order*. Fresh
   draws always mint fresh ids, so tombstones never block new work.
3. **Deterministic conflicts** — concurrent adds for the same id resolve by
   last-writer-wins on `(lamport, siteId, opId)`, identical on every replica
   with no coordination.
4. **Lamport receive rule** — `clock = max(clock, op.lamport) + 1` on every
   new remote op keeps causal ordering sane.

`getStrokes()` returns visible strokes sorted by `(lamport, siteId, opId)`,
so every replica renders the same z-order.

## API

```ts
import { CrdtDoc, PresenceManager, OpStats } from "@repo/pulse-core";

// --- replica ---------------------------------------------------------------
const doc = new CrdtDoc("you");

const op: Op = doc.addStroke([{ x: 0, y: 0 }, { x: 10, y: 10 }], "#38bdf8", 4);
// → broadcast `op` to peers…

const del: Op = doc.deleteStroke(op.strokeId); // tombstone (delete-wins)

doc.applyRemote(incomingOp);        // Op[] — newly applied ops ([] if no-op)
doc.inspectApply(incomingOp);       // ApplyReport { op, decision }
doc.merge(batchOfOps);              // ApplyReport[] — any order converges

doc.getStrokes();   // Stroke[] — visible, deterministically ordered
doc.getStroke(id);  // Stroke | undefined — including tombstoned
doc.isTombstoned(id);
doc.getOps();       // Op[] — full log, arrival order
doc.clock;          // current Lamport value
doc.opCount;

// ApplyDecision = "applied" | "duplicate" | "tombstoned"

// --- presence --------------------------------------------------------------
const presence = new PresenceManager();
presence.heartbeat("bot-maya", { x: 12, y: 40 }, "#f472b6", "Maya", Date.now());
presence.prune(15_000, Date.now()); // SiteId[] — peers gone quiet
presence.remove("bot-maya");
presence.list();                    // PeerInfo[] — sorted by siteId

// --- latency stats ----------------------------------------------------------
const stats = new OpStats();
stats.record(23.4);  // one send→ack round-trip, ms
stats.count(); stats.avg(); stats.p95(); // p95 = nearest-rank, 0 when empty
stats.recent(40);    // trailing window for charts
stats.reset();
```

## Design notes

- **Why not a full CRDT (Yjs/Automerge)?** This is a portfolio core: the
  point is to demonstrate the fundamentals — Lamport clocks, tombstones,
  idempotent apply, deterministic merge — in ~200 lines you can read in one
  sitting. A production deployment would reach for Yjs.
- **Op log growth** is unbounded here; a real deployment would snapshot and
  compact. The demo's op inspector reads straight from `getOps()`.
- **Strokes are immutable**; "editing" a stroke is a new add op for the same
  id, which loses to a concurrent delete. There is no resurrection.

## Tests

`vitest run` — 15 tests covering convergence/commutativity (opposite merge
orders, random permutations), idempotency (re-apply is a strict no-op),
delete-wins (concurrent same-id re-add loses on both replicas, delete-before-add
ordering), deterministic render order, Lamport clock updates, presence
pruning, and latency percentiles.
