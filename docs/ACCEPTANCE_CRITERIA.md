# Personal Finance Console — Acceptance Criteria

These criteria define later V0.1 acceptance. They do not authorize implementation in the current specification phase.

## Initialization and data boundaries

A. Any user can start with empty data, enter their own information, and run the same model.
B. Owner-specific figures are not hard-coded into general formulas, business constants, or model decisions.
C. Facts, parameters, and derived results remain distinguishable in the data contract and implementation.
D. Setup collects Stable Monthly Income, Essential Expenses, Current Cash, Debt, Liquid Investment Assets, and a user-chosen Safety Coverage Target; it targets about 2–3 minutes.
E. Users can select Safety Coverage Target and minimum cash-coverage floor. Six months of Safety Coverage does not mean all six months must be held as cash.
F. The cash floor is a user parameter; no Owner example (including two months) is a universal default.

## Model correctness

G. For a debt with a valid current-month due, Mandatory Debt Service uses Current Month Due and does not also count Fixed Monthly Payment for that same debt/month. Without a valid due, it uses Fixed Monthly Payment.
H. When Monthly Core Obligations <= 0, the model reports `NO_CORE_OBLIGATION`; coverage does not become NaN, Infinity, or a fabricated number.
I. If Base Surplus < 0, the model reports `STRUCTURAL_DEFICIT`, Recommended Monthly Spending = 0, and Remaining Optional Spending Capacity = 0, distinguishable from discretionary overspending. Desired Monthly Discretionary Spending remains as a user target.
J. If Base Surplus = 0, the model reports `BALANCED_NO_SURPLUS`, not `STRUCTURAL_DEFICIT`; Recommended Monthly Spending, Remaining Optional Spending Capacity, and Recommended New Investment Capacity are 0. It does not trigger the Structural Deficit Hard Gate.
K. Expected or pending income not yet received is not treated as proof that the month has no income; Planning Income and Actual Income remain distinct.
L. Safety Resources use Eligible Cash and Eligible Liquid Investment Assets, with asset eligibility controlled through `include_in_safety_resources`.
M. Safety Coverage Target is user-chosen; six months is not a universal default or a cash-only requirement.
N. When Safety Gap > 0 and Base Surplus > 0, the user can set `safety_recovery_horizon_months`; Required Monthly Safety Recovery, Actual Monthly Safety Recovery, and Safe Optional Capacity follow the formulas in FINANCIAL_MODEL_SPEC.md. No fixed 50%/70%/80% allocation is hard-coded.
O. Recommended Monthly Spending never exceeds Desired Monthly Discretionary Spending and follows the separate rules for Safety Gap present or absent.
P. When Safety Gap > 0, Recommended New Investment Capacity is 0. This does not force sale of existing assets or prevent independent user action.
Q. When Safety Gap = 0, Unallocated Surplus is calculated as specified; V0.1 does not invent investment allocation proportions.

## Trend and action behavior

R. The overall trend has four main dimensions: `LIQUIDITY_SAFETY`, `DEBT`, `CONSUMPTION`, and `WEALTH`; Safety Coverage and Cash Coverage do not count as separate votes.
S. Safety/Cash/asset changes are not simply added or weighted together to award duplicate credit for the same asset growth.
T. Investment asset market-value increase alone cannot make LIQUIDITY_SAFETY `IMPROVING` when Cash and Core Obligations have not improved. The gain may make WEALTH `IMPROVING`.
U. Eligible Cash increase with Cash Coverage increase, Core Obligations decrease with Cash Coverage increase, or Cash Floor changing from unmet to met may make LIQUIDITY_SAFETY `IMPROVING`.
V. If Safety Coverage rises only because of investment asset market-value increase, LIQUIDITY_SAFETY is `NEUTRAL`; crossing Safety Target updates target status and strong-improvement eligibility but adds no second directional vote.
W. Consumption increases while remaining on the reasonable Recommended Spending trajectory are not automatically classified as a Drag; exceeding that trajectory and worsening versus the prior same period is required for a clear Drag.
X. Recommended Spending Utilization handles a zero recommendation without NaN or Infinity.
Y. A user below the Cash Floor triggers an `ACTIVE` Cash Safety Gate; `STRUCTURAL_DEFICIT` also triggers it. `NO_CORE_OBLIGATION` yields `NOT_APPLICABLE`, not Active or Clear. With fewer than two valid dimensions, report `BASELINE_BUILDING` and expose the gate separately. Otherwise, an Active gate plus worsening `LIQUIDITY_SAFETY` yields `DETERIORATING` regardless of the total worsening count. If liquidity safety is not worsening, normal qualification for `DETERIORATING` (at least three worsening dimensions) still applies; otherwise report `UNDER_PRESSURE`.
Z. When the Cash Floor is met but the Safety Target is not, Safety Target shortfall alone does not activate the Hard Gate; improvement may be reported, but not `IMPROVING_STRONGLY` until the Safety Target is met.
AA. With fewer than two valid comparison dimensions, Overall Trend is `BASELINE_BUILDING`; `NOT_APPLICABLE` is excluded from valid count and direction counts.
AB. Dimension directions are `IMPROVING`, `NEUTRAL`, `WORSENING`, `NO_BASELINE`, or `NOT_APPLICABLE`; the latter two are not counted as improving or worsening.
AC. Overall Trend follows the decision rules and precedence in FINANCIAL_MODEL_SPEC.md: fewer than two valid dimensions gives `BASELINE_BUILDING`; Active gate plus worsening liquidity gives `DETERIORATING`; otherwise at least three worsening dimensions gives `DETERIORATING`; otherwise an Active gate gives `UNDER_PRESSURE`; otherwise normal trend rules apply.
AD. Primary Improvement and Primary Drag use the approved dimension priority, not raw cross-metric magnitude or invented percentage severity scores.
AE. Priority Action returns a deterministic `action_code` and short reason/context, at most one action, and `NO_ACTION` when no clear issue exists. `STRUCTURAL_DEFICIT` maps to `RESTORE_CORE_BALANCE`, ahead of a breached cash floor; an active cash-floor gate without structural deficit maps to `REBUILD_CASH_FLOOR`; `NOT_APPLICABLE` creates no Hard Gate action. `NO_CORE_OBLIGATION` alone is not a cash warning. Do not generate personalized financial coaching; UI wording is deferred.

