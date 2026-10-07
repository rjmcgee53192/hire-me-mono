"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  LineChart,
  PageHeader,
  SectionTitle,
  Slider,
  StatTile,
  Toggle,
} from "@repo/ui";
import { CrdtDoc, OpStats, PresenceManager } from "@repo/pulse-core";
import type { ApplyDecision, Op, Point, Stroke } from "@repo/pulse-core";

// ---------------------------------------------------------------- constants

const W = 960;
const H = 560;

const YOU = { siteId: "you", name: "You", color: "#38bdf8" } as const;

const BOT_DEFS = [
  { siteId: "bot-maya", name: "Maya", color: "#f472b6" },
  { siteId: "bot-leo", name: "Leo", color: "#a3e635" },
] as const;

const PALETTE = [
  "#38bdf8",
  "#f472b6",
  "#a3e635",
  "#fbbf24",
  "#c084fc",
  "#f87171",
  "#e2e8f0",
];

// ------------------------------------------------------------------ helpers

/** Lazily create a ref-held instance once (class instances, not re-created). */
function useLazyRef<T>(factory: () => T): { current: T } {
  const ref = useRef<T | null>(null);
  if (ref.current === null) ref.current = factory();
  return ref as { current: T };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ------------------------------------------------------- bot shape drawing

function circlePoints(cx: number, cy: number, r: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

function rectPoints(cx: number, cy: number, w: number, h: number): Point[] {
  const corners: Point[] = [
    { x: cx - w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy + h / 2 },
    { x: cx - w / 2, y: cy + h / 2 },
    { x: cx - w / 2, y: cy - h / 2 },
  ];
  const pts: Point[] = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const p0 = corners[i];
    const p1 = corners[i + 1];
    for (let t = 0; t < 12; t++) {
      pts.push({
        x: p0.x + ((p1.x - p0.x) * t) / 12,
        y: p0.y + ((p1.y - p0.y) * t) / 12,
      });
    }
  }
  pts.push(corners[corners.length - 1]);
  return pts;
}

function zigzagPoints(cx: number, cy: number, w: number, h: number): Point[] {
  const pts: Point[] = [];
  const n = 7;
  for (let i = 0; i <= n * 8; i++) {
    const t = i / 8;
    const seg = Math.floor(t);
    const f = t - seg;
    pts.push({
      x: cx - w / 2 + (w * t) / n,
      y: cy + (seg % 2 === 0 ? -h / 2 + h * f : h / 2 - h * f),
    });
  }
  return pts;
}

function spiralPoints(cx: number, cy: number, r: number): Point[] {
  const pts: Point[] = [];
  const turns = 2.5;
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * Math.PI * 2;
    const rr = r * t;
    pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
  return pts;
}

function randomShape(): Point[] {
  const cx = 80 + Math.random() * (W - 160);
  const cy = 80 + Math.random() * (H - 160);
  const pick = Math.floor(Math.random() * 4);
  if (pick === 0) return circlePoints(cx, cy, 24 + Math.random() * 40);
  if (pick === 1)
    return rectPoints(cx, cy, 60 + Math.random() * 90, 50 + Math.random() * 70);
  if (pick === 2)
    return zigzagPoints(cx, cy, 90 + Math.random() * 120, 30 + Math.random() * 40);
  return spiralPoints(cx, cy, 30 + Math.random() * 45);
}

// ------------------------------------------------------------- eraser math

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq),
  );
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distToStroke(p: Point, s: Stroke): number {
  if (s.points.length === 1) {
    const q = s.points[0];
    return Math.hypot(p.x - q.x, p.y - q.y);
  }
  let best = Infinity;
  for (let i = 0; i < s.points.length - 1; i++) {
    const d = distToSegment(p, s.points[i], s.points[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

function hitStroke(strokes: Stroke[], p: Point): Stroke | undefined {
  let best: Stroke | undefined;
  let bestD = 14;
  for (const s of strokes) {
    const d = distToStroke(p, s);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

// ----------------------------------------------------------------- painting

interface PaintableStroke {
  points: Point[];
  color: string;
  width: number;
}

function paintStroke(ctx: CanvasRenderingContext2D, s: PaintableStroke): void {
  if (s.points.length === 0) return;
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (s.points.length === 1) {
    const p = s.points[0];
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.5, p.y + 0.5);
  } else {
    s.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
  }
  ctx.stroke();
}

function paintCursor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  name: string,
  dim: boolean,
): void {
  ctx.save();
  ctx.globalAlpha = dim ? 0.5 : 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 15, y + 6);
  ctx.lineTo(x + 6, y + 15);
  ctx.closePath();
  ctx.fill();
  ctx.font = "11px system-ui, sans-serif";
  const label = dim ? `${name} · partitioned` : name;
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = "rgba(2, 6, 16, 0.9)";
  ctx.fillRect(x + 10, y + 12, tw + 12, 20);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 10, y + 12, tw + 12, 20);
  ctx.fillStyle = "#e2e8f0";
  ctx.fillText(label, x + 16, y + 26);
  ctx.restore();
}

// --------------------------------------------------------------- bot sims

interface BotSim {
  doc: CrdtDoc;
  siteId: string;
  name: string;
  color: string;
  cursor: Point;
  target: Point;
}

function randomBoardPoint(): Point {
  return {
    x: 60 + Math.random() * (W - 120),
    y: 60 + Math.random() * (H - 120),
  };
}

function makeBot(def: { siteId: string; name: string; color: string }): BotSim {
  return {
    doc: new CrdtDoc(def.siteId),
    siteId: def.siteId,
    name: def.name,
    color: def.color,
    cursor: randomBoardPoint(),
    target: randomBoardPoint(),
  };
}

function moveToward(bot: BotSim, dt: number): void {
  const dx = bot.target.x - bot.cursor.x;
  const dy = bot.target.y - bot.cursor.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 4) {
    bot.target = randomBoardPoint();
    return;
  }
  const speed = 140; // px per second
  const step = Math.min(dist, speed * dt);
  bot.cursor.x += (dx / dist) * step;
  bot.cursor.y += (dy / dist) * step;
}

// ---------------------------------------------------------- op inspector

type InspectorDecision = ApplyDecision | "local" | "queued";

interface InspectorEntry {
  seq: number;
  opId: string;
  siteId: string;
  lamport: number;
  kind: string;
  decision: InspectorDecision;
}

function toneFor(d: InspectorDecision): "success" | "neutral" | "warn" | "info" {
  if (d === "applied") return "success";
  if (d === "duplicate") return "neutral";
  if (d === "tombstoned" || d === "queued") return "warn";
  return "info";
}

function shortId(opId: string): string {
  return opId.length > 20 ? `${opId.slice(0, 18)}…` : opId;
}

// ================================================================== page

export default function PulseDemoPage() {
  const docRef = useLazyRef(() => new CrdtDoc(YOU.siteId));
  const botsRef = useLazyRef<BotSim[]>(() => BOT_DEFS.map(makeBot));
  const presenceRef = useLazyRef(() => new PresenceManager());
  const statsRef = useLazyRef(() => new OpStats());

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pendingRef = useRef<Op[]>([]);
  const drawingRef = useRef({
    active: false,
    points: [] as Point[],
    color: PALETTE[0],
    width: 4,
  });
  const seqRef = useRef(1);
  const ackTimersRef = useRef<number[]>([]);
  const partitionedRef = useRef(false);
  const collaboratorsRef = useRef(true);

  const [color, setColor] = useState(PALETTE[0]);
  const [width, setWidth] = useState(4);
  const [eraser, setEraser] = useState(false);
  const [collaborators, setCollaborators] = useState(true);
  const [partitioned, setPartitioned] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [log, setLog] = useState<InspectorEntry[]>([]);
  const [statsTick, setStatsTick] = useState(0);
  const [converged, setConverged] = useState<boolean | null>(null);

  // ------------------------------------------------------------ core ops

  /** Bump to re-render stat panels (values are read from refs at render). */
  const bump = (): void => setStatsTick((t) => t + 1);

  const addLog = (entry: Omit<InspectorEntry, "seq">): void => {
    const seq = seqRef.current;
    seqRef.current += 1;
    setLog((prev) => [{ ...entry, seq }, ...prev].slice(0, 80));
  };

  /** Simulate a network ack: measure the real elapsed ms into OpStats. */
  const simulateAck = (): void => {
    const t0 = performance.now();
    const delay = 12 + Math.random() * 60;
    const id = window.setTimeout(() => {
      statsRef.current.record(performance.now() - t0);
      bump();
    }, delay);
    ackTimersRef.current.push(id);
  };

  const logOp = (op: Op, decision: InspectorDecision): void => {
    addLog({
      opId: op.opId,
      siteId: op.siteId,
      lamport: op.lamport,
      kind: op.kind,
      decision,
    });
    simulateAck();
  };

  // ------------------------------------------------------- partition heal

  const healPartition = (): void => {
    const queued = pendingRef.current;
    pendingRef.current = [];
    setPendingCount(0);
    if (queued.length === 0) {
      setConverged(null);
      return;
    }
    // Merge in a shuffled order — the CRDT must converge regardless.
    const reports = docRef.current.merge(shuffle(queued));
    for (const r of reports) logOp(r.op, r.decision);

    // Convergence proof: replay every known op into a fresh replica in a
    // random order. It must produce byte-identical strokes.
    const verifier = new CrdtDoc("verifier");
    verifier.merge(shuffle(docRef.current.getOps()));
    const same =
      JSON.stringify(verifier.getStrokes()) ===
      JSON.stringify(docRef.current.getStrokes());
    setConverged(same);
    bump();
  };

  const handlePartition = (on: boolean): void => {
    partitionedRef.current = on;
    setPartitioned(on);
    if (on) setConverged(null);
    else healPartition();
  };

  const handleCollaborators = (on: boolean): void => {
    collaboratorsRef.current = on;
    setCollaborators(on);
    if (!on) {
      for (const bot of botsRef.current) presenceRef.current.remove(bot.siteId);
      bump();
    }
  };

  // ------------------------------------------------------- bot tick loop

  useEffect(() => {
    if (!collaborators) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      for (const bot of botsRef.current) {
        presenceRef.current.heartbeat(
          bot.siteId,
          bot.cursor,
          bot.color,
          bot.name,
          now,
        );
        const op = bot.doc.addStroke(
          randomShape(),
          bot.color,
          3 + Math.floor(Math.random() * 4),
        );
        if (partitionedRef.current) {
          pendingRef.current.push(op);
          setPendingCount(pendingRef.current.length);
          addLog({
            opId: op.opId,
            siteId: op.siteId,
            lamport: op.lamport,
            kind: op.kind,
            decision: "queued",
          });
        } else {
          const report = docRef.current.inspectApply(op);
          logOp(op, report.decision);
        }
      }
      presenceRef.current.prune(15000, now);
      bump();
    }, 2400);
    return () => window.clearInterval(id);
  }, [collaborators]);

  // ------------------------------------------------------- render loop

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);

    const paint = (): void => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0b1120";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(148, 163, 184, 0.08)";
      for (let x = 24; x < W; x += 32) {
        for (let y = 24; y < H; y += 32) ctx.fillRect(x, y, 2, 2);
      }
      for (const s of docRef.current.getStrokes()) paintStroke(ctx, s);
      const d = drawingRef.current;
      if (d.active && d.points.length > 0) {
        paintStroke(ctx, { points: d.points, color: d.color, width: d.width });
      }
      if (collaboratorsRef.current) {
        const dim = partitionedRef.current;
        for (const bot of botsRef.current) {
          paintCursor(
            ctx,
            bot.cursor.x,
            bot.cursor.y,
            dim ? "#64748b" : bot.color,
            bot.name,
            dim,
          );
        }
      }
    };

    let raf = 0;
    let last = performance.now();
    const frame = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!partitionedRef.current) {
        for (const bot of botsRef.current) moveToward(bot, dt);
      }
      paint();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ------------------------------------------------------- unmount cleanup

  useEffect(() => {
    const timers = ackTimersRef.current;
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, []);

  // ------------------------------------------------------- local drawing

  const posFromEvent = (e: PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * W) / rect.width,
      y: ((e.clientY - rect.top) * H) / rect.height,
    };
  };

  const handlePointerDown = (e: PointerEvent<HTMLCanvasElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = posFromEvent(e);
    if (eraser) {
      const hit = hitStroke(docRef.current.getStrokes(), p);
      if (hit) {
        const op = docRef.current.deleteStroke(hit.id);
        logOp(op, "local");
        bump();
      }
      return;
    }
    drawingRef.current = { active: true, points: [p], color, width };
  };

  const handlePointerMove = (e: PointerEvent<HTMLCanvasElement>): void => {
    const d = drawingRef.current;
    if (!d.active) return;
    const p = posFromEvent(e);
    const prev = d.points[d.points.length - 1];
    if (Math.hypot(p.x - prev.x, p.y - prev.y) >= 2.5) d.points.push(p);
  };

  const finishStroke = (): void => {
    const d = drawingRef.current;
    if (!d.active) return;
    d.active = false;
    if (d.points.length >= 2) {
      const op = docRef.current.addStroke(d.points, d.color, d.width);
      logOp(op, "local");
      bump();
    }
  };

  const clearBoard = (): void => {
    const strokes = docRef.current.getStrokes();
    if (strokes.length === 0) return;
    for (const s of strokes) {
      const op = docRef.current.deleteStroke(s.id);
      logOp(op, "local");
    }
    bump();
  };

  // ------------------------------------------------------- derived values

  void statsTick; // re-render trigger; values below are read from refs
  const opsCount = docRef.current.getOps().length;
  const avgLatency = statsRef.current.avg();
  const p95Latency = statsRef.current.p95();
  const latencySeries = statsRef.current.recent(40);
  const peers = presenceRef.current.list();

  const status = partitioned ? (
    <Badge tone="warn">Partitioned</Badge>
  ) : collaborators ? (
    <Badge tone="success">Live</Badge>
  ) : (
    <Badge tone="neutral">Solo</Badge>
  );

  // ------------------------------------------------------------------ JSX

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <PageHeader
        title="Pulse"
        sub="Realtime whiteboard — presence, operations, deterministic CRDT merge."
        actions={status}
      />

      {partitioned && (
        <div className="mb-6">
          <Alert tone="warn" title="Network partition active">
            Collaborator ops are queuing instead of merging — the pending-ops
            badge is counting up. Draw or erase while partitioned, then toggle
            the partition off to merge and watch the inspector prove
            convergence.
          </Alert>
        </div>
      )}
      {converged !== null && (
        <div className="mb-6">
          {converged ? (
            <Alert tone="success" title="Converged">
              A fresh replica replayed every known op in random order and
              produced byte-identical strokes. Merge is order-independent —
              the CRDT holds.
            </Alert>
          ) : (
            <Alert tone="critical" title="Divergence detected">
              Replicas disagree after merge. This should never happen.
            </Alert>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Whiteboard</CardTitle>
                <CardDescription>
                  Draw with mouse or touch — every stroke becomes a CRDT op in
                  the log below.
                </CardDescription>
              </div>
              {pendingCount > 0 && (
                <Badge tone="warn">{pendingCount} queued</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <canvas
              ref={canvasRef}
              className="block w-full cursor-crosshair touch-none rounded-lg border border-slate-800"
              style={{ aspectRatio: `${W} / ${H}` }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishStroke}
              onPointerCancel={finishStroke}
              onPointerLeave={finishStroke}
            />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant={eraser ? "secondary" : "primary"}
                size="sm"
                onClick={() => setEraser(false)}
              >
                Pen
              </Button>
              <Button
                variant={eraser ? "primary" : "secondary"}
                size="sm"
                onClick={() => setEraser(true)}
              >
                Eraser
              </Button>
              <Button variant="danger" size="sm" onClick={clearBoard}>
                Clear board
              </Button>
              <span className="ml-auto text-xs text-slate-500">
                {eraser
                  ? "Click a stroke to delete it (issues a delete-stroke op)."
                  : "Click and drag to draw."}
              </span>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Tools</CardTitle>
              <CardDescription>Brush, peers, and network controls.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div>
                <div className="mb-2 text-sm text-slate-300">Color</div>
                <div className="flex flex-wrap items-center gap-2">
                  {PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Brush color ${c}`}
                      onClick={() => setColor(c)}
                      className={`h-8 w-8 rounded-full border transition-transform hover:scale-110 ${
                        color === c
                          ? "border-white ring-2 ring-white/70 ring-offset-2 ring-offset-slate-900"
                          : "border-slate-700"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <input
                    type="color"
                    aria-label="Custom brush color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="h-8 w-10 cursor-pointer rounded border border-slate-700 bg-transparent"
                  />
                </div>
              </div>
              <Slider
                label="Brush width"
                min={1}
                max={14}
                step={1}
                value={width}
                onChange={setWidth}
                unit="px"
              />
              <Toggle
                label="Collaborators"
                checked={collaborators}
                onChange={handleCollaborators}
              />
              <Toggle
                label="Simulate network partition"
                checked={partitioned}
                onChange={handlePartition}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Presence</CardTitle>
              <CardDescription>
                Live peers, straight from PresenceManager.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col">
                <li className="flex items-center gap-3 py-1.5">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: YOU.color }}
                  />
                  <span className="text-sm text-slate-200">You</span>
                  <span className="font-mono text-xs text-slate-500">
                    {YOU.siteId}
                  </span>
                </li>
                {peers.map((p) => (
                  <li
                    key={p.siteId}
                    className="flex items-center gap-3 py-1.5"
                  >
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{
                        backgroundColor: partitioned ? "#64748b" : p.color,
                      }}
                    />
                    <span className="text-sm text-slate-200">{p.name}</span>
                    <span className="font-mono text-xs text-slate-500">
                      {p.siteId}
                    </span>
                    <span className="ml-auto font-mono text-xs text-slate-500">
                      {Math.round(p.cursor.x)}, {Math.round(p.cursor.y)}
                    </span>
                  </li>
                ))}
              </ul>
              {peers.length === 0 && (
                <p className="mt-2 text-sm text-slate-500">
                  No collaborators online — toggle them on to watch Maya and
                  Leo draw.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-8">
        <SectionTitle
          title="Network & stats"
          sub="Live measurements from OpStats, the op log, and the partition queue."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatTile
            label="Operations"
            value={String(opsCount)}
            sub="ops in the log"
          />
          <StatTile
            label="Avg ack latency"
            value={`${avgLatency.toFixed(1)} ms`}
            sub="send → ack"
            sparkData={latencySeries.length >= 2 ? latencySeries : undefined}
            sparkColor="#38bdf8"
          />
          <StatTile
            label="p95 ack latency"
            value={`${p95Latency.toFixed(1)} ms`}
            sub="nearest-rank"
          />
          <StatTile
            label="Peers online"
            value={String(peers.length)}
            sub="via presence heartbeats"
          />
          <StatTile
            label="Divergence"
            value={String(pendingCount)}
            sub="ops queued behind partition"
          />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Ack latency</CardTitle>
            <CardDescription>
              Measured send → ack round-trips, live from OpStats.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {latencySeries.length >= 2 ? (
              <LineChart
                series={[
                  {
                    label: "ack latency",
                    color: "#38bdf8",
                    data: latencySeries,
                  },
                ]}
                height={220}
                yUnit=" ms"
                title="Ack latency"
              />
            ) : (
              <p className="py-10 text-center text-sm text-slate-500">
                Draw something — latency samples appear here.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Op inspector</CardTitle>
                <CardDescription>
                  Every op, with its merge decision.
                </CardDescription>
              </div>
              {pendingCount > 0 && (
                <Badge tone="warn">{pendingCount} queued</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-[320px] overflow-y-auto pr-1">
              {log.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No ops yet. Draw on the canvas or wait for a collaborator.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {log.map((e) => (
                    <li
                      key={e.seq}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs"
                    >
                      <span className="text-slate-600">#{e.seq}</span>
                      <Badge tone={toneFor(e.decision)}>{e.decision}</Badge>
                      <span className="text-slate-300">{e.kind}</span>
                      <span className="text-slate-500">
                        λ{e.lamport} · {e.siteId} · {shortId(e.opId)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
