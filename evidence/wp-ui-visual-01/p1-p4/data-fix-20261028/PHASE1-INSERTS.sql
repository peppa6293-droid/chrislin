-- WP-DATA-TRUTH-01 / Phase 1（V2-A）：补录 2026-05～10 六个月真实工资
-- 依据：docs/REAL-DATA-CORRECTION-PLAN-V2-20261028.md §2（R-1' / R-2'）
-- 性质：12 条纯 INSERT，零 DELETE、零 UPDATE、零 DROP/ALTER
-- 执行：单事务；任意一条失败整体回滚
-- profile_id：ffb61fa9-1206-4bdd-923b-7e440468139c（活库唯一 profile）
-- label 固定 '工资'；one_time=0；amount 为 TEXT 十进制字面量；created_at 用执行时刻 ISO-8601 Z

BEGIN IMMEDIATE;

-- R-1' income_records 6 行（kind=ACTUAL, status=RECEIVED）
INSERT INTO income_records (id, profile_id, kind, status, amount, date, period_month, created_at)
SELECT 'f6acbefe-f328-46c5-ae55-0674ae13cb58','ffb61fa9-1206-4bdd-923b-7e440468139c','ACTUAL','RECEIVED','33347.55','2026-05-20','2026-05',strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM income_records WHERE profile_id='ffb61fa9-1206-4bdd-923b-7e440468139c' AND kind='ACTUAL' AND period_month='2026-05' AND date='2026-05-20');

INSERT INTO income_records (id, profile_id, kind, status, amount, date, period_month, created_at)
SELECT '72613b8a-9697-4f98-9258-557b279bf7bb','ffb61fa9-1206-4bdd-923b-7e440468139c','ACTUAL','RECEIVED','10919.10','2026-06-18','2026-06',strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM income_records WHERE profile_id='ffb61fa9-1206-4bdd-923b-7e440468139c' AND kind='ACTUAL' AND period_month='2026-06' AND date='2026-06-18');

INSERT INTO income_records (id, profile_id, kind, status, amount, date, period_month, created_at)
SELECT 'ecfa6f56-073f-4942-940b-73069d4f0a1b','ffb61fa9-1206-4bdd-923b-7e440468139c','ACTUAL','RECEIVED','10048.90','2026-07-20','2026-07',strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM income_records WHERE profile_id='ffb61fa9-1206-4bdd-923b-7e440468139c' AND kind='ACTUAL' AND period_month='2026-07' AND date='2026-07-20');

INSERT INTO income_records (id, profile_id, kind, status, amount, date, period_month, created_at)
SELECT 'a8ab1339-0317-43b8-82fd-2f7906b505fd','ffb61fa9-1206-4bdd-923b-7e440468139c','ACTUAL','RECEIVED','24441.24','2026-08-20','2026-08',strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM income_records WHERE profile_id='ffb61fa9-1206-4bdd-923b-7e440468139c' AND kind='ACTUAL' AND period_month='2026-08' AND date='2026-08-20');

INSERT INTO income_records (id, profile_id, kind, status, amount, date, period_month, created_at)
SELECT '76954ba9-712d-450d-bbb7-d2f1bd7379b6','ffb61fa9-1206-4bdd-923b-7e440468139c','ACTUAL','RECEIVED','12266.47','2026-09-18','2026-09',strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM income_records WHERE profile_id='ffb61fa9-1206-4bdd-923b-7e440468139c' AND kind='ACTUAL' AND period_month='2026-09' AND date='2026-09-18');

INSERT INTO income_records (id, profile_id, kind, status, amount, date, period_month, created_at)
SELECT 'ede4b5d8-23a8-408f-a84e-5c7336910bd4','ffb61fa9-1206-4bdd-923b-7e440468139c','ACTUAL','RECEIVED','13791.25','2026-10-20','2026-10',strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM income_records WHERE profile_id='ffb61fa9-1206-4bdd-923b-7e440468139c' AND kind='ACTUAL' AND period_month='2026-10' AND date='2026-10-20');

-- R-2' income_entries 6 行（label='工资', one_time=0；UNIQUE(profile_id, occurred_at, label, amount) 自带防重）
INSERT INTO income_entries (id, profile_id, period_month, occurred_at, amount, label, one_time, created_at)
VALUES ('9112bb98-747a-4153-9464-82244dce308a','ffb61fa9-1206-4bdd-923b-7e440468139c','2026-05','2026-05-20','33347.55','工资',0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO income_entries (id, profile_id, period_month, occurred_at, amount, label, one_time, created_at)
VALUES ('ae57ad71-1083-4ea9-8c61-07c730954917','ffb61fa9-1206-4bdd-923b-7e440468139c','2026-06','2026-06-18','10919.10','工资',0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO income_entries (id, profile_id, period_month, occurred_at, amount, label, one_time, created_at)
VALUES ('31b9beb2-0805-4b7d-8ab0-023eda344b78','ffb61fa9-1206-4bdd-923b-7e440468139c','2026-07','2026-07-20','10048.90','工资',0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO income_entries (id, profile_id, period_month, occurred_at, amount, label, one_time, created_at)
VALUES ('7a309696-1124-47cb-b2c6-3ee18bbe77b1','ffb61fa9-1206-4bdd-923b-7e440468139c','2026-08','2026-08-20','24441.24','工资',0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO income_entries (id, profile_id, period_month, occurred_at, amount, label, one_time, created_at)
VALUES ('7cf6cf90-1de6-48c5-8c17-633b29d4da6b','ffb61fa9-1206-4bdd-923b-7e440468139c','2026-09','2026-09-18','12266.47','工资',0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO income_entries (id, profile_id, period_month, occurred_at, amount, label, one_time, created_at)
VALUES ('f257e81c-0a83-4526-8a75-edfb43c93610','ffb61fa9-1206-4bdd-923b-7e440468139c','2026-10','2026-10-20','13791.25','工资',0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

COMMIT;
