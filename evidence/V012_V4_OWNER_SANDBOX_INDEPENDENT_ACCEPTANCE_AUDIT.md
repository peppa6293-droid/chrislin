# V0.1.2 V4 Owner Acceptance Sandbox — Independent Functional Acceptance Audit

日期：2026-10-08（Asia/Shanghai）  
最终状态：**PF_V012_V4_OWNER_SANDBOX_AUDIT_P1_REQUIRED**

## 1. Executive decision / Scope

**本轮不通过整体功能验收：P0 = 0，P1 = 1。** 月度收入、平时收入变化、Actual 修订、未来日期不复活、作废、延迟补录、现金停用及重启持久化均通过实际原生操作与数据库核对。必须通过的“恢复初始测试数据”在原生 App 中无响应，未恢复种子数据，构成 P1-SANDBOX-RESET-01。历史表直接露出 OVERRIDE / INHERIT，另记非阻塞文案问题。

本轮仅审计当前独立验收 artifact。未实施修复、未改源码、未改 RC2、未安装 App、未迁移 Production、未开始 Stage 4–7。没有勾选 Owner 验收清单；不宣称 Owner accepted / approved。**NOT ready for Owner acceptance decision until the reset P1 is closed.**

PRODUCTION V4 MIGRATION = **NOT AUTHORIZED**。RB-V4-OLD-RUNTIME-01 = **OPEN**。

## 2. Authoritative request / Sources reviewed

当次范围来自 [Owner 审计请求](/Users/linte/.codex/attachments/a8bf95e3-7898-4008-82a4-4d5776af606d/已粘贴的文本.txt)。已读取当次引用的 Codex task `01a0fd01-7944-75e1-8abb-c74e74e8d581` 最新交付；实施方的 `NATIVE_FRONTEND_READY` 仅作为定位材料，不作为本轮验收结论。

实际源码根目录：`/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0`。环境显示的 Documents 镜像目录不是本轮源码依据。

核对了当前：

- [V4AcceptanceApp.tsx](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/src/ui/V4AcceptanceApp.tsx)：原生页面、输入、保存、回读、历史、重置交互。
- [v4-acceptance-sandbox-service.ts](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/src/application/v4-acceptance-sandbox-service.ts)：身份校验、合成种子、初始化、保存、历史、reset 路由。
- [v4-foundation-service.ts](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/src/application/v4-foundation-service.ts)、[repositories.ts](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/src/persistence/repositories.ts:681)、[migrations.ts](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/src/persistence/migrations.ts)：日期语义、最新版本优先、现金生命周期、V4 结构。
- [lib.rs](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/src-tauri/src/lib.rs:128)、[验收 Tauri 配置](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/src-tauri/tauri.v4acceptance.conf.json)、Cargo / package / Vite 配置与实际 .app Info.plist。
- 当前 tests/v4-acceptance-sandbox.test.ts、官方 tests 目录、Rust 验收测试；本轮新增的显式 fail-closed 测试夹具仅存在于审计证据目录。
- docs/CURRENT_PHASE.md、V012_V4_ACTUAL02_INDEPENDENT_FINAL_REAUDIT.md、当前 sandbox / consumer-language / native frontend packaging 交付记录。

历史文档包含旧 Production 哈希；本轮只使用当次 Owner 提供的 `4b69…cf35` 基线及真实文件复验，没有用历史摘要覆盖当前事实。

## 3. Environment identity / Runtime

| 项目 | 本轮核验值 |
|---|---|
| 实际 App | `/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-acceptance-sandbox-20261007/cargo-target/release/bundle/macos/小钱家 V4 验收版.app` |
| Bundle ID | `com.personalfinance.console.v4acceptance` |
| Window title | `小钱家 V4 验收版` |
| Executable | 上述 .app 内 `Contents/MacOS/personal-finance-console` |
| Executable SHA-256 | `43c572411c4d5ec195239fedea3e96d44dfe2a741e540b6e62435683e6a98f9f` |
| Acceptance DB | `/Users/linte/Library/Application Support/com.personalfinance.console.v4acceptance/personal-finance-console-v4-acceptance.sqlite3` |
| Acceptance schema | V4 / migrations `[1,2,3,4]` |
| 测试前已运行 PID | 37575 |
| 备份后同一 artifact 重开 PID | 46495 |
| 干净合成夹具业务测试 PID | 49449 |
| 重启回读及最终 reset PID | 55194 |

