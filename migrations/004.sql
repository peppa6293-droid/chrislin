
CREATE TABLE IF NOT EXISTS planning_income_month_revisions (
  revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  period_month TEXT NOT NULL CHECK (length(period_month)=7 AND substr(period_month,5,1)='-' AND substr(period_month,6,2) BETWEEN '01' AND '12' AND substr(period_month,1,4) NOT GLOB '*[^0-9]*'),
  as_of_date TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('OVERRIDE','INHERIT')),
  amount TEXT,
  created_at TEXT NOT NULL,
  CHECK ((decision='OVERRIDE' AND amount IS NOT NULL) OR (decision='INHERIT' AND amount IS NULL))
);
CREATE INDEX IF NOT EXISTS planning_income_month_revision_lookup ON planning_income_month_revisions(profile_id,period_month,as_of_date,revision_id);
CREATE TABLE IF NOT EXISTS actual_income_revisions (
  revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
  income_id TEXT NOT NULL REFERENCES income_records(id) ON DELETE RESTRICT,
  as_of_date TEXT NOT NULL,
  amount TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('EXPECTED','PENDING','RECEIVED')),
  date TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS actual_income_revision_lookup ON actual_income_revisions(income_id,as_of_date,revision_id);
CREATE TABLE IF NOT EXISTS cash_account_lifecycle_revisions (
  revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES cash_accounts(id) ON DELETE RESTRICT,
  as_of_date TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cash_account_lifecycle_lookup ON cash_account_lifecycle_revisions(account_id,as_of_date,revision_id);
PRAGMA user_version = 4;
