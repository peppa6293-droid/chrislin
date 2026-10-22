# R10 真实 Production V3→V8 迁移回执

执行依据：`docs/EXEC-R10-PRODUCTION-V8-MIGRATION-INSTRUCTIONS.md`（任务书定稿，提交 `ea5f899`）
任务书 SHA-256：`6960469c79d20643ba10c95e7f9067b5c684b88df2bbe6504b501d567ffe4d33`
开工 HEAD：`ea5f899739350478024838f3a933e4885815e098`（`6976b7d` 的后代）
执行日期：2026-10-22
执行窗口（本地）：约 14:26–14:30；gate 观测时间（UTC）：2026-10-22T06:27:56Z / 06:28:03Z

固定路径（下文命令中的变量）：

```bash
REPO="/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2"
APP_DATA="$HOME/Library/Application Support/com.personalfinance.console"
P="$APP_DATA/personal-finance-console.sqlite3"
APP_PATH="/Applications/Personal Finance Console.app"
CAND="$REPO/src-tauri/target/release/bundle/macos/小钱家.app"
EV="$REPO/evidence/r10-production-migration-20261022"
AUTH="$EV/authorization"
```

## 1. 状态

**R10_PASS**

R10-01…R10-07 全部完成且符合任务书期望；未触发红线，未触发 §5 返回条件。
真实生产库已由 gate 内部触发的 native rusqlite runner 从 V3 迁移到 V8；真实生产包已替换为审核员批准的候选包；V8 terminal 已发布；应用已启动并按 bundle id 干净退出。

两项须审核员知悉的事实已在第 6、7、8、11 节如实披露，不构成失败：

1. **启动后数据库文件哈希发生变化**：迁移完成时 `f32014c7…`，启动并退出后为 `319907d6…`。业务表与结构计数均未变；源码明确把迁移后哈希定义为“迁移时事实”，启动权威改用 `production_integrity_state`（`src-tauri/src/lib.rs:1268-1285`）。
2. **持久化的 `production-v8-release-receipt.json` 状态仍为 preflight 状态**：`PREFLIGHT_PASS_READY_FOR_SEPARATELY_AUTHORIZED_MIGRATION`。gate 的 migrate 在内存中返回 `V8_RELEASE_GATE_COMPLETED` 回执对象，但不重写该文件；该文件的 SHA-256 `93bb…` 正是 terminal 的 `releaseReceiptSha256` 绑定值（`scripts/production_v8_release_gate.py:1358-1399`）。

## 2. 分任务结论

| 任务 | 结论 | 核心证据 |
|---|---|---|
| 第 1 节 开工检查（R10-01.1–.2） | PASS | HEAD `ea5f899`；仅允许的未跟踪项；无 Production 进程 |
| R10-01 候选哈希与真实库只读 Preflight | PASS | `10-preflight/14`、`15`、`15b`、`16`；四候选哈希与 DMG 全命中；真实库 `ebdd7c2d…`、229376、V3、1..3、ok、FK 空、无 sidecar |
| R10-02 双备份 | PASS | `20-backup/21`；三份哈希同一；主备份规范路径、常规文件、非 symlink、`nlink=1`；备份后库哈希未变 |
| R10-03 候选包安装 | PASS | `30-install/31`–`33`；安装后三哈希与候选逐字一致；manifest/Info.plist `cmp` 均为 0 |
| R10-04 授权文件与 gate preflight | PASS | `authorization/` 两文件 mode 600；`40-gate/41-preflight.log` = `PREFLIGHT_PASS` |
| R10-05 真实迁移 | PASS | `50-migrate/51-migrate.log` = `V8_RELEASE_GATE_COMPLETED`，native `V8_MIGRATION_VERIFIED_NATIVE` |
| R10-06 迁移后对账 | PASS | `60-reconciliation/61`–`6b`；C1–C5 全过；`RESULT=PASS` |
| R10-07 启动验证与退出 | PASS | `70-launch/71`–`76`；PID 72236 存活；bundle id 退出；无残留进程/sidecar；`user_version=8` |

## 3. 命令、退出码与日志

