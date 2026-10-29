#!/bin/bash
# WP-DATA-TRUTH-01 / Phase 1 一键执行（V2-A）
# 用法（在授权边界覆盖活库的回合执行）：
#   bash RUN-PHASE1.sh "/Users/linte/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3"
# 前置：整库备份已存在（BACKUP-MANIFEST.txt）；本脚本会再备份一次并记录 sha256。
# 机制：-bail 单事务，任一语句失败整体回滚，不留半截状态。
set -uo pipefail

DB="${1:-/Users/linte/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3}"
HERE="$(cd "$(dirname "$0")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
BAK="$HERE/personal-finance-console.sqlite3.prephase1-$STAMP"

[ -f "$DB" ] || { echo "STOP: 主库不存在：$DB"; exit 2; }

echo "== S0 只读 PRECHECK =="
sqlite3 -bail "file:$DB?mode=ro" <<'SQL' || { echo "STOP: PRECHECK 失败"; exit 3; }
PRAGMA integrity_check;
PRAGMA user_version;
SELECT 'ACTUAL_rows', COUNT(*) FROM income_records WHERE kind='ACTUAL';
SELECT 'entries_rows', COUNT(*) FROM income_entries;
SELECT 'all_records', COUNT(*) FROM income_records;
SQL

ACTUAL=$(sqlite3 "file:$DB?mode=ro" "SELECT COUNT(*) FROM income_records WHERE kind='ACTUAL';")
ENTRIES=$(sqlite3 "file:$DB?mode=ro" "SELECT COUNT(*) FROM income_entries;")
if [ "$ACTUAL" != "0" ] || [ "$ENTRIES" != "0" ]; then
  echo "STOP: ACTUAL=$ACTUAL / entries=$ENTRIES ≠ 0，疑似已执行或基线变化，禁止重复执行"; exit 4
fi

echo "== S1 在线一致性备份 =="
sqlite3 -bail "file:$DB?mode=ro" ".backup '$BAK'" || { echo "STOP: 备份失败"; exit 5; }
shasum -a 256 "$BAK" "$DB"
sqlite3 "$BAK" "PRAGMA integrity_check;" "PRAGMA user_version;" | tr '\n' ' '; echo

echo "== S2 单事务写入 12 条 INSERT =="
sqlite3 -bail "$DB" < "$HERE/PHASE1-INSERTS.sql" || { echo "STOP: 写入失败已回滚，用 $BAK 还原"; exit 6; }

echo "== S3 对拍（V2 §4）=="
sqlite3 -header -column -bail "file:$DB?mode=ro" <<'SQL'
PRAGMA integrity_check;
PRAGMA user_version;
SELECT kind, period_month, date, amount FROM income_records ORDER BY period_month, kind;
SELECT period_month, occurred_at, amount, label FROM income_entries ORDER BY period_month;
SELECT printf('%.2f', SUM(CAST(amount AS REAL))) AS actual_total FROM income_records WHERE kind='ACTUAL';
SELECT printf('%.2f', SUM(CAST(amount AS REAL))) AS entries_total FROM income_entries;
SELECT COUNT(*) AS debts FROM debts;
SELECT COUNT(*) AS debt_facts FROM debt_period_facts;
SELECT COUNT(*) AS expenses FROM expenses;
SELECT COUNT(*) AS expense_records FROM expense_records;
SELECT amount AS planning_amount FROM income_records WHERE kind='PLANNING';
SQL
echo "备份：$BAK （sha256 见上）"
