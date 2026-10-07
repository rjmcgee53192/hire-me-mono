"use client";

/**
 * TensorGrid demo — live GPU-cluster observability dashboard.
 *
 * A real Cluster + Scheduler + AlertManager from @repo/tensorgrid-core run
 * in a setInterval loop; every control below (play/pause, speed, reset,
 * job submit/cancel, heatmap node selection, background workload, stress
 * fill) drives that live simulation. Nothing here is canned.
 */

import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Heatmap,
  LineChart,
  PageHeader,
  ProgressBar,
  SectionTitle,
  Select,
  Slider,
  StatTile,
  Toggle,
} from "@repo/ui";
import {
  AlertManager,
  Cluster,
  Scheduler,
  mulberry32,
  randomJobSpec,
  type AlertSeverity,
  type ClusterAlert,
  type CompletedJob,
  type Job,
  type JobPriority,
  type NodeSnapshot,
  type Rng,
} from "@repo/tensorgrid-core";

const NODE_COUNT = 4;
const GPUS_PER_NODE = 8;
const HIST_CAP = 120;
const SPARK_CAP = 40;
const MAX_QUEUE_BG = 10;

interface Sim {
  cluster: Cluster;
  sched: Scheduler;
  alerts: AlertManager;
  bgRng: Rng;
  bgCounter: number;
}

interface Hist {
  powerKw: number[];
  tempC: number[];
  tput: number[];
  nodeTemp: number[][];
  nodeUtil: number[][];
}

interface View {
  tick: number;
  time: number;
  nodes: NodeSnapshot[];
  queue: Job[];
  running: Job[];
  completed: CompletedJob[];
  activeAlerts: ClusterAlert[];
  alertLog: ClusterAlert[];
  usedGpus: number;
  totalGpus: number;
  allocPct: number;
  avgTemp: number;
  maxTemp: number;
  powerKw: number;
  aggTput: number;
  powerHist: number[];
  tempHist: number[];
  tputHist: number[];
  nodeTempHist: number[][];
  nodeUtilHist: number[][];
}

const randomSeed = (): number => (Math.random() * 2 ** 31) | 0;

function createSim(seed: number): Sim {
  const cluster = new Cluster({
    nodeCount: NODE_COUNT,
    gpusPerNode: GPUS_PER_NODE,
    seed,
  });
  const sched = new Scheduler(cluster, { seed: seed ^ 0x9e3779b9 });
  const bgRng = mulberry32(seed ^ 0x51ed);
  const sim: Sim = {
    cluster,
    sched,
    alerts: new AlertManager({ sustainedTicks: 3 }),
    bgRng,
    bgCounter: 0,
  };
  // Seed the cluster with a few real jobs so the dashboard is alive on load.
  for (let i = 0; i < 3; i++) {
    sim.sched.submit(randomJobSpec(bgRng, sim.bgCounter++));
  }
  return sim;
}

function emptyHist(): Hist {
  return { powerKw: [], tempC: [], tput: [], nodeTemp: [], nodeUtil: [] };
}

function pushCapped(arr: number[], v: number, cap: number): void {
  arr.push(v);
  if (arr.length > cap) arr.splice(0, arr.length - cap);
}

