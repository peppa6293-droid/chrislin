import type { SchemaMigrationBoundary, SqlDatabase } from "./database.js";

export const CURRENT_SCHEMA_VERSION = 6;

interface SchemaVersionState {
  userVersion: number;
  migrationVersion: number;
}

async function readSchemaVersionState(db: SqlDatabase): Promise<SchemaVersionState> {
  const userVersionRows = await db.select<{ user_version: number }>("PRAGMA user_version");
  const userVersion = Number(userVersionRows[0]?.user_version ?? 0);
  const migrationTable = await db.select<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
  );
  if (migrationTable.length === 0) return { userVersion, migrationVersion: 0 };

  const migrationRows = await db.select<{ version: number }>(
    "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
  );
  return { userVersion, migrationVersion: Number(migrationRows[0]?.version ?? 0) };
}

const migrationV1 = `
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  singleton_id INTEGER NOT NULL DEFAULT 1 UNIQUE CHECK (singleton_id = 1),
  display_name TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS financial_settings (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE RESTRICT,
  safety_coverage_target_months REAL NOT NULL CHECK (safety_coverage_target_months >= 0),
  minimum_cash_coverage_months REAL NOT NULL CHECK (minimum_cash_coverage_months >= 0),
  safety_recovery_horizon_months REAL CHECK (safety_recovery_horizon_months IS NULL OR safety_recovery_horizon_months > 0),
  desired_monthly_discretionary_spending TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS essential_expense_items (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  category TEXT NOT NULL CHECK (category IN ('HOUSING','BASIC_FOOD','TRANSPORT','UTILITIES_COMMUNICATIONS','INSURANCE','FAMILY_FIXED_RESPONSIBILITY','OTHER_ESSENTIAL')),
  name TEXT NOT NULL,
  monthly_amount TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS essential_expense_snapshots (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES essential_expense_items(id) ON DELETE RESTRICT,
  as_of_date TEXT NOT NULL,
  monthly_amount TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(item_id, as_of_date)
);
CREATE INDEX IF NOT EXISTS essential_snapshot_date ON essential_expense_snapshots(item_id, as_of_date);
CREATE TABLE IF NOT EXISTS income_records (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('PLANNING','ACTUAL')),
  status TEXT NOT NULL CHECK (status IN ('EXPECTED','PENDING','RECEIVED')),
  amount TEXT NOT NULL,
  date TEXT NOT NULL,
  period_month TEXT CHECK (period_month IS NULL OR (length(period_month)=7 AND substr(period_month,5,1)='-' AND substr(period_month,6,2) BETWEEN '01' AND '12' AND substr(period_month,1,4) NOT GLOB '*[^0-9]*')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS income_profile_month ON income_records(profile_id, period_month, kind, date);
CREATE TABLE IF NOT EXISTS expense_records (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  amount TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ESSENTIAL','VARIABLE')),
  category TEXT CHECK (category IS NULL OR category IN ('HOUSING','BASIC_FOOD','TRANSPORT','UTILITIES_COMMUNICATIONS','INSURANCE','FAMILY_FIXED_RESPONSIBILITY','OTHER_ESSENTIAL','FOOD','SHOPPING','ENTERTAINMENT','HOUSEHOLD','OTHER_VARIABLE')),
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS expenses_profile_date ON expense_records(profile_id, occurred_at);
CREATE TABLE IF NOT EXISTS cash_accounts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  include_in_safety_resources INTEGER NOT NULL CHECK (include_in_safety_resources IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cash_balance_snapshots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES cash_accounts(id) ON DELETE RESTRICT,
  as_of_date TEXT NOT NULL,
  balance TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(account_id, as_of_date)
);
CREATE INDEX IF NOT EXISTS cash_snapshot_date ON cash_balance_snapshots(account_id, as_of_date);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('LIQUID_INVESTMENT','OTHER')),
  include_in_safety_resources INTEGER NOT NULL CHECK (include_in_safety_resources IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS asset_value_snapshots (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  as_of_date TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(asset_id, as_of_date)
);
CREATE INDEX IF NOT EXISTS asset_snapshot_date ON asset_value_snapshots(asset_id, as_of_date);
CREATE TABLE IF NOT EXISTS debts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  fixed_monthly_payment TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS debt_period_facts (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE RESTRICT,
  period_month TEXT NOT NULL CHECK (length(period_month)=7 AND substr(period_month,5,1)='-' AND substr(period_month,6,2) BETWEEN '01' AND '12' AND substr(period_month,1,4) NOT GLOB '*[^0-9]*'),
  as_of_date TEXT NOT NULL,
  current_balance TEXT NOT NULL,
  current_month_due TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(debt_id, period_month)
);
CREATE INDEX IF NOT EXISTS debt_period_lookup ON debt_period_facts(debt_id, period_month, as_of_date);
CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
PRAGMA user_version = 1;
`;