每次进入业务测试及最终 reset 前，都独立读取 Info.plist、PID 与 `lsof -p PID -Fn`。各 PID 的实际 executable 与指定 artifact 匹配，金融 SQLite 句柄指向验收库，**未发现验收 PID 打开 Production DB**。没有触发 SECURITY_BLOCKED 条件。

证据：[preflight.json](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/preflight.json)、[business-preflight.json](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/business-preflight.json)、[04-clean-seed-lsof.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/04-clean-seed-lsof.txt)、[28-before-restart-lsof.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/28-before-restart-lsof.txt)、[29-after-restart-lsof.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/29-after-restart-lsof.txt)、[34-before-final-reset-lsof.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/34-before-final-reset-lsof.txt)。

## 4. Production preservation / Audit data handling

Production DB：`/Users/linte/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3`。

| 核验项 | 测试前 | 最终 |
|---|---|---|
| SHA-256 | `4b69c93356967fb8eec6fa25b7eedb6cf2a886bddf6b9ea9040182028beacf35` | 完全相同 |
| user_version / migrations | 3 / `[1,2,3]` | 完全相同 |
| integrity_check | ok | ok |
| foreign_key_check | 无记录 | 无记录 |
| 大小 / mtime / inode | 229376 / 1791164404446788550 / 21120760 | 完全相同 |
| WAL / SHM / journal | 无 | 无 |

真实 Production 数据库未发生写入、业务交互或迁移。没有启动或操作安装的 Production App。验收 bundle、RC2 bundle、安装的 Production bundle、当前源文件与配置均通过前后保护清单核对；148 个保护文件无哈希或 mtime 改变，另有自动回归分包的 145 个输入 / 5686 个依赖文件哈希核对。

**回滚方式 A 已完成。** 正常退出验收 App 后，先保存测试后的合成库证据，再将审计前 byte-for-byte 备份恢复到原验收路径。恢复后 SHA 为 `f6fba4790c750bf8dcdb14303cb816fcf2fd22d8eae3fcc0d8dc09da8cc1e3ce`，与审计前及备份完全相同。验收 App 最终关闭。没有恢复 Production。

起点处理：审计前验收库已有合成修改记录。UI reset 无响应而普通收入保存能够写入，因此为隔离规定的初始场景，退出后将该合成库暂存于本轮证据目录，让同一未修改 App 在同一验收路径正常创建 V4 初始种子。这是严格必要的测试数据夹具，**不能作为 UI reset 通过的证据**。最终恢复包含原有修改的审计前备份，并非用干净种子覆盖 Owner 原先的验收现场。

**审计工具失误说明：** 一次 Python 只读 URI 少了 `file:` 前缀，在两个 app-data 目录各创建一个带字面 `?mode=ro&immutable=1` 后缀的零字节辅助文件。这两个文件不是实际数据库，未写入金融数据，随即移入证据目录，脚本改为正确的只读 URI。不能声称 Production 目录完全没有短暂文件创建；可确认真实 Production DB 的字节与元数据均未变。错误记录、辅助空文件均保留，没有掩盖或把检查尝试当成通过。

证据：[rollback-backup.json](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/rollback-backup.json)、[fixture-preparation.json](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/fixture-preparation.json)、[helper-uri-correction.json](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/helper-uri-correction.json)、[37-final-preservation-and-rollback.json](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/37-final-preservation-and-rollback.json)、[protected-files-before.json](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/protected-files-before.json)。

## 5. Planning tests — actual native behavior

本轮月份查询使用页面“要设置的月份”，生效查询日期为 2026-10-07；同一天多次保存由追加 revision_id 决定最终有效版本。

