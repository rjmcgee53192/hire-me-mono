/**
 * Time-of-use electricity pricing for the depot.
 *
 * The day is divided into 96 fifteen-minute slots. Rates:
 * - Off-peak $0.12/kWh  00:00–06:00
 * - Mid      $0.24/kWh  06:00–16:00 and 21:00–24:00
 * - Peak     $0.48/kWh  16:00–21:00
 */

export const SLOTS_PER_DAY = 96;
export const SLOT_MINUTES = 15;
export const SLOT_HOURS = SLOT_MINUTES / 60;

export type PriceBand = "off-peak" | "mid" | "peak";

export const RATES: Record<PriceBand, number> = {
  "off-peak": 0.12,
  mid: 0.24,
  peak: 0.48,
};

/** Hour of day for a 15-minute slot index (0–95). */
export function slotToHour(slot: number): number {
  return slot * SLOT_HOURS;
}

/** Rate band for a fractional hour of day. Wraps values outside [0, 24). */
export function priceBandAt(hour: number): PriceBand {
  const h = ((hour % 24) + 24) % 24;
  if (h < 6) return "off-peak";
  if (h >= 16 && h < 21) return "peak";
  return "mid";
}

/** $/kWh at a fractional hour of day. */
export function priceAt(hour: number): number {
  return RATES[priceBandAt(hour)];
}

function buildCurve(): [number, ...number[]] {
  const curve: number[] = Array.from({ length: SLOTS_PER_DAY }, (_, slot) =>
    priceAt(slotToHour(slot)),
  );
  return curve as [number, ...number[]];
}

/** $/kWh for each of the 96 fifteen-minute slots of the day. */
export const PRICE_CURVE: [number, ...number[]] = buildCurve();
