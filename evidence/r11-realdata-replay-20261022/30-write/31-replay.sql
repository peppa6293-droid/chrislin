-- EXEC-R11 real-data replay
-- Scope: exactly the four groups in §1. Single transaction. No other tables.
-- Values and ids are copied verbatim from the quarantine seed rows (§1.5).
-- created_at matches the quarantine seed shape: 2026-10-21T12:00:00.000Z.

PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;

-- 1.1 cash accounts: add WeChat cash; set ABC reserved amount.
INSERT INTO cash_accounts(
  id, profile_id, name, include_in_safety_resources, active, created_at, reserved_amount
) VALUES(
  'seed-wechat-cash-20261021',
  'ffb61fa9-1206-4bdd-923b-7e440468139c',
  '微信零钱', 1, 1, '2026-10-21T12:00:00.000Z', '0.00'
);

UPDATE cash_accounts
   SET reserved_amount = '3800.00'
 WHERE id = '3787daaa-35da-4ccd-a28c-954fda066bfe';

-- 1.1 cash snapshots at 2026-10-21 (old 2026-10-04 snapshots are preserved).
INSERT INTO cash_balance_snapshots(id, account_id, as_of_date, balance, created_at) VALUES
  ('seed-snap-yuebao-20261021', 'cd4f47d0-f811-4c65-9188-bd51aa6b2d91', '2026-10-21', '168.57', '2026-10-21T12:00:00.000Z'),
  ('seed-snap-abc-20261021',    '3787daaa-35da-4ccd-a28c-954fda066bfe', '2026-10-21', '5097.04', '2026-10-21T12:00:00.000Z'),
  ('seed-snap-bosc-20261021',   'c5e4626f-137d-40c7-bbb5-1cd0c0c11846', '2026-10-21', '4.44',    '2026-10-21T12:00:00.000Z'),
  ('seed-snap-wechat-20261021', 'seed-wechat-cash-20261021',            '2026-10-21', '55.88',   '2026-10-21T12:00:00.000Z');

-- 1.1 rent-purpose account: deactivate via lifecycle revision only.
-- cash_accounts.active stays 1 (quarantine shape).
INSERT INTO cash_account_lifecycle_revisions(account_id, as_of_date, active, created_at) VALUES
  ('a0c23914-394e-444b-b8b9-de95ec931712', '2026-10-21', 0, '2026-10-21T12:00:00.000Z');

-- 1.2 assets: add securities account; new 2026-10-21 snapshots.
INSERT INTO assets(
  id, profile_id, name, kind, include_in_safety_resources, active, created_at
) VALUES(
  'seed-securities-asset-20261021',
  'ffb61fa9-1206-4bdd-923b-7e440468139c',
  '证券账户', 'LIQUID_INVESTMENT', 1, 1, '2026-10-21T12:00:00.000Z'
);

INSERT INTO asset_value_snapshots(id, asset_id, as_of_date, value, created_at) VALUES
  ('seed-snap-fund-20261021', '950288d5-4fd6-456e-a16b-a9245005d7c7', '2026-10-21', '0.00',     '2026-10-21T12:00:00.000Z'),
  ('seed-snap-sec-20261021',  'seed-securities-asset-20261021',      '2026-10-21', '20000.00', '2026-10-21T12:00:00.000Z');

-- 1.3 income entries (V2 ledger).
INSERT INTO income_entries(
  id, profile_id, period_month, occurred_at, amount, label, one_time, created_at
) VALUES
  ('seed-income-salary-202609', 'ffb61fa9-1206-4bdd-923b-7e440468139c', '2026-09', '2026-09-30', '12791.25', '工资',   0, '2026-10-21T12:00:00.000Z'),
  ('seed-income-bonus-202609',  'ffb61fa9-1206-4bdd-923b-7e440468139c', '2026-09', '2026-09-30', '1000.00',  '进步奖', 1, '2026-10-21T12:00:00.000Z');

-- 1.4 fixed expense plans (V2).
INSERT INTO fixed_expense_plans(
  id, profile_id, name, monthly_amount, effective_from, note, active, created_at
) VALUES
  ('seed-plan-rent-202609',      'ffb61fa9-1206-4bdd-923b-7e440468139c', '房租',                 '1900.00', '2026-09-01', '季付节奏；另设专款预留 3800.00', 1, '2026-10-21T12:00:00.000Z'),
  ('seed-plan-battery-202609',   'ffb61fa9-1206-4bdd-923b-7e440468139c', '电池租赁',             '728.00',  '2026-09-01', NULL, 1, '2026-10-21T12:00:00.000Z'),
  ('seed-plan-parking-202609',   'ffb61fa9-1206-4bdd-923b-7e440468139c', '停车',                 '300.00',  '2026-09-01', NULL, 1, '2026-10-21T12:00:00.000Z'),
  ('seed-plan-diet-202609',      'ffb61fa9-1206-4bdd-923b-7e440468139c', '饮食规划',             '1500.00', '2026-09-01', NULL, 1, '2026-10-21T12:00:00.000Z'),
  ('seed-plan-insurance-202609', 'ffb61fa9-1206-4bdd-923b-7e440468139c', '车险+无忧年度预提',    '648.31',  '2026-09-01', NULL, 1, '2026-10-21T12:00:00.000Z');

COMMIT;
