/**
 * @repo/volt-core — EV fleet smart-charging optimization core.
 *
 * Pure TypeScript: time-of-use pricing, vehicle model, a greedy
 * cost-optimal charging scheduler, and a trip energy planner.
 */

export {
  SLOTS_PER_DAY,
  SLOT_MINUTES,
  SLOT_HOURS,
  RATES,
  PRICE_CURVE,
  priceAt,
  priceBandAt,
  slotToHour,
} from "./pricing";
export type { PriceBand } from "./pricing";

export { chargeNeededKwh } from "./vehicle";
export type { Vehicle } from "./vehicle";

export { scheduleCharging, scheduleNaive, windowSlots } from "./scheduler";
export type {
  Allocation,
  ScheduleResult,
  VehicleScheduleSummary,
} from "./scheduler";

export { planTrip, ELEV_KWH_PER_FT, REF_SPEED_MPH } from "./trip";
export type { TripPlan } from "./trip";

export { mulberry32 } from "./rng";
