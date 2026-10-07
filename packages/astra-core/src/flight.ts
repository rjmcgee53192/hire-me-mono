/**
 * @repo/astra-core — physics-flavored rocket flight simulation engine.
 *
 * A deterministic two-stage ascent simulator: constant-throttle burns,
 * inverse-square gravity, exponential-atmosphere drag, dynamic-pressure
 * (max-q) detection, staged event logging, and injectable flight anomalies.
 *
 * Everything is pure TypeScript with no framework dependencies; the showcase
 * dashboard drives it tick-by-tick.
 */
import { mulberry32, gaussian, type Rng } from "./rng";

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

/** Supported anomaly injections. */
export type AnomalyKind = "engine-underperform" | "fuel-leak" | "sensor-noise";

/** Mission events the engine detects. */
export type FlightEventType =
  | "LIFTOFF"
  | "MAXQ"
  | "MECO"
  | "STAGE_SEP"
  | "SECOND_IGNITION"
  | "SECO";

/** Alert severity levels. */
export type AlertSeverity = "info" | "warn" | "critical";

export interface StageConfig {
  /** Human-readable stage name, e.g. "Booster". */
  name: string;
  /** Propellant mass at ignition, kg. */
  propMassKg: number;
  /** Structural dry mass, kg. Dropped at stage separation. */
  dryMassKg?: number;
  /** Vacuum-ish thrust at full throttle, kN. */
  thrustKN: number;
  /** Nominal full burn duration, s. */
  burnTimeS: number;
}

export interface FlightConfig {
  /** Exactly two stages: [booster, upper stage]. */
  stages: [StageConfig, StageConfig];
  /** Payload / capsule mass, kg. */
  payloadMassKg: number;
  /** Drag coefficient (dimensionless). */
  dragCoefficient: number;
  /** Reference cross-section for drag, m^2. Defaults to 10.2. */
  crossSectionM2?: number;
  /** Coast time between MECO and second-stage ignition, s. Defaults to 2. */
  coastGapS?: number;
  /** Simulated coast after SECO, s. Defaults to 120. */
  postSecoCoastS?: number;
  /** Default seed used when reset() is called without one. */
  seed?: number;
}

/** One telemetry sample. Reported values may carry sensor noise; the true
 *  flight state is available via getTrueState(). */
export interface TelemetrySample {
  /** Mission elapsed time, s. */
  t: number;
  /** Reported altitude, m. */
  altitudeM: number;
  /** Reported velocity, m/s. */
  velocityMs: number;
  /** Reported dynamic pressure, kPa. */
  qKpa: number;
  /** Stage 1 propellant remaining, fraction 0..1. */
  fuelStage1Frac: number;
  /** Stage 2 propellant remaining, fraction 0..1. */
  fuelStage2Frac: number;
  /** Currently burning stage: 1 or 2. */
  stage: 1 | 2;
  /** Throttle setting, fraction 0..1. */
  throttle: number;
}

/** A detected mission event. */
export interface FlightEvent {
  t: number;
  type: FlightEventType;
  message: string;
}

/** An alert raised by the engine (events and anomaly injections). */
export interface FlightAlert {
  t: number;
  severity: AlertSeverity;
  message: string;
}

/** Ground-truth physics state — never affected by sensor noise. */
export interface TrueState {
  t: number;
  altitudeM: number;
  velocityMs: number;
  massKg: number;
  qKpa: number;
  stage: 1 | 2;
  throttle: number;
}

/* ------------------------------------------------------------------ */
/* Physics constants                                                   */
/* ------------------------------------------------------------------ */

const G0 = 9.80665; // sea-level gravity, m/s^2
const RE = 6_371_000; // Earth radius, m
const RHO0 = 1.225; // sea-level air density, kg/m^3
const SCALE_H = 8_500; // atmospheric scale height, m
const STEP = 0.1; // fixed physics timestep, s

const DEFAULT_DRY_FRAC = 0.07; // dry mass as fraction of propellant when unspecified
const UNDERPERFORM_THRUST_FRAC = 0.75; // thrust multiplier for engine-underperform
const FUEL_LEAK_FLOW_MULT = 1.6; // mass-flow multiplier for fuel-leak

/** Sensor-noise sigmas applied to reported samples (true state untouched). */
const NOISE_SIGMA = {
  altitudeM: 40,
  velocityMs: 3,
  qKpa: 0.25,
  fuelFrac: 0.004,
} as const;

type Phase = "stage1" | "coast" | "stage2" | "post";

interface ScheduledAnomaly {
  at: number;
  kind: AnomalyKind;
}

