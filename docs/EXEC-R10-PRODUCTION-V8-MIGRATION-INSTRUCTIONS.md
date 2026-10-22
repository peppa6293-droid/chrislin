# EXEC-R10 真实 Production V3→V8 迁移任务书

发布方：审核员/架构方。执行方：执行员。
日期：2026-10-22。
授权：户主已于 2026-10-22 明确批准真实 V3→V8 迁移、/Applications 正式包替换、Production 启动与 terminal 发布（R8 任务书 §6 所列四项单独授权）。本任务书是该授权的执行载体。

前置事实（已由审核员核实）：
- R9 结论 `R9_PASS`（`evidence/r9-rehearsal-20261022/RECEIPT.md`）：基线复跑全过、合成演练全过、真实库只读 preflight 前后指纹逐字一致、schema 差异 0 条。
- 生产库仍为 V3：SHA-256 `ebdd7c2d52c904dc0ce763302b461a8530ce0f6f3b4bc13c695ca5386f0d29bc`，大小 229376，`user_version=3`，`schema_migrations=[1,2,3]`，integrity ok，FK 空，无 sidecar；app-data 目录内仅 `maintenance.lock`、`personal-finance-console.sqlite3`、`personal-finance-console.sqlite3.v8-quarantined`。
- 候选包（提交 `93db676` 构建，未启动）：executable `444729451aafc3bbe6cf95b52ffd84a2191b75f6c1477d0d840656ace4711b5c`；Info.plist `41b8aa5a1c1933531c2d986c25d180590ffbf8920aff4483d791a882dc3cfdcb`；manifest（包内与源一致）`f98b7f7bab5161e8c0c6bb93571ac8ce658c20d81785fc5651ac37f2f9c3d509`；DMG `ebb93b4a29647f1bc9bba543fe2834e4d3e12da1b7d1200028b66a47683d98f6`。身份文件：`evidence/r8-production-v8-20261022/70-rebuild-post-commit-93db676/BUILD_IDENTITY.json`。

## 0. 红线（任一触发立即停止并返回 R10_BLOCKED，不得自行绕过或补救后继续）

1. 不得修改 `src/`、`src-tauri/src/`、`src-tauri/runtime-compatibility.json`、`migrations/`、`scripts/`、`tests/` 下任何已提交文件。发现代码缺陷只记录并返回。
2. 不得重建候选包、不得改动 `src-tauri/target` 下候选产物。候选哈希任一不符即停止，不得覆盖重建。
3. 不得 `git add` / `commit` / `push`。证据与授权文件只写入新证据目录，是否提交由审核员裁决。
4. 不得修改、降低、绕过任何 gate 检查；gate 返回 `BLOCKED` 时如实记录原因并停止，不得删除 gate 报告的状态文件来"重试"。
5. 迁移窗口内不得有第二份授权、第二次 permit、或手工运行 `--pfc-internal-v8-migrate`；迁移只能由 `production_v8_release_gate.py migrate` 触发。
6. 不得使用 `sudo`、不得关闭 SIP/Gatekeeper、不得改系统时间。
7. 回执中不得把未完成步骤写成完成；任何一步失败必须如实标注。

## 1. 固定路径与常量（全任务一致，不得改动）

```bash
REPO="/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2"
APP_DATA="$HOME/Library/Application Support/com.personalfinance.console"
P="$APP_DATA/personal-finance-console.sqlite3"
APP_PATH="/Applications/Personal Finance Console.app"
CAND="$REPO/src-tauri/target/release/bundle/macos/小钱家.app"
EV="$REPO/evidence/r10-production-migration-20261022"
AUTH="$EV/authorization"
```

备份位置（审核员指定，共两处，缺一不可）：

1. **主备份（gate 强制的规范路径，唯一被 gate 绑定的备份）**：
   `$APP_DATA/production-v8-backups/personal-finance-console.sqlite3`
   由 `scripts/production_v8_release_gate.py` 的 `fixed_backup_path()` 强制：必须是该精确路径下的单链接常规文件，非 symlink，哈希必须与迁移前数据库逐字一致。
2. **副备份（回滚保险，审核员新指定，仓库外）**：
   `$HOME/Documents/pfc-v8-migration-backup-20261022/personal-finance-console.sqlite3`
   理由：与 app-data 目录树完全隔离（防单目录误删/误操作），仓库外（真实库内容不进仓库），路径无空格无特殊字符，回滚命令简单。它不参与 gate 绑定，仅作为第二副本。

