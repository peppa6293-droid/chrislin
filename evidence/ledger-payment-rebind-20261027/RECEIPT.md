# LEDGER-PAYMENT 2026-10-27 生产恢复回执（审核侧实测）

- 状态：`P0_RESTORE_ACCEPTED_WITH_FINDINGS`
- 授权：`owner-approval-ledger-payment-20261027-1`（候选可执行指纹重绑定）→ `owner-approval-ledger-payment-20261027-2`（卷设备号重确认，`upgradeFrom` 指向 `-1`）
- 任务书：`docs/WP-RELEASE-REBIND-01-EXEC-INSTRUCTIONS.md`、`docs/WP-RELEASE-REBIND-02-EXEC-INSTRUCTIONS.md`
- 复测时间：2026-10-27 14:46 起连续实测（Asia/Shanghai）。本回执所有数值均为审核侧独立重测，不是转抄执行方输出。
- 性质：**只读复核**。本轮未写生产库、未启动/停止/替换生产 App、未创建迁移许可、未改代码、未提交 git。

## 1. 交付与启动（A 线）

| 项 | 实测值 |
| --- | --- |
| 代码提交 | `e21f1e5`（2026-10-27 11:14:37 +0800，4 文件 +305/−31，含 `tests/v2-ledger/essential-payment-identity.test.ts`） |
| 重建包 | `src-tauri/target/release/bundle/macos/小钱家.app`，可执行 mtime 11:29:13 |
| 安装包可执行 | `/Applications/Personal Finance Console.app/Contents/MacOS/personal-finance-console` = `35c69ba50644920607b5b0b66393c7dcba718aca105c8906cdb83009a7217f92`（与重建产物同哈希） |
| Info.plist | `41b8aa5a1c1933531c2d986c25d180590ffbf8920aff4483d791a882dc3cfdcb`（新旧一致，未改） |
| runtime-compatibility.json | `f98b7f7bab5161e8c0c6bb93571ac8ce658c20d81785fc5651ac37f2f9c3d509`（新旧一致，未改） |
| REBIND-01 | `2026-10-27T03:38:00.646Z`（11:38:00）：`d407b7bf…c09c86c` → `35c69ba5…17f92`，审计副本 `production-v8-hotfix-audit/ledger-payment-20261027/` |
| REBIND-02 | `2026-10-27T03:44:46.668Z`（11:44:46）：`backupDevice`/`databaseDevice` `16777232` → `16777233`，inode `31243956`/`30715175` 与两个 sha256 均未变，审计副本 `…-volume/` |
| 启动验收 | PID 42838，STARTED 11:44:46，14:48 实测 elapsed `3:03:37`，`ps` 状态 `S`、CPU 0.0%，`~/Library/Logs/DiagnosticReports` 今日无该 App 崩溃报告 |

三件套现行哈希（实测）：
- terminal `0f480aba50de1a1064bfaffe3ca2103322c1f7ff96b499bb1e26693981dc0ec7`，`state=V8_VERIFIED`、`migrationRows=[1..8]`、`migrationRowCount=8`、`integrityCheck=ok`、`foreignKeyViolationCount=0`、`sidecarsAbsent=true`
- receipt `ebf02545698aa54bf3c7166b79584d0111da333f464ecabebdf12746d611d996`（其 `candidateExecutableSha256` 与 `productionAppInventory[0].executable_sha256` 均已指向 `35c69ba5…`）
- ledger `04439bf4112d8e867c55bce1a6d35c17da323bb790acc96ae82a39af430838a6`，**恰 1 条**，`candidateExecutableSha256=35c69ba5…`
- rotations `93b2bd31c37819c4dd4bc63bbf015812cbe394444868a055a9d54ea838f8f1a1`：根记录 R13B + 4 条 `subsequentRotations`（ux-revamp、ux-round2×2、本轮 REBIND-01）+ 1 条 `volumeRotations`（本轮 REBIND-02）
- `production-v8-migration-authorization.json` 与 `production-v8-legacy-v4-migration-authorization.json` **均不存在**（未创建迁移许可）

回归复跑：`npx vitest run tests/v2-ledger/essential-payment-identity.test.ts` → **2/2 passed**（14:48）。

## 2. 生产库只读核对