## Experience and recalculation

AF. Quick expense entry requires amount, supplies date/time automatically, permits an optional category and note, and targets completion in 3–5 seconds.
AG. Saving an expense immediately recalculates Monthly Spend, same-period comparison, remaining spending capacity, trend, Primary Improvement, Primary Drag, and Priority Action.
AH. The home screen shows the specified lightweight financial values and at most one Priority Action.
AI. Model outputs can be explained from facts, parameters, and approved calculation rules.

## Final model edge cases

These are explicit acceptance examples for the final model freeze:

1. Planning Income = 5000 and Monthly Core Obligations = 5000 produces `BALANCED_NO_SURPLUS`, not `STRUCTURAL_DEFICIT`.
2. Planning Income = 4999 and Monthly Core Obligations = 5000 produces `STRUCTURAL_DEFICIT`.
3. Monthly Core Obligations = 0 produces Safety Coverage Status `NO_CORE_OBLIGATION`, null/undefined Safety Coverage Months and Cash Coverage Months, and Cash Safety Gate Status `NOT_APPLICABLE`; no Infinity, NaN, fabricated coverage, cash warning, or valid LIQUIDITY_SAFETY vote is produced.
4. If investment fund market value rises while Eligible Cash and Monthly Core Obligations do not improve, WEALTH may be `IMPROVING`, but LIQUIDITY_SAFETY is not `IMPROVING` solely because of that gain.
5. If Eligible Cash increases and Cash Coverage increases, LIQUIDITY_SAFETY may be `IMPROVING`.
6. If Monthly Core Obligations decrease and Cash Coverage increases, LIQUIDITY_SAFETY may be `IMPROVING`.

## Owner-approved audit clarifications

AJ. Expense entry preserves the user's local `business_date` independently from its instant timestamp. Local month boundaries, year end, leap day, short months, offset signs, and repeated DST hours group by `business_date`; period reads use half-open boundaries and include `23:59:59.999` on the intended date.
AK. A historical model at `asOfDate` excludes any planning-income or settings revision whose effective/as-of date is later than that date, including revisions in the same month. Future-dated Actual Income is excluded from that historical snapshot.
AL. User-entered monetary strings are finite, use no more than two fractional digits, and have absolute value at most `999999999999.99`. Invalid, scientific-notation, excess-precision, and out-of-range values are rejected. Exact cents survive UI, service, SQLite, model, and Home display.
AM. Every Essential Expense item is non-negative and is validated at an application/domain boundary as well as in the UI; a failed validation preserves the input and provides a visible error.
AN. When the current month's debt fact is missing, Home provides a route to maintenance. Maintenance shows the active debt with its latest valid prior balance editable, leaves current-month due blank unless entered, and does not change the prior-month fact. Saving a current-month fact restores Home.
AO. Requirement/prevalidation failures are visible, do not save or falsely report success, and leave the maintenance form open with entered input available for retry.
AP. Monetary validation separates `USER_INPUT_MONEY` (per-entry range, precision, and notation limits), `AGGREGATE_MONEY` (finite valid sums that may exceed the per-entry limit), and `DERIVED_MONEY` (finite Decimal outputs that may have greater precision or scientific-notation serialization). Aggregate and derived values remain intact for Model Core and historical comparisons.
AQ. A debt missing its current-month fact is marked for confirmation in maintenance; saving creates that fact even with unchanged values, covers every missing active debt shown, preserves a blank due as null/absent, and does not duplicate an already-present unchanged current-month fact.

Acceptance of future code must include appropriate unit and relevant integration evidence; this document does not prescribe a specific test framework.
