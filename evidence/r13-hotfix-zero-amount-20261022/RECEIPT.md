# R13 零元支出热修回执

日期：2026-10-22
执行依据：`docs/EXEC-R13-HOTFIX-ZERO-AMOUNT-MODEL.md`（审核员下发，户主批准方案 A）
结论：**R13_BLOCKED**

代码热修、回归测试、全量验证、安装前备份、构建、安装均已完成并留证；**但新包启动被原生生产门闸拒绝**（`PRODUCTION_TERMINAL_CANDIDATE_BINDING_MISMATCH`），无法进入首页，因此 §5 的界面回读与退出重开验收无法执行。按红线 §7.4「修复后仍打不开：保留现场，停止，先报告，不自行扩大处置」，已停手，未动 terminal/receipt/permit、未改库、未改 `src-tauri/`。

---

## 1. 改动文件

| 文件 | 改动 |
|------|------|
| `src/application/monthly-model-service.ts` | `buildMonthlyModelInput` 组装 `facts.expenses` 时过滤 `amount > 0`（`money(expense.amount).gt(0)`）；0 元行留在账本，不进月度模型。 |
| `src/application/financial-maintenance-service.ts` | 第二入口 `buildMaintenanceModelInput` 的 fallback 同样过滤 `amount > 0`，与主入口口径一致。 |
| `tests/r13-zero-amount-expenses.test.ts` | 新增回归测试（见 §2）。 |

未改 `src/model/`（冻结 Model Core）、未改导入服务、未改 `src-tauri/`、未改 UI、未动任何数据行。

## 2. 回归测试名与结果

`tests/r13-zero-amount-expenses.test.ts`（2/2 通过）：

1. `keeps zero-amount rows in the ledger but out of the monthly model input`
   - 同时存 `0.00` 与 `12.34` 两行；断言 `facts.expenses` 只含 `12.34`，`actualVariableSpending = 12.34`，且 `listExpenses` 仍回读到 `["0.00","12.34"]`（账本留痕）。
2. `opens the model when every expense in the month is zero`
   - 两行均为 `0.00`；断言 `facts.expenses = []`，`actualVariableSpending = 0`，推荐支出与空支出输入一致，不抛 `ModelValidationError`。

## 3. 全量测试 / typecheck / lint

| 项目 | 结果 |
|------|------|
| `npm run test` | **444 passed / 0 failed / 80 skipped**（46 个测试文件，45 passed + 1 skipped）；旧基线 442/0/80，新增 2 条通过 |
| `npm run typecheck` | 通过（无输出，见 `11-typecheck.log`） |
| `npm run lint` | 通过：`Checked 126 files ... No fixes applied.`（见 `12-lint.log`） |

日志：`10-test.log`、`11-typecheck.log`、`12-lint.log`。

## 4. 安装前库备份

- 路径：`~/Library/Application Support/com.personalfinance.console/backups/pre-r13-20261022-233309.sqlite3`
- SHA-256：`857fda164fdb0a46853a8f9a716d2bc0099ebce898984228b208d4f16e6d2a2f`
- 当前生产库 SHA-256：同为 `857fda164fdb0a46853a8f9a716d2bc0099ebce898984228b208d4f16e6d2a2f`（R13 未写入库）

## 5. 新包锚点与安装

| 项目 | 值 |
|------|-----|
| 包路径 | `/Applications/Personal Finance Console.app` |
| 可执行文件 | `Contents/MacOS/personal-finance-console` |
| 新可执行 SHA-256 | `ea430fe97dac79c006d7a86558454f2f0a6d5a5522699e796d545e7b60f44baa` |
| Info.plist SHA-256 | `41b8aa5a1c1933531c2d986c25d180590ffbf8920aff4483d791a882dc3cfdcb`（与旧包相同） |
| runtime-compatibility.json SHA-256 | `f98b7f7bab5161e8c0c6bb93571ac8ce658c20d81785fc5651ac37f2f9c3d509`（与旧包相同） |
| 旧可执行 SHA-256（R10 安装） | `444729451aafc3bbe6cf95b52ffd84a2191b75f6c1477d0d840656ace4711b5c` |

安装后 `/Applications` 三哈希与本次构建候选一致（全量 manifest 比对 `MANIFEST_IDENTICAL`）。本次重建属户主批准的授权热修漂移，不是事故。

## 6. 真库启动：报错（被原生门闸拒绝）

`open` 后无进程；直接前台运行安装后的二进制，退出码 101：

```text
thread 'main' (72897299) panicked at src/lib.rs:2116:14:
Production durable cutover terminal check failed before Builder: "PRODUCTION_TERMINAL_CANDIDATE_BINDING_MISMATCH"
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
exit=101
```

现场：`21-startup-panic.txt`、`20-post-install-state.txt`（含安装哈希、`pgrep` 无进程）。

### 阻塞根因（只读定位）

