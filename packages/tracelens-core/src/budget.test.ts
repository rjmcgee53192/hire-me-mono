import { describe, expect, it } from "vitest";
import { ErrorBudget } from "./budget";

describe("ErrorBudget", () => {
  it("at exactly the allowed error ratio, budget is ~0 and burn rate ~1", () => {
    // 99.9% SLO over 10k requests permits 10 errors; 10 errors observed.
    const budget = new ErrorBudget(0.999, 3600);
    const state = budget.consume(10000, 10);
    expect(state.burnRate).toBeCloseTo(1, 10);
    expect(state.budgetPctRemaining).toBeCloseTo(0, 10);
    expect(state.isBreaching).toBe(false);
    expect(state.allowedErrors).toBeCloseTo(10, 10);
  });

  it("at 1% errors against a 99.9% SLO, the budget is breached", () => {
    const budget = new ErrorBudget(0.999, 3600);
    const state = budget.consume(10000, 100);
    expect(state.burnRate).toBeCloseTo(10, 10);
    expect(state.budgetPctRemaining).toBe(0);
    expect(state.isBreaching).toBe(true);
  });

  it("with zero errors the budget is untouched", () => {
    const budget = new ErrorBudget(0.999, 3600);
    const state = budget.consume(5000, 0);
    expect(state.burnRate).toBe(0);
    expect(state.budgetPctRemaining).toBe(100);
    expect(state.isBreaching).toBe(false);
  });

  it("burn-down series depletes linearly under a constant error ratio", () => {
    const budget = new ErrorBudget(0.999, 3600);
    // 10 intervals of 1000 requests with 1 error each: exactly at budget pace
    // for a 10k-request window with a 10-error allowance.
    const history = Array.from({ length: 10 }, () => ({ total: 1000, errors: 1 }));
    const series = budget.burnDown(history, 10000);
    expect(series).toHaveLength(10);
    expect(series[0]).toBeCloseTo(90, 6);
    expect(series[4]).toBeCloseTo(50, 6);
    expect(series[9]).toBeCloseTo(0, 6);
    for (let i = 1; i < series.length; i++) {
      expect(series[i]).toBeLessThan(series[i - 1]);
    }
  });

  it("burn-down floors at zero when errors exceed the allowance", () => {
    const budget = new ErrorBudget(0.999, 3600);
    const history = Array.from({ length: 5 }, () => ({ total: 1000, errors: 10 }));
    const series = budget.burnDown(history, 10000);
    expect(series[0]).toBeCloseTo(0, 10);
    expect(series[4]).toBe(0);
  });

  it("empty windows report a full budget without breaching", () => {
    const budget = new ErrorBudget(0.99, 60);
    const state = budget.consume(0, 0);
    expect(state.budgetPctRemaining).toBe(100);
    expect(state.isBreaching).toBe(false);
  });
});