证据目录结构：

```bash
mkdir -p "$EV"/{10-preflight,20-backup,30-install,40-gate,50-migrate,60-reconciliation,70-launch} "$AUTH"
```

命名规则：每条命令的 stdout+stderr 存 `<序号>-<名称>.log`，退出码存同名 `.exit`（内容形如 `exit=0`）。

## 2. 任务

### R10-01 开工检查与只读 Preflight（任一不满足即 R10_BLOCKED）

日志存 `10-preflight/`。

1. `git rev-parse HEAD` 必须是 `6976b7d` 或其后代；`git status --short` 除 `.claude/`、`pelican-*.html`、`docs/EXEC-R10-*.md`、`evidence/r10-*` 外不得有改动。
2. 无 Production 进程：`pgrep -fl personal-finance-console` 必须无输出。有则等待/报告，不得 kill。
3. 候选哈希复核（只读）：对 `$CAND` 的 executable、`Contents/Info.plist`、`Contents/Resources/runtime-compatibility.json`、源 `src-tauri/runtime-compatibility.json`、DMG 跑 `shasum -a 256`，四个值必须与本文开头"候选包"一节逐字一致；包内与源 manifest 必须相同。
4. 真实库只读指纹（`mode=ro&immutable=1`，禁止裸 `sqlite3 "$P"`）：

```bash
shasum -a 256 "$P"; stat -f "dev=%d inode=%i size=%z mtime=%m" "$P"; ls -la@ "$APP_DATA"
sqlite3 "file:$P?mode=ro&immutable=1" "PRAGMA user_version; PRAGMA integrity_check; PRAGMA foreign_key_check; SELECT version FROM schema_migrations ORDER BY 1;"
```

期望：哈希 `ebdd7c2d…`（全文见上）、大小 229376、`user_version=3`、rows `[1,2,3]`、integrity `ok`、FK 空、无 `-wal/-shm/-journal`。**任一不符（尤其哈希或 mtime 变化，说明有人在窗口内动过库）→ R10_BLOCKED。**
5. `/Applications/Personal Finance Console.app` 现状记录（替换前身份，供审计）：对其 `Contents/MacOS/personal-finance-console` 与 `Contents/Info.plist` 跑 `shasum -a 256`，记录在案。
6. 迁移前 C3-2 行数基线（只读，必须早于 R10-02 的任何写入）：

```bash
sqlite3 "file:$P?mode=ro&immutable=1" "select 'app_metadata',count(*) from app_metadata
union all select 'asset_revisions',count(*) from asset_revisions
union all select 'asset_value_snapshots',count(*) from asset_value_snapshots
union all select 'cash_account_revisions',count(*) from cash_account_revisions
union all select 'cash_balance_snapshots',count(*) from cash_balance_snapshots
union all select 'essential_expense_items',count(*) from essential_expense_items
union all select 'essential_expense_revisions',count(*) from essential_expense_revisions
union all select 'essential_expense_snapshots',count(*) from essential_expense_snapshots
union all select 'financial_settings',count(*) from financial_settings
union all select 'planning_income_revisions',count(*) from planning_income_revisions
union all select 'schema_migrations',count(*) from schema_migrations
union all select 'settings_revisions',count(*) from settings_revisions
order by 1;" | tee "$EV/10-preflight/16-pre-counts.txt"
```

R9-03 的 `30-real-readonly/34-*.log` 只覆盖 C3-1 的 8 张表，未覆盖 C3-2 的 12 张表；不得把该日志当作 C3-2 基线。期望当前 `schema_migrations` 为 3，其余表计数原样记录，供 R10-06 比对。

### R10-02 双备份（先备份，后一切）

日志存 `20-backup/`。