说明：
- 工作目录除注明外均为仓库根；`$P` 的只读访问一律使用 `sqlite3 "file:$P?mode=ro&immutable=1"`，全程未裸开、未复制真实库为查询输入。
- `13`、`31b`、`50-pre-migrate` 中的 `pgrep` 返回 1 表示“无匹配进程”，是本任务要求的通过条件，不是失败。
- `40-nonce` 与 `72-process-alive` 的退出码在命令执行时已写入各自日志；`.exit` 文件在回执整理阶段补齐，内容与日志一致（`40-nonce.log` 内含 `exit=0`；`72-process-alive.log` 内含三个 `pgrep_*_exit=0`）。`40-authorizations` 只有 `.exit`，授权文件原文与 `40-auth-verify.log` 为其实质证据。

| # | 完整命令 | 退出码 | 结果摘要 | 日志 |
|---|---|---|---|---|
| 11 | `git rev-parse HEAD; git merge-base --is-ancestor 6976b7d HEAD` | 0 | HEAD `ea5f899…`；是 `6976b7d` 后代 | `10-preflight/11-head.log` |
| 12 | `git status --short` + 允许项过滤 | 0 | 仅 `.claude/`、`evidence/r10-…/`、`pelican-*.html`；`disallowed_count=0` | `10-preflight/12-git-status.log` |
| 13 | `/usr/bin/pgrep -fl personal-finance-console` | 1 | 无输出；无 Production 进程 | `10-preflight/13-no-process.log` |
| 14 | `shasum -a 256 "$CAND/Contents/MacOS/personal-finance-console" "$CAND/Contents/Info.plist" "$CAND/Contents/Resources/runtime-compatibility.json" src-tauri/runtime-compatibility.json src-tauri/target/release/bundle/dmg/小钱家_0.1.0_aarch64.dmg; cmp …` | 0 | 5 个实测哈希全命中；包内=源 manifest（`cmp` 0） | `10-preflight/14-candidate-hashes.log` |
| 15 | `shasum -a 256 "$P"; stat -f "dev=%d inode=%i size=%z mtime=%m" "$P"; ls -la@ "$APP_DATA"; sqlite3 "file:$P?mode=ro&immutable=1" "PRAGMA user_version; PRAGMA integrity_check; PRAGMA foreign_key_check; SELECT version FROM schema_migrations ORDER BY 1;"` | 0 | `ebdd7c2d…`；dev 16777232 / inode 30715175 / 229376 / mtime 1792594937；V3；ok；FK 空；1,2,3；无 sidecar | `10-preflight/15-db-fingerprint.log` |
| 15b | `shasum -a 256 "$APP_PATH/Contents/MacOS/personal-finance-console" "$APP_PATH/Contents/Info.plist"; plutil -p "$APP_PATH/Contents/Info.plist"` | 0 | 替换前旧可执行 `5b2b1329…`；plist `41b8aa5a…`；bundle id/可执行名正确 | `10-preflight/15b-app-before.log` |
| 16 | `sqlite3 "file:$P?mode=ro&immutable=1" "select 'app_metadata',count(*) … union all … order by 1;"` | 0 | C3-2 迁移前 12 表计数（`schema_migrations=3`），见第 7 节 | `10-preflight/16-pre-counts.log`、`16-pre-counts.txt` |
| 21 | `mkdir -p …; test ! -e …; cp "$P" "$APP_DATA/production-v8-backups/…"; cp "$P" "$HOME/Documents/pfc-v8-migration-backup-20261022/…"; shasum …; stat …` | 0 | 三份哈希均 `ebdd7c2d…`；两备份 `nlink=1`、常规文件、非 symlink；备份后 `$P` 哈希未变 | `20-backup/21-backup.log` |
| 31 | `plutil -p "$CAND/Contents/Info.plist"` | 0 | `CFBundleIdentifier=com.personalfinance.console`；`CFBundleExecutable=personal-finance-console`；显示名/名称为「小钱家」 | `30-install/31-install-precheck.log` |
| 31b | `/usr/bin/pgrep -fl personal-finance-console` | 1 | 无输出；安装前无 Production 进程 | `30-install/31b-no-process.log` |
| 32 | `rm -rf "$APP_PATH"; cp -R "$CAND" "$APP_PATH"` | 0 | 旧包移除、候选包复制完成 | `30-install/32-install.log` |
| 33 | `shasum -a 256` 三个安装后文件；`cmp` manifest/Info.plist（安装包 vs 候选） | 0 | 三哈希分别等于候选；`manifest_cmp_exit=0`、`plist_cmp_exit=0` | `30-install/33-install-verify.log` |
| 40-nonce | `python3 -c "import secrets; print(secrets.token_hex(16))"` | 0 | nonce=`a89d781adc1875811f80fdaf3a9ff998` | `40-gate/40-nonce.log` |
| 40-authorizations | 写入两份授权 JSON；`chmod 600` | 0 | 字段逐字按任务书；两文件 mode 600；SHA-256 分别为 `eaac65ca…`、`ca76b86c…` | `40-gate/40-authorizations.exit`；文件在 `authorization/` |
| 40-pre-auth-state | `shasum` 库与两备份；检查 permit/receipt/ledger/terminal 均不存在 | 0 | 库与两备份仍 `ebdd7c2d…`；四个状态文件全部 absent | `40-gate/40-pre-auth-state.log` |
| 40-auth-verify | 精确键值比对 + `stat` 权限 | 0 | 两文件 exact match；均 mode 600；nonce 一致 | `40-gate/40-auth-verify.log` |
| 41 | `python3 -I scripts/production_v8_release_gate.py preflight "$AUTH/candidate-approval.json" "$AUTH/migration-authorization.json"` | 0 | `PREFLIGHT_PASS`；receipt 写入；`syntheticOnly=false`；V3/V3；`sidecarsAbsent=true`；备份=库哈希 | `40-gate/41-preflight.log` |
| 50-pre-migrate | `pgrep`；`shasum "$P"`；检查 preflight receipt | 0 | 无进程；库仍 `ebdd7c2d…`；preflight receipt 存在 | `50-migrate/50-pre-migrate.log` |
| 51 | `python3 -I scripts/production_v8_release_gate.py migrate "$AUTH/candidate-approval.json" "$AUTH/migration-authorization.json"` | 0 | `V8_RELEASE_GATE_COMPLETED`；native `V8_MIGRATION_VERIFIED_NATIVE`；terminal/ledger 生成；DB `f32014c7…` | `50-migrate/51-migrate.log` |
| 61 | C1：`SELECT count(*), count(DISTINCT id) FROM debts; SELECT id,name FROM debts ORDER BY id;`（只读 URI） | 0 | `5|5`；5 个 ID/名称精确匹配 | `60-reconciliation/61-c1-debt-ids.log` |
| 62 | C2：按 `period_month` 聚合 + 逐笔 10 行（只读 URI） | 0 | 2026-10 `172579.53/14518.73/5`；2026-11 `157228.31/8851.03/5`；10 行无重复 | `60-reconciliation/62-c2-monthly.log` |
| 63 | C3-1：8 张表 `count(*)`（只读 URI） | 0 | 5/1/4/4/1/1/10/0，精确匹配 | `60-reconciliation/63-c3-1-counts.log` |
| 64 | C3-2：迁移后同一 12 表计数（只读 URI） | 0 | 除 `schema_migrations 3→8` 外全部不变 | `60-reconciliation/64-c3-2-post-counts.log`、`post-counts.txt` |
| 65 | `diff` 迁移前/后 C3-2 计数（排除 `schema_migrations`） | 0 | `diff_exit=0`，无差异 | `60-reconciliation/65-c3-2-diff.log` |
| 66 | C3-3：8 张 V4–V8 新表 `count(*)`（只读 URI） | 0 | 全部为 0 | `60-reconciliation/66-c3-3-new-tables.log` |
| 67 | C4：`PRAGMA user_version/integrity_check/foreign_key_check; SELECT version…; ls -la "$APP_DATA";` 状态文件/备份检查 | 0 | V8；ok；FK 空；1..8；无 sidecar；terminal/receipt/ledger 存在；permit 不存在；备份哈希未变 | `60-reconciliation/67-c4-state.log` |
| 67b | Python 只读解析 terminal/receipt/ledger | 0 | terminal 为 dict；receipt `status=PREFLIGHT_PASS…`；ledger 长度 1 | `60-reconciliation/67b-json-state.log` |
| 68 | C5-1：V2 现金支出镜像一致性（只读 URI） | 0 | `row_count=0` | `60-reconciliation/68-c5-1.log` |
| 69 | C5-2：V2 信用卡支出不得有 V1 镜像（只读 URI） | 0 | `row_count=0` | `60-reconciliation/69-c5-2.log` |
| 6a | OPEN 1 信息性计数（只读 URI） | 0 | `0|1|0`（v2 收入 0 / v1 收入 1 / 共享 ID 0），仅记录 | `60-reconciliation/6a-open1.log` |
| 6b | 对账判决脚本 | 0 | `RESULT=PASS`；C1–C5 全 PASS | `60-reconciliation/6b-reconciliation-verdict.log` |
| 6c | `sqlite3 "file:$P?mode=ro&immutable=1" "SELECT singleton, sequence, previous_digest, content_digest, tag FROM production_integrity_state;"` | 0 | `sequence=3`，完整性头由迁移初始化后继续被合法事务推进 | `60-reconciliation/6c-integrity-head.log` |
| 71 | `open "$APP_PATH"; sleep 12` | 0 | 启动命令与等待均成功 | `70-launch/71-launch.log` |
| 72 | `pgrep -fl "Personal Finance Console"; pgrep -fl personal-finance-console; pgrep -x personal-finance-console` | 0 | PID 72236，路径为 `/Applications/Personal Finance Console.app/Contents/MacOS/personal-finance-console` | `70-launch/72-process-alive.log` |
| 73 | `osascript -e 'tell application id "com.personalfinance.console" to quit'; sleep 5` | 0 | 按 bundle id 退出成功 | `70-launch/73-quit.log` |
| 74 | `pgrep -fl personal-finance-console; ls -la "$APP_DATA"; sqlite3 "file:$P?mode=ro&immutable=1" "PRAGMA user_version;"` | 0 | 无进程；无 `-wal/-shm/-journal`；terminal 仍在；`user_version=8` | `70-launch/74-post-quit.log` |
| 75 | `shasum -a 256 "$P"; stat …; sqlite3 …` | 0 | 启动后哈希 `319907d6…`；352256；V8；ok；计数未变 | `70-launch/75-post-launch-fingerprint.log` |
| 76 | C3-2 同 SQL（启动后，只读 URI） | 0 | 12 表计数与迁移后完全一致 | `70-launch/76-post-launch-counts.log` |
| 80 | `git status --short; git diff --check; git diff --stat` | 0 | 仅允许的未跟踪项；`diff_check_exit=0`；无已跟踪改动 | `80-final-git-status.log` |
| 81 | 状态文件与证据文件清单 | 0 | terminal/ledger/receipt 哈希记录；证据清单 | `81-evidence-inventory.log` |
| 82 | 回执写后最终清单 | 0 | 重列全部证据与哈希（含 `RECEIPT.md`） | `82-final-inventory.log` |
| 83 | 补录 `6c` 后的最终清单 | 0 | 再次重列全部证据与哈希（含 `RECEIPT.md`、`6c-integrity-head.log`） | `83-final-inventory.log` |

