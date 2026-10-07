/**
 * Vehicle model for the fleet.
 */

export interface Vehicle {
  /** Stable identifier, e.g. "v1". */
  id: string;
  /** Display name, e.g. "Atlas". */
  name: string;
  /** Battery capacity in kWh. */
  batteryKwh: number;
  /** State of charge when the vehicle arrives at the depot, 0–1. */
  soc: number;
  /** Rated consumption in kWh per mile. */
  efficiencyKwhPerMile: number;
  /** Onboard charger / depot plug limit in kW. */
  chargerKw: number;
  /**
   * 15-minute slot index when the vehicle plugs in (0–95).
   * If departureSlot <= arrivalSlot the window wraps past midnight.
   */
  arrivalSlot: number;
  /** 15-minute slot index when the vehicle must be ready (0–96, 96 = end of day). */
  departureSlot: number;
  /** Target state of charge at departure, 0–1. */
  requiredSoc: number;
}

/** kWh the vehicle still needs to reach its required departure SoC. */
export function chargeNeededKwh(v: Vehicle): number {
  return Math.max(0, (v.requiredSoc - v.soc) * v.batteryKwh);
}
