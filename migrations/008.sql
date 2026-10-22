CREATE TABLE IF NOT EXISTS income_entries (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  period_month TEXT NOT NULL CHECK (
    length(period_month)=7 AND substr(period_month,5,1)='-'
    AND substr(period_month,6,2) BETWEEN '01' AND '12'
    AND substr(period_month,1,4) NOT GLOB '*[^0-9]*'
  ),
  occurred_at TEXT NOT NULL,
  amount TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  one_time INTEGER NOT NULL DEFAULT 0 CHECK (one_time IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE(profile_id, occurred_at, label, amount)
);
CREATE INDEX IF NOT EXISTS income_entries_profile_month
  ON income_entries(profile_id, period_month);

ALTER TABLE cash_accounts ADD COLUMN reserved_amount TEXT NOT NULL DEFAULT '0.00';

CREATE TABLE IF NOT EXISTS fixed_expense_plans (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  monthly_amount TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fixed_expense_plans_profile_lookup
  ON fixed_expense_plans(profile_id, active, effective_from);

PRAGMA user_version = 8;