## 4. 迁移前指纹 vs R9 基线；双备份

### 4.1 真实库迁移前

只读方式：`sqlite3 "file:$P?mode=ro&immutable=1"`；`$P` 从未被裸开。

| 项目 | R9 基线 | R10 开工实测 | 判定 |
|---|---|---|---|
| SHA-256 | `ebdd7c2d52c904dc0ce763302b461a8530ce0f6f3b4bc13c695ca5386f0d29bc` | 同左 | 相同 |
| size | 229376 | 229376 | 相同 |
| dev | 16777232 | 16777232 | 相同 |
| inode | 30715175 | 30715175 | 相同 |
| mtime epoch | 1792594937 | 1792594937 | 相同 |
| nlink / mode | 1 / 100644 | 1 / 100644 | 相同 |
| `user_version` | 3 | 3 | 相同 |
| `schema_migrations` | 1,2,3 | 1,2,3 | 相同 |
| `integrity_check` | ok | ok | 相同 |
| `foreign_key_check` | 空 | 空 | 相同 |
| sidecars | 无 | 无 | 相同 |
| 目录清单 | `maintenance.lock`(0)、库(229376)、`.v8-quarantined`(348160) | 同左 | 相同 |

结论：迁移前真实库与 R9 基线逐字一致，未在窗口内被改动。