- `src-tauri/src/lib.rs:2116` 在 Tauri Builder 之前调用 `ensure_production_cutover_startup`；`validate_production_terminal` 在 `lib.rs:1191` 比较三项绑定：terminal 记录的候选可执行哈希、`Info.plist` 哈希、`runtime-compatibility.json` 哈希。
- 生产 durable terminal：`~/Library/Application Support/com.personalfinance.console/production-v8-cutover-terminal.json`，`state=V8_VERIFIED`，绑定：
  - `candidateExecutableSha256 = 444729451aafc3bbe6cf95b52ffd84a2191b75f6c1477d0d840656ace4711b5c`（R10 安装包）
  - `candidateInfoPlistSha256 / compatibilityManifestSha256` 与新包相同
- R13 修改了代码，重新构建后必然产生新的可执行哈希 `ea430fe9...`，因此与 durable terminal 的候选绑定不一致，门闸在任何窗口创建前拒绝启动。
- 这不是 0 元热修逻辑失败（代码/测试已全绿），而是「重新构建即改变可执行哈希」与「terminal 一次性绑定旧候选」之间的冲突。任务书 §4.6 明确禁止改动 terminal/receipt/permit，且现有 CLI 只有 `--pfc-internal-v8-migrate`（permit 已消费、库已是 V8），没有可用的热修重签入口，故执行侧无合规解。

## 7. 界面回读

**未取得**（App 未进入首页）：

- 首页「已花」= 100,513.11：未取得
- 债务 5 笔 / 本月必须还款 14,518.73：未取得
- 现金 5,325.93 / 安全资源 25,325.93：未取得

## 8. SQL 只读复核（`22-sql-readback.log`）

| 指标 | 值 | 锚点 |
|------|-----|------|
| `expenses` | 825 | 825 ✅ |
| `expense_records` | 826 | 826 ✅ |
| `import_batches` | 12 | 12 ✅ |
| 导入总额 | 100,450.11 | 100,450.11 ✅ |
| 0 元行总数 | 14 | 14 ✅ |
| 2026-10 内 0 元行 | 3 | 3 ✅ |
| 2026-10 债务合计 | 172,579.53 | 172,579.53 ✅ |

SQL 全部只读（`mode=ro&immutable=1`），未删、未改任何数据行；14 行 0 元原样保留。

## 9. 退出重开复核

**未执行** —— App 无法启动，无「启动正常」可复核。

## 10. 异常 / 偏差

1. **阻断项**：新包被 `PRODUCTION_TERMINAL_CANDIDATE_BINDING_MISMATCH` 拒绝，`/Applications` 当前为新构建（无法启动）。旧可执行 `44472945...` 已不在 `/Applications` 或构建输出中；但旧包即使恢复也仍会因 3 行 0 元支出停在「暂时打不开账本」，恢复旧包不构成可用性回退方案。
2. **任务书缺口**：§4「重建 + 安装」与 §4.6「不动 terminal/receipt/permit」在本门闸下不可同时满足；§4.5 只要求登记热修漂移哈希，未提供 terminal 重新绑定的授权流程。这是任务书层面的流程缺口，不是执行偏差。
3. **未做动作（遵守红线）**：未改 `src-tauri/`、未动 `production_integrity_state`、未动 terminal/receipt/permit、未动两份迁移备份与 `.v8-quarantined`、未 SQL 写库、未删改任何导入行、未 kill 进程、未自行重签或删除门闸文件。
4. **证据缺口**：因无法进入首页，§6 要求的界面回读截图/启动正常录屏无法提供；已提供启动 panic 原文与只读 SQL 日志。

## 11. 待裁决（建议）

需审核员/户主裁决「生产门闸如何接纳授权热修包」，两条合法路线（均超出本任务书红线，执行侧不能自行做）：

- **A1（建议）**：立项一个显式的「授权热修发布」流程：重新签发候选授权/release receipt，按既有 cutover 机制把 terminal 重新绑定到新可执行哈希（保留旧 terminal 审计副本），再启动验收。需改授权文件或增加专用 CLI，必须由审核员定案并明确红线变更。
- **A2**：若不希望动 terminal，则本批只能停在代码+测试完成（本文状态），由后续版本在下次正式迁移/发布窗口一并带上该修复。

在裁决前保持现状：App 不启动、库不动、terminal 不动。

## 12. 流程教训确认

已知悉，无需执行：

1. 批量写库前必须先做库文件备份（R12 缺失，本批 §4.1 已补）。
2. 转换脚本「模拟解析通过」不等于模型接受；导入验证须含模型口径试算。
3. 「金额原样」须配套 0 元筛查；本批口径为「0 元行照实入账、不进月度模型」。
4. 新增：**任何「改代码后重建安装」的任务书，必须先确认生产 durable terminal 是否绑定可执行哈希，并给出合规的重绑定授权流程**；否则重建包必然被门闸拒绝。
