# LANDING L-03（build-44）执行回执

日期：2026-10-21
执行环境：macOS，候选包 `com.personalfinance.console.smoke`

## 1. 专项测试结果
- `tests/v2-ledger/landing-services.test.ts`：通过（L-01 已验收）
- `tests/v2-ledger/landing-import.test.ts`：通过（L-02 已验收）
- `tests/ui.test.tsx`、`tests/v2-ui/*`：通过
- 本轮 L-03 未改代码，未新增/修改测试。

## 2. 全量测试结果
- 400 passed, 0 failed, 80 skipped（40 passed files, 1 skipped file）

## 3. TypeCheck / Lint / Build
- `npm run typecheck`：0 errors
- `npm run lint`：0 problems（122 files checked）
- `npm run tauri:build:smoke`：exit 0（见 `build-smoke.log`）

## 4. 本批关键决策说明
- 沿用 smoke 隔离库中既有 onboarding：`SmokeNormal`，稳定月收入 `12000`（`income_records` 中 PLANNING/EXPECTED 12000）。
- 快速记账：`88.88`，分类「餐饮」，备注 `L03验收`，业务日期 `2026-10-21`。
- 导入：`ALIPAY_CSV`，夹具 `tests/fixtures/v2-import/sample-alipay-export.csv`（桌面副本 `L03-import-sample.csv`），批次 `e51714d0-adcf-4058-94f9-fc8510a2d1df`，`written_rows=2 / error_rows=0`。
- 二次导入同一夹具：预览 `共 2 条｜可导入 0｜重复跳过 2｜异常 0`，未确认写入。

## 5. 图标门
- `Contents/Resources/icon.icns`：43,431 B，SHA256 `6fb51b77f61987e85a0c83ada416d1a0ca14637599aab3ebe1533283cde6a80a`
- `Info.plist`：`CFBundleIconFile = icon.icns`
- Dock 截图：`f01-dock-icon.png`、`l03-07-dock-icon.png`，目视为绿色钱包图形，非空白/通用白板。

## 6. 候选包与数据目录
- 候选包：`/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2/src-tauri/target/release/bundle/macos/小钱家.app`（20 MB）
- DMG：`.../bundle/dmg/小钱家_0.1.0_aarch64.dmg`（11,639,045 B）
- 数据目录：`~/Library/Application Support/com.personalfinance.console.smoke/`
- `personal-finance-console.sqlite3` 大小：319,488 B
- 启动前 SHA256：`a77caadcf57e4fb6c43f37643a1804d163978aacc04908ea352e3ba8386a737f`
- 记账/导入并重启后 SHA256：`07eb5bea63a93c8aa5e335975360dd779995a5409532b23a5bc69e99c6604d4b`
- 哈希变化与写入记录一致，属预期。

## 7. 验收结果
- 记账后重启：`expenses=3`、`expense_records=5`；`88.88` 与镜像行同 id。
- 月度模型：记账前 `actualVariableSpending=1500.00`；记账后 `1588.88`；导入并重启后 `1636.38`（1500 + 88.88 + 35.00 + 12.50）。
- 二次导入去重：2 条均显示「已重复」，未新增行。

## 8. 剩余问题清单
1. 基础 `src-tauri/tauri.conf.json` 仍无 `bundle.icon`；已安装 production 包无图标（历史缺口，本轮未修）。
2. `src-tauri/runtime-compatibility.json` 的 `maxSupportedSchemaVersion` 仍为 4，未覆盖当前 schema 7。
3. V2 编辑/删除尚无 V1 镜像同步。
4. V2 自由分类在 V1 侧无细分语义：本次「餐饮」在 `expense_records` 落为 `OTHER_VARIABLE`，记录页显示「其他」。
5. 「最近消费」固定只渲染前 3 条，没有完整流水页；10-01/10-02 导入行被 10-03 旧记录挤出，需用二次导入预览验证持久化。
6. 导入失败时只显示失败条数，不显示行级原因；`b2bee328-2e1e-4096-80b4-2e161aeffa1d` 的 `error_rows=1` 无法从 UI 定位。
7. 840x580 窗口下首页底部「已花」一行被裁切，需要滚动查看。

## 9. HEAD
- 代码 HEAD（提交前）：`44d61ca`（build-43）
- 本回执与证据随 `build-44: landing — smoke candidate package evidence` 提交。

## 10. 证据文件
- `build-smoke.log`
- `datadir-before-launch.txt`
- `f01-dock-icon.png`
- `l03-01-launch-onboarding.png`
- `l03-02-onboarding-step1.png`
- `l03-03-home-before-record.png`
- `l03-04-expense-after-restart.png`
- `l03-04b-expense-after-restart.png`
- `l03-05-import-result.png`
- `l03-06-after-import-restart.png`
- `l03-06b-record-after-restart.png`
- `l03-07-dock-icon.png`
- `l03-08-import-dedupe-after-restart.png`