| 场景 | 输入 / 实际操作 | 预期 | 实际结果 / 判定 | 证据 |
|---|---|---|---|---|
| T1 十月单独设置 | 初始平时 13000；十月按 15500 保存；切十一月 | 十月15500 / 本月单独设置；十一月13000 / 按平时收入 | 与预期一致，没有串月。PASS | 04、05、06 AX及截图 |
| T2 改平时收入 | 保留十月覆盖，保存平时14000；分别查十月/十一月 | 十月15500；十一月14000 | 原生十一月14000、十月15500。PASS | 07-stable-save-nov、08-stable-save-oct-preserved |
| T3 恢复跟随 | 十月点击“恢复按平时收入算” | 14000 / 跟随平时收入，旧15500保留 | 原生显示14000 / 跟随平时收入；数据库追加INHERIT，旧OVERRIDE15500仍在。PASS | 09-planning-inherit、28-before-restart-db.json |
| T4 只读历史 | 查看月收入设置记录并核对原库 | 追加历史不删除；主要标签是自然语言 | 存储语义/只读通过：2条历史依序保留；标签显示OVERRIDE / INHERIT，文案部分FAIL/P2 | 27-cash-oct14-again完整AX、35-final-reset完整AX、28/29数据库快照 |

关键证据：[05-oct-override-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/05-oct-override-ax.txt)、[06-nov-default-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/06-nov-default-ax.txt)、[07-stable-save-nov-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/07-stable-save-nov-ax.txt)、[08-stable-save-oct-preserved-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/08-stable-save-oct-preserved-ax.txt)、[09-planning-inherit-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/09-planning-inherit-ax.txt)。

## 6. Actual income / Legacy backfill tests

四个场景均使用既有独立 seed ID；base 为业务日期 Oct02、800、RECEIVED。普通修订、未来修订、作废修订、legacy 修订都通过实际原生按钮写入，再通过页面日期查询回读。最终数据库仍保留四条原始 base 与五条 V4 revision。

| 场景 | 输入 / 操作 | 预期 | 实际结果 / 判定 | 证据 |
|---|---|---|---|---|
| T5 普通修订 | A：effective04，业务02，950待到账；查03→05→03 | 800已到账→950待到账→800已到账；两版本存储 | 完全一致。base800与revision950均保留。PASS | 10、11-final、12 AX / 截图；28数据库 |
| T6 未来业务日期 | B：effective04，业务20，950待到账；查03、05、20 | 03原800；05无记录且不能回退800；20为950待到账 | 03为800、05无记录、20为950，无旧值复活。PASS | 15-final、16-final、17-final；重启31再次无记录 |
| T7 作废 | C：先追加effective04的950待到账，再effective06作废；查05、07 | 05前一版本；07无记录；存储保留 | 05为950待到账，07无记录；base及active1/active0两修订保留。PASS | 18、19、20；28/29数据库 |
| T8 延迟补录 | D：原date02、created_at07；先查03，再保存effective04/date02/950待到账，查05及25 | 03仍800；05与25均950，不被created_at遮蔽或被base反抢 | 原生03为800；05/25为950。物理created_at为07的seed行及新修订均在。PASS | 21、22、23、24；04 seed / 28数据库 |

未来日期测试最初的输入准备曾误改年份，页面没有保存该非法修订；随后逐段纠正并核对 2026-10-04 / 2026-10-20，才执行有效保存与最终断言。早期中间快照保留，但**最终证据只使用带 final 的15/16/17文件和数据库中的有效记录**，不将输入准备失败认定为业务逻辑回归。

当前 Repository 的 SQL 先按 effective/as_of 与 revision_id 找权威版本，再按 active 与业务日期过滤；只有没有有效期内 V4 revision 的 ID 才回退 base，base 使用业务日期而不使用 created_at。源代码与本轮 native 结果一致。

关键证据：[11-actual-a-oct05-final-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/11-actual-a-oct05-final-ax.txt)、[12-actual-a-past-again-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/12-actual-a-past-again-ax.txt)、[15-future-oct05-final-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/15-future-oct05-final-ax.txt)、[16-future-oct20-final-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/16-future-oct20-final-ax.txt)、[17-future-oct03-final-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/17-future-oct03-final-ax.txt)、[19-void-oct05-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/19-void-oct05-ax.txt)、[20-void-oct07-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/20-void-oct07-ax.txt)、[21-legacy-oct03-base-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/21-legacy-oct03-base-ax.txt)、[23-legacy-oct05-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/23-legacy-oct05-ax.txt)、[24-legacy-oct25-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/24-legacy-oct25-ax.txt)。

