# Personal Finance Console — Financial Model Specification V1.0

## Model Layers

Keep three conceptual layers separate:

- **FACTS:** events or values that have actually occurred or been observed.
- **PARAMETERS:** user-selected settings or longer-term planning inputs.
- **DERIVED RESULTS:** values calculated by the model.

Owner profile information is user data, not model logic. A blank user must be able to enter their own data and run the same model.

### Owner-approved V0.1 time and money contract

- Financial calendar dates use the user's local business date. Expense timestamps retain instant identity, while `business_date` determines expense day/month, aggregation, comparisons, and calendar grouping. UTC date text must not determine a financial period.
- Date ranges use half-open boundaries (`start <= value < next period start`) or an equivalent boundary-safe form.
- Historical queries honor `asOfDate`: a revision is eligible only when its effective date is not after the requested `asOfDate`, even when both dates fall in the same month. Future-dated actual income is excluded from historical snapshots.
- User-entered currency values are finite decimal strings with at most two fractional digits and absolute value at most `999999999999.99`. Out-of-range values, excess decimals, invalid values, and unsupported scientific notation are rejected. Financial display preserves decimal values without converting canonical money to JavaScript `Number`.
- Monetary validation has three explicit domains: `USER_INPUT_MONEY` applies the preceding range, precision, and notation restrictions to each entered amount; `AGGREGATE_MONEY` accepts valid finite Decimal sums of valid facts even when the result exceeds that single-entry range; `DERIVED_MONEY` accepts valid finite Decimal model outputs regardless of scale or Decimal serialization notation. Aggregates and derived values are not rounded or clamped before Model Core comparison.
- Each Essential Expense item is non-negative; validating only its aggregate is insufficient.

## Safety Resources and Obligations

An asset can be included or excluded from Safety Resources through `include_in_safety_resources`; eligibility must not be entirely hard-coded.

**Safety Resources** = Eligible Cash + Eligible Liquid Investment Assets.

**Monthly Core Obligations** = Essential Expenses + Mandatory Debt Service.

When Monthly Core Obligations > 0:

- **Safety Coverage Status** = `NORMAL`.
- **Safety Coverage Months** = Safety Resources / Monthly Core Obligations.
- **Cash Coverage Months** = Eligible Cash / Monthly Core Obligations.

When Monthly Core Obligations <= 0:

- **Safety Coverage Status** = `NO_CORE_OBLIGATION`.
- Safety Coverage Months and Cash Coverage Months are undefined / null.
- **Cash Safety Gate Status** = `NOT_APPLICABLE` because there are no core obligations to cover.

Coverage fields must never contain Infinity, NaN, or fabricated large values. Cash Coverage remains separate because liquid investments do not remove short-term liquidity risk when cash is very low.

### No Core Obligations Edge Case — RESOLVED (`OPEN_DECISION_FM_004`)

The statuses, nullable coverage values, excluded LIQUIDITY_SAFETY vote, and absence of an automatic cash warning above fully define this edge case.

## Debt and Mandatory Debt Service

V0.1 debt facts include `name`, `current_balance`, `current_month_due`, and `fixed_monthly_payment`.

For the current month, the same debt must not count both Current Month Due and Fixed Monthly Payment. If a valid Current Month Due exists for the month, use it; otherwise use Fixed Monthly Payment. A future Schedule module may supersede this rule.

## Income

Keep Planning Income distinct from Actual Income. Stable Monthly Income supports baseline planning. Actual Income records real current-month facts. An expected salary that has not arrived must not be treated as proof that the month has no income. Income records distinguish Expected, Pending, and Received.

## Spending and Surplus

**Base Surplus** = Planning Income - Essential Expenses - Mandatory Debt Service.

If Base Surplus < 0, Spending Status is `STRUCTURAL_DEFICIT`: Planning Income is insufficient to cover Essential Expenses plus Mandatory Debt Service. **Recommended Monthly Spending** = 0 and **Remaining Optional Spending Capacity** = 0. Preserve and display Desired Monthly Discretionary Spending as a user target.

