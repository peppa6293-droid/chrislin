#!/usr/bin/env python3
"""R9-04 SQL verification on a SYNTHETIC_ONLY V8 database.

Builds a throw-away V8 database from the committed migration chain
(003-bootstrap.sql then 004..008), seeds synthetic rows, and executes the
C1-C5 post-migration reconciliation SQL to prove syntax, table names and
column names. No real database bytes are read or written here.

Provenance note: the native fixture created by
native_v3_to_v8_full_schema_fixture_migration_is_isolated is deleted by the
test itself (src-tauri/src/lib.rs:2745), so it cannot be reused. This driver
therefore rebuilds the same V8 schema from the committed chain; schema identity
is anchored by 22-native_*.log and tests/r8-native-migration-sql-parity.test.ts.
"""

from __future__ import annotations

import sqlite3
import sys
import tempfile
from pathlib import Path

C5_1 = """SELECT e.id
FROM expenses e
LEFT JOIN expense_records r ON r.id = e.id
WHERE e.kind = 'CASH_DEBIT'
  AND (r.id IS NULL
    OR cast(r.amount as real) <> cast(e.amount as real)
    OR r.occurred_at <> e.occurred_on || 'T00:00:00.000Z'
    OR r.business_date <> e.occurred_on
    OR r.kind <> 'VARIABLE'
    OR r.category <> 'OTHER_VARIABLE'
    OR coalesce(r.note, '') <> e.description);
"""

C5_2 = """SELECT e.id
FROM expenses e
JOIN expense_records r ON r.id = e.id
WHERE e.kind IN ('CREDIT_ONE_TIME','CREDIT_INSTALLMENT');
"""

OPEN1 = """SELECT (SELECT count(*) FROM income_entries) AS v2_income_rows,
       (SELECT count(*) FROM income_records) AS v1_income_rows,
       (SELECT count(*) FROM income_entries i JOIN income_records r ON r.id = i.id) AS shared_ids;
"""


