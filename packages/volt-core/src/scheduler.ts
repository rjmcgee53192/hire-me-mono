/**
 * Greedy cost-optimal charging scheduler.
 *
 * Strategy: for every vehicle, expand its plug-in window into candidate
 * (vehicle, slot) pairs, sort all pairs by electricity price ascending, then
 * allocate slot by slot — always taking the cheapest available slot first —
 * while respecting each vehicle's charger limit and the depot's total site
 * power cap. Charging windows may wrap past midnight
 * (departureSlot <= arrivalSlot). A final partial slot tops a vehicle up
 * exactly to its target instead of overcharging it.
 *
 * This "cheapest-slot-first" greedy allocation is optimal here because slots
 * are independent and costs are linear: filling the cheapest feasible slot
 * for one unit of energy never hurts the ability to place the rest.
 */

import { PRICE_CURVE, SLOTS_PER_DAY, SLOT_HOURS } from "./pricing";
import { Vehicle, chargeNeededKwh } from "./vehicle";

export interface Allocation {
  vehicleId: string;
  /** 15-minute slot index, 0–95. */
  slot: number;
  /** Power allocated in kW (<= vehicle charger limit). */
  kw: number;
}

export interface VehicleScheduleSummary {
  vehicleId: string;
  /** Total kWh scheduled for this vehicle. */
  energyKwh: number;
  /** Cost in $ for this vehicle. */
  cost: number;
  /** Projected state of charge at departure (0–1); below requiredSoc when unmet. */
  arrivalSoc: number;
}

interface RawSchedule {
  allocations: Allocation[];
  /** Aggregated allocated kW per 15-minute slot (length 96). */
  kwPerSlot: number[];
  /** Total energy cost in $. */
  costTotal: number;
  /** Vehicle ids that could not reach requiredSoc within their window. */
  unmet: string[];
  vehicles: VehicleScheduleSummary[];
}

export interface ScheduleResult extends RawSchedule {
  /** Cost of the charge-at-arrival baseline in $. */
  costNaive: number;
  /** costNaive - costTotal in $. */
  savings: number;
  /** savings / costNaive * 100. */
  savingsPct: number;
}

interface Candidate {
  price: number;
  slot: number;
  vehicleId: string;
}

/**
 * Slot indexes in a vehicle's plug-in window.
 * departureSlot <= arrivalSlot means the window wraps past midnight.
 * departureSlot may be 96 to mean end of day.
 */
export function windowSlots(v: Vehicle): number[] {
  const slots: number[] = [];
  const arr = Math.max(0, Math.min(SLOTS_PER_DAY - 1, Math.floor(v.arrivalSlot)));
  const dep = Math.max(0, Math.min(SLOTS_PER_DAY, Math.floor(v.departureSlot)));
  if (dep > arr) {
    for (let s = arr; s < dep; s++) slots.push(s);
  } else {
    for (let s = arr; s < SLOTS_PER_DAY; s++) slots.push(s);
    for (let s = 0; s < dep; s++) slots.push(s);
  }
  return slots;
}

const EPS = 1e-9;

function computeRaw(
  vehicles: Vehicle[],
  allocations: Allocation[],
  usage: number[],
  remainingKwh: Map<string, number>,
): RawSchedule {
  let costTotal = 0;
  const energyByVehicle = new Map<string, number>();
  const costByVehicle = new Map<string, number>();
  for (const a of allocations) {
    const energy = a.kw * SLOT_HOURS;
    const cost = energy * PRICE_CURVE[a.slot];
    costTotal += cost;
    energyByVehicle.set(a.vehicleId, (energyByVehicle.get(a.vehicleId) ?? 0) + energy);
    costByVehicle.set(a.vehicleId, (costByVehicle.get(a.vehicleId) ?? 0) + cost);
  }

  const unmet: string[] = [];
  const summaries: VehicleScheduleSummary[] = vehicles.map((v) => {
    const remaining = remainingKwh.get(v.id) ?? 0;
    if (remaining > 1e-6) unmet.push(v.id);
    const delivered = energyByVehicle.get(v.id) ?? 0;
    return {
      vehicleId: v.id,
      energyKwh: delivered,
      cost: costByVehicle.get(v.id) ?? 0,
      arrivalSoc: Math.min(1, v.soc + delivered / v.batteryKwh),
    };
  });

  return {
    allocations,
    kwPerSlot: usage,
    costTotal,
    unmet,
    vehicles: summaries,
  };
}

export function scheduleCharging(
  vehicles: Vehicle[],
  maxSiteKw: number,
): ScheduleResult {
  const byId = new Map<string, Vehicle>(vehicles.map((v) => [v.id, v]));
  const remainingKwh = new Map<string, number>();
  const usedSlots = new Map<string, Set<number>>();
  for (const v of vehicles) {
    remainingKwh.set(v.id, chargeNeededKwh(v));
    usedSlots.set(v.id, new Set<number>());
  }

  const candidates: Candidate[] = [];
  for (const v of vehicles) {
    for (const slot of windowSlots(v)) {
      candidates.push({ price: PRICE_CURVE[slot], slot, vehicleId: v.id });
    }
  }
  // Cheapest slots first; ties broken by earliest slot for determinism.
  candidates.sort((a, b) => a.price - b.price || a.slot - b.slot);

  const usage = new Array<number>(SLOTS_PER_DAY).fill(0);
  const allocations: Allocation[] = [];

  for (const c of candidates) {
    const need = remainingKwh.get(c.vehicleId) ?? 0;
    if (need <= EPS) continue;
    const taken = usedSlots.get(c.vehicleId);
    if (taken !== undefined && taken.has(c.slot)) continue;
    const v = byId.get(c.vehicleId);
    if (v === undefined) continue;
    const headroom = maxSiteKw - usage[c.slot];
    const kw = Math.min(v.chargerKw, need / SLOT_HOURS, headroom);
    if (kw <= EPS) continue;
    allocations.push({ vehicleId: c.vehicleId, slot: c.slot, kw });
    if (taken !== undefined) taken.add(c.slot);
    usage[c.slot] += kw;
    remainingKwh.set(c.vehicleId, need - kw * SLOT_HOURS);
  }

  const raw = computeRaw(vehicles, allocations, usage, remainingKwh);
  const costNaive = scheduleNaive(vehicles).costTotal;
  const savings = costNaive - raw.costTotal;
  const savingsPct = costNaive > EPS ? (savings / costNaive) * 100 : 0;

  return { ...raw, costNaive, savings, savingsPct };
}

/**
 * Charge-at-arrival baseline: every vehicle charges at full charger power
 * starting the moment it plugs in, ignoring prices and the site cap.
 * This is what an unmanaged depot does — and what the optimizer beats.
 */
export function scheduleNaive(vehicles: Vehicle[]): RawSchedule {
  const allocations: Allocation[] = [];
  const usage = new Array<number>(SLOTS_PER_DAY).fill(0);
  const remainingKwh = new Map<string, number>();
  for (const v of vehicles) {
    let need = chargeNeededKwh(v);
    const taken = new Set<number>();
    for (const slot of windowSlots(v)) {
      if (need <= EPS || taken.has(slot)) continue;
      const kw = Math.min(v.chargerKw, need / SLOT_HOURS);
      allocations.push({ vehicleId: v.id, slot, kw });
      taken.add(slot);
      usage[slot] += kw;
      need -= kw * SLOT_HOURS;
    }
    remainingKwh.set(v.id, need);
  }
  return computeRaw(vehicles, allocations, usage, remainingKwh);
}
