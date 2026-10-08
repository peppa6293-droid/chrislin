# Personal Finance Console — Product Specification

## Product Goal

Personal Finance Console is a personal finance console that helps a user understand current financial condition, monthly spending, current cash, debt changes, liquid assets, and financial trends with very low maintenance effort. It is not traditional bookkeeping software, an enterprise finance console, an Excel dashboard, an investment trading product, or a gamified finance product.

The core use pattern is: record spending daily; maintain a small amount of real income, debt, and asset information monthly; let the model calculate the rest.

## V0.1 Scope

V0.1 includes:

1. Lightweight first-use setup.
2. The approved basic financial model.
3. A home screen.
4. Quick expense entry.
5. Local storage for financial facts.
6. Immediate home-screen recalculation after an expense is saved.

Priority order: model correctness, a useful home screen, then fast expense entry.

## Non-goals for V0.1

- Full 24-month forecast page.
- Bank-manager debt role, full debt detail page, or full asset detail page.
- Conservative/base/optimistic scenario UI.
- Excel sync, bank API, Alipay API, or cloud sync.
- Multiple users or a mobile app.
- Automatic investing or AI investment advice.
- Complex budgeting system or a 0–100 financial health score.

Future interfaces may be reserved, but these features are not V0.1 implementation work.

## First-use Workflow

First-use setup should take about 2–3 minutes. It collects Stable Monthly Income, Essential Expenses, Current Cash, Debt, Liquid Investment Assets, and the user's Safety Coverage Target. Ask the fixed main questions. Essential expenses use these simple categories: housing, basic food, transport/commuting, utilities/communications, insurance, fixed family responsibilities, and other necessary spending. The system totals them; V0.1 does not require finer categorization.

Safety Coverage Target is chosen by the user, in months. Supported examples are 3, 6, 9, 12, or Custom. Six months is the current Owner selection only and is not a universal default truth. The user may also set a minimum cash-coverage floor (examples 1, 2, 3, or Custom) and, when Safety Gap > 0 with positive Base Surplus, a safety-recovery horizon (examples 6, 12, 18, 24, or Custom). The user may set Desired Monthly Discretionary Spending as a target; it is not a model result.

## Home Screen

The home screen answers:

1. How is this month going overall?
2. What is a key improvement?
3. What is a key drag?
4. What is the single most worthwhile thing to address now?

It also shows, lightly, Current Cash, Current Month Spending, Total Debt, and Liquid Assets. Use the labels Primary Improvement and Primary Drag for decision-relevant directional signals, not claims about the mathematically largest changes. Their selection follows the approved dimension priority in the financial model spec; do not compare raw values across unlike measures or use invented cross-metric scores. If no direction qualifies, omit the corresponding item.

At most one Priority Action is shown. Its style may be somewhat proactive, allow short-term fluctuation, and must remain within the cash-safety floor.

When there are no Monthly Core Obligations, coverage values are unavailable and no cash-safety warning is generated solely from that state.

The visual direction is clean, slightly cute, lightly tactile, not childlike, with a small amount of meaningful motion. This is not an enterprise dashboard: avoid many KPIs, charts, specialist fields, or a complex cash timeline.

## Quick Expense Entry

The home screen has a “+ Record expense” action. Required input is amount; date and time are automatic. Category is optional, using Food, Transport, Shopping, Entertainment, Household, and Other. A note is optional. Target completion time is 3–5 seconds.

After save, recalculate Monthly Spend, same-period comparison, remaining spending capacity, trend, Primary Improvement, Primary Drag, and Priority Action immediately.

## UX Principles

- Keep ongoing user maintenance low.
- Make the model's outputs explainable.
- Preserve the distinction between facts, user parameters, and derived results.
- Do not turn Owner-specific data into general model rules or defaults.
- Do not invent business rules where the approved specification leaves a decision open.

## Future V0.2 Direction

The excluded capabilities above may be considered in later phases, including richer forecasts, detailed debt/asset views, external synchronization, and additional platform support. This section is directional only and does not authorize implementation or define V0.2 scope.

## Owner Profile Boundary

Owner figures, if later used, are Seed / Fixture / User Profile data only. They must not be embedded in general formulas, business constants, or model decision logic. The system must work for any user starting from an empty database and entering their own data.

Examples supplied for a future Owner fixture include Stable Monthly Income 13000; Current Free Cash 3948.41; Restricted Rent Cash 3800; Liquid Investment Asset 3842.12; Locked Short-term Asset 20000; Financial Assets 31590.53; consumer debt at least 47097.66; car-loan principal 118137.60; fixed debt service about 8207.26; current spending target 1600; current hard cap 2000; and Safety Target 6 months. These are examples only and are not implemented as defaults in this phase.
