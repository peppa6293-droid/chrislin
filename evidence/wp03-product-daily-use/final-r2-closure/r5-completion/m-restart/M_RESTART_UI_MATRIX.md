# R5 M — same-bundle restart UI matrix

After L, the exact final-r5 `.app` was reopened by its full path; no build occurred. Bundle ID and executable SHA matched the frozen candidate. Relaunch landed on Home with preview date reset to system date `2026-10-12`.

| Page | UI read after restart | Result |
|---|---|---|
| Home | income ¥10,001.01; expense ¥68.50; planned remaining ¥6,001.01; debt ¥5,000 / due ¥0; safety 6.39/100 months; gap ¥374,444.45; date 2026-10-12 | PASS |
| Income / Actual | stable ¥10,001.01; active Actual count 0; history retains pending ¥1,345.67, received ¥1,456.78 and voided state, initial expected ¥1,234.56 | PASS |
| Planning Oct | inherit selected; planned ¥10,001.01 | PASS |
| Planning Nov | inherit selected; stable ¥10,001.01 | PASS |
| Expense | ¥68.50; target ¥1,000; remaining ¥931.50 | PASS |
| Cash | only original active account ¥10,000; history retains R5 account values ¥8,888.88 → ¥7,777.77 eligible → ¥7,777.77 ineligible → ¥0 ineligible, then inactive | PASS |
| Assets | active total ¥15,555.55; Liquid Asset ¥5,555.55 active/eligible; history retains Other Asset ¥3,333.33 → edited ¥4,444.44 OTHER/not eligible → inactive | PASS |
| Debts Oct | total ¥5,000; A ¥0 balance/due, B ¥5,000 balance/due ¥0; Debt C absent from active list, lifecycle history retained | PASS |
| Debts Nov | temporary preview 2026-11-01 showed Home debt due ¥200; A=0/B=200 remains in debt revision rows; preview then restored to system date | PASS |
| Safety detail | 6.39/100 months; target 100; cash floor 0; prepared reserves ¥25,555.55 | PASS |

No save buttons were used on M readback. Preview-date changes were session-only and reset before the second normal quit. The second closed-state table readback and revision comparison are in `final-readback/`.