### 4.2 两份备份

| 备份 | 路径 | SHA-256 | dev | inode | nlink | 类型/权限 |
|---|---|---|---|---|---|---|
| 主备份（gate 规范路径） | `$APP_DATA/production-v8-backups/personal-finance-console.sqlite3` | `ebdd7c2d52c904dc0ce763302b461a8530ce0f6f3b4bc13c695ca5386f0d29bc` | 16777232 | 31243956 | 1 | 常规文件 / 100644 / 非 symlink |
| 副备份（仓库外） | `$HOME/Documents/pfc-v8-migration-backup-20261022/personal-finance-console.sqlite3` | `ebdd7c2d52c904dc0ce763302b461a8530ce0f6f3b4bc13c695ca5386f0d29bc` | 16777232 | 31243957 | 1 | 常规文件 / 100644 / 非 symlink |

三份哈希（库 + 两备份）逐字相同且等于迁移前哈希 `ebdd7c2d…`；备份动作后 `$P` 哈希未变（`21-backup.log`）。两个备份在 R10-06 对账时仍在且哈希未变（`67-c4-state.log`）。

## 5. `/Applications` 替换前后身份

| 对象 | 替换前（旧包） | 替换后（候选包） | 期望候选值 |
|---|---|---|---|
| `Contents/MacOS/personal-finance-console` | `5b2b13292abb6513de06d901b8f45469e1b075672ee628cb46c31a5ca282a845` | `444729451aafc3bbe6cf95b52ffd84a2191b75f6c1477d0d840656ace4711b5c` | `44472945…` |
| `Contents/Info.plist` | `41b8aa5a1c1933531c2d986c25d180590ffbf8920aff4483d791a882dc3cfdcb` | `41b8aa5a1c1933531c2d986c25d180590ffbf8920aff4483d791a882dc3cfdcb` | `41b8aa5a…` |
| `Contents/Resources/runtime-compatibility.json` | — | `f98b7f7bab5161e8c0c6bb93571ac8ce658c20d81785fc5651ac37f2f9c3d509` | `f98b7f7b…` |

