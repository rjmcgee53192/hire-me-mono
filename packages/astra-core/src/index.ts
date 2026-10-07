/**
 * @repo/astra-core — deterministic rocket flight simulation engine.
 *
 * Public API:
 * - Flight: two-stage ascent simulator (tick / scrubTo / reset /
 *   injectAnomaly / getEvents / getSamples / getAlerts / getTrueState)
 * - TelemetrySample, FlightEvent, FlightAlert, TrueState, FlightConfig,
 *   StageConfig, AnomalyKind, FlightEventType, AlertSeverity
 * - ASTRA_DEMO_CONFIG: a ready-to-fly vehicle configuration
 * - mulberry32, gaussian: seeded RNG primitives
 */
export {
  Flight,
  ASTRA_DEMO_CONFIG,
} from "./flight";
export type {
  AnomalyKind,
  FlightEventType,
  AlertSeverity,
  StageConfig,
  FlightConfig,
  TelemetrySample,
  FlightEvent,
  FlightAlert,
  TrueState,
} from "./flight";
export { mulberry32, gaussian } from "./rng";
export type { Rng } from "./rng";
