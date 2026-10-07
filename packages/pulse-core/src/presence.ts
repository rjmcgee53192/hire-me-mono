import type { Point, SiteId } from "./types";

export interface PeerInfo {
  siteId: SiteId;
  name: string;
  color: string;
  cursor: Point;
  /** Caller-supplied timestamp (ms) of the last heartbeat. */
  lastSeen: number;
}

/**
 * Tracks live collaborators. Timestamps are always passed in by the caller —
 * this class never reads the wall clock, which keeps it deterministic and
 * trivially testable.
 */
export class PresenceManager {
  private peers = new Map<SiteId, PeerInfo>();

  /** Upsert a peer's heartbeat. */
  heartbeat(
    siteId: SiteId,
    cursor: Point,
    color: string,
    name: string,
    now: number,
  ): void {
    this.peers.set(siteId, {
      siteId,
      name,
      color,
      cursor: { x: cursor.x, y: cursor.y },
      lastSeen: now,
    });
  }

  /**
   * Drop peers whose last heartbeat is older than `timeoutMs`.
   * Returns the removed site ids in insertion order.
   */
  prune(timeoutMs: number, now: number): SiteId[] {
    const removed: SiteId[] = [];
    for (const [id, peer] of this.peers) {
      if (now - peer.lastSeen > timeoutMs) {
        this.peers.delete(id);
        removed.push(id);
      }
    }
    return removed;
  }

  /** Remove a peer immediately. Returns true if it was present. */
  remove(siteId: SiteId): boolean {
    return this.peers.delete(siteId);
  }

  /** Active peers, sorted by siteId for deterministic rendering. */
  list(): PeerInfo[] {
    return [...this.peers.values()]
      .map((p) => ({ ...p, cursor: { x: p.cursor.x, y: p.cursor.y } }))
      .sort((a, b) => (a.siteId < b.siteId ? -1 : a.siteId > b.siteId ? 1 : 0));
  }

  get size(): number {
    return this.peers.size;
  }
}