安装后 `manifest_cmp_exit=0`、`plist_cmp_exit=0`（安装包 vs 候选逐字相同）；bundle id `com.personalfinance.console`、可执行名 `personal-finance-console`、显示名/名称「小钱家」。

## 6. Gate preflight 与 migrate JSON 摘要

### 6.1 Preflight（`41-preflight.log`，退出 0）

| 字段 | 值 |
|---|---|
| `status` | `PREFLIGHT_PASS` |
| `receiptPath` | `$APP_DATA/production-v8-release-receipt.json` |
| `receipt.status` | `PREFLIGHT_PASS_READY_FOR_SEPARATELY_AUTHORIZED_MIGRATION` |
| `receipt.syntheticOnly` | `false` |
| `receipt.productionSchema` | `userVersion=3`、`migrationVersion=3` |
| `receipt.sidecarsAbsent` | `true` |
| `receipt.productionDatabasePreMigrationSha256` | `ebdd7c2d52c904dc0ce763302b461a8530ce0f6f3b4bc13c695ca5386f0d29bc` |
| `receipt.backupSha256` | `ebdd7c2d52c904dc0ce763302b461a8530ce0f6f3b4bc13c695ca5386f0d29bc` |
| `receipt.backupPath` | `/Users/linte/Library/Application Support/com.personalfinance.console/production-v8-backups/personal-finance-console.sqlite3` |
| `receipt.candidateApprovalSha256` | `eaac65ca7d83c67f0b5929756a5abc7d72a988b7e3d1c4ce611c204394abf507` |
| `receipt.migrationAuthorizationSha256` | `ca76b86cc6f519f4daf542b7c0e9bed71007b77b0e9763dd15ca8f208b1aeb53` |
| `receipt.processInventory.processes` | `[]` |
| 安装包三哈希 | 与候选完全一致（见 6.1 日志 `productionAppInventory`） |