function buildView(sim: Sim, hist: Hist, alertLog: ClusterAlert[], tick: number): View {
  const nodes = sim.cluster.snapshot();
  const powerKw = nodes.reduce((s, n) => s + n.powerW, 0) / 1000;
  const avgTemp = nodes.reduce((s, n) => s + n.tempC, 0) / nodes.length;
  const maxTemp = Math.max(...nodes.map((n) => n.tempC));
  const aggTput = sim.sched
    .running()
    .reduce((s, j) => s + (j.throughputTokensPerSec ?? 0), 0);

  pushCapped(hist.powerKw, powerKw, HIST_CAP);
  pushCapped(hist.tempC, avgTemp, HIST_CAP);
  pushCapped(hist.tput, aggTput, HIST_CAP);
  nodes.forEach((n, i) => {
    if (!hist.nodeTemp[i]) {
      hist.nodeTemp[i] = [];
      hist.nodeUtil[i] = [];
    }
    pushCapped(hist.nodeTemp[i] as number[], n.tempC, SPARK_CAP);
    pushCapped(hist.nodeUtil[i] as number[], n.utilPct, SPARK_CAP);
  });

  const usedGpus = sim.cluster.totalGpusUsed;
  const totalGpus = sim.cluster.totalGpus;
  return {
    tick,
    time: sim.sched.time,
    nodes,
    queue: sim.sched.queue(),
    running: sim.sched.running(),
    completed: sim.sched.completed(),
    activeAlerts: sim.alerts.activeAlerts(),
    alertLog,
    usedGpus,
    totalGpus,
    allocPct: totalGpus === 0 ? 0 : (usedGpus / totalGpus) * 100,
    avgTemp,
    maxTemp,
    powerKw,
    aggTput,
    powerHist: [...hist.powerKw],
    tempHist: [...hist.tempC],
    tputHist: [...hist.tput],
    nodeTempHist: hist.nodeTemp.map((h) => [...h]),
    nodeUtilHist: hist.nodeUtil.map((h) => [...h]),
  };
}

const fmtClock = (s: number): string => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const fmtTput = (t: number): string =>
  t >= 1000 ? `${(t / 1000).toFixed(1)}k` : `${Math.round(t)}`;

const PRIORITY_TONE: Record<JobPriority, "critical" | "warn" | "info" | "neutral"> = {
  1: "critical",
  2: "warn",
  3: "info",
  4: "neutral",
  5: "neutral",
};

const ALERT_TONE: Record<AlertSeverity, "critical" | "warn" | "info"> = {
  critical: "critical",
  warn: "warn",
  info: "info",
};

const SPEED_OPTIONS = [
  { value: "0.5", label: "0.5×" },
  { value: "1", label: "1×" },
  { value: "4", label: "4×" },
  { value: "16", label: "16×" },
];

const PRIORITY_OPTIONS = [
  { value: "1", label: "P1 — highest" },
  { value: "2", label: "P2 — high" },
  { value: "3", label: "P3 — normal" },
  { value: "4", label: "P4 — low" },
  { value: "5", label: "P5 — batch" },
];

