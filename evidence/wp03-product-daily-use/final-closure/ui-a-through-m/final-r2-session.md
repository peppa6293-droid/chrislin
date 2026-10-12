# Final r2 native UI session evidence

Exact bundle: `artifacts/wp03-isolated-product-preview-20261012/final-build/cargo-target/release/bundle/macos/小钱家 WP-03 测试版.app`

Bundle ID: `com.personalfinance.console.wp03preview`  
Executable SHA-256: `7791d20845abbba2d33cfa60feb3a135cc98a3b9b4524a74bd8620b2f374f8d3`  
Data path: `~/Library/Application Support/com.personalfinance.console.wp03preview/personal-finance-console.sqlite3`

## Final-package steps observed

- A: Fresh WP-03 synthetic profile setup was completed before this session; home opened with seeded income, cash, asset, debt, and safety values.
- B: Stable monthly income showed ¥11,000.01 baseline. A real UI save changed it to ¥11,001.01; UI displayed a new revision 2 and revision 1. No-op save was separately observed to create no revision.
- C: October plan was changed from inherit to override ¥12,000. UI displayed the saved override. Home displayed planned income ¥12,000 and planned surplus ¥7,100. The broader cross-month fallback/return-to-inherit sequence was not fully evidenced here.
- Safety detail page opened and displayed coverage `7.76 / 3 months`, minimum cash coverage `6.12 / 1 month`, and prepared safety resources ¥38,000. Safety target editing boundaries were not exercised in this final-package session.
- Normal Quit was selected from the app menu. Closed-state DB check found no process, no open handle, and no SQLite sidecar; DB v4 integrity passed.
- The exact same app was relaunched. Home again displayed October planned income ¥12,000, proving this part of persistence. The same app was normally quit and closed-state readback repeated.

## Not completed in final-package A–M

Actual income status/revisions/void, variable expense creation, cash lifecycle, OTHER asset lifecycle, full debt fact matrix and debt deactivation, Safety Targets invalid/zero/1.5 boundaries, full page-by-page post-save comparison, and complete month rollover debt pending/single-confirm isolation were not verified on this exact package. Prior package runs are not combined with this session.

Final result: `PARTIAL`; overall WP-03R1 status remains `WP03_PRODUCT_DAILY_USE_REGRESSION_FAILED` until the required full A–M chain is completed.