```bash
# 主备份（gate 规范路径）
mkdir -p "$APP_DATA/production-v8-backups"
# 先确认目标不存在或为空，绝不覆盖既有文件
test ! -e "$APP_DATA/production-v8-backups/personal-finance-console.sqlite3" || { echo "backup target exists"; exit 1; }
cp "$P" "$APP_DATA/production-v8-backups/personal-finance-console.sqlite3"
# 副备份
mkdir -p "$HOME/Documents/pfc-v8-migration-backup-20261022"
cp "$P" "$HOME/Documents/pfc-v8-migration-backup-20261022/personal-finance-console.sqlite3"
# 验证：三份哈希必须全部等于 ebdd7c2d…
shasum -a 256 "$P" "$APP_DATA/production-v8-backups/personal-finance-console.sqlite3" "$HOME/Documents/pfc-v8-migration-backup-20261022/personal-finance-console.sqlite3"
stat -f "path=%N dev=%d inode=%i nlink=%l mode=%p" "$APP_DATA/production-v8-backups/personal-finance-console.sqlite3" "$HOME/Documents/pfc-v8-migration-backup-20261022/personal-finance-console.sqlite3"
# 确认迁移前后数据库本体未被备份动作改变
shasum -a 256 "$P"
```

要求：三个哈希逐字相同且等于迁移前哈希；主备份 `nlink=1`、常规文件、非 symlink；备份后 `$P` 哈希不变。任一不符 → 删除本次新建的两个备份文件后 R10_BLOCKED（不得动其他文件）。

### R10-03 候选包安装到 /Applications

日志存 `30-install/`。

1. 预检：读 `$CAND/Contents/Info.plist`，确认 `CFBundleIdentifier=com.personalfinance.console`、`CFBundleExecutable=personal-finance-console`（`plutil -p` 即可）。不符 → R10_BLOCKED。
2. 再次确认无 Production 进程（同 R10-01.2）。
3. 替换：

```bash
rm -rf "$APP_PATH"
cp -R "$CAND" "$APP_PATH"
```

4. 安装后验证：对 `"$APP_PATH/Contents/MacOS/personal-finance-console"`、`"$APP_PATH/Contents/Info.plist"`、`"$APP_PATH/Contents/Resources/runtime-compatibility.json"` 跑 `shasum -a 256`，必须分别等于候选三哈希。同时 `"$APP_PATH"` 与 `$CAND` 的 manifest 内容逐字相同（`cmp`）。任一不符 → R10_BLOCKED（保留现场，不得回滚覆盖，等审核员裁决）。

### R10-04 授权文件与 Gate Preflight

日志存 `40-gate/`。授权文件写入 `$AUTH/`。

1. 生成 nonce：`python3 -c "import secrets; print(secrets.token_hex(16))"`，记为 `NONCE`。
2. 写 `$AUTH/candidate-approval.json`（逐字如下，不得增删字段）：

```json
{
  "status": "OWNER_APPROVED_V8_PRODUCTION_CANDIDATE",
  "syntheticOnly": false,
  "authorizationId": "owner-approval-r10-20261022-1",
  "candidateExecutableSha256": "444729451aafc3bbe6cf95b52ffd84a2191b75f6c1477d0d840656ace4711b5c",
  "candidateInfoPlistPath": "/Applications/Personal Finance Console.app/Contents/Info.plist",
  "candidateInfoPlistSha256": "41b8aa5a1c1933531c2d986c25d180590ffbf8920aff4483d791a882dc3cfdcb",
  "compatibilityManifestSha256": "f98b7f7bab5161e8c0c6bb93571ac8ce658c20d81785fc5651ac37f2f9c3d509",
  "bundleId": "com.personalfinance.console",
  "maxSupportedSchemaVersion": 8,
  "migrationSourceSchemaVersion": 3
}
```

3. 写 `$AUTH/migration-authorization.json`（`nonce` 用第 1 步生成值）：

```json
{
  "status": "OWNER_AUTHORIZED_PRODUCTION_V8_MIGRATION",
  "syntheticOnly": false,
  "authorizationId": "owner-migration-r10-20261022-1",
  "ownerAuthorizationId": "owner-approval-r10-20261022-1",
  "nonce": "<NONCE>",
  "candidateExecutableSha256": "444729451aafc3bbe6cf95b52ffd84a2191b75f6c1477d0d840656ace4711b5c",
  "candidateInfoPlistPath": "/Applications/Personal Finance Console.app/Contents/Info.plist",
  "candidateInfoPlistSha256": "41b8aa5a1c1933531c2d986c25d180590ffbf8920aff4483d791a882dc3cfdcb",
  "compatibilityManifestSha256": "f98b7f7bab5161e8c0c6bb93571ac8ce658c20d81785fc5651ac37f2f9c3d509",
  "productionDbPreMigrationSha256": "ebdd7c2d52c904dc0ce763302b461a8530ce0f6f3b4bc13c695ca5386f0d29bc",
  "backupPath": "/Users/linte/Library/Application Support/com.personalfinance.console/production-v8-backups/personal-finance-console.sqlite3",
  "productionBundleId": "com.personalfinance.console",
  "sourceSchemaVersion": 3,
  "targetSchemaVersion": 8
}
```

