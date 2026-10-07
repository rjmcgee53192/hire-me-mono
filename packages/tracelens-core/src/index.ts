/**
 * @repo/tracelens-core — synthetic load generation + observability statistics.
 *
 * A pure-TypeScript toolkit for simulating API traffic and computing the
 * statistics real observability backends serve: streaming latency histograms,
 * rolling percentiles, error budgets, synthetic distributed traces, and
 * threshold alerting. The TraceLens showcase demo drives all of these live.
 */

export { mulberry32, makeGaussian, seededGaussian } from "./rng";

export type { MockEndpoint, HttpStatus, Sample } from "./generator";
export { LoadGen } from "./generator";

export { HISTOGRAM_BOUNDARIES, StreamingHistogram, RollingStats, percentileSorted } from "./stats";
export type { EndpointStats } from "./stats";

export { ErrorBudget } from "./budget";
export type { BudgetState } from "./budget";

export { makeTrace } from "./traces";
export type { Span, Trace, MakeTraceOptions } from "./traces";

export { AlertEngine, makeRuleId } from "./alerts";
export type { AlertMetric, AlertRule, FiredAlert } from "./alerts";
