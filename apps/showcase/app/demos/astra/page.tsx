"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  LineChart,
  PageHeader,
  SectionTitle,
  Select,
  Slider,
  StatTile,
} from "@repo/ui";
import {
  Flight,
  ASTRA_DEMO_CONFIG,
  type AnomalyKind,
  type FlightEventType,
} from "@repo/astra-core";

const SPEEDS = [
  { value: "1", label: "1× real time" },
  { value: "4", label: "4×" },
  { value: "16", label: "16×" },
];

const ANOMALY_OPTIONS: { value: AnomalyKind; label: string }[] = [
  { value: "engine-underperform", label: "Engine underperformance (thrust × 0.75)" },
  { value: "fuel-leak", label: "Fuel leak (mass flow × 1.6)" },
  { value: "sensor-noise", label: "Sensor noise (reported telemetry only)" },
];

const EVENT_TONE: Record<FlightEventType, "info" | "warn" | "success" | "neutral"> = {
  LIFTOFF: "info",
  MAXQ: "warn",
  MECO: "info",
  STAGE_SEP: "neutral",
  SECOND_IGNITION: "success",
  SECO: "success",
};

function fmtClock(t: number): string {
  const mm = Math.floor(t / 60).toString().padStart(2, "0");
  const ss = Math.floor(t % 60).toString().padStart(2, "0");
  const tenths = Math.floor((t % 1) * 10);
  return `T+${mm}:${ss}.${tenths}`;
}