## 7. Cash lifecycle

T9 输入：合成余额宝 4805.61；停用生效日期 2026-10-15。

操作：点击“停用这个账户”；查询 Oct14→Oct15→Oct14。

预期：Oct14仍使用中4805.61；Oct15从有效账户集合排除；回看Oct14仍使用中；余额与历史不删除。

实际：原生结果完全一致。数据库保留现金账户、4805.61余额快照与一条effective15/active0生命周期记录，没有物理删除账户或余额。**PASS**。重启后Oct15仍已停用。

证据：[25-cash-deactivate-oct14.png](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/25-cash-deactivate-oct14.png)、[26-cash-oct15-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/26-cash-oct15-ax.txt)、[27-cash-oct14-again-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/27-cash-oct14-again-ax.txt)、[33-restart-cash-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/33-restart-cash-ax.txt)、[28-before-restart-db.json](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/28-before-restart-db.json)。

## 8. Restart persistence

T10 输入：上述所有Planning、Actual与Cash修改已保存。

操作：正常 Command-Q 退出，确认旧PID结束；重开完全相同的验收 artifact，先复验PID/数据库隔离，再核对历史与日期回读。

预期：稳定14000、十月INHERIT、旧15500、Actual全部修订与作废、现金停用均持久化；不自动seed；打开同一路径。

实际：重启前后验收库 SHA 均为 `90302ca7b8db4d2cd9265debacfbd17299ea21989a39dbec876cd8d68ab78a40`，全部存储表内容逐项相同。原生重启显示稳定14000 / 跟随平时收入，A在05显示950，B在05无记录，C在07无记录，Cash在15停用；只读历史完整保留。**PASS**。

证据：[28-before-restart-db.json](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/28-before-restart-db.json)、[29-after-restart-db.json](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/29-after-restart-db.json)、[29-restart-initial-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/29-restart-initial-ax.txt)、[30-restart-a-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/30-restart-a-ax.txt)、[31-restart-future-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/31-restart-future-ax.txt)、[32-restart-void-final-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/32-restart-void-final-ax.txt)、[33-restart-cash-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/33-restart-cash-ax.txt)。

## 9. Consumer-language review

T11 操作：实际读取主要操作区、查询区和历史区，保持技术详情折叠。

预期：主要界面使用平时每月收入、这个月按这个金额算、恢复按平时收入算、实际收入记录、查看哪一天的状态、收入日期、保存修改、作废这笔收入、现金账户状态、停用这个账户、历史记录；枚举仅出现在技术区。

实际：上述主要操作与结果标签均可见、自然。计算来源STABLE_BASELINE / MONTH_OVERRIDE / MONTH_INHERIT和Actual内部状态未强迫用户阅读。但是“月收入设置记录”的主要表格直接显示 OVERRIDE / INHERIT，没有被技术折叠收起。**语言要求部分 FAIL / P2-SANDBOX-HISTORY-01**，不影响已验证的财务结果。

明确原因：当前 [历史映射](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/src/ui/V4AcceptanceApp.tsx:521) 使用以 MONTH_OVERRIDE / MONTH_INHERIT 为键的 planningSourceLabels 去查 row.decision；实际 decision 是 OVERRIDE / INHERIT，fallback遂露出内部值。这是可直接定位的UI映射缺陷。

证据：[27-cash-oct14-again-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/27-cash-oct14-again-ax.txt)、[35-final-reset-no-response-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/35-final-reset-no-response-ax.txt)。本轮没有关闭或替代既有 P2-TEXT-01。

## 10. Reset safety — required acceptance failure

T12 输入：mutated stable14000、Planning历史2、Actual历史5、Cash生命周期1。重置前再次确认PID55194 / 正确Bundle ID / 验收DB独占路径，没有故意让真实native runtime指向Production。

操作：功能测试及重启完成后，滚动到重置按钮，**在可见状态下点击“恢复初始测试数据”一次**。审计起点另有用于验证故障的按钮点击与坐标复核，均未产生重置。

