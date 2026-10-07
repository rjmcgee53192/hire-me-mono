# @repo/astra-core

Deterministic rocket flight simulation engine — the physics core behind the
**Astra Telemetry** mission-control demo (`/demos/astra`).

Pure TypeScript, zero dependencies, no React. The engine models a two-stage
launch vehicle from liftoff through SECO and a post-burn coast, emitting a
telemetry sample every 0.1 s plus a detected event log (LIFTOFF, MAXQ, MECO,
STAGE_SEP, SECOND_IGNITION, SECO).

## Physics model

Each tick integrates vertical motion with semi-implicit Euler at a fixed
`dt = 0.1 s`:

- **Thrust**: `T = thrustKN × 1000 × throttle` of the active stage.
- **Gravity**: inverse-square, `g = g0 × (Re / (Re + alt))²`.
- **Drag**: `D = ½ × ρ × v|v| × Cd × A / m`, with an exponential atmosphere
  `ρ = ρ0 × e^(−alt/8500)`.
- **Mass**: payload + attached stage dry mass + remaining propellant.
  Stage 1's dry mass is jettisoned at separation.
- **Propellant**: constant mass flow `propMass / burnTime` per stage. When a
  stage runs dry its burnout event fires (MECO for stage 1, SECO for stage 2),
  followed by a short coast, stage separation, and second-stage ignition.
- **Dynamic pressure**: `q = ½ρv²`, tracked every tick; MAXQ is emitted once
  q has peaked and then declined below 97 % of the peak.

## Anomalies

`injectAnomaly(kind)` perturbs the flight from the current mission time:

| kind | effect |
| --- | --- |
| `engine-underperform` | thrust × 0.75 from injection onward — visibly bends the velocity/altitude curves |
| `fuel-leak` | propellant mass flow × 1.6 — the burning stage runs dry early |
| `sensor-noise` | reported samples get Gaussian noise while the **true** physics state is untouched; raises a `SENSOR_ANOMALY` critical alert |

Injections are idempotent and recorded on a schedule so re-simulation replays
them at the same mission times.

## API

```ts
import { Flight, ASTRA_DEMO_CONFIG } from "@repo/astra-core";

const flight = new Flight(ASTRA_DEMO_CONFIG);

flight.tick(0.1);            // advance 0.1 s, returns latest TelemetrySample
flight.getSamples();         // TelemetrySample[] — the reported stream
flight.getTrueState();       // ground truth (never touched by sensor noise)
flight.getEvents();          // FlightEvent[] { t, type, message }
flight.getAlerts();          // FlightAlert[] { t, severity, message }
flight.injectAnomaly("engine-underperform");
flight.scrubTo(120);         // re-simulate deterministically from t=0 to t=120
flight.reset();              // back to the pad (same seed => identical replay)
flight.reset(99);            // back to the pad with a new seed
flight.getMissionDuration(); // total simulated seconds
```

`TelemetrySample` = `{ t, altitudeM, velocityMs, qKpa, fuelStage1Frac,
fuelStage2Frac, stage, throttle }`.

## How determinism works

1. All randomness comes from `mulberry32`, seeded per flight (`seed: 1337`
   by default). The Gaussian noise draws happen only in the reporting layer,
   in a fixed order per sample, so replays draw the identical sequence.
2. The physics integrator always advances in fixed 0.1 s sub-steps —
   `tick(dt)` rounds `dt` to a whole step count — so ticking live in small
   chunks and re-simulating in one call execute the exact same step sequence.
3. `scrubTo(t)` saves the anomaly injection schedule, resets to the same
   seed, and re-ticks from zero, re-applying each anomaly at its original
   mission time. The resulting samples are `toEqual`-identical to the live
   run (covered by tests).

## Tests

`npx vitest run` — covers RNG determinism, MECO timing (±1 s of the
configured burn time), MAXQ-before-MECO ordering, the full six-event
sequence, underperform vs. nominal divergence, fuel-leak early burnout,
scrub determinism (with and without anomalies), and the sensor-noise
true-state isolation.
