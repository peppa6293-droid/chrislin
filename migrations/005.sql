CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('CASH','DEBIT_CARD','CREDIT_CARD','OTHER')),
  currency TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS accounts_profile_lookup ON accounts(profile_id,active,name);
CREATE TABLE IF NOT EXISTS expense_categories (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  monthly_budget TEXT,
  overspending_alert INTEGER NOT NULL CHECK (overspending_alert IN (0,1)),
  savings_related INTEGER NOT NULL CHECK (savings_related IN (0,1)),
  adjustable INTEGER NOT NULL CHECK (adjustable IN (0,1)),
  builtin INTEGER NOT NULL CHECK (builtin IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS expense_categories_profile_lookup ON expense_categories(profile_id,active,builtin,name);
PRAGMA user_version = 5;
