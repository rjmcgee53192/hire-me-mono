/**
 * Error budgets, the quantitative half of an SLO.
 *
 * The math: for an SLO target like 99.9%, the allowed error ratio is 0.1%.
 * Over N total requests, the budget permits N * 0.001 errors. Burn rate is
 * actual errors / permitted errors — 1.0 means you are consuming the budget
 * exactly as fast as the SLO allows, > 1.0 means you are breaching.
 * Budget remaining is the fraction of the permitted errors you haven't spent.
 */

export interface BudgetState {
  /** 0–100: how much of the permitted-error allowance is unspent. */
  budgetPctRemaining: number;
  /** errors / allowedErrors. 1.0 = spending exactly at the SLO pace. */
  burnRate: number;
  /** True when the budget is exhausted (burnRate > 1). */
  isBreaching: boolean;
  total: number;
  errors: number;
  allowedErrors: number;
}

export class ErrorBudget {
  /** @param sloTarget e.g. 0.999 for "99.9% of requests succeed" */
  constructor(
    private readonly sloTarget: number,
    private readonly windowSec: number,
  ) {
    if (sloTarget <= 0 || sloTarget >= 1) {
      throw new Error("sloTarget must be in (0, 1)");
    }
    if (windowSec <= 0) throw new Error("windowSec must be positive");
  }

  get target(): number {
    return this.sloTarget;
  }

  get window(): number {
    return this.windowSec;
  }

  consume(total: number, errors: number): BudgetState {
    const allowedErrors = total * (1 - this.sloTarget);
    if (total <= 0) {
      return {
        budgetPctRemaining: 100,
        burnRate: 0,
        isBreaching: false,
        total: 0,
        errors: 0,
        allowedErrors: 0,
      };
    }
    if (allowedErrors <= 0) {
      return {
        budgetPctRemaining: errors > 0 ? 0 : 100,
        burnRate: errors > 0 ? Number.POSITIVE_INFINITY : 0,
        isBreaching: errors > 0,
        total,
        errors,
        allowedErrors: 0,
      };
    }
    const burnRate = errors / allowedErrors;
    return {
      budgetPctRemaining: Math.max(0, (1 - burnRate) * 100),
      burnRate,
      isBreaching: burnRate > 1,
      total,
      errors,
      allowedErrors,
    };
  }

  /**
   * Budget-remaining series (0–100) for a sequence of per-interval
   * {total, errors} buckets. The budget is sized once for the whole window
   * from `windowTotal` (the expected request count for the window), so each
   * point answers "how much of the window's error allowance is still
   * unspent after this interval?".
   */
  burnDown(
    history: ReadonlyArray<{ total: number; errors: number }>,
    windowTotal: number,
  ): number[] {
    const allowed = windowTotal * (1 - this.sloTarget);
    if (allowed <= 0) return history.map(() => 100);
    let errors = 0;
    return history.map((h) => {
      errors += h.errors;
      return Math.max(0, (1 - errors / allowed) * 100);
    });
  }
}
