import { Vehicle, mulberry32 } from "@repo/volt-core";

export interface MapVehicle extends Vehicle {
  /** Closed loop of map waypoints [x, y] in a 640x400 viewBox. */
  route: [number, number][];
  color: string;
}

const NAMES = ["Atlas", "Bolt", "Comet", "Dynamo", "Ember", "Flux", "Glide", "Helio"];
const COLORS = ["#38bdf8", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#fb7185", "#4ade80", "#f97316"];

const LOOPS: [number, number][][] = [
  [[64, 64], [576, 64], [576, 336], [64, 336]],
  [[128, 128], [512, 128], [512, 272], [128, 272]],
  [[64, 200], [320, 64], [576, 200], [320, 336]],
  [[192, 64], [192, 336], [448, 336], [448, 64]],
  [[64, 128], [576, 128], [576, 272], [64, 272]],
  [[320, 64], [576, 200], [320, 336], [64, 200]],
  [[64, 64], [320, 64], [320, 336], [64, 336]],
  [[320, 64], [576, 64], [576, 336], [320, 336]],
];

/**
 * Deterministic 8-vehicle demo fleet. Six vans charge overnight at the depot
 * (plug in ~17:00–19:00, depart ~05:00–07:00); two run daytime windows so the
 * optimizer has mixed price exposure to exploit.
 */
export function buildFleet(): MapVehicle[] {
  const rng = mulberry32(20261006);
  const pick = (a: number, b: number) => a + rng() * (b - a);
  return NAMES.map((name, i) => {
    const overnight = i < 6;
    const batteryKwh = Math.round(pick(60, 100));
    const chargerKw = i % 3 === 2 ? 50 : i % 2 === 0 ? 22 : 11;
    return {
      id: `v${i + 1}`,
      name,
      batteryKwh,
      soc: +(pick(0.15, 0.45).toFixed(2)),
      efficiencyKwhPerMile: +(pick(0.28, 0.38).toFixed(2)),
      chargerKw,
      arrivalSlot: overnight ? 68 + Math.floor(pick(0, 5)) : 36 + Math.floor(pick(0, 5)),
      departureSlot: overnight ? 20 + Math.floor(pick(0, 9)) : 64 + Math.floor(pick(0, 9)),
      requiredSoc: +(pick(0.85, 0.95).toFixed(2)),
      route: LOOPS[i],
      color: COLORS[i],
    };
  });
}