### 6.2 Migrate（`51-migrate.log`，退出 0）

| 字段 | 值 |
|---|---|
| `status` | `V8_RELEASE_GATE_COMPLETED` |
| `receipt.status` | `V8_RELEASE_GATE_COMPLETED`（migrate 内存返回对象） |
| `receipt.nativeStatus` | `V8_MIGRATION_VERIFIED_NATIVE` |
| `receipt.nativeNonce` | `cqaOvUIJIm2d4f2Bze06v3YoY9sIsNMllem_LMeRGS4` |
| `receipt.releaseReceiptSha256` | `93bb61952eee41c7d7df76de9321b7e66086b3789aa116d5daaf40012c68361b` |
| `verification.status` | `V8_RELEASE_GATE_VERIFIED` |
| `verification.nativeResult.status` | `V8_MIGRATION_VERIFIED_NATIVE` |
| `verification.nativeResult.terminalState` | `V8_VERIFIED` |
| `verification.nativeResult.schema` | `userVersion=8`、`migrationVersion=8`、rows `[1..8]` |
| `verification.databaseSha256` | `f32014c7f5a7ac16f5e8f1a9f900299a8adf0f3c353e673058265e3df62986a2` |
| terminal 路径 | `$APP_DATA/production-v8-cutover-terminal.json` |
| terminal SHA-256 | `46d4e4405437789281e949b64faaadffca2356528cd1813dc01c4ddc204ccbcc` |
| ledger 路径 | `$APP_DATA/production-v8-consumed-authorizations.json` |
| ledger SHA-256 | `4b337dcd7ff490e05162d5530076b43330e591b02d53a752e6d3084f9a867bbf` |

**持久化 receipt 状态披露**：gate 在 migrate 成功时只在返回值中把 `receipt.status` 改为 `V8_RELEASE_GATE_COMPLETED`，并未把该对象写回 `production-v8-release-receipt.json`；因此磁盘上的 receipt 仍是 preflight 状态（`67b-json-state.log` 实测 `status=PREFLIGHT_PASS_READY_FOR_SEPARATELY_AUTHORIZED_MIGRATION`）。其 SHA-256 `93bb…` 与 terminal 的 `releaseReceiptSha256` 完全一致，说明 terminal 绑定的是该持久化 preflight receipt，而不是返回对象。该行为由 `scripts/production_v8_release_gate.py:1358-1399` 决定，gate 退出码为 0，不构成迁移失败；本回执不把磁盘 receipt 描述为“已完成 receipt”。

## 7. 迁移后数据库、C1–C5 与哈希变化

### 7.1 迁移完成时（gate 刚结束，`67-c4-state.log`）

- SHA-256：`f32014c7f5a7ac16f5e8f1a9f900299a8adf0f3c353e673058265e3df62986a2`
- size：352256
- `user_version=8`；`integrity_check=ok`；`foreign_key_check` 空；`schema_migrations=1,2,3,4,5,6,7,8`
- 目录无 `-wal/-shm/-journal`
- `production-v8-cutover-terminal.json` 存在
- `production-v8-release-receipt.json` 存在
- `production-v8-consumed-authorizations.json` 存在且恰 1 条记录（authorizationId `owner-approval-r10-20261022-1`，nonce `cqaOv…`）
- `production-v8-migration-authorization.json`（permit）不存在（已消费）
- 两份备份仍在且哈希仍为 `ebdd7c2d…`

### 7.2 C1–C5 结果

