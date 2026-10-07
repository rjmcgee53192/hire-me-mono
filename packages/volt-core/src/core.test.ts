import { describe, expect, it } from "vitest";
import { planTrip } from "./trip";
import { Vehicle } from "./vehicle";
import { priceAt, priceBandAt, PRICE_CURVE, SLOTS_PER_DAY } from "./pricing";
import { mulberry32 } from "./rng";

const car: Vehicle = {
  id: "t1",
  name: "Tripper",
  batteryKwh: 75,
  soc: 0.4,
  efficiencyKwhPerMile: 0.3,
  chargerKw: 11,
  arrivalSlot: 0,
  departureSlot: 96,
  requiredSoc: 0.9,
};

describe("planTrip", () => {
  it("flags a 400-mile trip on a 75kWh / 40% vehicle as infeasible with positive deficit", () => {
    const plan = planTrip(car, 400, 0, 65);
    expect(plan.feasible).toBe(false);
    expect(plan.deficitKwh).toBeGreaterThan(0);
    expect(plan.energyKwh).toBeGreaterThan(100);
    expect(plan.arrivalSoc).toBe(0);
    expect(plan.recommendation).toMatch(/not feasible/i);
  });

  it("flags a 60-mile trip as feasible with a sensible arrival SoC", () => {
    const plan = planTrip(car, 60, 0, 65);
    expect(plan.feasible).toBe(true);
    expect(plan.deficitKwh).toBe(0);
    expect(plan.energyKwh).toBeLessThan(car.soc * car.batteryKwh);
    expect(plan.arrivalSoc).toBeGreaterThan(0);
    expect(plan.arrivalSoc).toBeLessThan(car.soc);
  });

  it("penalizes high speed and elevation gain", () => {
    const slow = planTrip(car, 100, 0, 55);
    const fast = planTrip(car, 100, 0, 80);
    const hilly = planTrip(car, 100, 4000, 55);
    expect(fast.energyKwh).toBeGreaterThan(slow.energyKwh);
    expect(hilly.energyKwh).toBeGreaterThan(slow.energyKwh);
    expect(hilly.energyKwh - slow.energyKwh).toBeCloseTo(4000 * 0.0006, 6);
  });

  it("recommendation tells the driver the charge target when infeasible", () => {
    const plan = planTrip(car, 400, 0, 65);
    const neededPct = Math.min(100, Math.ceil((plan.energyKwh / car.batteryKwh) * 100));
    expect(plan.recommendation).toContain(`${neededPct}%`);
  });
});

describe("pricing", () => {
  it("applies the correct rate bands", () => {
    expect(priceAt(2)).toBe(0.12);
    expect(priceAt(5.99)).toBe(0.12);
    expect(priceAt(10)).toBe(0.24);
    expect(priceAt(22)).toBe(0.24);
    expect(priceAt(17)).toBe(0.48);
    expect(priceAt(20.99)).toBe(0.48);
    expect(priceBandAt(25)).toBe("off-peak"); // wraps
  });

  it("PRICE_CURVE has 96 slots matching priceAt", () => {
    expect(PRICE_CURVE).toHaveLength(SLOTS_PER_DAY);
    expect(PRICE_CURVE).toHaveLength(96);
    for (let s = 0; s < 96; s++) {
      expect(PRICE_CURVE[s]).toBe(priceAt(s * 0.25));
    }
  });
});

describe("mulberry32", () => {
  it("is deterministic for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("produces values in [0, 1)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const x = rng();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