注意：`backupPath` 必须逐字等于该规范路径；`productionDbPreMigrationSha256` 必须仍与当前 `$P` 一致（写文件前再 `shasum` 复核一次）。两个文件 `chmod 600`。

4. Preflight：

```bash
cd "$REPO"
python3 -I scripts/production_v8_release_gate.py preflight "$AUTH/candidate-approval.json" "$AUTH/migration-authorization.json" | tee "$EV/40-gate/41-preflight.log"
```

期望：退出码 0，输出 `"status": "PREFLIGHT_PASS"`，receipt `syntheticOnly=false`、`productionSchema` 为 V3/V3、`sidecarsAbsent=true`、备份与数据库哈希一致。`BLOCKED` → 如实记录全部 reasons，R10_BLOCKED，不得改动任何状态文件。

### R10-05 真实迁移（唯一允许写生产库的一步）

日志存 `50-migrate/`。执行前最后确认：无 Production 进程；`$P` 哈希仍为 `ebdd7c2d…`。

```bash
cd "$REPO"
python3 -I scripts/production_v8_release_gate.py migrate "$AUTH/candidate-approval.json" "$AUTH/migration-authorization.json" | tee "$EV/50-migrate/51-migrate.log"
```

gate 将在内部：校验持久化 preflight receipt → 写一次性 permit → 启动 `/Applications` 候选可执行文件执行 `--pfc-internal-v8-migrate` → 校验 native 结果与 terminal → 完成。

期望：退出码 0；输出 `"status": "V8_RELEASE_GATE_COMPLETED"`；`receipt.nativeStatus` 为 `V8_MIGRATION_VERIFIED_NATIVE`；verification 段 `terminal` 校验通过。

失败处置（严格照做，不得自行清理）：
- 退出码 2 / `BLOCKED`：记录 reasons 全文。**不得删除** permit、receipt、ledger、terminal 中任何一个；它们是关键状态证据。R10_BLOCKED 返回，由审核员裁决清理。
- native 超时或崩溃：同上，另附 `51-migrate.log` 全文。

### R10-06 迁移后对账（按 R9-04 规格）

日志存 `60-reconciliation/`。全部使用 `sqlite3 "file:$P?mode=ro&immutable=1"`。

依次执行 `evidence/r9-rehearsal-20261022/40-reconciliation/POST_MIGRATION_CHECKS.md` 的 C1、C2、C3、C5，期望值以该文件为准（5 笔债务 ID 精确、2026-10 合计 172579.53/14518.73、2026-11 合计 157228.31/8851.03、逐表行数、C5-1/C5-2 返回 0 行、OPEN 1 仅记录）。C3-2 的"迁移前"计数以 `10-preflight/16-pre-counts.txt` 为基线（R9-03 未采集这 12 张表），迁移后执行同一 SQL 保存为 `60-reconciliation/post-counts.txt`，排除 `schema_migrations` 后 `diff` 必须为空。

C4 按本任务口径执行（替代 R9 规格中的 C4 表述，因为真实迁移合法产生 terminal）：

```bash
sqlite3 "file:$P?mode=ro&immutable=1" "PRAGMA user_version; PRAGMA integrity_check; PRAGMA foreign_key_check; SELECT version FROM schema_migrations ORDER BY 1;"
ls -la "$APP_DATA"
```

期望：`user_version=8`；integrity `ok`；FK 空；rows 恰为 1..8；目录内无 `-wal/-shm/-journal`；`production-v8-cutover-terminal.json` 存在；`production-v8-release-receipt.json` 存在；`production-v8-consumed-authorizations.json` 存在且恰 1 条记录；`production-v8-migration-authorization.json`（permit）**不存在**（已消费）；备份与副备份仍在且哈希未变。

