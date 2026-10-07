"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
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
  Toggle,
  cn,
} from "@repo/ui";
import {
  PRICE_CURVE,
  planTrip,
  priceBandAt,
  scheduleCharging,
  scheduleNaive,
  windowSlots,
} from "@repo/volt-core";
import type { Allocation, Vehicle } from "@repo/volt-core";
import { buildFleet } from "./fleet";
import type { MapVehicle } from "./fleet";
import { FleetMap } from "./components/FleetMap";

const PLAY_SPEED_H_PER_S = 1.5;
const DRIVE_DRAIN_PER_H = 0.012;

const BAND_COLORS: Record<string, string> = {
  "off-peak": "#34d399",
  mid: "#3b82f6",
  peak: "#f59e0b",
};

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtHour(h: number): string {
  const hh = Math.floor(h) % 24;
  const mm = Math.floor((h % 1) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function slotOf(hour: number): number {
  return Math.floor((((hour % 24) + 24) % 24 * 4)) % 96;
}

/**
 * Per-vehicle SoC timeline (97 points: slot boundaries 0..96) simulated from
 * the active schedule's real allocations, with a small driving drain while
 * the vehicle is away from the depot.
 */
function buildSocTimelines(
  fleet: MapVehicle[],
  allocations: Allocation[],
): Map<string, number[]> {
  const kwByVehicleSlot = new Map<string, Map<number, number>>();
  for (const a of allocations) {
    let m = kwByVehicleSlot.get(a.vehicleId);
    if (!m) {
      m = new Map();
      kwByVehicleSlot.set(a.vehicleId, m);
    }
    m.set(a.slot, (m.get(a.slot) ?? 0) + a.kw);
  }
  const out = new Map<string, number[]>();
  for (const v of fleet) {
    const inWindow = new Set(windowSlots(v));
    const kw = kwByVehicleSlot.get(v.id) ?? new Map<number, number>();
    const tl: number[] = [v.soc];
    let soc = v.soc;
    for (let s = 0; s < 96; s++) {
      if (inWindow.has(s)) {
        soc += ((kw.get(s) ?? 0) * 0.25) / v.batteryKwh;
      } else {
        soc -= DRIVE_DRAIN_PER_H * 0.25;
      }
      soc = Math.min(1, Math.max(0, soc));
      tl.push(soc);
    }
    out.set(v.id, tl);
  }
  return out;
}

export default function VoltDemoPage() {
  const fleet = useMemo(() => buildFleet(), []);
  const [simHour, setSimHour] = useState(18.5);
  const [playing, setPlaying] = useState(true);
  const [selectedId, setSelectedId] = useState("v1");
  const [optimized, setOptimized] = useState(true);
  const [siteCap, setSiteCap] = useState(120);
  const [tripVehicleId, setTripVehicleId] = useState("v1");
  const [tripDistance, setTripDistance] = useState(120);
  const [tripSpeed, setTripSpeed] = useState(65);
  const [tripElevation, setTripElevation] = useState(1200);

  // Playback loop; pauses while the tab is hidden.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (!document.hidden) {
        setSimHour((h) => (h + dt * PLAY_SPEED_H_PER_S) % 24);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const schedule = useMemo(() => scheduleCharging(fleet, siteCap), [fleet, siteCap]);
  const naive = useMemo(() => scheduleNaive(fleet), [fleet]);
  const active = optimized ? schedule : naive;

  const socTimelines = useMemo(
    () => buildSocTimelines(fleet, active.allocations),
    [fleet, active],
  );
  const socAt = useCallback(
    (id: string, hour: number): number => {
      const tl = socTimelines.get(id);
      if (!tl) return 0;
      return tl[Math.min(96, slotOf(hour))];
    },
    [socTimelines],
  );

  const selected: MapVehicle =
    fleet.find((v) => v.id === selectedId) ?? fleet[0];
  const selectedSummary = schedule.vehicles.find((s) => s.vehicleId === selected.id);
  const selectedCharging = useMemo(
    () => new Set(windowSlots(selected)).has(slotOf(simHour)),
    [selected, simHour],
  );
  const selectedSoc = socAt(selected.id, simHour);
  const selectedRange = Math.round(
    (selectedSoc * selected.batteryKwh) / selected.efficiencyKwhPerMile,
  );

  const barData = useMemo(
    () =>
      active.kwPerSlot.map((kw, slot) => ({
        label: slot % 16 === 0 ? `${String(slot / 4).padStart(2, "0")}:00` : "",
        value: Math.round(kw * 10) / 10,
        color: BAND_COLORS[priceBandAt(slot * 0.25)],
      })),
    [active],
  );

  const tripVehicle: Vehicle =
    fleet.find((v) => v.id === tripVehicleId) ?? fleet[0];
  const tripPlan = useMemo(
    () =>
      planTrip(
        { ...tripVehicle, soc: socAt(tripVehicle.id, simHour) },
        tripDistance,
        tripElevation,
        tripSpeed,
      ),
    [tripVehicle, tripDistance, tripElevation, tripSpeed, simHour, socAt],
  );

  const savingsDelta = {
    direction: (schedule.savings >= 0 ? "up" : "down") as "up" | "down" | "flat",
    value: `${schedule.savingsPct.toFixed(1)}%`,
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <PageHeader
        title="Volt Fleet"
        sub="Fleet operations with cost-optimized smart charging."
        actions={
          <Button
            variant={playing ? "secondary" : "primary"}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? "Pause simulation" : "Play simulation"}
          </Button>
        }
      />

      {/* Time scrub */}
      <Card className="mb-6">
        <CardContent>
          <div className="flex items-center gap-6">
            <div className="flex-1">
              <Slider
                label="Time of day"
                min={0}
                max={24}
                step={0.25}
                value={simHour}
                onChange={setSimHour}
                unit="h"
              />
            </div>
            <div className="shrink-0 text-right">
              <div className="text-2xl font-semibold tabular-nums text-slate-100">
                {fmtHour(simHour)}
              </div>
              <div className="text-xs text-slate-400">simulated time</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Map + vehicle detail */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Live fleet map</CardTitle>
            <CardDescription>
              Eight vehicles running routes across the city. Click a vehicle for
              its live status — green halo means it is charging at the depot.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FleetMap
              vehicles={fleet}
              simHour={simHour}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              {fleet.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedId(v.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    v.id === selectedId
                      ? "border-slate-500 bg-slate-800 text-slate-100"
                      : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-600",
                  )}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: v.color }}
                  />
                  {v.name}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{selected.name}</CardTitle>
              <Badge tone={selectedCharging ? "success" : "info"}>
                {selectedCharging ? "Charging" : "En route"}
              </Badge>
            </div>
            <CardDescription>
              {selected.id.toUpperCase()} · depot van · {selected.chargerKw} kW plug
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-sm text-slate-400">Battery</span>
              <span className="text-lg font-semibold tabular-nums text-slate-100">
                {Math.round(selectedSoc * 100)}%
              </span>
            </div>
            <ProgressBar value={selectedSoc * 100} color={selected.color} />
            <dl className="mt-5 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-400">Capacity</dt>
                <dd className="tabular-nums text-slate-200">{selected.batteryKwh} kWh</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Target at departure</dt>
                <dd className="tabular-nums text-slate-200">
                  {Math.round(selected.requiredSoc * 100)}%
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Est. range now</dt>
                <dd className="tabular-nums text-slate-200">{selectedRange} mi</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Energy scheduled today</dt>
                <dd className="tabular-nums text-slate-200">
                  {(selectedSummary?.energyKwh ?? 0).toFixed(1)} kWh
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Charging cost today</dt>
                <dd className="tabular-nums text-slate-200">
                  {fmtMoney(selectedSummary?.cost ?? 0)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Departs at</dt>
                <dd className="tabular-nums text-slate-200">
                  {fmtHour(selected.departureSlot * 0.25)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* Charging schedule */}
      <div className="mt-6">
        <SectionTitle
          title="Smart charging schedule"
          sub="Greedy cheapest-slot-first optimization against the time-of-use price curve. Move the depot power-cap slider and watch the savings change — every figure is computed live by scheduleCharging()."
        />
        <Card>
          <CardContent>
            <div className="mb-4 flex flex-wrap items-center gap-6">
              <Toggle
                label={optimized ? "Optimized schedule" : "Naive (charge at arrival)"}
                checked={optimized}
                onChange={setOptimized}
              />
              <div className="min-w-64 flex-1">
                <Slider
                  label="Depot power cap"
                  min={40}
                  max={240}
                  step={10}
                  value={siteCap}
                  onChange={setSiteCap}
                  unit="kW"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label={optimized ? "Optimized cost" : "Naive schedule cost"}
                value={fmtMoney(optimized ? schedule.costTotal : naive.costTotal)}
                sub="total energy cost / day"
              />
              <StatTile
                label="Naive baseline cost"
                value={fmtMoney(schedule.costNaive)}
                sub="charge at arrival, no optimization"
              />
              <StatTile
                label="Savings"
                value={fmtMoney(optimized ? schedule.savings : 0)}
                sub={optimized ? "per day vs baseline" : "optimization disabled"}
                delta={optimized ? savingsDelta : undefined}
              />
              <StatTile
                label="Savings"
                value={optimized ? `${schedule.savingsPct.toFixed(1)}%` : "0%"}
                sub="of baseline cost"
              />
            </div>

            {schedule.unmet.length > 0 && (
              <p className="mt-3 text-sm text-amber-300">
                Site cap too tight: {schedule.unmet.length} vehicle
                {schedule.unmet.length === 1 ? "" : "s"} cannot reach target SoC
                before departure ({schedule.unmet.join(", ")}).
              </p>
            )}

            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-medium text-slate-200">
                  Scheduled power per 15-minute slot (kW)
                </h4>
                <div className="flex gap-3 text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-sm bg-emerald-400" /> off-peak $0.12
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-sm bg-blue-500" /> mid $0.24
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-sm bg-amber-500" /> peak $0.48
                  </span>
                </div>
              </div>
              <div className="relative">
                <BarChart data={barData} height={200} />
                <div
                  className="pointer-events-none absolute top-0 bottom-6 w-0.5 bg-white/70"
                  style={{ left: `${(slotOf(simHour) / 96) * 100}%` }}
                  aria-hidden
                />
              </div>
            </div>

            <div className="mt-6">
              <LineChart
                title="Time-of-use price curve ($/kWh)"
                yUnit="$"
                height={180}
                series={[
                  { label: "Price", color: "#f59e0b", data: [...PRICE_CURVE] },
                ]}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Trip planner */}
      <div className="mt-6">
        <SectionTitle
          title="Trip planner"
          sub="Energy feasibility for a trip, computed live by planTrip() using the vehicle's current simulated charge."
        />
        <Card>
          <CardContent>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <Select
                  label="Vehicle"
                  value={tripVehicleId}
                  onChange={setTripVehicleId}
                  options={fleet.map((v) => ({
                    value: v.id,
                    label: `${v.name} — ${Math.round(socAt(v.id, simHour) * 100)}% battery`,
                  }))}
                />
                <Slider
                  label="Distance"
                  min={10}
                  max={400}
                  step={5}
                  value={tripDistance}
                  onChange={setTripDistance}
                  unit="mi"
                />
                <Slider
                  label="Average speed"
                  min={25}
                  max={85}
                  step={1}
                  value={tripSpeed}
                  onChange={setTripSpeed}
                  unit="mph"
                />
                <Slider
                  label="Elevation gain"
                  min={0}
                  max={5000}
                  step={100}
                  value={tripElevation}
                  onChange={setTripElevation}
                  unit="ft"
                />
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-medium text-slate-200">Verdict</h4>
                  <Badge tone={tripPlan.feasible ? "success" : "critical"}>
                    {tripPlan.feasible ? "Feasible" : "Not feasible"}
                  </Badge>
                </div>
                <dl className="space-y-2.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-400">Trip energy</dt>
                    <dd className="tabular-nums text-slate-200">
                      {tripPlan.energyKwh.toFixed(1)} kWh
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-400">Arrival battery</dt>
                    <dd className="tabular-nums text-slate-200">
                      {Math.round(tripPlan.arrivalSoc * 100)}%
                    </dd>
                  </div>
                  {!tripPlan.feasible && (
                    <div className="flex justify-between">
                      <dt className="text-slate-400">Energy shortfall</dt>
                      <dd className="tabular-nums text-red-300">
                        {tripPlan.deficitKwh.toFixed(1)} kWh
                      </dd>
                    </div>
                  )}
                </dl>
                <p className="mt-4 text-sm leading-relaxed text-slate-300">
                  {tripPlan.recommendation}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
