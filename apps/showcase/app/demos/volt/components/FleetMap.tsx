"use client";

import { useMemo } from "react";
import { windowSlots } from "@repo/volt-core";
import type { MapVehicle } from "../fleet";

const W = 640;
const H = 400;
const DEPOT: [number, number] = [320, 200];

function windows(vehicles: MapVehicle[]): Map<string, Set<number>> {
  return new Map(vehicles.map((v) => [v.id, new Set(windowSlots(v))]));
}

function slotOf(hour: number): number {
  return Math.floor((((hour % 24) + 24) % 24 * 4)) % 96;
}

function routeLength(route: [number, number][]): number {
  let total = 0;
  for (let i = 0; i < route.length; i++) {
    const [x1, y1] = route[i];
    const [x2, y2] = route[(i + 1) % route.length];
    total += Math.hypot(x2 - x1, y2 - y1);
  }
  return total;
}

function pointOnRoute(route: [number, number][], phase: number): [number, number] {
  const total = routeLength(route);
  let target = ((phase % 1) + 1) % 1 * total;
  for (let i = 0; i < route.length; i++) {
    const [x1, y1] = route[i];
    const [x2, y2] = route[(i + 1) % route.length];
    const seg = Math.hypot(x2 - x1, y2 - y1);
    if (target <= seg || i === route.length - 1) {
      const t = seg === 0 ? 0 : target / seg;
      return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
    }
    target -= seg;
  }
  return route[0];
}

export interface VehicleMapState {
  x: number;
  y: number;
  charging: boolean;
}

export function vehicleMapState(v: MapVehicle, slotSet: Set<number>, simHour: number): VehicleMapState {
  const slot = slotOf(simHour);
  if (slotSet.has(slot)) {
    // Parked at the depot.
    const idx = Number(v.id.slice(1)) - 1;
    return {
      x: DEPOT[0] + ((idx % 4) - 1.5) * 26,
      y: DEPOT[1] + (Math.floor(idx / 4) - 0.5) * 30,
      charging: true,
    };
  }
  const depHour = v.departureSlot * 0.25;
  const hoursAway = 24 - slotSet.size * 0.25;
  const sinceDep = ((((simHour - depHour) % 24) + 24) % 24) % Math.max(hoursAway, 0.25);
  const phase = hoursAway > 0 ? sinceDep / hoursAway : 0;
  const [x, y] = pointOnRoute(v.route, phase);
  return { x, y, charging: false };
}

interface FleetMapProps {
  vehicles: MapVehicle[];
  simHour: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function FleetMap({ vehicles, simHour, selectedId, onSelect }: FleetMapProps) {
  const slotSets = useMemo(() => windows(vehicles), [vehicles]);
  const states = useMemo(
    () =>
      new Map(
        vehicles.map((v) => [v.id, vehicleMapState(v, slotSets.get(v.id) ?? new Set(), simHour)]),
      ),
    [vehicles, slotSets, simHour],
  );

  const streets = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let x = 0; x <= W; x += 64) lines.push({ x1: x, y1: 0, x2: x, y2: H });
    for (let y = 0; y <= H; y += 64) lines.push({ x1: 0, y1: y, x2: W, y2: y });
    return lines;
  }, []);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full select-none rounded-xl"
      role="img"
      aria-label="Stylized city map with fleet vehicles"
    >
      <rect x={0} y={0} width={W} height={H} fill="#0b111c" />
      {/* diagonal avenue */}
      <line x1={-20} y1={H + 20} x2={W + 20} y2={-20} stroke="#16202f" strokeWidth={14} />
      {/* street grid */}
      {streets.map((l, i) => (
        <line
          key={i}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke="#182234"
          strokeWidth={9}
        />
      ))}
      {streets.map((l, i) => (
        <line
          key={`c${i}`}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke="#2b3b55"
          strokeWidth={1}
          strokeDasharray="8 8"
        />
      ))}

      {/* depot */}
      <rect x={DEPOT[0] - 34} y={DEPOT[1] - 34} width={68} height={68} rx={12} fill="#0d2b1f" stroke="#34d399" strokeWidth={2} />
      <polygon points="326,178 310,202 321,202 314,224 332,198 321,198" fill="#34d399" />
      <text x={DEPOT[0]} y={DEPOT[1] + 52} textAnchor="middle" fill="#6ee7b7" fontSize={11} fontWeight={600}>
        DEPOT
      </text>

      {/* vehicles */}
      {vehicles.map((v) => {
        const s = states.get(v.id);
        if (!s) return null;
        const selected = v.id === selectedId;
        return (
          <g
            key={v.id}
            onClick={() => onSelect(v.id)}
            style={{ cursor: "pointer" }}
            role="button"
            aria-label={`Select ${v.name}`}
          >
            {s.charging && (
              <circle cx={s.x} cy={s.y} r={13} fill="none" stroke="#34d399" strokeWidth={1.5} opacity={0.6}>
                <animate attributeName="r" values="10;15;10" dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.7;0.15;0.7" dur="2s" repeatCount="indefinite" />
              </circle>
            )}
            {selected && <circle cx={s.x} cy={s.y} r={12} fill="none" stroke="#fff" strokeWidth={2} />}
            <circle cx={s.x} cy={s.y} r={7} fill={v.color} stroke="#0a0e14" strokeWidth={2} />
            <text x={s.x + 11} y={s.y + 4} fill="#94a3b8" fontSize={10} fontWeight={500}>
              {v.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
