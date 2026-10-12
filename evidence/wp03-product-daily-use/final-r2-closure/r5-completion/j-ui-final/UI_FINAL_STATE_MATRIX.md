# R5 UI final state matrix — 2026-10-12

Scope: normal UI reads from the exact R5 app before its first normal quit. Values below are observed in the UI or prior accepted same-R5 evidence; “inherited” rows were not re-run to avoid repeating writes.

| Area | Observed current value | Result | Evidence |
|---|---|---|---|
| Home | Oct 2026; planned income ¥10,001.01; expense ¥68.50; life and repayment ¥4,000; planned surplus ¥6,001.01; actual records 0; debt ¥5,000, due ¥0; safety cover 6.39 / 100 months; gap about ¥374,444.45 | PASS for visible values | UI tree captured at end of J readback |
| Stable income | ¥10,001.01; revision 1 | inherited PASS | R5 preflight and Income UI |
| October Planning | inherit; ¥10,001.01; history retains override ¥12,345.67, inherit, equal-value override ¥10,001.01, final inherit | PASS | C UI sequence; DB has four ordered decisions |
| November Planning | inherit; stable ¥10,001.01 | PASS | C2 UI sequence |
| Actual income | active list empty; history shows EXPECTED ¥1,234.56, PENDING ¥1,345.67, RECEIVED ¥1,456.78, and voided state | PASS with limitation | D UI; product UI has no record-name field |
| Expense | ¥68.50 | inherited PASS | R5 E and Home |
| Cash | active total ¥10,000 from original account; R5 test account absent after deactivation; test account ended at zero and safety-ineligible | PASS | F UI; closed DB lifecycle readback |
| Assets | active total ¥15,555.55; Liquid Asset ¥5,555.55 active/eligible; edited Other Asset ¥4,444.44 inactive, OTHER/not eligible retained in history | PASS | G UI; closed DB revisions |
| Debts October | A balance 0/due 0 active; B balance ¥5,000/due 0 active; Debt C inactive; due-precedence/zero/fallback/clear sequence observed | PASS for UI | H UI and DB revisions |
| Debts November | A due 0 and B due 200 from inherited H2 | PASS inherited; L consistency check pending | H2 evidence; see L open discrepancy |
| Safety | target 100 months; cash floor 0; Home safety gap positive; 8-month recovery horizon submitted | PASS for save; persisted app-layer value pending restart read | I/I2 UI and settings revision in L |
| Preview date | restored to system date; UI showed 2026-10-12 | PASS | Home UI before quit |

## Limitations

- The R5 Actual editor exposes no name field, so “R5 Actual Lifecycle Test” could not be assigned; the record was created through the normal UI with the requested values/date/status and later voided.
- The latest closed DB `debt_period_facts` rows are October 500/300, while revision history retains November A=0/B=200. This requires the same-bundle restart UI comparison and prevents claiming full UI-to-authority consistency until resolved.
- This is not a complete screenshot archive; observed values are recorded from the accessibility UI trees and prior same-R5 evidence.
