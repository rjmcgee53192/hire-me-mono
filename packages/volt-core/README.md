# @repo/volt-core

Pure-TypeScript core behind the **Volt Fleet** demo: EV fleet smart-charging
optimization and trip energy planning. No React, no I/O — every function is
deterministic and unit-tested.

## Modules

- `src/pricing.ts` — 24-hour time-of-use price curve (`priceAt`, `PRICE_CURVE`).
  Off-peak $0.12/kWh (00:00–06:00), mid $0.24/kWh, peak $0.48/kWh (16:00–21:00),
  in 96 fifteen-minute slots.
- `src/vehicle.ts` — `Vehicle` model (`batteryKwh`, `soc`, charger limit,
  plug-in window, `requiredSoc`) and `chargeNeededKwh()`.
- `src/scheduler.ts` — greedy cost-optimal charging scheduler.
- `src/trip.ts` — trip energy planner (`planTrip`).
- `src/rng.ts` — deterministic `mulberry32` PRNG for reproducible fixtures.

## Scheduler algorithm

`scheduleCharging(vehicles, maxSiteKw)`:

1. Expand each vehicle's plug-in window (wraps past midnight) into
   `(vehicle, slot)` candidate pairs.
2. Sort all pairs by electricity price ascending (ties → earliest slot).
3. Allocate greedily: for each pair, schedule up to the vehicle's charger
   limit — with a partial final slot to hit the target exactly — as long as
   the slot's total stays under the depot's `maxSiteKw` site cap.
4. Vehicles that cannot reach `requiredSoc` within their window land in
   `unmet` with their partial schedule intact (no exceptions, no silent
   over-allocation).

Because slot costs are linear and independent, cheapest-slot-first is
optimal. The result also carries the `scheduleNaive()` charge-at-arrival
baseline so the demo can report real dollar savings.

## API

```ts
import {
  scheduleCharging, scheduleNaive, planTrip,
  priceAt, PRICE_CURVE, chargeNeededKwh, mulberry32,
} from "@repo/volt-core";

const result = scheduleCharging(fleet, 120);
// result.costTotal, result.costNaive, result.savings, result.savingsPct,
// result.unmet, result.kwPerSlot (96), result.vehicles[...]

const trip = planTrip(vehicle, 120 /* mi */, 1500 /* ft */, 65 /* mph */);
// trip.feasible, trip.energyKwh, trip.arrivalSoc, trip.deficitKwh, trip.recommendation
```

## Tests

`pnpm --filter @repo/volt-core test` (or `npx vitest run` in this directory).
Covers: optimized cost strictly below naive cost, full SoC attainment on the
standard fixture, site-cap compliance per slot, window/charger-limit
compliance, graceful unmet handling, trip feasibility bounds, price bands,
and RNG determinism.