| 检查 | 期望 | 实测 | 判定 |
|---|---|---|---|
| C1 债务 ID | 5 行 / 5 distinct；5 个 ID/名称精确 | `5|5`；5 个 ID/名称精确匹配 | PASS |
| C2 2026-10 | `172579.53 / 14518.73 / 5` | 同左 | PASS |
| C2 2026-11 | `157228.31 / 8851.03 / 5` | 同左 | PASS |
| C2 逐笔 | 10 行（5+5），无重复 `(debt_id, period_month)` | 10 行，无重复 | PASS |
| C3-1 | debts 5、profiles 1、assets 4、cash_accounts 4、income_records 1、expense_records 1、debt_period_facts 10、debt_revisions 0 | 完全一致 | PASS |
| C3-2 | 除 `schema_migrations 3→8` 外 11 表计数不变 | 完全一致；`diff_exit=0` | PASS |
| C3-3 | 8 张新表全部 0 | 全部 0 | PASS |
| C4 | V8 / ok / FK 空 / 1..8 / 无 sidecar / 状态文件符合 | 完全一致 | PASS |
| C5-1 | 0 行 | `row_count=0` | PASS |
| C5-2 | 0 行 | `row_count=0` | PASS |
| OPEN 1 | 仅记录 | `0|1|0` | 记录，不判失败 |

C3-2 迁移前（`16-pre-counts.txt`）与迁移后（`post-counts.txt`）：

| 表 | 前 | 后 |
|---|---|---|
| `app_metadata` | 0 | 0 |
| `asset_revisions` | 3 | 3 |
| `asset_value_snapshots` | 4 | 4 |
| `cash_account_revisions` | 0 | 0 |
| `cash_balance_snapshots` | 4 | 4 |
| `essential_expense_items` | 3 | 3 |
| `essential_expense_revisions` | 0 | 0 |
| `essential_expense_snapshots` | 3 | 3 |
| `financial_settings` | 1 | 1 |
| `planning_income_revisions` | 0 | 0 |
| `schema_migrations` | 3 | 8（唯一允许变化） |
| `settings_revisions` | 0 | 0 |

### 7.3 启动后的数据库哈希变化（须审核员知悉）

| 时点 | SHA-256 | size | mtime | 业务表/结构 |
|---|---|---|---|---|
| 迁移完成（67） | `f32014c7f5a7ac16f5e8f1a9f900299a8adf0f3c353e673058265e3df62986a2` | 352256 | 未采集（67 未记录 mtime） | V8，计数见 7.2 |
| 启动并退出后（75） | `319907d68dafd513a2ebed758d469a066793735677a1a462d034ea7b88b192a3` | 352256 | 1792650564 | V8，C3-2 计数与 7.2 完全一致 |

解释与判定：
- 应用启动/退出期间发生了合法的数据库写事务；只读实测 `production_integrity_state` 当前 `sequence=3`（`6c-integrity-head.log`），说明完整性头已由迁移初始化后继续被合法事务推进。业务表计数（`76-post-launch-counts.log`）与迁移后逐字一致：`debts 5`、`debt_period_facts 10`、`expenses 0`、`income_entries 0`、`schema_migrations 8`；`user_version=8`、`integrity ok`。
- 源码明确说明：`databasePostMigrationSha256` 是“迁移时事实”，合法业务 DML 会改变文件字节；启动权威不比对迁移后哈希，而校验 `production_integrity_state` 的认证链（`src-tauri/src/lib.rs:1268-1285`，原文注释：*"The exact post-migration file hash is a migration-time fact: legitimate business DML changes the file bytes. Startup authority therefore rests on the authenticated transactional integrity head..."*）。
- 因此该哈希变化不是对账失败，也不是数据被外部篡改；它是应用合法启动写事务的结果。terminal 内仍保留迁移时的 `f32014c7…`，这是设计预期。未在窗口内录入任何真实业务数据（`expenses=0`、`income_entries=0`，C3-2 计数不变）。

## 8. 启动验证

| 项目 | 结果 |
|---|---|
| `open "$APP_PATH"` | 退出 0（`71-launch.log`） |
| 12 秒后进程 | PID 72236 存活；三个 pgrep 形式均命中原包路径（`72-process-alive.log`） |
| 退出方式 | `osascript -e 'tell application id "com.personalfinance.console" to quit'`，退出 0；等待 5 秒（`73-quit.log`） |
| 退出后进程 | `pgrep` 退出 1，无输出；无残留进程（`74-post-quit.log`） |
| 退出后目录 | 无 `-wal/-shm/-journal`；terminal 仍在；`user_version=8`（`74-post-quit.log`） |
| 启动后哈希 | `319907d6…`；352256；`integrity ok`；计数未变（`75`、`76`） |