迁移后哈希记录：`shasum -a 256 "$P"`（新 V8 哈希，写入回执与 terminal 对照）。

任一对账项不符 → 停止，不得尝试修数据，R10_BLOCKED。

### R10-07 Production 启动验证

日志存 `70-launch/`。

```bash
open "$APP_PATH"
sleep 12
pgrep -fl "Personal Finance Console" ; pgrep -fl personal-finance-console
```

期望：进程存活、无立即退出（若 12 秒后进程不存在，读 `$APP_DATA` 下日志/诊断并记录，R10_BLOCKED）。随后：

```bash
osascript -e 'tell application id "com.personalfinance.console" to quit'
sleep 5
pgrep -fl personal-finance-console   # 期望无输出
ls -la "$APP_DATA"                    # 期望无 -wal/-shm/-journal 残留；terminal 仍在
sqlite3 "file:$P?mode=ro&immutable=1" "PRAGMA user_version;"   # 仍为 8
```

注意：候选包 `CFBundleDisplayName`/`CFBundleName` 为「小钱家」（审核员已用 `plutil -p` 核实），按名称 `quit app "Personal Finance Console"` 无法解析；必须按 bundle id 退出。若 5 秒后进程仍在，再等 10 秒并记录；仍不退出 → R10_BLOCKED，保留现场，**不得** `kill -9` 或 `kill` 任何进程。

启动验证只证明"V8 terminal 通过读回、应用不再 panic"。不得在窗口内录入任何真实业务数据。

## 3. 回滚方案（仅供裁决后执行，执行员不得擅自触发）

重要事实（审核员确认）：当前 Rust 启动门闸只接受「V8 库 + 完整 V8 terminal」。因此**回滚到 V3 只能恢复数据，不能恢复应用可用性**——回滚后应用仍将拒绝启动，直至重新完成迁移。是否回滚由户主/审核员在了解该后果后明确下令。

参考命令（仅在明确指令下执行）：

```bash
# 1. 确认应用已退出、无进程持有数据库
# 2. 用主备份恢复数据库本体
cp "$APP_DATA/production-v8-backups/personal-finance-console.sqlite3" "$P"
shasum -a 256 "$P"   # 必须回到 ebdd7c2d…
# 3. terminal/receipt/ledger/backup 目录的处置、以及随后的再迁移安排，逐字按审核员指令执行
```

## 4. 回执

`$EV/RECEIPT.md`，按顺序：

1. 状态：`R10_PASS` 或 `R10_BLOCKED`（含原因与停止点）。
2. R10-01…R10-07 各自 PASS/BLOCKED 与证据文件路径。
3. 所有命令的「序号 / 完整命令 / 退出码 / 结果摘要 / 日志路径」表。
4. 迁移前指纹 vs R9 基线（哈希、大小、mtime）；两份备份的哈希、dev、inode、nlink。
5. 替换前 `/Applications` 旧包哈希 → 替换后新包三哈希。
6. gate preflight 与 migrate 的完整 JSON 输出摘要（status、nativeStatus、nonce、receipt/terminal 路径）。
7. 迁移后数据库哈希、C1–C5 逐项结果、与期望的差异（若有）。
8. 启动验证：进程存活证据、退出后状态、无 sidecar。
9. `git status --short` 输出。
10. 下列声明（值如实填写，与 R9 口径相反，本任务允许为 true）：

```text
REAL_PRODUCTION_DATABASE_MIGRATED_TO_V8 = <true|false>
REAL_PRODUCTION_APP_REPLACED_WITH_APPROVED_CANDIDATE = <true|false>
REAL_PRODUCTION_V8_TERMINAL_PUBLISHED = <true|false>
REAL_PRODUCTION_APP_LAUNCHED_AND_EXITED_CLEANLY = <true|false>
```

只有四项全为 true 且 C1–C5 全过时才可写 `R10_PASS`。

## 5. 返回条件（R10_BLOCKED）

红线任一触发；开工检查任一不符；候选或迁移前数据库哈希与基线不符；备份三份哈希不一致；安装后哈希不符；gate preflight/migrate 返回 BLOCKED；对账任一项不符；启动后进程立即退出。返回时停止全部后续步骤，保留现场（不删任何状态文件），附完整原因与日志，等待审核员裁决。