import { describe, it, expect } from "vitest";
import { Flight, ASTRA_DEMO_CONFIG, type FlightConfig } from "./flight";

/** Shorter vehicle so full-flight tests run fast. */
const TEST_CONFIG: FlightConfig = {
  stages: [
    { name: "Booster", propMassKg: 200_000, thrustKN: 4_000, burnTimeS: 120 },
    { name: "Upper Stage", propMassKg: 60_000, thrustKN: 700, burnTimeS: 240 },
  ],
  payloadMassKg: 10_000,
  dragCoefficient: 0.3,
  crossSectionM2: 10.2,
  coastGapS: 2,
  postSecoCoastS: 60,
  seed: 42,
};

function runTo(flight: Flight, tEnd: number, dt = 0.1): void {
  const start = flight.getTrueState().t;
  let remaining = tEnd - start;
  while (remaining > 1e-9) {
    flight.tick(Math.min(dt, remaining));
    remaining -= dt;
  }
}

function eventTime(
  flight: Flight,
  type: "LIFTOFF" | "MAXQ" | "MECO" | "STAGE_SEP" | "SECOND_IGNITION" | "SECO",
): number {
  const ev = flight.getEvents().find((e) => e.type === type);
  if (!ev) throw new Error(`event ${type} never fired`);
  return ev.t;
}

describe("Flight", () => {
  it("fires MECO at approximately the configured stage-1 burn time", () => {
    const f = new Flight(TEST_CONFIG);
    runTo(f, 130);
    const mecoT = eventTime(f, "MECO");
    expect(Math.abs(mecoT - TEST_CONFIG.stages[0].burnTimeS)).toBeLessThanOrEqual(1);
  });

  it("detects Max-Q strictly before MECO on a nominal flight", () => {
    const f = new Flight(TEST_CONFIG);
    runTo(f, 130);
    const maxqT = eventTime(f, "MAXQ");
    const mecoT = eventTime(f, "MECO");
    expect(maxqT).toBeLessThan(mecoT);
  });

  it("fires the full event sequence in order: LIFTOFF → MAXQ → MECO → STAGE_SEP → SECOND_IGNITION → SECO", () => {
    const f = new Flight(TEST_CONFIG);
    runTo(f, f.getMissionDuration());
    const types = f.getEvents().map((e) => e.type);
    const expected = [
      "LIFTOFF",
      "MAXQ",
      "MECO",
      "STAGE_SEP",
      "SECOND_IGNITION",
      "SECO",
    ];
    expect(types).toEqual(expected);
  });

  it("engine-underperform produces lower velocity and apogee than nominal (same seed)", () => {
    const nominal = new Flight(TEST_CONFIG);
    const degraded = new Flight(TEST_CONFIG);
    runTo(nominal, 10);
    runTo(degraded, 10);
    degraded.injectAnomaly("engine-underperform");
    runTo(nominal, 300);
    runTo(degraded, 300);

    const nSamples = nominal.getSamples();
    const dSamples = degraded.getSamples();
    const nFinal = nSamples[nSamples.length - 1];
    const dFinal = dSamples[dSamples.length - 1];

    const nApogee = Math.max(...nSamples.map((s) => s.altitudeM));
    const dApogee = Math.max(...dSamples.map((s) => s.altitudeM));

    expect(dFinal.velocityMs).toBeLessThan(nFinal.velocityMs);
    expect(dApogee).toBeLessThan(nApogee);
    // Sanity: the degraded flight still lifted off and climbed.
    expect(dApogee).toBeGreaterThan(50_000);
  });

  it("fuel-leak ends the stage-1 burn early", () => {
    const nominal = new Flight(TEST_CONFIG);
    const leaky = new Flight(TEST_CONFIG);
    leaky.injectAnomaly("fuel-leak");
    runTo(nominal, 130);
    runTo(leaky, 130);
    const nominalMeco = eventTime(nominal, "MECO");
    const leakyMeco = eventTime(leaky, "MECO");
    // 1.6x mass flow => burnout at burnTime / 1.6.
    expect(leakyMeco).toBeLessThan(nominalMeco - 10);
    expect(
      Math.abs(leakyMeco - TEST_CONFIG.stages[0].burnTimeS / 1.6),
    ).toBeLessThanOrEqual(1);
  });

  it("scrubTo(t) re-simulation yields samples identical to live ticking", () => {
    const live = new Flight(TEST_CONFIG);
    runTo(live, 60);
    const liveSamples = live.getSamples();

    const scrubbed = new Flight(TEST_CONFIG);
    scrubbed.scrubTo(60);
    const scrubbedSamples = scrubbed.getSamples();

    expect(scrubbedSamples.length).toBe(liveSamples.length);
    expect(scrubbedSamples).toEqual(liveSamples);
  });

  it("scrubTo replays anomalies at their injection times deterministically", () => {
    const live = new Flight(TEST_CONFIG);
    runTo(live, 20);
    live.injectAnomaly("engine-underperform");
    runTo(live, 80);

    const scrubbed = new Flight(TEST_CONFIG);
    scrubbed.scrubTo(20);
    scrubbed.injectAnomaly("engine-underperform");
    scrubbed.scrubTo(80);

    expect(scrubbed.getSamples()).toEqual(live.getSamples());
    expect(scrubbed.getEvents()).toEqual(live.getEvents());
  });

  it("sensor-noise perturbs reported samples but leaves true state identical", () => {
    const clean = new Flight(TEST_CONFIG);
    const noisy = new Flight(TEST_CONFIG);
    runTo(clean, 10);
    runTo(noisy, 10);
    noisy.injectAnomaly("sensor-noise");
    runTo(clean, 60);
    runTo(noisy, 60);

    // Ground truth physics is untouched by the noise layer.
    expect(noisy.getTrueState()).toEqual(clean.getTrueState());

    // Reported samples differ.
    const cleanSamples = clean.getSamples();
    const noisySamples = noisy.getSamples();
    expect(noisySamples.length).toBe(cleanSamples.length);
    const differs = noisySamples.some(
      (s, i) => s.altitudeM !== cleanSamples[i].altitudeM,
    );
    expect(differs).toBe(true);

    // And the engine raises a SENSOR_ANOMALY alert.
    const sensorAlert = noisy
      .getAlerts()
      .find((a) => a.message.includes("SENSOR_ANOMALY"));
    expect(sensorAlert).toBeDefined();
    expect(sensorAlert?.severity).toBe("critical");
  });

  it("reset with the same seed replays the mission identically", () => {
    const f = new Flight(TEST_CONFIG);
    runTo(f, 100);
    const first = f.getSamples();
    f.reset();
    runTo(f, 100);
    expect(f.getSamples()).toEqual(first);
  });

  it("the demo config flies a sane nominal mission", () => {
    const f = new Flight(ASTRA_DEMO_CONFIG);
    runTo(f, f.getMissionDuration());
    const types = f.getEvents().map((e) => e.type);
    expect(types).toEqual([
      "LIFTOFF",
      "MAXQ",
      "MECO",
      "STAGE_SEP",
      "SECOND_IGNITION",
      "SECO",
    ]);
    const apogee = Math.max(...f.getSamples().map((s) => s.altitudeM));
    expect(apogee).toBeGreaterThan(150_000); // climbs past 150 km
  });
});