export default function TensorGridDemo(): React.JSX.Element {
  const simRef = useRef<Sim | null>(null);
  if (simRef.current === null) simRef.current = createSim(randomSeed());
  const histRef = useRef<Hist>(emptyHist());
  const alertLogRef = useRef<ClusterAlert[]>([]);
  const tickRef = useRef(0);
  const bgOnRef = useRef(true);

  const [view, setView] = useState<View>(() =>
    buildView(simRef.current as Sim, histRef.current, alertLogRef.current, 0),
  );
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState("1");
  const [bgOn, setBgOn] = useState(true);
  const [selectedNode, setSelectedNode] = useState<number | null>(null);
  const [jobName, setJobName] = useState("");
  const [jobGpus, setJobGpus] = useState(4);
  const [jobPriority, setJobPriority] = useState("2");
  const [jobDuration, setJobDuration] = useState(180);

  useEffect(() => {
    bgOnRef.current = bgOn;
  }, [bgOn]);

  /** Advance the simulation by dt sim-seconds (0 = repaint only) and rebuild the view. */
  const pump = (dt: number): void => {
    const sim = simRef.current as Sim;
    if (dt > 0) {
      if (
        bgOnRef.current &&
        sim.sched.queue().length < MAX_QUEUE_BG &&
        Math.random() < dt * 0.1
      ) {
        sim.sched.submit(randomJobSpec(sim.bgRng, sim.bgCounter++));
      }
      sim.cluster.tick(dt);
      sim.sched.tick(dt);
      const fired = sim.alerts.evaluate(sim.cluster, sim.sched, sim.sched.time);
      if (fired.length > 0) {
        alertLogRef.current = [...fired, ...alertLogRef.current].slice(0, 30);
      }
    }
    tickRef.current += 1;
    setView(buildView(sim, histRef.current, alertLogRef.current, tickRef.current));
  };
  const pumpRef = useRef(pump);
  pumpRef.current = pump;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => pumpRef.current(Number(speed) * 0.5), 500);
    return () => clearInterval(id);
  }, [playing, speed]);

  const refresh = (): void => pumpRef.current(0);

  const resetCluster = (): void => {
    simRef.current = createSim(randomSeed());
    histRef.current = emptyHist();
    alertLogRef.current = [];
    tickRef.current = 0;
    setSelectedNode(null);
    refresh();
  };

  const saturateCluster = (): void => {
    const sim = simRef.current as Sim;
    let n = 0;
    while (sim.cluster.totalGpusFree >= GPUS_PER_NODE && n < NODE_COUNT + 2) {
      sim.sched.submit({
        name: `stress-${Math.floor(sim.sched.time)}-${n}`,
        gpus: GPUS_PER_NODE,
        priority: 2,
        durationSec: 300,
      });
      n++;
    }
    refresh();
  };

  const submitJob = (): void => {
    const sim = simRef.current as Sim;
    const priority = Number(jobPriority) as JobPriority;
    sim.sched.submit({
      name: jobName.trim() === "" ? `train-${Math.floor(sim.sched.time)}` : jobName.trim(),
      gpus: jobGpus,
      priority,
      durationSec: jobDuration,
    });
    setJobName("");
    refresh();
  };

  const cancelJob = (id: string): void => {
    (simRef.current as Sim).sched.cancel(id);
    refresh();
  };

  const node = selectedNode !== null ? view.nodes[selectedNode] : undefined;
  const nodeJobs = node
    ? view.running.filter((j) => j.nodeIds.includes(node.id))
    : [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        title="TensorGrid"
        sub="GPU cluster observability for ML training — live scheduler, thermal model, alerting."
        actions={
          <>
            <Button variant="secondary" onClick={() => setPlaying((p) => !p)}>
              {playing ? "Pause" : "Play"}
            </Button>
            <Button variant="danger" onClick={resetCluster}>
              Reset cluster
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Cluster heatmap</CardTitle>
              <CardDescription>
                Per-GPU utilization across {NODE_COUNT} nodes × {GPUS_PER_NODE} GPUs.
                Click any cell for node detail. Sim time {fmtClock(view.time)}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Heatmap
                data={view.nodes.map((n) => n.gpuUtil)}
                rowLabels={view.nodes.map((n) => n.id)}
                colLabels={view.nodes[0]?.gpuUtil.map((_, i) => `GPU ${i}`) ?? []}
                min={0}
                max={100}
                lowColor="#1e293b"
                highColor="#f59e0b"
                onCellClick={(r) => setSelectedNode(r)}
              />
              <div className="mt-3 flex items-center gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: "#1e293b" }} />
                  idle
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: "#f59e0b" }} />
                  100% util
                </span>
                {selectedNode !== null && (
                  <span className="text-slate-300">
                    selected: <span className="font-medium">{view.nodes[selectedNode]?.id}</span>
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Power &amp; thermals</CardTitle>
              <CardDescription>
                Cluster power draw and average die temperature, last {HIST_CAP} ticks.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LineChart
                series={[
                  { label: "Power (kW)", color: "#38bdf8", data: view.powerHist },
                  { label: "Avg temp (°C)", color: "#fbbf24", data: view.tempHist },
                ]}
                height={220}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Job queue</CardTitle>
              <CardDescription>
                Waiting jobs in scheduling order (priority, then FIFO).{" "}
                {view.queue.length} queued.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {view.queue.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Queue empty — submit a job from the panel on the right.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                        <th className="pb-2 pr-4 font-medium">Job</th>
                        <th className="pb-2 pr-4 font-medium">GPUs</th>
                        <th className="pb-2 pr-4 font-medium">Priority</th>
                        <th className="pb-2 pr-4 font-medium">Wait</th>
                        <th className="pb-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {view.queue.map((j) => (
                        <tr key={j.id} className="border-t border-slate-800 text-slate-300">
                          <td className="py-2 pr-4 font-mono text-xs">{j.name}</td>
                          <td className="py-2 pr-4 tabular-nums">{j.gpus}</td>
                          <td className="py-2 pr-4">
                            <Badge tone={PRIORITY_TONE[j.priority]}>P{j.priority}</Badge>
                          </td>
                          <td className="py-2 pr-4 tabular-nums">{fmtClock(view.time - j.submittedAt)}</td>
                          <td className="py-2 text-right">
                            <Button variant="ghost" size="sm" onClick={() => cancelJob(j.id)}>
                              Cancel
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Running jobs</CardTitle>
              <CardDescription>{view.running.length} jobs training now.</CardDescription>
            </CardHeader>
            <CardContent>
              {view.running.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Nothing running — the queue is empty and no jobs are training.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                        <th className="pb-2 pr-4 font-medium">Job</th>
                        <th className="pb-2 pr-4 font-medium">GPUs</th>
                        <th className="pb-2 pr-4 font-medium">Nodes</th>
                        <th className="pb-2 pr-4 font-medium">Progress</th>
                        <th className="pb-2 pr-4 font-medium">Throughput</th>
                        <th className="pb-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {view.running.map((j) => {
                        const pct = Math.min(
                          100,
                          Math.max(0, (1 - j.remainingSec / j.durationSec) * 100),
                        );
                        return (
                          <tr key={j.id} className="border-t border-slate-800 text-slate-300">
                            <td className="py-2 pr-4 font-mono text-xs">{j.name}</td>
                            <td className="py-2 pr-4 tabular-nums">{j.gpus}</td>
                            <td className="py-2 pr-4 font-mono text-xs text-slate-400">
                              {j.nodeIds.join(", ")}
                            </td>
                            <td className="py-2 pr-4">
                              <div className="flex items-center gap-2">
                                <div className="w-24">
                                  <ProgressBar value={pct} color="#34d399" />
                                </div>
                                <span className="text-xs tabular-nums text-slate-400">
                                  {Math.round(pct)}%
                                </span>
                              </div>
                            </td>
                            <td className="py-2 pr-4 tabular-nums">
                              {fmtTput(j.throughputTokensPerSec ?? 0)} tok/s
                            </td>
                            <td className="py-2 text-right">
                              <Button variant="ghost" size="sm" onClick={() => cancelJob(j.id)}>
                                Cancel
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <StatTile
              label="GPUs allocated"
              value={`${view.usedGpus}/${view.totalGpus}`}
              sub={`${view.allocPct.toFixed(0)}% of cluster`}
            />
            <StatTile
              label="Avg temp"
              value={`${view.avgTemp.toFixed(1)}°C`}
              sub={`peak ${view.maxTemp.toFixed(1)}°C`}
              sparkData={view.tempHist}
              sparkColor="#fbbf24"
            />
            <StatTile
              label="Power draw"
              value={`${view.powerKw.toFixed(1)} kW`}
              sub="cluster total"
              sparkData={view.powerHist}
              sparkColor="#38bdf8"
            />
            <StatTile
              label="Throughput"
              value={`${fmtTput(view.aggTput)} tok/s`}
              sub={`${view.running.length} jobs training`}
              sparkData={view.tputHist}
              sparkColor="#34d399"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Simulation controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select
                label="Speed"
                value={speed}
                onChange={setSpeed}
                options={SPEED_OPTIONS}
              />
              <Toggle
                label="Background workload"
                checked={bgOn}
                onChange={setBgOn}
              />
              <p className="-mt-2 text-xs text-slate-500">
                Synthetic training jobs arrive automatically.
              </p>
              <Button variant="secondary" onClick={saturateCluster} className="w-full">
                Saturate cluster
              </Button>
              <p className="-mt-2 text-xs text-slate-500">
                Fills every node with P2 jobs — watch thermals and queue pressure react.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Submit job</CardTitle>
              <CardDescription>Enqueues into the live scheduler.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="w-full">
                <label htmlFor="tg-job-name" className="mb-1 block text-sm text-slate-300">
                  Job name
                </label>
                <input
                  id="tg-job-name"
                  type="text"
                  value={jobName}
                  onChange={(e) => setJobName(e.target.value)}
                  placeholder="llama-3-70b-sft"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <Slider
                label="GPUs"
                min={1}
                max={view.totalGpus}
                step={1}
                value={jobGpus}
                onChange={setJobGpus}
              />
              <Select
                label="Priority"
                value={jobPriority}
                onChange={setJobPriority}
                options={PRIORITY_OPTIONS}
              />
              <Slider
                label="Duration"
                min={30}
                max={600}
                step={30}
                value={jobDuration}
                onChange={setJobDuration}
                unit="s"
              />
              <Button variant="primary" onClick={submitJob} className="w-full">
                Submit job
              </Button>
            </CardContent>
          </Card>

          {node && selectedNode !== null && (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle>{node.id}</CardTitle>
                    <CardDescription>
                      {node.gpusUsed}/{node.gpusTotal} GPUs allocated
                    </CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedNode(null)}>
                    Close
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-3">
                  <StatTile
                    label="Temperature"
                    value={`${node.tempC.toFixed(1)}°C`}
                    sparkData={view.nodeTempHist[selectedNode]}
                    sparkColor={node.tempC > 85 ? "#f87171" : "#fbbf24"}
                  />
                  <StatTile
                    label="Power"
                    value={`${(node.powerW / 1000).toFixed(1)} kW`}
                    sub={`${Math.round(node.powerW)} W`}
                  />
                  <StatTile
                    label="Utilization"
                    value={`${node.utilPct.toFixed(0)}%`}
                    sparkData={view.nodeUtilHist[selectedNode]}
                    sparkColor="#38bdf8"
                  />
                </div>
                <div>
                  <SectionTitle title="Jobs on this node" />
                  {nodeJobs.length === 0 ? (
                    <p className="text-sm text-slate-500">No jobs running here.</p>
                  ) : (
                    <ul className="space-y-2">
                      {nodeJobs.map((j) => (
                        <li
                          key={j.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
                        >
                          <span className="font-mono text-xs text-slate-300">{j.name}</span>
                          <Badge tone={PRIORITY_TONE[j.priority]}>P{j.priority}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Alerts</CardTitle>
              <CardDescription>
                {view.activeAlerts.length} active · {view.alertLog.length} total fired
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {view.alertLog.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No alerts yet. Saturate the cluster to trigger thermal and queue-pressure alerts.
                </p>
              ) : (
                view.alertLog.slice(0, 6).map((a) => (
                  <Alert key={`${a.key}-${a.t}`} tone={ALERT_TONE[a.severity]} title={a.title}>
                    <span className="font-mono text-xs opacity-70">t={fmtClock(a.t)}</span>
                    {" — "}
                    {a.message}
                  </Alert>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recently completed</CardTitle>
              <CardDescription>
                {view.completed.length} jobs finished this session.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {view.completed.length === 0 ? (
                <p className="text-sm text-slate-500">No completions yet.</p>
              ) : (
                <ul className="space-y-2">
                  {view.completed
                    .slice(-5)
                    .reverse()
                    .map((c) => (
                      <li
                        key={c.jobId}
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-mono text-xs text-slate-300">
                            {c.name}
                          </div>
                          <div className="text-xs text-slate-500">
                            {c.gpus} GPUs · {fmtClock(c.durationSec)} ·{" "}
                            <Badge tone="success">done</Badge>
                          </div>
                        </div>
                        <span className="shrink-0 text-xs tabular-nums text-emerald-300">
                          {fmtTput(c.throughputTokensPerSec)} tok/s
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