说明：候选包 `CFBundleDisplayName`/`CFBundleName` 为「小钱家」，按名称退出无法解析，已按任务书要求使用 bundle id 退出。启动验证只证明“V8 terminal 通过读回、应用不再 panic”；未在窗口内录入任何真实业务数据。

## 9. 最终 `git status --short`

```text
?? .claude/
?? evidence/r10-production-migration-20261022/
?? pelican-bicycle-animation.html
?? pelican-bicycle.html
?? pelican-bike-ride.html
?? pelican-bike.html
?? pelican-cycling.html
```

`git diff --check` 退出 0；无已跟踪文件改动；未执行 `git add` / `commit` / `push`；未修改 `src/`、`src-tauri/src/`、`src-tauri/runtime-compatibility.json`、`migrations/`、`scripts/`、`tests/`；未重建候选包、未改动 `src-tauri/target`。

## 10. 生产写入四项标志

```text
REAL_PRODUCTION_DATABASE_MIGRATED_TO_V8 = true
REAL_PRODUCTION_APP_REPLACED_WITH_APPROVED_CANDIDATE = true
REAL_PRODUCTION_V8_TERMINAL_PUBLISHED = true
REAL_PRODUCTION_APP_LAUNCHED_AND_EXITED_CLEANLY = true
```

证据：R10-05 gate migrate 退出 0 且 native 状态为 `V8_MIGRATION_VERIFIED_NATIVE`；R10-06 实测 V8、1..8、terminal/ledger 存在、permit 不存在；R10-07 PID 72236 存活后按 bundle id 退出且无残留进程/sidecar。四项均为 true，且 C1–C5 全过，故状态为 `R10_PASS`。

## 11. 附注与剩余风险（不隐瞒）

1. **启动后哈希变化**：详见 7.3。当前真实库 SHA-256 为 `319907d6…`，不再是 terminal 记录的 `f32014c7…`；这是合法启动写事务导致的文件字节变化，业务数据与结构未变。若审核员要求“迁移后哈希必须永久不变”，则该期望与当前源码设计冲突，需要另行裁决；本次未修改源码。
2. **持久化 receipt 状态**：磁盘 receipt 仍为 preflight 状态；migrate 的成功状态只在 stdout 返回对象中。terminal 的 `releaseReceiptSha256` 绑定的是磁盘 preflight receipt，二者哈希一致。未手工改写 receipt 以伪造 completed 状态。
3. **`40-authorizations` 无独立 `.log`**：该步骤只有 `.exit`；授权文件原文在 `authorization/`，字段/权限由 `40-auth-verify.log` 复核。
4. **`.exit` 补齐**：`40-nonce` 与 `72-process-alive` 的退出码原本已记录在日志正文，回执整理时补写同名 `.exit`；值分别为 0 和 0（72 的三个 pgrep 均为 0）。未改动任何日志正文。
5. **`personal-finance-console.sqlite3.v8-quarantined`**（348160 字节）：全程只读列举，未触碰、未删除、未移动；去留由审核员裁决。
6. **既有 OPEN 1–3 设计缺口**：`income_entries` 无 V1 镜像；`deleteV2Expense()` 不删 `expense_records` 镜像；V2 独有表无 V1 对应。迁移未改变这些行为，本次只记录，未新增镜像/触发器/迁移语句。
7. **未执行回滚**：§3 的回滚命令仅在审核员明确指令下执行；本次未触发。回滚到 V3 只恢复数据，不恢复应用可用性（Rust 门闸只接受 V8 库 + 完整 V8 terminal）。
8. **R10-06 C4 口径**：按任务书允许真实迁移合法产生 terminal/ledger，因此 C4 以“terminal/receipt/ledger 存在、permit 不存在、备份未变”判定；未按 R9 纯规格中“无残留 terminal/ledger”的旧表述判失败。