If Base Surplus = 0, Spending Status is `BALANCED_NO_SURPLUS`: Planning Income exactly covers Essential Expenses plus Mandatory Debt Service, with no Optional Spending Surplus. **Recommended Monthly Spending** = 0, **Remaining Optional Spending Capacity** = 0, and **Recommended New Investment Capacity** = 0. This is not `STRUCTURAL_DEFICIT` and does not trigger the Structural Deficit Hard Gate. Preserve and display Desired Monthly Discretionary Spending as a user target.

If Base Surplus > 0, Spending Status is `NORMAL` and the applicable spending and recovery rules below apply.

The user parameter **Desired Monthly Discretionary Spending** is the user's desired monthly variable living-spending level. It is a target and an upper bound on the model's recommendation, not a model result.

The three spending concepts remain distinct:

- **Recommended Monthly Spending:** a current model recommendation constrained by the rules below; it can rise or fall as financial capacity changes.
- **Remaining Optional Spending Capacity** = `max(Recommended Monthly Spending - Actual Variable Spending, 0)`.
- **Amount Above Recommendation** = `max(Actual Variable Spending - Recommended Monthly Spending, 0)`.

When Safety Gap > 0 and Base Surplus > 0, calculate Safe Optional Capacity as described under Safety Recovery. Recommended Monthly Spending = `min(Desired Monthly Discretionary Spending, Safe Optional Capacity)`.

When Safety Gap = 0 and Base Surplus > 0, Recommended Monthly Spending = `min(Desired Monthly Discretionary Spending, Base Surplus)`.

Unspent surplus is not automatically recommended for consumption. **Unallocated Surplus** = `max(Base Surplus - Recommended Monthly Spending, 0)`. It may be considered by a future Investment Engine. V0.1 does not define investment proportions.

Overspending does not erase the recommendation. If Recommended is 2400 and Actual Variable Spending is 3000, show Recommended 2400, Remaining 0, and Above Recommendation 600.

## Safety Target, Gap, and Recovery

Safety Coverage Target is a user-selected parameter in months. Examples include 3, 6, 9, 12, or Custom. Six months is an Owner selection, not a universal default.

**Safety Target Resources** = Safety Coverage Target × Monthly Core Obligations.

**Safety Gap** = `max(Safety Target Resources - Safety Resources, 0)`.

### Safety Recovery Allocation Policy — RESOLVED (`OPEN_DECISION_FM_001`)

Use a **Target-Horizon Safety Recovery Model**, not an unexplained fixed proportion.

The user parameter `safety_recovery_horizon_months` is how many months the user wants to take to replenish Safety Resources to their Safety Coverage Target. Example choices are 6, 12, 18, 24, or Custom; these are not fixed system rules.

The parameter is needed only when Safety Gap > 0 and Base Surplus > 0. If the target is already met, no Safety Recovery Horizon is needed.

When Safety Gap > 0 and Base Surplus > 0:

- **Required Monthly Safety Recovery** = Safety Gap / Safety Recovery Horizon Months.
- **Actual Monthly Safety Recovery** = `min(Required Monthly Safety Recovery, Base Surplus)`.
- **Safe Optional Capacity** = `max(Base Surplus - Actual Monthly Safety Recovery, 0)`.

Outside those recovery conditions, no positive recovery allocation is made; do not use a negative recovery amount. If Base Surplus < 0, the structural-deficit rule applies. If Base Surplus = 0, the balanced-no-surplus rule applies.

If Safety Gap > 0, **Recommended New Investment Capacity** = 0. This is advice against adding new investment; it does not require selling existing assets or prevent the user from investing independently.

If Safety Gap = 0, V0.1 does not perform complete investment allocation. Unallocated Surplus may enter a future Investment Engine, but V0.1 defines no investment percentage.

## Investment Principle

A fund's monthly gain is an asset-change fact, not an instruction to invest more next month. A monthly loss is not an instruction to stop investing. Future investment capacity may depend on cash safety, Safety Coverage, debt, income, and Base Surplus. V0.1 does not implement investment allocation.

## Trend Engine

V0.1 uses a Hard Gate plus Directional Trend, not a 0–100 Financial Health Score or a weighted sum of unlike raw metric changes.

The four main dimensions are:

1. `LIQUIDITY_SAFETY`
2. `DEBT`
3. `CONSUMPTION`
4. `WEALTH`