const ANOMALY_LABEL: Record<AnomalyKind, string> = {
  "engine-underperform": "engine underperformance",
  "fuel-leak": "fuel leak",
  "sensor-noise": "sensor noise",
};

/* ------------------------------------------------------------------ */
/* Flight                                                              */
/* ------------------------------------------------------------------ */

export class Flight {
  private readonly config: Required<
    Omit<FlightConfig, "stages" | "seed">
  > & { stages: [Required<StageConfig>, Required<StageConfig>]; seed: number };

  private rng: Rng = mulberry32(1);
  private seed = 1;

  private t = 0;
  private altitudeM = 0;
  private velocityMs = 0;
  private propRemaining: [number, number] = [0, 0];
  private separated: [boolean, boolean] = [false, false];
  private phase: Phase = "stage1";
  private coastTimer = 0;

  private events: FlightEvent[] = [];
  private alerts: FlightAlert[] = [];
  private samples: TelemetrySample[] = [];

  private activeAnomalies = new Set<AnomalyKind>();
  private anomalySchedule: ScheduledAnomaly[] = [];

  private maxQ = 0;
  private maxQEmitted = false;
  private liftoffEmitted = false;

  constructor(config: FlightConfig) {
    if (config.stages.length !== 2) {
      throw new Error("Flight requires exactly two stage configs");
    }
    const normalize = (s: StageConfig): Required<StageConfig> => ({
      ...s,
      dryMassKg: s.dryMassKg ?? s.propMassKg * DEFAULT_DRY_FRAC,
    });
    this.config = {
      stages: [normalize(config.stages[0]), normalize(config.stages[1])],
      payloadMassKg: config.payloadMassKg,
      dragCoefficient: config.dragCoefficient,
      crossSectionM2: config.crossSectionM2 ?? 10.2,
      coastGapS: config.coastGapS ?? 2,
      postSecoCoastS: config.postSecoCoastS ?? 120,
      seed: config.seed ?? 1337,
    };
    this.reset(this.config.seed);
  }

  /* ----------------------------- control -------------------------- */

  /** Reset to t=0. Same seed (or the new one given) replays identically. */
  reset(seed?: number): void {
    this.seed = seed ?? this.config.seed;
    this.rng = mulberry32(this.seed);
    this.t = 0;
    this.altitudeM = 0;
    this.velocityMs = 0;
    this.propRemaining = [
      this.config.stages[0].propMassKg,
      this.config.stages[1].propMassKg,
    ];
    this.separated = [false, false];
    this.phase = "stage1";
    this.coastTimer = 0;
    this.events = [];
    this.alerts = [];
    this.samples = [];
    this.activeAnomalies = new Set();
    this.anomalySchedule = [];
    this.maxQ = 0;
    this.maxQEmitted = false;
    this.liftoffEmitted = false;
  }

  /**
   * Re-simulate deterministically from t=0 up to `t`, replaying any injected
   * anomalies at their original injection times. Produces samples identical
   * to ticking there live.
   */
  scrubTo(t: number): void {
    const schedule = this.anomalySchedule.slice();
    const seed = this.seed;
    this.reset(seed);
    this.anomalySchedule = schedule;
    this.tick(Math.max(0, Math.min(t, this.getMissionDuration())));
  }

  /**
   * Inject an anomaly effective from the current mission time onward.
   * Idempotent: injecting the same kind twice is a no-op.
   */
  injectAnomaly(kind: AnomalyKind): void {
    if (this.activeAnomalies.has(kind)) return;
    this.anomalySchedule.push({ at: this.t, kind });
  }

  /**
   * Advance the simulation by `dt` seconds using fixed 0.1 s physics
   * sub-steps (dt is rounded to a whole step count, so every path through
   * the engine executes the identical step sequence). Returns the latest
   * reported sample.
   */
  tick(dt: number): TelemetrySample {
    const end = this.getMissionDuration();
    let n = Math.max(0, Math.round(Math.max(0, dt) / STEP));
    while (n > 0 && this.t < end) {
      const h = end - this.t;
      if (h < 1e-9) break;
      this.step(Math.min(STEP, h));
      n--;
    }
    const last = this.samples[this.samples.length - 1];
    // Before the first step (dt = 0), report the pad state.
    return last ?? this.report(this.trueState());
  }

  /* ---------------------------- accessors ------------------------- */

  getSamples(): TelemetrySample[] {
    return this.samples.slice();
  }

  getEvents(): FlightEvent[] {
    return this.events.slice();
  }

  getAlerts(): FlightAlert[] {
    return this.alerts.slice();
  }

