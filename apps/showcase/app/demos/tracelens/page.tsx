"use client";

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import {
  Alert,
  Badge,
  BarChart,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  LineChart,
  PageHeader,
  ProgressBar,
  SectionTitle,
  Select,
  Slider,
  StatTile,
  Tabs,
  Toggle,
} from "@repo/ui";
import {
  AlertEngine,
  ErrorBudget,
  LoadGen,
  RollingStats,
  makeRuleId,
  makeTrace,
} from "@repo/tracelens-core";
import type {
  AlertMetric,
  AlertRule,
  FiredAlert,
  MockEndpoint,
  Sample,
  Trace,
} from "@repo/tracelens-core";
import { TraceWaterfall } from "./components/TraceWaterfall";

const ENDPOINTS: MockEndpoint[] = [
  { name: "GET /api/search", baseLatencyMs: 45, jitterMs: 18, errorRate: 0.002 },
  { name: "POST /api/checkout", baseLatencyMs: 120, jitterMs: 60, errorRate: 0.005 },
  { name: "GET /api/users/:id", baseLatencyMs: 22, jitterMs: 8, errorRate: 0.001 },
  { name: "POST /api/embeddings", baseLatencyMs: 900, jitterMs: 300, errorRate: 0.01 },
  { name: "GET /api/feed", baseLatencyMs: 60, jitterMs: 25, errorRate: 0.003 },
];

const BASE_LOOKUP = new Map(ENDPOINTS.map((e) => [e.name, e.baseLatencyMs]));
const WINDOW_SEC = 30;
const HIST_LEN = 48;
const SPEEDS = [
  { value: "0.5", label: "0.5×" },
  { value: "1", label: "1×" },
  { value: "2", label: "2×" },
  { value: "4", label: "4×" },
];
const METRIC_OPTIONS = [
  { value: "p99", label: "p99 latency" },
  { value: "errorRate", label: "Error rate" },
  { value: "burnRate", label: "Burn rate" },
];
const ENDPOINT_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#f472b6"];