Each dimension reports one direction: `IMPROVING`, `NEUTRAL`, `WORSENING`, `NO_BASELINE`, or `NOT_APPLICABLE`. `NOT_APPLICABLE` is excluded from Improving Count, Worsening Count, and valid comparison dimension count.

### Dimension inputs

- **LIQUIDITY_SAFETY:** its directional trend is based primarily on Cash Coverage change and Cash Floor status changes. Real liquidity improvements include Eligible Cash increasing with Cash Coverage increasing, Cash Coverage increasing because Mandatory Core Obligations decrease, or the Cash Floor changing from unmet to met. Safety Coverage remains an input to safety state, Safety Gap, Safety Target status, and eligibility for `IMPROVING_STRONGLY`; it is not by itself an additional directional vote.
- **DEBT:** current valid debt balance versus previous valid debt balance. Debt Service Burden is out of V0.1 scope.
- **CONSUMPTION:** considers both same-period consumption change and Recommended Spending Utilization. Higher spending alone is not automatically worse.
- **WEALTH:** liquid/investable asset snapshot change. This dimension expresses asset-value changes. It is separate directional information, but must not be added numerically to LIQUIDITY_SAFETY as a second reward for the same investment asset market-value increase.

If Cash and Mandatory Core Obligations do not improve, and Safety Coverage rises only because Eligible Investment Asset market value increased, set `LIQUIDITY_SAFETY` to `NEUTRAL`; the change is represented by `WEALTH`. If Safety Coverage crosses its target due to that same market-value increase, update Safety Target status and remove the target-based restriction on `IMPROVING_STRONGLY` eligibility, but do not award an extra LIQUIDITY_SAFETY improvement vote for the crossing.

Consumption comparisons use the same elapsed period of adjacent months (for example, October 1–4 against September 1–4 on October 4). Debt and asset comparisons use current valid values/snapshots against previous valid values/snapshots.

When the prior period's required facts and parameters are available, reconstruct its Recommended Monthly Spending by running the same frozen Model Core with those facts and that period's `asOfDate`. Do not persist the derived recommendation as financial truth or copy the current recommendation backward.

For the elapsed portion of a month:

- **Prorated Recommended Spending** = Recommended Monthly Spending × Elapsed Days / Days In Month.
- **Consumption Utilization** = Current Same-period Spending / Prorated Recommended Spending.

If Recommended Monthly Spending or Prorated Recommended Spending is 0, do not divide; return an explicit nonnumeric status for utilization. Do not produce NaN or Infinity.

If consumption increases but remains on the reasonable Recommended Spending trajectory, it must not automatically be a Drag. Consumption becomes a clear Drag when it exceeds that trajectory and has worsened versus the prior same period.

### Cash Safety Hard Gate — RESOLVED (`OPEN_DECISION_FM_002`)

`minimum_cash_coverage_months` is a user parameter specifying the minimum months of core obligations the user wants covered by Eligible Cash. Example choices are 1, 2, 3, or Custom. Two months is not a universal default.

When Monthly Core Obligations > 0, Cash Safety Gate Status is `ACTIVE` if either:

- Spending Status is `STRUCTURAL_DEFICIT`; or
- Cash Coverage Months < Minimum Cash Coverage Months.

When Monthly Core Obligations <= 0, status is `NOT_APPLICABLE`. Otherwise status is `CLEAR` when Base Surplus >= 0 and Cash Coverage Months >= Minimum Cash Coverage Months. This makes `BALANCED_NO_SURPLUS` with a met cash floor clear while keeping its spending and investment capacity at zero.

With fewer than two valid comparison dimensions, report `BASELINE_BUILDING` while exposing the gate separately. With at least two, worsening `LIQUIDITY_SAFETY` under an `ACTIVE` gate yields `DETERIORATING` regardless of total worsening dimensions. The normal three-worsening-dimensions rule also yields `DETERIORATING`; otherwise an `ACTIVE` gate yields `UNDER_PRESSURE`.