  /** Ground-truth state — never touched by sensor noise. */
  getTrueState(): TrueState {
    return this.trueState();
  }

  /** Total simulated mission length, s (burns + coast gap + post-SECO coast). */
  getMissionDuration(): number {
    return (
      this.config.stages[0].burnTimeS +
      this.config.coastGapS +
      this.config.stages[1].burnTimeS +
      this.config.postSecoCoastS
    );
  }

  /* --------------------------- internals -------------------------- */

  private step(h: number): void {
    // Apply anomalies scheduled at or before the current time.
    for (const s of this.anomalySchedule) {
      if (s.at <= this.t + 1e-9 && !this.activeAnomalies.has(s.kind)) {
        this.activateAnomaly(s.kind);
      }
    }
    this.anomalySchedule = this.anomalySchedule.filter(
      (s) => !this.activeAnomalies.has(s.kind),
    );

    if (!this.liftoffEmitted) {
      this.liftoffEmitted = true;
      this.pushEvent(0, "LIFTOFF", "Liftoff — Astra has cleared the tower");
      this.pushAlert(0, "info", "Liftoff confirmed. All systems nominal.");
    }

    const burning = this.phase === "stage1" || this.phase === "stage2";
    const stageIdx = this.phase === "stage2" ? 1 : 0;
    const stageCfg = this.config.stages[stageIdx];

    // Throttle program: constant full throttle for this vehicle.
    const throttle = 1;

    const underperform = this.activeAnomalies.has("engine-underperform");
    const leak = this.activeAnomalies.has("fuel-leak");

    const thrustN =
      burning && this.propRemaining[stageIdx] > 0
        ? stageCfg.thrustKN * 1000 * throttle * (underperform ? UNDERPERFORM_THRUST_FRAC : 1)
        : 0;

    const massKg = this.totalMassKg();

    // Gravity weakens with altitude (inverse square).
    const g = G0 * (RE / (RE + this.altitudeM)) ** 2;
    // Exponential atmosphere.
    const rho = RHO0 * Math.exp(-this.altitudeM / SCALE_H);
    // Drag acceleration, opposing velocity.
    const dragAcc =
      (0.5 * rho * this.velocityMs * Math.abs(this.velocityMs) *
        this.config.dragCoefficient *
        this.config.crossSectionM2) /
      massKg;

    const acc = thrustN / massKg - g - dragAcc;

    // Semi-implicit Euler integration.
    this.velocityMs += acc * h;
    this.altitudeM += this.velocityMs * h;
    if (this.altitudeM < 0) {
      this.altitudeM = 0;
      this.velocityMs = Math.max(0, this.velocityMs);
    }
    this.t += h;

    // Propellant consumption and stage transitions.
    if (burning && this.propRemaining[stageIdx] > 0) {
      const flow =
        (stageCfg.propMassKg / stageCfg.burnTimeS) *
        (leak ? FUEL_LEAK_FLOW_MULT : 1);
      this.propRemaining[stageIdx] = Math.max(
        0,
        this.propRemaining[stageIdx] - flow * h,
      );
      if (this.propRemaining[stageIdx] <= 0) {
        this.onBurnout(stageIdx);
      }
    } else if (this.phase === "coast") {
      this.coastTimer -= h;
      if (this.coastTimer <= 0) {
        this.separated[0] = true;
        this.pushEvent(
          this.t,
          "STAGE_SEP",
          `Stage separation confirmed — ${this.config.stages[0].name} jettisoned`,
        );
        this.pushEvent(
          this.t,
          "SECOND_IGNITION",
          `${this.config.stages[1].name} ignition — second burn underway`,
        );
        this.pushAlert(
          this.t,
          "info",
          "Stage 2 ignition confirmed. Trajectory nominal.",
        );
        this.phase = "stage2";
      }
    }

    // Dynamic pressure and max-q detection (peak then decline).
    const qKpa = (0.5 * rho * this.velocityMs * this.velocityMs) / 1000;
    if (qKpa > this.maxQ) this.maxQ = qKpa;
    if (
      !this.maxQEmitted &&
      this.t > 5 &&
      this.maxQ > 2 &&
      qKpa < 0.97 * this.maxQ
    ) {
      this.maxQEmitted = true;
      this.pushEvent(
        this.t,
        "MAXQ",
        `Max-Q passed — peak dynamic pressure ${this.maxQ.toFixed(1)} kPa`,
      );
      this.pushAlert(
        this.t,
        "warn",
        `Max-Q passed at ${this.maxQ.toFixed(1)} kPa. Vehicle through the highest aerodynamic load.`,
      );
    }

    this.samples.push(this.report(this.trueState()));
  }

