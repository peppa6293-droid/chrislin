# R5 L — Full closed-state business readback

Captured 2026-10-12 after normal quit, from the exact WP-03 synthetic DB in read-only mode. App process/open-handle checks were empty; directory contained only the database (no WAL/SHM/journal sidecar). Byte copy and source DB SHA-256: `2659df609f35050df3197a7fa9ef961019fde5c569f3a788440242d196c66981`.

- `user_version=4`; migrations 1–4; integrity `ok`; foreign-key check empty.
- Profiles: 1 (`验收用户`). Full rows, IDs, snapshots, revisions, facts and counts are in `L_FULL_BUSINESS_READBACK.json`.
- Stable income: base revision 1, ¥10,001.01 effective 2026-10. Planning month history: four ordered Oct decisions — override ¥12,345.67, inherit, explicit override equal to stable ¥10,001.01, inherit. November has no month override.
- Actual income: ID `e714856e-9992-4c40-97ea-7815f01dfe51`; initial base EXPECTED ¥1,234.56 for 2026-10-10; revisions PENDING ¥1,345.67 on 10-10, RECEIVED ¥1,456.78 on 10-11, then same latest value marked inactive (void). Three revision rows; no active Actual shown by UI.
- Expense: ID `176be39f-265d-4e40-8c15-8ca138a5668c`, variable ¥68.50, business date 2026-10-12.
- Cash: test account ID `7ba24491-c06c-42af-80cb-e4e46a96cd6b`; four revisions (¥8,888.88/eligible, ¥7,777.77/eligible, ¥7,777.77/ineligible, ¥0/ineligible), lifecycle inactive. Original account remains active at ¥10,000.
- Assets: Liquid ID `16e619fc-40d1-46de-bf3a-acfc345de060`, ¥5,555.55, LIQUID_INVESTMENT/eligible/active. Other ID `0dcac45b-b5ae-4d19-aed3-81500cbcd250`, latest ¥4,444.44, OTHER/not eligible/inactive; four revisions preserve identity and lifecycle. Original liquid asset remains active.
- Debt revisions: October A 500 with fixed 900; B explicit 0 with fixed 900; A blank due/fixed 900; A blank due/fixed null; A balance 0 still active; Debt C ID `81a0fd8a-6b8f-4261-8c83-0826bbcb6456` latest inactive. September? No; all facts are scoped by the displayed `period_month` in the JSON.
- Safety settings revisions: Oct target 1.5/floor 0, then target 100/floor 0/recovery horizon 8. Current app base settings table remains its initial 3/1/null values; monthly revisions are the effective dated record used by the UI.

## November fact consistency check

The base `debt_period_facts` table contains the original October A=500/B=300 rows; later monthly facts are stored in `debt_revisions`. Read-only source inspection confirmed the debt lookup unions both tables, selects the latest record by date/revision, and uses revisions for monthly due history. After same-bundle restart, a session-only 2026-11-01 preview displayed Home debt due ¥200. The November debt revisions remain A=0/B=200. H2 persistence is therefore confirmed; the October facts did not overwrite the November revisions. Preview was reset to system date before quit.

Machine-readable complete readback: `L_FULL_BUSINESS_READBACK.json`. DB copy: `r5-after-k-before-restart.sqlite3`.
