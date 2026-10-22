ALTER TABLE expenses ADD COLUMN dedupe_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_dedupe_unique
  ON expenses(profile_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
PRAGMA user_version = 7;