预期：出现可操作确认并执行reset；稳定收入恢复13000；四条Actual800已到账原始记录恢复；月修订、Actual修订、现金生命周期清空；schema4 / migrations1234保持；Production不变。

实际：没有出现确认提示、没有成功或错误提示，数据仍为14000及原有修改。前后验收库 SHA 完全相同，全部表内容也相同。**功能 FAIL — P1-SANDBOX-RESET-01**。schema和Production保持正确，但不能代替重置通过。

[当前按钮源码](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/src/ui/V4AcceptanceApp.tsx:593) 以 `window.confirm(...)` 为调用service.reset()的前置条件。实际现象与该确认链路未完成一致；本轮没有注入JavaScript、跟踪WebView内部返回值或证明确认未完成的底层平台原因，因此“window.confirm导致原生确认链路不可用”仅为修复调查方向。**确定事实是指定原生artifact中的按钮无法完成重置。**普通收入保存、作废与停用按钮都正常响应，排除了整个窗口无法点击或整个数据库无法写入的解释。

防护与重置功能分别判定：

| 项目 | 判定 |
|---|---|
| 正确身份下实际原生UI恢复seed | FAIL / P1 |
| 错误identity下initialize/reset拒绝，未开库/未invoke reset | 显式内存探针PASS |
| 正确identity但错误目录/错误文件名拒绝 | 显式内存探针PASS |
| Rust本地reset仅清业务表且保留migrations | 既有Rust测试j PASS |
| Rust身份与独立data-dir防护 | 既有Rust测试h PASS |
| Rust reset错误文件名/路径的额外直接分支 | 本轮未新增直接测试；已读源码，不能声称逐分支动态覆盖 |

修复建议仅限验收UI：使用能够在实际原生环境显示的应用内确认交互或已支持的确认机制，再调用现有受身份/路径保护的service.reset()。不得为解决按钮问题放宽身份校验、改Model/Repository/schema、指向Production或升级正式库。本轮**未执行修复**。

复验收条件：在带修改的同一原生artifact内正常确认reset，独立核对真实验收DB回到合成seed、V4 migrations保留、重启回读仍为seed，Production哈希/结构不变，并保留取消重置和错误身份/路径fail-closed覆盖。

证据：[34-before-final-reset-db.json](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/34-before-final-reset-db.json)、[35-final-reset-no-response.png](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/35-final-reset-no-response.png)、[35-final-reset-no-response-ax.txt](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/35-final-reset-no-response-ax.txt)、[36-after-final-reset-db.json](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/36-after-final-reset-db.json)、[automated/failclosed-probe-summary.json](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/automated/failclosed-probe-summary.json)。

## 11. Runtime / Window identity

原生窗口实际标题为“小钱家 V4 验收版”。多次原生截图可见完整验收窗口与可操作内容，没有复现此前不可见/屏幕外窗口问题。窗口使用当前配置 center / 1040×900，原生保存、日期输入、滚动均成功；与安装的Personal Finance Console显示名称及Bundle ID可区分。

本轮证据是实际窗口显示与交互；未新增屏幕坐标测量工具，不把源码center值单独当作运行成功。native截图完整窗口可见的实测结论通过；精确frame/screen坐标没有单独数值报告。没有通过切换安装的Production窗口来核验。

证据：[04-clean-seed.png](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/04-clean-seed.png)、[29-restart-window.png](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/29-restart-window.png)、上述PID/lsof记录。验收最后已关闭，原库已恢复。

## 12. Automated regression / Reproducibility