def seed(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        INSERT INTO profiles(id, singleton_id, display_name, created_at)
        VALUES('p_synth', 1, 'SYNTHETIC_ONLY', '2026-01-01T00:00:00.000Z');
        INSERT INTO accounts(id, profile_id, name, type, currency, active, created_at)
        VALUES('a_cash','p_synth','SYNTHETIC cash','CASH','CNY',1,'2026-01-01T00:00:00.000Z'),
              ('a_card','p_synth','SYNTHETIC card','CREDIT_CARD','CNY',1,'2026-01-01T00:00:00.000Z');
        INSERT INTO expense_categories(id, profile_id, name, icon, color, monthly_budget,
                                       overspending_alert, savings_related, adjustable, builtin, active, created_at)
        VALUES('c1','p_synth','SYNTHETIC category','i','#000000',NULL,0,0,1,0,1,'2026-01-01T00:00:00.000Z');
        INSERT INTO expenses(id, profile_id, kind, amount, currency, occurred_on, category_id,
                             description, account_id, credit_card_id, created_at)
        VALUES('e1','p_synth','CASH_DEBIT','10.00','CNY','2026-10-01','c1','legal mirror','a_cash',NULL,'2026-10-01T00:00:00.000Z'),
              ('e2','p_synth','CASH_DEBIT','20.00','CNY','2026-10-02','c1','missing mirror','a_cash',NULL,'2026-10-02T00:00:00.000Z'),
              ('e3','p_synth','CASH_DEBIT','30.00','CNY','2026-10-03','c1','note tampered','a_cash',NULL,'2026-10-03T00:00:00.000Z'),
              ('e4','p_synth','CASH_DEBIT','40.00','CNY','2026-10-07','c1','business date tampered','a_cash',NULL,'2026-10-07T00:00:00.000Z'),
              ('e5','p_synth','CREDIT_ONE_TIME','50.00','CNY','2026-10-04','c1','credit with illegal mirror',NULL,'a_card','2026-10-04T00:00:00.000Z'),
              ('e6','p_synth','CREDIT_ONE_TIME','60.00','CNY','2026-10-05','c1','credit without mirror',NULL,'a_card','2026-10-05T00:00:00.000Z'),
              ('e7','p_synth','CASH_DEBIT','70.00','CNY','2026-10-06','c1','','a_cash',NULL,'2026-10-06T00:00:00.000Z');
        INSERT INTO expense_records(id, profile_id, amount, occurred_at, kind, category, note, created_at, business_date)
        VALUES('e1','p_synth','10.00','2026-10-01T00:00:00.000Z','VARIABLE','OTHER_VARIABLE','legal mirror','2026-10-01T00:00:00.000Z','2026-10-01'),
              ('e3','p_synth','30.00','2026-10-03T00:00:00.000Z','VARIABLE','OTHER_VARIABLE','tampered','2026-10-03T00:00:00.000Z','2026-10-03'),
              ('e4','p_synth','40.00','2026-10-07T00:00:00.000Z','VARIABLE','OTHER_VARIABLE','business date tampered','2026-10-07T00:00:00.000Z','2026-10-08'),
              ('e5','p_synth','50.00','2026-10-04T00:00:00.000Z','VARIABLE','OTHER_VARIABLE','credit with illegal mirror','2026-10-04T00:00:00.000Z','2026-10-04'),
              ('e7','p_synth','70.00','2026-10-06T00:00:00.000Z','VARIABLE','OTHER_VARIABLE',NULL,'2026-10-06T00:00:00.000Z','2026-10-06'),
              ('h1','p_synth','99.00','2025-01-01T00:00:00.000Z','VARIABLE','OTHER_VARIABLE','historical V1 only','2025-01-01T00:00:00.000Z','2025-01-01');
        INSERT INTO income_entries(id, profile_id, period_month, occurred_at, amount, label, one_time, created_at)
        VALUES('i1','p_synth','2026-10','2026-10-01T00:00:00.000Z','1000.00','SYNTHETIC salary',0,'2026-10-01T00:00:00.000Z');
        INSERT INTO income_records(id, profile_id, kind, status, amount, date, period_month, created_at)
        VALUES('r_hist','p_synth','PLANNING','RECEIVED','500.00','2025-01-01','2025-01','2025-01-01T00:00:00.000Z');
        INSERT INTO debts(id, profile_id, name, fixed_monthly_payment, active, created_at)
        VALUES('d1','p_synth','SYNTHETIC debt one','100.00',1,'2026-01-01T00:00:00.000Z'),
              ('d2','p_synth','SYNTHETIC debt two','200.00',1,'2026-01-01T00:00:00.000Z');
        INSERT INTO debt_period_facts(id, debt_id, period_month, as_of_date, current_balance, current_month_due, created_at)
        VALUES('f1','d1','2026-10','2026-10-31','1000.10','100.10','2026-10-31T00:00:00.000Z'),
              ('f2','d2','2026-10','2026-10-31','2000.20','200.20','2026-10-31T00:00:00.000Z'),
              ('f3','d1','2026-11','2026-11-30','900.10','90.10','2026-11-30T00:00:00.000Z'),
              ('f4','d2','2026-11','2026-11-30','1900.20','190.20','2026-11-30T00:00:00.000Z');
        """
    )


def main() -> int:
    repo = Path(sys.argv[1]).resolve(strict=True)
    failures: list[str] = []
    root = Path(tempfile.mkdtemp(prefix="pfc-r9-reconcile-synthetic-")).resolve()
    db_path = root / "personal-finance-console.sqlite3"
    try:
        connection = sqlite3.connect(db_path)
        for name in ("003-bootstrap.sql", "004.sql", "005.sql", "006.sql", "007.sql", "008.sql"):
            connection.executescript((repo / "migrations" / name).read_text(encoding="utf-8"))
        # The committed 004..008 SQL files carry DDL + user_version only; the native
        # migrator records rows 4..8 itself. Record the synthetic ledger rows here so
        # the synthetic database has the accepted V8 migration history.
        connection.executescript(
            "INSERT INTO schema_migrations(version, applied_at) VALUES"
            "(4,'2000-01-01T00:00:00.000Z'),(5,'2000-01-01T00:00:00.000Z'),"
            "(6,'2000-01-01T00:00:00.000Z'),(7,'2000-01-01T00:00:00.000Z'),"
            "(8,'2000-01-01T00:00:00.000Z');"
        )
        seed(connection)
        print("SYNTHETIC_ONLY")
        print(f"syntheticRoot={root}")

        version = connection.execute("PRAGMA user_version").fetchone()[0]
        migrations = [row[0] for row in connection.execute("SELECT version FROM schema_migrations ORDER BY 1")]
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        fk_violations = connection.execute("PRAGMA foreign_key_check").fetchall()
        sidecars = sorted(p.name for p in root.iterdir() if p.name.endswith(("-wal", "-shm", "-journal")))
        print(f"C4 userVersion={version} migrations={migrations} integrity={integrity} "
              f"foreignKeyViolations={len(fk_violations)} sidecars={sidecars}")
        if version != 8:
            failures.append("C4 userVersion != 8")
        if migrations != [1, 2, 3, 4, 5, 6, 7, 8]:
            failures.append(f"C4 migrations != 1..8: {migrations}")
        if integrity != "ok":
            failures.append(f"C4 integrity != ok: {integrity}")
        if fk_violations:
            failures.append(f"C4 foreign key violations: {fk_violations}")
        if sidecars:
            failures.append(f"C4 sidecars present: {sidecars}")

        c1 = connection.execute("SELECT id FROM debts ORDER BY id").fetchall()
        print(f"C1 synthetic debt ids={[row[0] for row in c1]}")
        if [row[0] for row in c1] != ["d1", "d2"]:
            failures.append(f"C1 unexpected synthetic debt rows: {c1}")

        c2 = connection.execute(
            "SELECT period_month, round(sum(cast(current_balance as real)),2), "
            "round(sum(cast(coalesce(current_month_due,'0') as real)),2), count(*) "
            "FROM debt_period_facts WHERE period_month IN ('2026-10','2026-11') "
            "GROUP BY period_month ORDER BY 1"
        ).fetchall()
        print(f"C2 synthetic aggregates={c2}")
        if c2 != [("2026-10", 3000.3, 300.3, 2), ("2026-11", 2800.3, 280.3, 2)]:
            failures.append(f"C2 unexpected synthetic aggregates: {c2}")

        c3_rows = connection.execute(
            "SELECT 'debts',count(*) FROM debts UNION ALL SELECT 'profiles',count(*) FROM profiles "
            "UNION ALL SELECT 'assets',count(*) FROM assets UNION ALL SELECT 'cash_accounts',count(*) FROM cash_accounts "
            "UNION ALL SELECT 'income_records',count(*) FROM income_records "
            "UNION ALL SELECT 'expense_records',count(*) FROM expense_records "
            "UNION ALL SELECT 'debt_period_facts',count(*) FROM debt_period_facts "
            "UNION ALL SELECT 'debt_revisions',count(*) FROM debt_revisions"
        ).fetchall()
        print(f"C3 synthetic rowcounts={c3_rows}")

        c5_1 = [row[0] for row in connection.execute(C5_1)]
        c5_2 = [row[0] for row in connection.execute(C5_2)]
        print(f"C5-1 detected={sorted(c5_1)}")
        print(f"C5-2 detected={sorted(c5_2)}")
        if sorted(c5_1) != ["e2", "e3", "e4"]:
            failures.append(f"C5-1 expected e2,e3,e4; got {sorted(c5_1)}")
        if sorted(c5_2) != ["e5"]:
            failures.append(f"C5-2 expected e5; got {sorted(c5_2)}")

        open1 = connection.execute(OPEN1).fetchone()
        print(f"OPEN1 v2_income_rows={open1[0]} v1_income_rows={open1[1]} shared_ids={open1[2]}")

        connection.close()
        print("RESULT=" + ("PASS" if not failures else "FAIL"))
        for failure in failures:
            print(f"failure={failure}")
        return 0 if not failures else 1
    finally:
        import shutil

        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