/** Downsample a series to at most `max` points, keeping the endpoints. */
function downsample(data: number[], max: number): number[] {
  if (data.length <= max) return data;
  const stride = Math.ceil(data.length / max);
  const out: number[] = [];
  for (let i = 0; i < data.length; i += stride) out.push(data[i]);
  const last = data[data.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export default function AstraDemoPage(): ReactElement {
  const flightRef = useRef<Flight | null>(null);
  if (!flightRef.current) {
    flightRef.current = new Flight(ASTRA_DEMO_CONFIG);
  }
  const flight = flightRef.current;
  const missionDuration = useMemo(() => flight.getMissionDuration(), [flight]);

  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState("4");
  const [now, setNow] = useState(0);
  const [anomaly, setAnomaly] = useState<AnomalyKind>("engine-underperform");
  const [injected, setInjected] = useState<AnomalyKind[]>([]);

  // Drive the engine on a fixed wall-clock interval.
  useEffect(() => {
    const id = setInterval(() => {
      if (!playing) return;
      const sample = flight.tick(parseFloat(speed) * 0.1);
      setNow(sample.t);
    }, 100);
    return () => clearInterval(id);
  }, [playing, speed, flight]);

  const samples = flight.getSamples();
  const events = flight.getEvents();
  const alerts = flight.getAlerts();
  const latest = samples[samples.length - 1];

  const altKm = useMemo(
    () => downsample(samples.map((s) => s.altitudeM / 1000), 600),
    [samples],
  );
  const velMs = useMemo(
    () => downsample(samples.map((s) => s.velocityMs), 600),
    [samples],
  );
  const qKpa = useMemo(() => downsample(samples.map((s) => s.qKpa), 600), [samples]);
  const fuel1 = useMemo(
    () => downsample(samples.map((s) => s.fuelStage1Frac * 100), 600),
    [samples],
  );
  const fuel2 = useMemo(
    () => downsample(samples.map((s) => s.fuelStage2Frac * 100), 600),
    [samples],
  );

  const phaseLabel = useMemo(() => {
    const types = new Set(events.map((e) => e.type));
    if (types.has("SECO")) return "POST-SECO COAST";
    if (types.has("SECOND_IGNITION")) return "STAGE 2 BURN";
    if (types.has("MECO")) return "STAGING";
    return "STAGE 1 BURN";
  }, [events]);

  const missionComplete = now >= missionDuration - 1e-6;
  const anomalyInjected = injected.includes(anomaly);

  const handleScrub = (v: number): void => {
    flight.scrubTo(v);
    setNow(flight.getTrueState().t);
  };

  const handleInject = (): void => {
    if (anomalyInjected) return;
    flight.injectAnomaly(anomaly);
    setInjected((prev) => [...prev, anomaly]);
    setNow(flight.getTrueState().t);
  };

  const handleReset = (): void => {
    flight.reset();
    setInjected([]);
    setNow(0);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <PageHeader
        title="Astra Telemetry"
        sub="Live mission-control simulation — physics engine, event detection, anomaly injection."
        actions={
          <>
            <Badge tone={missionComplete ? "success" : "info"}>
              {missionComplete ? "MISSION COMPLETE" : phaseLabel}
            </Badge>
            <span className="font-mono text-sm tabular-nums text-slate-200">
              {fmtClock(now)}
            </span>
          </>
        }
      />

      {/* Controls */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Flight controls</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="flex items-end gap-2">
              <Button
                variant={playing ? "secondary" : "primary"}
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? "Pause" : "Play"}
              </Button>
              <Button variant="ghost" onClick={handleReset}>
                Reset
              </Button>
            </div>
            <Select
              label="Time warp"
              value={speed}
              onChange={setSpeed}
              options={SPEEDS}
            />
            <Select
              label="Anomaly"
              value={anomaly}
              onChange={(v) => setAnomaly(v as AnomalyKind)}
              options={ANOMALY_OPTIONS}
            />
            <div className="flex items-end">
              <Button
                variant="danger"
                onClick={handleInject}
                disabled={anomalyInjected}
              >
                {anomalyInjected ? "Anomaly active" : "Inject anomaly"}
              </Button>
            </div>
          </div>
          <Slider
            label="Mission time scrub"
            min={0}
            max={Math.round(missionDuration)}
            step={1}
            value={Math.round(now)}
            onChange={handleScrub}
            unit="s"
          />
        </CardContent>
      </Card>

      {/* Live stats */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Altitude"
          value={`${((latest?.altitudeM ?? 0) / 1000).toFixed(2)} km`}
          sub={`Stage ${latest?.stage ?? 1} · throttle ${Math.round((latest?.throttle ?? 1) * 100)}%`}
          sparkData={downsample(altKm, 120)}
          sparkColor="#22d3ee"
        />
        <StatTile
          label="Velocity"
          value={`${(latest?.velocityMs ?? 0).toFixed(0)} m/s`}
          sub="Inertial, vertical component"
          sparkData={downsample(velMs, 120)}
          sparkColor="#a78bfa"
        />
        <StatTile
          label="Dynamic pressure"
          value={`${(latest?.qKpa ?? 0).toFixed(2)} kPa`}
          sub="Max-Q is auto-detected on decline"
          sparkData={downsample(qKpa, 120)}
          sparkColor="#fbbf24"
        />
        <StatTile
          label="Stage 1 fuel"
          value={`${((latest?.fuelStage1Frac ?? 1) * 100).toFixed(1)}%`}
          sub={`Stage 2: ${((latest?.fuelStage2Frac ?? 1) * 100).toFixed(1)}%`}
          sparkData={downsample(fuel1, 120)}
          sparkColor="#34d399"
        />
      </div>

      {/* Charts */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Trajectory</CardTitle>
          </CardHeader>
          <CardContent>
            <LineChart
              title="Altitude & velocity"
              height={260}
              series={[
                { label: "Altitude (km)", color: "#22d3ee", data: altKm },
                { label: "Velocity (m/s)", color: "#a78bfa", data: velMs },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Aerodynamics & propellant</CardTitle>
          </CardHeader>
          <CardContent>
            <LineChart
              title="Dynamic pressure & fuel"
              height={260}
              series={[
                { label: "Dyn. pressure (kPa)", color: "#fbbf24", data: qKpa },
                { label: "Stage 1 fuel (%)", color: "#34d399", data: fuel1 },
                { label: "Stage 2 fuel (%)", color: "#60a5fa", data: fuel2 },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      {/* Timeline + alerts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Mission event timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="text-sm text-slate-400">
                Awaiting liftoff — press Play to start the mission.
              </p>
            ) : (
              <ol className="space-y-2">
                {[...events].reverse().map((e, i) => (
                  <li
                    key={`${e.type}-${i}`}
                    className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
                  >
                    <span className="w-20 shrink-0 font-mono text-xs tabular-nums text-slate-400">
                      {fmtClock(e.t)}
                    </span>
                    <Badge tone={EVENT_TONE[e.type]}>{e.type}</Badge>
                    <span className="text-sm text-slate-200">{e.message}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
        <div>
          <SectionTitle
            title="Alert feed"
            sub="Engine events and anomaly injections, latest first."
          />
          <div className="space-y-2">
            {alerts.length === 0 ? (
              <p className="text-sm text-slate-400">No alerts yet.</p>
            ) : (
              [...alerts].reverse().map((a, i) => (
                <Alert key={i} tone={a.severity} title={fmtClock(a.t)}>
                  {a.message}
                </Alert>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
