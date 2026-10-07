import { describe, expect, it } from "vitest";
import { Vehicle, chargeNeededKwh } from "./vehicle";
import { scheduleCharging, scheduleNaive, windowSlots } from "./scheduler";
import { PRICE_CURVE, SLOTS_PER_DAY } from "./pricing";

function v(partial: Partial<Vehicle> & { id: string }): Vehicle {
  return {
    name: partial.id,
    batteryKwh: 75,
    soc: 0.25,
    efficiencyKwhPerMile: 0.32,
    chargerKw: 11,
    arrivalSlot: 68, // 17:00
    departureSlot: 28, // 07:00 next day (wraps)
    requiredSoc: 0.9,
    ...partial,
  };
}

/** Mixed fleet: overnight vans plus a couple of daytime windows. */
function standardFleet(): Vehicle[] {
  return [
    v({ id: "a1" }),
    v({ id: "a2", soc: 0.4, batteryKwh: 60, chargerKw: 22 }),
    v({ id: "a3", soc: 0.15, batteryKwh: 100, chargerKw: 22, requiredSoc: 0.85 }),
    v({ id: "b1", arrivalSlot: 36, departureSlot: 68, soc: 0.5, batteryKwh: 60 }), // 09:00–17:00
    v({ id: "b2", arrivalSlot: 40, departureSlot: 72, soc: 0.3, batteryKwh: 75, chargerKw: 22 }),
    v({ id: "c1", arrivalSlot: 76, departureSlot: 20, soc: 0.2, batteryKwh: 82, chargerKw: 50 }), // 19:00–05:00, fast charger
  ];
}

describe("chargeNeededKwh", () => {
  it("computes kWh to reach requiredSoc and never goes negative", () => {
    expect(chargeNeededKwh(v({ id: "x", soc: 0.2, batteryKwh: 100, requiredSoc: 0.8 }))).toBeCloseTo(60);
    expect(chargeNeededKwh(v({ id: "y", soc: 0.9, requiredSoc: 0.8 }))).toBe(0);
  });
});

describe("windowSlots", () => {
  it("wraps past midnight when departure <= arrival", () => {
    const slots = windowSlots(v({ id: "w", arrivalSlot: 90, departureSlot: 6 }));
    expect(slots).toContain(95);
    expect(slots).toContain(0);
    expect(slots).toContain(5);
    expect(slots).not.toContain(6);
    expect(slots).toHaveLength(6 + 6);
  });

  it("handles a plain same-day window", () => {
    expect(windowSlots(v({ id: "d", arrivalSlot: 10, departureSlot: 14 }))).toEqual([10, 11, 12, 13]);
  });
});

describe("scheduleCharging", () => {
  const fleet = standardFleet();
  const SITE_KW = 120;
  const result = scheduleCharging(fleet, SITE_KW);

  it("costs strictly less than the charge-at-arrival baseline", () => {
    expect(result.costNaive).toBeGreaterThan(0);
    expect(result.costTotal).toBeLessThan(result.costNaive);
    expect(result.savings).toBeCloseTo(result.costNaive - result.costTotal, 6);
    expect(result.savingsPct).toBeGreaterThan(0);
  });

  it("meets every vehicle's requiredSoc when the window is feasible (unmet empty)", () => {
    expect(result.unmet).toEqual([]);
    for (const s of result.vehicles) {
      const vehicle = fleet.find((x) => x.id === s.vehicleId);
      expect(vehicle).toBeDefined();
      expect(s.arrivalSoc).toBeGreaterThanOrEqual(vehicle!.requiredSoc - 1e-6);
      expect(s.energyKwh).toBeCloseTo(chargeNeededKwh(vehicle!), 6);
    }
  });

  it("never exceeds the site power cap in any slot", () => {
    expect(result.kwPerSlot).toHaveLength(SLOTS_PER_DAY);
    for (const kw of result.kwPerSlot) {
      expect(kw).toBeLessThanOrEqual(SITE_KW + 1e-9);
      expect(kw).toBeGreaterThanOrEqual(0);
    }
  });

  it("never allocates outside a vehicle's plug-in window", () => {
    const windows = new Map(fleet.map((x) => [x.id, new Set(windowSlots(x))]));
    for (const a of result.allocations) {
      expect(windows.get(a.vehicleId)?.has(a.slot)).toBe(true);
    }
  });

  it("respects each vehicle's charger limit", () => {
    const chargers = new Map(fleet.map((x) => [x.id, x.chargerKw]));
    for (const a of result.allocations) {
      expect(a.kw).toBeLessThanOrEqual(chargers.get(a.vehicleId)! + 1e-9);
    }
  });

  it("prefers cheaper slots: overnight fleet charges mostly off-peak", () => {
    const offPeakKw = result.allocations
      .filter((a) => PRICE_CURVE[a.slot] === 0.12)
      .reduce((sum, a) => sum + a.kw, 0);
    const totalKw = result.allocations.reduce((sum, a) => sum + a.kw, 0);
    expect(offPeakKw / totalKw).toBeGreaterThan(0.5);
  });

  it("handles unmet demand gracefully under a tiny site cap", () => {
    const tight = scheduleCharging(fleet, 5);
    expect(tight.unmet.length).toBeGreaterThan(0);
    // Partial energy is still scheduled; nothing crashes, costs stay sane.
    expect(tight.costTotal).toBeGreaterThanOrEqual(0);
    expect(tight.costTotal).toBeLessThanOrEqual(tight.costNaive);
    for (const kw of tight.kwPerSlot) {
      expect(kw).toBeLessThanOrEqual(5 + 1e-9);
    }
  });
});

describe("scheduleNaive", () => {
  it("charges from arrival at full power and costs more than optimized", () => {
    const fleet = standardFleet();
    const naive = scheduleNaive(fleet);
    const optimized = scheduleCharging(fleet, 120);
    // Naive starts at the arrival slot for every vehicle.
    for (const vehicle of fleet) {
      const first = naive.allocations
        .filter((a) => a.vehicleId === vehicle.id)
        .sort((a, b) => a.slot - b.slot)[0];
      expect(first).toBeDefined();
      expect(first.kw).toBeCloseTo(Math.min(vehicle.chargerKw, chargeNeededKwh(vehicle) / 0.25), 6);
    }
    expect(naive.costTotal).toBeCloseTo(optimized.costNaive, 6);
  });
});