function shortName(name: string): string {
  return name.replace(/^(GET|POST|PUT|DELETE) \/api\//, "");
}

function fmtMs(v: number): string {
  return v >= 100 ? v.toFixed(0) : v.toFixed(1);
}

function statusBadge(status: Sample["status"]): JSX.Element {
  if (status === 200) return <Badge tone="success">200</Badge>;
  if (status === 429) return <Badge tone="warn">429</Badge>;
  return <Badge tone="critical">500</Badge>;
}

function metricLabel(metric: AlertMetric): string {
  return metric === "p99" ? "p99 latency" : metric === "errorRate" ? "error rate" : "burn rate";
}

function formatThreshold(metric: AlertMetric, v: number): string {
  if (metric === "p99") return `${v}ms`;
  if (metric === "errorRate") return `${(v * 100).toFixed(2)}%`;
  return `${v}×`;
}

function defaultRules(): AlertRule[] {
  return [
    {
      id: "rule-error-spike",
      name: "Error rate spike",
      metric: "errorRate",
      threshold: 0.01,
      windowSec: 30,
    },
    {
      id: "rule-embeddings-p99",
      name: "Embeddings p99",
      metric: "p99",
      endpoint: "POST /api/embeddings",
      threshold: 1200,
      windowSec: 30,
    },
  ];
}

interface Engine {
  gen: LoadGen;
  stats: RollingStats;
  budget: ErrorBudget;
  alerts: AlertEngine;
}

function createEngine(): Engine {
  return {
    gen: new LoadGen(ENDPOINTS, 42),
    stats: new RollingStats(WINDOW_SEC),
    budget: new ErrorBudget(0.999, WINDOW_SEC),
    alerts: new AlertEngine(30),
  };
}

interface DashState {
  hasData: boolean;
  simTime: number;
  throughput: number;
  errPct: number;
  p50: number;
  p95: number;
  p99: number;
  budgetRemaining: number;
  burnRate: number;
  breaching: boolean;
  bars: { label: string; value: number; color?: string }[];
}

const EMPTY_DASH: DashState = {
  hasData: false,
  simTime: 0,
  throughput: 0,
  errPct: 0,
  p50: 0,
  p95: 0,
  p99: 0,
  budgetRemaining: 100,
  burnRate: 0,
  breaching: false,
  bars: [],
};

export default function TraceLensPage(): JSX.Element {
  const [playing, setPlaying] = useState(true);
  const [rps, setRps] = useState(300);
  const [chaos, setChaos] = useState(false);
  const [speed, setSpeed] = useState("1");
  const [filter, setFilter] = useState("all");

  const [dash, setDash] = useState<DashState>(EMPTY_DASH);
  const [hist, setHist] = useState<{ p50: number[]; p95: number[]; p99: number[]; err: number[]; rps: number[] }>({
    p50: [],
    p95: [],
    p99: [],
    err: [],
    rps: [],
  });
  const [slow, setSlow] = useState<Sample[]>([]);
  const [fired, setFired] = useState<FiredAlert[]>([]);
  const [rules, setRules] = useState<AlertRule[]>(defaultRules);
  const [selectedTrace, setSelectedTrace] = useState<Trace | null>(null);

  // New-rule form state.
  const [ruleName, setRuleName] = useState("");
  const [ruleMetric, setRuleMetric] = useState("p99");
  const [ruleEndpoint, setRuleEndpoint] = useState("all");
  const [ruleThreshold, setRuleThreshold] = useState("");
  const [ruleWindow, setRuleWindow] = useState(30);

  const engRef = useRef<Engine | null>(null);
  const cfgRef = useRef({ rps, chaos, speed, filter, rules });
  const slowBufRef = useRef<Sample[]>([]);
  const intervalHistRef = useRef<{ total: number; errors: number }[]>([]);
  const traceCacheRef = useRef(new Map<string, Trace>());

  if (engRef.current === null) engRef.current = createEngine();
  cfgRef.current = { rps, chaos, speed, filter, rules };

  useEffect(() => {
    if (!playing) return;
    const tick = (): void => {
      const eng = engRef.current;
      if (!eng) return;
      const cfg = cfgRef.current;
      const dt = 0.5 * parseFloat(cfg.speed);
      const samples = eng.gen.tick(dt, cfg.rps, cfg.chaos ? 10 : 1);
      eng.stats.push(samples);

      const buf = slowBufRef.current;
      buf.push(...samples);
      if (buf.length > 400) buf.splice(0, buf.length - 400);
      setSlow([...buf].sort((a, b) => b.latencyMs - a.latencyMs).slice(0, 8));

      const snap = eng.stats.snapshot();
      const scoped =
        cfg.filter === "all" ? eng.stats.overall() : (snap.get(cfg.filter) ?? null);
      const overall = eng.stats.overall();
      const total = overall?.count ?? 0;
      const errors = overall ? Math.round(total * overall.errorRate) : 0;
      const bstate = eng.budget.consume(total, errors);

      const firedNow = eng.alerts.evaluate(cfg.rules, eng.stats, bstate.burnRate, eng.gen.now());
      if (firedNow.length > 0) {
        setFired((prev) => [...firedNow, ...prev].slice(0, 30));
      }

      intervalHistRef.current.push({
        total: samples.length,
        errors: samples.filter((s) => s.status !== 200).length,
      });
      if (intervalHistRef.current.length > HIST_LEN) {
        intervalHistRef.current.splice(0, intervalHistRef.current.length - HIST_LEN);
      }

      setHist((prev) => {
        const push = (arr: number[], v: number): number[] => [...arr, v].slice(-HIST_LEN);
        return {
          p50: push(prev.p50, scoped?.p50 ?? 0),
          p95: push(prev.p95, scoped?.p95 ?? 0),
          p99: push(prev.p99, scoped?.p99 ?? 0),
          err: push(prev.err, (scoped?.errorRate ?? 0) * 100),
          rps: push(prev.rps, overall?.throughputRps ?? 0),
        };
      });

      setDash({
        hasData: total > 0,
        simTime: eng.gen.now(),
        throughput: overall?.throughputRps ?? 0,
        errPct: (scoped?.errorRate ?? 0) * 100,
        p50: scoped?.p50 ?? 0,
        p95: scoped?.p95 ?? 0,
        p99: scoped?.p99 ?? 0,
        budgetRemaining: bstate.budgetPctRemaining,
        burnRate: bstate.burnRate,
        breaching: bstate.isBreaching,
        bars: ENDPOINTS.map((e, i) => ({
          label: shortName(e.name),
          value: Math.round((snap.get(e.name)?.p99 ?? 0) * 10) / 10,
          color: ENDPOINT_COLORS[i % ENDPOINT_COLORS.length],
        })),
      });
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [playing]);

  const reset = (): void => {
    engRef.current = createEngine();
    slowBufRef.current = [];
    intervalHistRef.current = [];
    traceCacheRef.current = new Map();
    setDash(EMPTY_DASH);
    setHist({ p50: [], p95: [], p99: [], err: [], rps: [] });
    setSlow([]);
    setFired([]);
    setSelectedTrace(null);
  };

  const selectSample = (s: Sample): void => {
    const cache = traceCacheRef.current;
    let t = cache.get(s.traceId);
    if (!t) {
      t = makeTrace(s, { baseLatencyMs: BASE_LOOKUP.get(s.endpoint) ?? 100 });
      cache.set(s.traceId, t);
    }
    setSelectedTrace(t);
  };

  const addRule = (): void => {
    const threshold = parseFloat(ruleThreshold);
    if (ruleName.trim() === "" || !Number.isFinite(threshold) || threshold <= 0) return;
    const metric = ruleMetric as AlertMetric;
    const rule: AlertRule = {
      id: makeRuleId(),
      name: ruleName.trim(),
      metric,
      endpoint: ruleEndpoint === "all" ? undefined : ruleEndpoint,
      threshold,
      windowSec: ruleWindow,
    };
    setRules((prev) => [...prev, rule]);
    setRuleName("");
    setRuleThreshold("");
  };

  const deleteRule = (id: string): void => {
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  const burnSeries: number[] = (() => {
    const eng = engRef.current;
    if (!eng || intervalHistRef.current.length === 0) return [];
    return eng.budget.burnDown(intervalHistRef.current, cfgRef.current.rps * WINDOW_SEC);
  })();

  const tabs = useMemo(
    () => [
      { id: "all", label: "All endpoints" },
      ...ENDPOINTS.map((e) => ({ id: e.name, label: shortName(e.name) })),
    ],
    [],
  );

  const thresholdUnit =
    ruleMetric === "p99" ? "ms" : ruleMetric === "errorRate" ? "fraction 0–1" : "×";

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        title="TraceLens"
        sub="API observability — synthetic load, streaming percentiles, error budgets, tracing."
        actions={
          <div className="flex gap-2">
            <Button variant={playing ? "secondary" : "primary"} onClick={() => setPlaying((p) => !p)}>
              {playing ? "Pause" : "Play"}
            </Button>
            <Button variant="ghost" onClick={reset}>
              Reset
            </Button>
          </div>
        }
      />

      <SectionTitle title="Load controls" sub="Every control drives the live simulation." />
      <Card className="mb-8">
        <CardContent>
          <div className="grid gap-6 pt-4 md:grid-cols-2 lg:grid-cols-4">
            <Slider label="Request rate" min={10} max={2000} step={10} value={rps} onChange={setRps} unit="rps" />
            <div className="flex items-end pb-1">
              <Toggle label="Chaos: 10× errors" checked={chaos} onChange={setChaos} />
            </div>
            <Select label="Sim speed" value={speed} onChange={setSpeed} options={SPEEDS} />
            <div className="flex items-end pb-1 text-xs text-slate-400">
              <span className="font-mono">T+{dash.simTime.toFixed(1)}s · {WINDOW_SEC}s window</span>
            </div>
          </div>
          <div className="mt-4">
            <Tabs tabs={tabs} active={filter} onChange={setFilter} />
          </div>
        </CardContent>
      </Card>

      <SectionTitle
        title="Live service health"
        sub={filter === "all" ? "Across all endpoints" : `Endpoint: ${filter}`}
      />
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatTile
          label="Throughput"
          value={dash.hasData ? `${dash.throughput.toFixed(0)} rps` : "—"}
          sub="requests / second"
          sparkData={hist.rps}
          sparkColor="#38bdf8"
        />
        <StatTile
          label="Error rate"
          value={dash.hasData ? `${dash.errPct.toFixed(2)}%` : "—"}
          sub="non-2xx responses"
          delta={
            dash.hasData
              ? {
                  value: chaos ? "chaos injected" : "nominal",
                  direction: chaos ? "up" : "flat",
                }
              : undefined
          }
        />
        <StatTile label="p50 latency" value={dash.hasData ? `${fmtMs(dash.p50)}ms` : "—"} sub="median" />
        <StatTile label="p95 latency" value={dash.hasData ? `${fmtMs(dash.p95)}ms` : "—"} sub="95th percentile" />
        <StatTile label="p99 latency" value={dash.hasData ? `${fmtMs(dash.p99)}ms` : "—"} sub="99th percentile" />
      </div>

      <SectionTitle title="Latency" />
      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Percentiles over time</CardTitle>
            <CardDescription>Rolling-window p50 / p95 / p99, sampled every 500ms.</CardDescription>
          </CardHeader>
          <CardContent>
            <LineChart
              series={[
                { label: "p50", color: "#34d399", data: hist.p50 },
                { label: "p95", color: "#fbbf24", data: hist.p95 },
                { label: "p99", color: "#f87171", data: hist.p99 },
              ]}
              yUnit="ms"
              height={240}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>p99 by endpoint</CardTitle>
            <CardDescription>Tail latency comparison across the fleet.</CardDescription>
          </CardHeader>
          <CardContent>
            <BarChart data={dash.bars} height={240} />
          </CardContent>
        </Card>
      </div>

      <SectionTitle title="Error budget" sub="99.9% success SLO over a 30s rolling window." />
      <Card className="mb-8">
        <CardContent>
          <div className="grid gap-6 pt-4 lg:grid-cols-3">
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-sm text-slate-400">Budget remaining</span>
                <span className="font-mono text-sm text-slate-200">
                  {dash.budgetRemaining.toFixed(1)}%
                </span>
              </div>
              <ProgressBar
                value={dash.budgetRemaining}
                color={dash.breaching ? "#f87171" : dash.budgetRemaining < 25 ? "#fbbf24" : "#34d399"}
              />
              <div className="mt-4">
                <StatTile
                  label="Burn rate"
                  value={dash.hasData ? `${dash.burnRate.toFixed(2)}×` : "—"}
                  sub="1.0× = spending at SLO pace"
                />
              </div>
            </div>
            <div className="lg:col-span-2">
              <div className="mb-2 text-sm text-slate-400">Budget burn-down</div>
              <LineChart
                series={[{ label: "remaining %", color: "#34d399", data: burnSeries }]}
                yUnit="%"
                height={180}
              />
            </div>
          </div>
          {dash.breaching && (
            <div className="mt-4">
              <Alert tone="critical" title="SLO breach">
                Burn rate is {dash.burnRate.toFixed(2)}× — errors are consuming the budget faster
                than the 99.9% SLO allows. Toggle chaos off or add capacity.
              </Alert>
            </div>
          )}
        </CardContent>
      </Card>

      <SectionTitle title="Traces" sub="Slowest recent requests — click one for the span waterfall." />
      <Card className="mb-4">
        <CardContent>
          <div className="divide-y divide-slate-800/60">
            {slow.length === 0 && (
              <div className="py-6 text-center text-sm text-slate-500">
                {playing ? "Collecting samples…" : "Paused — press Play to generate traffic."}
              </div>
            )}
            {slow.map((s) => (
              <button
                key={s.traceId}
                onClick={() => selectSample(s)}
                className={`flex w-full items-center gap-3 px-2 py-2 text-left transition-colors hover:bg-slate-800/40 ${
                  selectedTrace?.traceId === s.traceId ? "bg-slate-800/60" : ""
                }`}
              >
                <span className="w-44 shrink-0 truncate font-mono text-xs text-slate-300">
                  {s.endpoint}
                </span>
                {statusBadge(s.status)}
                <span className="font-mono text-xs text-slate-400">
                  {s.latencyMs.toFixed(1)}ms
                </span>
                <span className="ml-auto hidden font-mono text-[11px] text-slate-600 sm:block">
                  {s.traceId}
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
      {selectedTrace && (
        <div className="mb-8">
          <TraceWaterfall trace={selectedTrace} />
        </div>
      )}

      <SectionTitle title="Alert rules" sub="Rules evaluate against live stats every tick." />
      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>New rule</CardTitle>
            <CardDescription>Registered immediately and evaluated on the next tick.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <label className="block">
                <span className="mb-1 block text-xs text-slate-400">Rule name</span>
                <input
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="e.g. Checkout tail latency"
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
                />
              </label>
              <div className="grid grid-cols-2 gap-4">
                <Select label="Metric" value={ruleMetric} onChange={setRuleMetric} options={METRIC_OPTIONS} />
                <Select
                  label="Endpoint"
                  value={ruleEndpoint}
                  onChange={setRuleEndpoint}
                  options={[
                    { value: "all", label: "All endpoints" },
                    ...ENDPOINTS.map((e) => ({ value: e.name, label: shortName(e.name) })),
                  ]}
                />
              </div>
              <div className="grid grid-cols-2 items-end gap-4">
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-400">
                    Threshold ({thresholdUnit})
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={ruleThreshold}
                    onChange={(e) => setRuleThreshold(e.target.value)}
                    placeholder={ruleMetric === "p99" ? "500" : ruleMetric === "errorRate" ? "0.02" : "2"}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
                  />
                </label>
                <Slider label="Window" min={5} max={120} step={5} value={ruleWindow} onChange={setRuleWindow} unit="s" />
              </div>
              <div>
                <Button variant="primary" onClick={addRule}>
                  Add rule
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Active rules ({rules.length})</CardTitle>
            <CardDescription>30s cooldown per rule prevents alert spam.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {rules.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-200">{r.name}</div>
                    <div className="truncate font-mono text-[11px] text-slate-500">
                      {metricLabel(r.metric)} &gt; {formatThreshold(r.metric, r.threshold)} ·{" "}
                      {r.endpoint ? shortName(r.endpoint) : "all"} · {r.windowSec}s
                    </div>
                  </div>
                  <Button variant="danger" size="sm" onClick={() => deleteRule(r.id)}>
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <SectionTitle title="Alert feed" sub="Newest first." />
      <div className="grid gap-2 pb-8">
        {fired.length === 0 && (
          <Card>
            <CardContent>
              <div className="py-4 text-center text-sm text-slate-500">
                No alerts yet. Flip on <span className="text-slate-300">Chaos: 10× errors</span> and
                the error-rate rule will fire for real.
              </div>
            </CardContent>
          </Card>
        )}
        {fired.map((a, i) => (
          <Alert key={`${a.ruleId}-${a.t}-${i}`} tone={a.severity === "critical" ? "critical" : "warn"} title={a.ruleName}>
            {a.message} <span className="font-mono text-[11px] opacity-70">· T+{a.t.toFixed(1)}s</span>
          </Alert>
        ))}
      </div>
    </div>
  );
}