  private onBurnout(stageIdx: 0 | 1): void {
    if (stageIdx === 0) {
      this.pushEvent(this.t, "MECO", "MECO — main engine cutoff confirmed");
      this.pushAlert(this.t, "info", "MECO confirmed. Preparing stage separation.");
      this.phase = "coast";
      this.coastTimer = this.config.coastGapS;
    } else {
      this.pushEvent(this.t, "SECO", "SECO — second engine cutoff. Orbit insertion burn complete");
      this.pushAlert(this.t, "info", "SECO confirmed. Vehicle in coast to apogee.");
      this.phase = "post";
    }
  }

  private totalMassKg(): number {
    let m = this.config.payloadMassKg;
    for (let i = 0; i < 2; i++) {
      if (!this.separated[i]) {
        m += this.config.stages[i].dryMassKg + this.propRemaining[i];
      }
    }
    return m;
  }

  private trueState(): TrueState {
    const rho = RHO0 * Math.exp(-this.altitudeM / SCALE_H);
    const qKpa = (0.5 * rho * this.velocityMs * this.velocityMs) / 1000;
    return {
      t: this.t,
      altitudeM: this.altitudeM,
      velocityMs: this.velocityMs,
      massKg: this.totalMassKg(),
      qKpa,
      stage: this.phase === "stage2" || this.phase === "post" ? 2 : 1,
      throttle: 1,
    };
  }

  /** Build the reported sample; sensor-noise only perturbs this layer. */
  private report(trueState: TrueState): TelemetrySample {
    const noisy = this.activeAnomalies.has("sensor-noise");
    const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
    return {
      t: trueState.t,
      altitudeM: noisy
        ? Math.max(0, trueState.altitudeM + gaussian(this.rng) * NOISE_SIGMA.altitudeM)
        : trueState.altitudeM,
      velocityMs: noisy
        ? trueState.velocityMs + gaussian(this.rng) * NOISE_SIGMA.velocityMs
        : trueState.velocityMs,
      qKpa: noisy
        ? Math.max(0, trueState.qKpa + gaussian(this.rng) * NOISE_SIGMA.qKpa)
        : trueState.qKpa,
      fuelStage1Frac: noisy
        ? clamp01(
            this.propRemaining[0] / this.config.stages[0].propMassKg +
              gaussian(this.rng) * NOISE_SIGMA.fuelFrac,
          )
        : this.propRemaining[0] / this.config.stages[0].propMassKg,
      fuelStage2Frac: noisy
        ? clamp01(
            this.propRemaining[1] / this.config.stages[1].propMassKg +
              gaussian(this.rng) * NOISE_SIGMA.fuelFrac,
          )
        : this.propRemaining[1] / this.config.stages[1].propMassKg,
      stage: trueState.stage,
      throttle: trueState.throttle,
    };
  }

  private activateAnomaly(kind: AnomalyKind): void {
    this.activeAnomalies.add(kind);
    if (kind === "sensor-noise") {
      this.pushAlert(
        this.t,
        "critical",
        `SENSOR_ANOMALY: erratic telemetry detected — cross-checking against redundant sensors. (${ANOMALY_LABEL[kind]})`,
      );
    } else if (kind === "engine-underperform") {
      this.pushAlert(
        this.t,
        "warn",
        `Anomaly injected: ${ANOMALY_LABEL[kind]} — thrust derated to 75%. Trajectory will undershoot.`,
      );
    } else {
      this.pushAlert(
        this.t,
        "warn",
        `Anomaly injected: ${ANOMALY_LABEL[kind]} — propellant mass flow ×${FUEL_LEAK_FLOW_MULT}. Burn will terminate early.`,
      );
    }
  }

  private pushEvent(t: number, type: FlightEventType, message: string): void {
    this.events.push({ t, type, message });
  }

  private pushAlert(t: number, severity: AlertSeverity, message: string): void {
    this.alerts.push({ t, severity, message });
  }
}

/** A ready-to-fly two-stage vehicle config used by the demo and tests. */
export const ASTRA_DEMO_CONFIG: FlightConfig = {
  stages: [
    { name: "Booster", propMassKg: 395_700, thrustKN: 7_607, burnTimeS: 162 },
    { name: "Upper Stage", propMassKg: 107_500, thrustKN: 934, burnTimeS: 397 },
  ],
  payloadMassKg: 15_000,
  dragCoefficient: 0.3,
  crossSectionM2: 10.2,
  coastGapS: 2,
  postSecoCoastS: 120,
  seed: 1337,
};