const migrationV2 = `
CREATE TABLE IF NOT EXISTS essential_expense_revisions (
  revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL REFERENCES essential_expense_items(id) ON DELETE RESTRICT,
  as_of_date TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  monthly_amount TEXT NOT NULL,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS essential_revision_lookup ON essential_expense_revisions(item_id,as_of_date,revision_id);
CREATE TABLE IF NOT EXISTS cash_account_revisions (
  revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES cash_accounts(id) ON DELETE RESTRICT,
  as_of_date TEXT NOT NULL,
  name TEXT NOT NULL,
  include_in_safety_resources INTEGER NOT NULL CHECK(include_in_safety_resources IN (0,1)),
  balance TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cash_revision_lookup ON cash_account_revisions(account_id,as_of_date,revision_id);
CREATE TABLE IF NOT EXISTS asset_revisions (
  revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  as_of_date TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('LIQUID_INVESTMENT','OTHER')),
  include_in_safety_resources INTEGER NOT NULL CHECK(include_in_safety_resources IN (0,1)),
  current_value TEXT NOT NULL,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS asset_revision_lookup ON asset_revisions(asset_id,as_of_date,revision_id);
CREATE TABLE IF NOT EXISTS debt_revisions (
  revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE RESTRICT,
  period_month TEXT NOT NULL,
  as_of_date TEXT NOT NULL,
  name TEXT NOT NULL,
  current_balance TEXT NOT NULL,
  current_month_due TEXT,
  fixed_monthly_payment TEXT,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS debt_revision_lookup ON debt_revisions(debt_id,period_month,as_of_date,revision_id);
CREATE TABLE IF NOT EXISTS planning_income_revisions (
  revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  effective_month TEXT NOT NULL,
  as_of_date TEXT NOT NULL,
  amount TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS planning_income_revision_lookup ON planning_income_revisions(profile_id,effective_month,as_of_date,revision_id);
CREATE TABLE IF NOT EXISTS settings_revisions (
  revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  effective_month TEXT NOT NULL,
  as_of_date TEXT NOT NULL,
  safety_coverage_target_months REAL NOT NULL,
  minimum_cash_coverage_months REAL NOT NULL,
  safety_recovery_horizon_months REAL,
  desired_monthly_discretionary_spending TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS settings_revision_lookup ON settings_revisions(profile_id,effective_month,as_of_date,revision_id);
PRAGMA user_version = 2;
`;

const migrationV3 = `
ALTER TABLE expense_records ADD COLUMN business_date TEXT;
UPDATE expense_records SET business_date=date(occurred_at,'localtime') WHERE business_date IS NULL;
CREATE INDEX IF NOT EXISTS expenses_profile_business_date ON expense_records(profile_id,business_date,occurred_at);
PRAGMA user_version = 3;
`;

const migrationV4 = `
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
`;


const migrationV5 = `
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
`;

const migrationV6 = `
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
`;

