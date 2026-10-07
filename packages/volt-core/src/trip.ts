/**
 * Trip energy planner: estimates whether a vehicle can complete a trip on
 * its current charge.
 *
 * Energy model:
 *   energyKwh = distance * efficiency * (1 + speedFactor) + elevationKwh
 *   speedFactor = ((avgSpeedMph - 55) / 55) * 0.25   (faster than 55 mph costs more)
 *   elevationKwh = elevationGainFt * 0.0006         (potential energy per foot of climb)
 */

import { Vehicle } from "./vehicle";

export const ELEV_KWH_PER_FT = 0.0006;
export const REF_SPEED_MPH = 55;

export interface TripPlan {
  /** True when the trip fits within the current charge. */
  feasible: boolean;
  /** Total trip energy in kWh. */
  energyKwh: number;
  /** Projected state of charge on arrival, 0–1 (0 when infeasible). */
  arrivalSoc: number;
  /** Extra kWh needed when infeasible, 0 otherwise. */
  deficitKwh: number;
  /** Plain-language recommendation for the driver. */
  recommendation: string;
}

export function planTrip(
  vehicle: Vehicle,
  distanceMiles: number,
  elevationGainFt: number,
  avgSpeedMph: number,
): TripPlan {
  const speedFactor = ((avgSpeedMph - REF_SPEED_MPH) / REF_SPEED_MPH) * 0.25;
  const energyKwh =
    distanceMiles * vehicle.efficiencyKwhPerMile * (1 + speedFactor) +
    elevationGainFt * ELEV_KWH_PER_FT;

  const availableKwh = Math.max(0, vehicle.soc) * vehicle.batteryKwh;
  const deficitKwh = Math.max(0, energyKwh - availableKwh);
  const feasible = deficitKwh <= 0;
  const arrivalSoc = feasible
    ? Math.max(0, Math.min(1, (availableKwh - energyKwh) / vehicle.batteryKwh))
    : 0;

  const arrivalPct = Math.round(arrivalSoc * 100);
  const neededPct = Math.min(100, Math.ceil((energyKwh / vehicle.batteryKwh) * 100));
  const recommendation = feasible
    ? `Trip is feasible. Expect to arrive with ~${arrivalPct}% battery remaining.`
    : `Not feasible on the current charge — short by ${deficitKwh.toFixed(1)} kWh. ` +
      `Charge to at least ${neededPct}% before departing.`;

  return { feasible, energyKwh, arrivalSoc, deficitKwh, recommendation };
}