| 项 | 实测值 |
| --- | --- |
| 文件 | `~/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3` |
| 大小 / mtime / inode | 1,294,336 字节 / 2026-10-24 12:03:47 / 30715175（本轮零写入，mtime 仍停在 10-24） |
| 当前 sha256 | `a0bd66c6ff30e8371577f8a44963f7d4b72da3ad48dcf14a934ad7678f820bc7` |
| schema | `user_version=8`，`schema_migrations` 8 行（1–8），`integrity_check=ok` |
| 备份 | `production-v8-backups/personal-finance-console.sqlite3`，229,376 字节，sha `ebdd7c2d…29bc`（= terminal `backupSha256`），inode 31243956 |
| ESSENTIAL 支付记录 | `expenses.kind` 仅 `CASH_DEBIT` 831 笔，**无 ESSENTIAL 行**；支付身份修复对现有数据零影响，属向前生效 |

**锚点更正（重要）**：10-23 各文件记录的「829 笔 / 101,187.16、库 sha `53a45c28…29aee7`」已过期。现库实测：

| 口径 | 现在 | 10-23 记录 | 差 |
| --- | --- | --- | --- |
| V2 `expenses` 全量 | **831 笔 / 101,250.26** | 829 / 101,187.16 | +2 / +63.10 |
| V2 当月（2026-10） | 111 笔 / 9,372.42 | 109 / 9,309.32 | +2 / +63.10 |
| V1 `expense_records` VARIABLE 全量 | **832 / 101,263.36** | 830 / 101,200.26 | +2 / +63.10 |
| 双账本差 | 1 笔 / 13.10 | 1 笔 / 13.10 | 未变 |

增量来源：户主自记两笔——`deepseek` ¥50.00（2026-10-23，created_at `13:55:01Z` = 21:55 本地）、`瑞幸` ¥13.10（2026-10-24，created_at `04:03:47Z` = 12:03:47 本地，与库 mtime 同刻）。两笔均为 `CASH_DEBIT`，非本轮造成，也非导入/归类批次。

## 3. 发现的差异与未闭合项

1. **安装包未通过 strict codesign 验证**（新发现）：`codesign --verify --strict "/Applications/Personal Finance Console.app"` → exit 1，报错 `code has no resources but signature indicates they must be present`；`codesign -dvv` 显示 `flags=adhoc,linker-signed`、`Info.plist=not bound`、`Sealed Resources=none`。重建产物 `小钱家.app` 同样如此。本机 `security find-identity -p codesigning` 仍有 `Apple Development: 8619814730147 (FW5KHTFNZ6)`。门闸只校验可执行指纹，因此不影响启动；但 11:29 重建**未做 bundle 签名**，与既往轮次「strict codesign PASS」的验收口径不一致。补签会改变可执行哈希，必须与重绑定同批、另出授权。
2. **状态文件滞后（本轮已修）**：`PROJECT-STATE.md` 停在 10-23、`WORKLOG.md` 停在 10-25、`docs/CURRENT_PHASE.md` 停在 10-23；两轮重绑结论此前只存在于授权/rotation 文件。本轮已补 10-27 记录，并更正库锚点。
3. **V4 cutover blocker 未动**：`RB-V4-CUTOVER-QUIESCENCE-01` 仍 OPEN；本轮只恢复启动，未创建任何迁移许可，Production V4 仍 NOT AUTHORIZED。
4. **结构性风险**：门闸把「允许启动」钉在卷设备号上，本次是数据卷重挂导致漂移（`16777232`→`16777233`）；同类重挂会再次复现同一错误。是否改为只认 inode+sha256，需规划层决策。
5. **工作区未提交**：8 个已跟踪改动 + 46 个未跟踪文件（本回执落盘前计数）。重绑脚本、授权文件、审计副本按任务书明令不入 git，属刻意；状态文档与新增回执的归属需一次性定档。

## 4. 未做（边界声明）

- 未写入生产库、未读写 `backups/**`、未触碰 `production_integrity_state`；
- 未启动/停止/替换生产 App（PID 42838 保持原样）、未重启；
- 未创建/复活任何迁移许可，未执行迁移；
- 未改代码、未重建、未补签、未提交 git；
- 未执行户主的 GUI 点验（导出备份、固定支出同类别两笔支付），该两项仍待户主完成。