export async function migrateDatabase(
  db: SqlDatabase,
  now = new Date().toISOString(),
  targetVersion = CURRENT_SCHEMA_VERSION,
): Promise<void> {
  if (
    !Number.isInteger(targetVersion) ||
    targetVersion < 1 ||
    targetVersion > CURRENT_SCHEMA_VERSION
  )
    throw new RangeError(`Target schema version must be between 1 and ${CURRENT_SCHEMA_VERSION}.`);

  // Read both version authorities before changing connection or database state.
  const schema = await readSchemaVersionState(db);
  if (
    schema.userVersion > CURRENT_SCHEMA_VERSION ||
    schema.migrationVersion > CURRENT_SCHEMA_VERSION
  ) {
    throw new RangeError(
      `Database schema is newer than this runtime (user_version=${schema.userVersion}, schema_migrations=${schema.migrationVersion}, supported=${CURRENT_SCHEMA_VERSION}).`,
    );
  }
  if (schema.userVersion > targetVersion || schema.migrationVersion > targetVersion) {
    throw new RangeError(
      `Database schema is newer than target ${targetVersion} (user_version=${schema.userVersion}, schema_migrations=${schema.migrationVersion}).`,
    );
  }

  if (schema.userVersion !== schema.migrationVersion) {
    throw new RangeError(
      `Database schema version authorities disagree (user_version=${schema.userVersion}, schema_migrations=${schema.migrationVersion}).`,
    );
  }

  // Already-current databases need no startup DDL or PRAGMA writes.
  if (schema.userVersion === targetVersion) return;

  const applied = schema.migrationVersion;
  if (applied > targetVersion)
    throw new RangeError(
      `Database schema version ${applied} is newer than target ${targetVersion}.`,
    );
  const migrationBoundary = db as SqlDatabase & SchemaMigrationBoundary;
  await migrationBoundary.beginSchemaMigration?.();
  let succeeded = false;
  try {
    await db.execute("PRAGMA foreign_keys = ON");
    await db.execute(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    if (applied < 1) {
      await db.transaction(async (transactionDb) => {
        for (const statement of migrationV1
          .split(";")
          .map((part) => part.trim())
          .filter(Boolean)) {
          await transactionDb.execute(statement);
        }
        await transactionDb.execute(
          "INSERT INTO schema_migrations(version, applied_at) VALUES(1, ?)",
          [now],
        );
      });
    }
    if (applied < 2) {
      await db.transaction(async (transactionDb) => {
        for (const statement of migrationV2
          .split(";")
          .map((part) => part.trim())
          .filter(Boolean)) {
          await transactionDb.execute(statement);
        }
        await transactionDb.execute(
          "INSERT INTO schema_migrations(version, applied_at) VALUES(2, ?)",
          [now],
        );
      });
    }
    if (applied < 3) {
      await db.transaction(async (transactionDb) => {
        for (const statement of migrationV3
          .split(";")
          .map((part) => part.trim())
          .filter(Boolean)) {
          await transactionDb.execute(statement);
        }
        await transactionDb.execute(
          "INSERT INTO schema_migrations(version, applied_at) VALUES(3, ?)",
          [now],
        );
      });
    }
    if (applied < 4 && targetVersion >= 4) {
      await db.transaction(async (transactionDb) => {
        for (const statement of migrationV4
          .split(";")
          .map((part) => part.trim())
          .filter(Boolean)) {
          await transactionDb.execute(statement);
        }
        await transactionDb.execute(
          "INSERT INTO schema_migrations(version, applied_at) VALUES(4, ?)",
          [now],
        );
      });
    }
    if (applied < 5 && targetVersion >= 5) {
      await db.transaction(async (transactionDb) => {
        for (const statement of migrationV5.split(";").map((part) => part.trim()).filter(Boolean)) {
          await transactionDb.execute(statement);
        }
        await transactionDb.execute("INSERT INTO schema_migrations(version, applied_at) VALUES(5, ?)", [now]);
      });
    }
    if (applied < 6 && targetVersion >= 6) {
      await db.transaction(async (transactionDb) => {
        for (const statement of migrationV6.split(";").map((part) => part.trim()).filter(Boolean)) {
          await transactionDb.execute(statement);
        }
        await transactionDb.execute("INSERT INTO schema_migrations(version, applied_at) VALUES(6, ?)", [now]);
      });
    }
    const finalSchema = await readSchemaVersionState(db);
    if (
      finalSchema.userVersion !== targetVersion ||
      finalSchema.migrationVersion !== targetVersion
    ) {
      throw new Error(
        `Migration did not reach target ${targetVersion} (user_version=${finalSchema.userVersion}, schema_migrations=${finalSchema.migrationVersion}).`,
      );
    }
    succeeded = true;
  } finally {
    await migrationBoundary.endSchemaMigration?.(succeeded);
  }
}
