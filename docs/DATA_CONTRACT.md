# Personal Finance Console — Data Contract (Interface Specification)

This document specifies TypeScript concepts and the frozen Owner-approved V0.1 clarifications below. Persisted facts, user parameters, and derived results must remain separate; do not store all three indiscriminately in one structure.

## Shared conventions

- Monetary values use a consistent currency and precision chosen by the implementation; no currency conversion behavior is defined here.
- Dates and periods must identify the relevant calendar date/month for comparisons.
- IDs identify records. Owner-specific values belong in profile/seed data, never in general constants or model rules.
- The following are conceptual interfaces, not a complete field-level schema. Add only fields required to implement approved behavior; do not infer business policies from field names.

### V0.1 Owner clarification

- Currency strings are finite, have at most two fractional digits, and are limited to an absolute value of `999999999999.99`; invalid, over-precision, out-of-range, or unsupported scientific-notation input is rejected. Canonical display uses exact decimal/string operations.
- Validation distinguishes `USER_INPUT_MONEY` (the per-entry limit above), `AGGREGATE_MONEY` (finite valid sums that may exceed the per-entry limit), and `DERIVED_MONEY` (finite valid Model Core outputs that may exceed the limit, precision, or use Decimal scientific notation). Aggregates and derived values remain Decimal values without clamping or rounding before model comparisons.
- A financial event's user-local business date is separate from its timestamp instant. The local business date determines day/month aggregation; UTC date text is identity/transport data only.
- Period queries use half-open boundaries. Historical revisions and income facts are filtered by `effective_date <= asOfDate` or the equivalent stored fields.

## FACT interfaces

### FinancialProfile

User/profile identity and profile-level facts needed to associate local financial records. It must not contain general model formulas or Owner-specific business defaults.

### IncomeRecord

Represents planning or actual income, with an amount, relevant period/date, and a state capable of distinguishing `EXPECTED`, `PENDING`, and `RECEIVED`. Planning Income and Actual Income must remain distinguishable.

### ExpenseRecord

Represents an occurred expense with amount, date/time, optional category, and optional note. Quick-entry categories: Food, Transport, Shopping, Entertainment, Household, Other. Necessary expense categories used during setup: housing, basic food, transport/commuting, utilities/communications, insurance, fixed family responsibilities, other necessary spending.

V0.1 persists `business_date` independently from the instant timestamp; that local date drives financial grouping.

### CashAccount

Represents a cash account/balance and the fact needed to determine whether its cash is eligible for Safety Resources. Do not assume all cash is eligible.

### Asset

Represents an asset fact/snapshot with amount or balance, relevant date, liquid-asset classification as applicable, and `include_in_safety_resources` eligibility. Eligibility is data, not a universal hard-coded rule.

### Debt

Represents debt facts including `name`, `current_balance`, optional/current-month `current_month_due`, and `fixed_monthly_payment`. Preserve a way to identify whether a valid current-month due exists so the current-month precedence rule can be applied without double counting. Monthly maintenance separately tracks whether the current-month fact is missing and needs confirmation; an unchanged confirmed balance still materializes that fact, with a blank due remaining absent/null.

## PARAMETER interface

### FinancialSettings

Contains user-selected settings, including `safety_coverage_target_months`. Target examples are 3, 6, 9, 12, and Custom; there is no universal 6-month default. Current spending recommendation settings or hard caps must not be inferred from Owner examples unless separately approved as user-entered data.

Also includes user-selected `minimum_cash_coverage_months`, `safety_recovery_horizon_months` (needed when Safety Gap > 0 and Base Surplus > 0), and `desired_monthly_discretionary_spending`. Examples are options, not system defaults. The desired spending amount is a user target, not a derived recommendation.

## DERIVED RESULT interfaces

### MonthlySnapshot

Represents derived monthly results and their period/baseline context, not a replacement for underlying facts. May expose monthly spending, same-period comparison, debt/asset comparison references, and derived trend outputs needed by the home screen.

### SafetyResult

Represents derived Safety Resources, Monthly Core Obligations, Safety Coverage Status (`NORMAL` or `NO_CORE_OBLIGATION`), nullable Safety Coverage Months and Cash Coverage Months, Safety Target Resources, Safety Gap, Cash Safety Gate Status (`ACTIVE`, `CLEAR`, or `NOT_APPLICABLE`), `required_monthly_safety_recovery`, and `actual_monthly_safety_recovery`. Coverage values are null when obligations are <= 0 and never NaN or Infinity; in that case the gate is `NOT_APPLICABLE`.

### SpendingResult

Represents derived Recommended Monthly Spending, Actual Variable Spending, Remaining Optional Spending Capacity, Amount Above Recommendation, Base Surplus, `safe_optional_capacity`, `desired_monthly_discretionary_spending`, `unallocated_surplus`, `recommended_new_investment_capacity`, and Spending Status (`NORMAL`, `STRUCTURAL_DEFICIT`, or `BALANCED_NO_SURPLUS`). Structural deficit applies only when Base Surplus < 0; balanced no surplus applies when it equals 0. In either case Recommended Monthly Spending and Remaining Optional Spending Capacity are 0; balanced no surplus also has Recommended New Investment Capacity 0 and does not trigger the Structural Deficit Hard Gate. When Safety Gap > 0, recommended new investment capacity is 0. The desired target remains visible. The recommendation remains visible after overspending.

### TrendResult

Represents the overall state, four dimension directions (`LIQUIDITY_SAFETY`, `DEBT`, `CONSUMPTION`, `WEALTH`), baseline availability, and Primary Improvement / Primary Drag. Each dimension direction is `IMPROVING`, `NEUTRAL`, `WORSENING`, `NO_BASELINE`, or `NOT_APPLICABLE`. `NOT_APPLICABLE` is excluded from all direction counts and valid comparison dimension count. When there are no core obligations, LIQUIDITY_SAFETY is `NOT_APPLICABLE` for coverage-based voting. With fewer than two valid comparison dimensions, state is `BASELINE_BUILDING`; otherwise, an Active gate plus worsening LIQUIDITY_SAFETY yields `DETERIORATING` regardless of total worsening count. The normal three-worsening-dimensions rule independently yields `DETERIORATING`; an Active gate otherwise yields `UNDER_PRESSURE`. It does not require a cross-metric Severity Score.

### PriorityAction

Represents a deterministic `action_code` and short reason/context, with at most one action: `RESTORE_CORE_BALANCE`, `REBUILD_CASH_FLOOR`, existing approved non-Hard-Gate codes, or `NO_ACTION`. `STRUCTURAL_DEFICIT` maps to `RESTORE_CORE_BALANCE` and wins over a breached Cash Floor. Otherwise, an `ACTIVE` cash-floor gate maps to `REBUILD_CASH_FLOOR`. `NOT_APPLICABLE` creates no Hard Gate action. Reasons are deterministic model context, not personalized natural-language coaching; UI wording is deferred. No unapproved thresholds may be embedded in the contract.

## Separation requirement

`FinancialProfile`, `IncomeRecord`, `ExpenseRecord`, `CashAccount`, and `Debt` describe user/profile facts, with `Asset` describing asset facts/snapshots. `FinancialSettings` describes parameters. `MonthlySnapshot`, `SafetyResult`, `SpendingResult`, `TrendResult`, and `PriorityAction` describe derived results. Concrete persistence shape and migrations are deferred to an authorized implementation phase.