Meeting the Cash Floor while Safety Coverage remains below the Safety Target is not automatically dangerous. The trend may be `IMPROVING` if the model shows continued improvement, but cannot be `IMPROVING_STRONGLY` until the Safety Target is met. When `NO_CORE_OBLIGATION`, set LIQUIDITY_SAFETY to `NOT_APPLICABLE` for coverage-based trend voting; it is excluded from valid comparison dimension count and cannot generate a cash-safety Priority Action by itself.

### Primary Improvement and Primary Drag — RESOLVED (`OPEN_DECISION_FM_003`)

Do not use cross-metric `NONE` / `LOW` / `MEDIUM` / `HIGH` / `CRITICAL` scores or invented thresholds. The V0.1 has no calibration history to support such precision.

Use the labels **Primary Improvement** and **Primary Drag** (future Chinese labels: 关键改善 and 主要拖累). These identify what matters most to the current financial decision, not the mathematically largest raw change.

Select each from dimension directions in this priority order:

1. `LIQUIDITY_SAFETY`
2. `DEBT`
3. `CONSUMPTION`
4. `WEALTH`

Return the first applicable `IMPROVING` dimension as Primary Improvement and first applicable `WORSENING` dimension as Primary Drag. `NEUTRAL`, `NO_BASELINE`, and `NOT_APPLICABLE` do not qualify. If none qualify, omit that item. This priority is decision relevance, not cross-metric magnitude scoring.

### Overall Trend

Apply this precedence in order: (1) with fewer than two valid comparison dimensions, report `BASELINE_BUILDING`; (2) with an `ACTIVE` gate and `LIQUIDITY_SAFETY=WORSENING`, report `DETERIORATING`, regardless of the total worsening count; (3) when the normal Trend Engine independently qualifies for `DETERIORATING` (at least three worsening dimensions), report `DETERIORATING`; (4) otherwise, with an `ACTIVE` gate, report `UNDER_PRESSURE`; (5) with a clear or not-applicable gate, apply normal clear-gate trend rules. `NO_BASELINE` and `NOT_APPLICABLE` are neither improving nor worsening and are not filled in artificially.

When the gate is clear and at least two valid comparison dimensions exist:

- `IMPROVING_STRONGLY`: at least 3 of 4 dimensions are Improving, none are Worsening, and Safety Coverage has met its target.
- `IMPROVING`: Improving count > Worsening count.
- `STABLE`: counts are equal or the pattern is mainly Neutral.
- `UNDER_PRESSURE`: Worsening count > Improving count.
- `DETERIORATING`: at least 3 dimensions are Worsening. This rule takes precedence over `UNDER_PRESSURE`.

`NO_BASELINE` and `NOT_APPLICABLE` dimensions do not count toward either side. Even with the Cash Safety Gate clear, a user below the Safety Target cannot receive `IMPROVING_STRONGLY`.

Overall states: `IMPROVING_STRONGLY`, `IMPROVING`, `STABLE`, `UNDER_PRESSURE`, `DETERIORATING`, `BASELINE_BUILDING`.

## Priority Action

Return one deterministic `action_code` and a short deterministic reason/context; do not generate free-form financial advice. If Spending Status is `STRUCTURAL_DEFICIT`, return `RESTORE_CORE_BALANCE` (Planning Income does not cover Essential Expenses plus Mandatory Debt Service). Otherwise, if Cash Safety Gate Status is `ACTIVE` because Cash Coverage Months is below Minimum Cash Coverage Months, return `REBUILD_CASH_FLOOR` (restore Eligible Cash to the selected floor before increasing optional spending or recommended new investment). Structural deficit wins when both conditions apply. If the gate is `NOT_APPLICABLE`, create no Hard Gate action. For other cases, retain existing approved action ordering (Primary Drag, Safety Gap, then another significant issue); when no clear issue exists, return `NO_ACTION`. `NO_CORE_OBLIGATION` alone is not a cash-safety warning. UI wording belongs to a later phase.

When a current-month debt fact is missing, Home exposes an actionable route to financial maintenance. Maintenance may present the latest valid prior debt balance as an editable fallback and marks that a current-month fact still requires confirmation. Saving materializes the current-month fact even when all editable values are unchanged. It leaves Current Month Due blank unless the user supplies a current-month fact and does not carry the prior month's due forward. Already-confirmed unchanged facts are not written again.
