CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('CASH_DEBIT','CREDIT_ONE_TIME','CREDIT_INSTALLMENT')),
  amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  occurred_on TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
  description TEXT NOT NULL DEFAULT '',
  account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  credit_card_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  total_amount TEXT,
  periods INTEGER,
  fee TEXT,
  first_installment_month TEXT,
  installment_amount TEXT,
  import_batch_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS expenses_profile_month_lookup ON expenses(profile_id, occurred_on);
CREATE INDEX IF NOT EXISTS expenses_category_lookup ON expenses(category_id);
CREATE INDEX IF NOT EXISTS expenses_import_lookup ON expenses(import_batch_id);
CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('ALIPAY_CSV','WECHAT_CSV','FUTURE_PROVIDER')),
  source_file_sha256 TEXT NOT NULL,
  total_rows INTEGER NOT NULL,
  valid_rows INTEGER NOT NULL,
  written_rows INTEGER NOT NULL,
  skipped_rows INTEGER NOT NULL,
  error_rows INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
PRAGMA user_version = 6;