所有测试使用本轮新目录内的 isolated TMPDIR。普通Vitest仅发现官方tests并显式exclude artifacts/**，没有用裸npm test。没有覆盖之前审计证据、当前验收web-dist或当前native artifact。

| 检查 | 实测结果 |
|---|---|
| npm run typecheck | PASS / exit0 |
| npm run lint | PASS / exit0 |
| 显式vitest run tests、exclude artifacts/** | 13官方文件、270/270 PASS / exit0 |
| 显式vitest run tests/v4-acceptance-sandbox.test.ts | 3/3 PASS / exit0 |
| acceptance Rust --features v4-acceptance（正确验收配置环境） | 11/11 PASS / exit0 |
| acceptance web build，fresh审计outDir | PASS / exit0 |
| 额外显式fail-closed测试夹具 | 错误身份/目录/文件名3/3 PASS；只内存库与假路径 |
| native bundle重建 | 未执行：本轮直接运行指定artifact，不需要覆盖原bundle进行重建 |

Rust首轮仅指定features、未设置TAURI_CONFIG时，Context测试得到默认Production identifier，10/11、exit101。依据已安装tauri-codegen/tauri-build源码，补入**原验收配置JSON作为TAURI_CONFIG**后，仅做一次有依据的环境修正，11/11。两轮日志均保留；不把首轮失败隐藏或说成相同环境直接通过。测试在字节相同的isolated crate副本运行，以避免tauri-build写入原src-tauri/gen/schemas。没有运行Production App。

主审独立读取测试日志、JSON、fail-closed夹具、原配置导入方式并核对日志哈希。自动通过不代替原生reset验收，正因现有服务/Rust测试没有覆盖原生按钮确认链，才能出现“测试通过而native reset失败”。

证据：[automated/results-summary.json](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/automated/results-summary.json)、[automated/official-tests.log](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/automated/official-tests.log)、[automated/acceptance-rust-tests.log](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/automated/acceptance-rust-tests.log)、[automated/acceptance-rust-tests-configured.log](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/automated/acceptance-rust-tests-configured.log)、[automated/tauri-config-evidence.md](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/automated/tauri-config-evidence.md)、[automated/failclosed.probe.ts](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/automated/failclosed.probe.ts)、[automated/failclosed-probe.log](/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0/artifacts/v012-v4-owner-sandbox-independent-acceptance-audit-20261008/automated/failclosed-probe.log)。

## 13. P0 / P1 / P2 findings

| ID | 等级 | 状态 / 影响 |
|---|---|---|
| P1-SANDBOX-RESET-01 | P1 | OPEN。实际验收App恢复初始测试数据按钮无响应，规定的T12失败，阻止整体功能验收 |
| P2-SANDBOX-HISTORY-01 | P2 | OPEN。月收入设置历史露出OVERRIDE/INHERIT；主要操作可理解，财务真值正确 |

P0 = **0**。P1 = **1**。本轮新增P2 = **1**；既有六项P2全部保持OPEN / DEFERRED，不在本轮修复或关闭：P2-F0-02、P2-DISCOVERY-01、P2-CSS-01、P2-TEXT-01、P2-V4-ACTUAL-NOCHANGE-01、P2-V4-TARGET-01。新历史文案问题与既有P2-TEXT-01是否合并登记，由后续Owner决定，本轮未改既有状态。

没有新证据表明已关闭的V4财务语义P1重新出现；不重开这些结论。工具辅助文件失误已单独披露，不伪装成产品跨库写入，也不把审计目录保护检查解释为从未发生该失误。

## 14. Release blocker / Final decision / Receipt

RB-V4-OLD-RUNTIME-01 = **OPEN**。本轮不修复old-runtime protection，不允许旧V3 runtime读取/写入V4正式数据的风险被“沙盒运行通过”掩盖。Financial Model V1.0保持冻结，现有财务公式/债务规则/资产资格未改。

**TECHNICAL / FUNCTIONAL ACCEPTANCE = FAIL（required reset case）**。独立财务行为与持久化子项已完成并通过；重置P1待实施方在后续明确授权的修复任务中处理，再由独立审计复验。不要求Owner重复已经完成的业务场景来替代这项修复。

任务收据：

- 已完成：真实native财务场景、历史存储、重启、隔离、最终reset失败复验、自动回归、Production保护核对、验收库精确回滚、报告交付。
- 未确认：reset链路的底层平台原因；Owner正式验收决定。精确屏幕frame数值未单独采集。
- 剩余：实施方修复P1并提供更新验收artifact；独立审计复验reset。Owner其后决定是否接受。旧runtime release blocker及六项延期P2继续保持原状态。
- 本轮到此停止；没有Source修复、Production迁移或Stage4–7执行。

**PF_V012_V4_OWNER_SANDBOX_AUDIT_P1_REQUIRED**
