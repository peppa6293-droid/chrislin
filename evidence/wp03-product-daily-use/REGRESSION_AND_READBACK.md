# WP-03 自动回归与只读回读

日期：2026-10-12（Asia/Shanghai）

## 自动回归（最终 UI 提示修正后的源码）

| 命令 | 结果 | 证据/说明 |
|---|---|---|
| `npm run typecheck` | PASS | exit 0 |
| `npm run lint` | PASS | exit 0；25 条既有 CSS `noDescendingSpecificity` warning |
| `npm run test:product` | PASS | 17 files，295 tests |
| `npm run test:wp03-preview` | PASS | 2 packaging tests；build-03 启动前也再次通过 |
| `npm run build` | PASS | TypeScript core 与 Vite web build 完成 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib --features wp03-preview` | PASS | 37 tests |
| `npm run tauri:build:wp03-preview` build-02 | BLOCKED | `PREVIEW_SIGNATURE_VERIFICATION_FAILED`：strict codesign 拒绝 `.app` 上 `com.apple.FinderInfo` |
| 同命令 build-03（一次针对证据的修正后） | BLOCKED | 已加入 `xattr -cr`，但 strict codesign 仍观察到 `com.apple.FinderInfo`。停止重试。原始 receipts 在 `artifacts/wp03-isolated-product-preview-20261012/build-02/build-record.json`、`build-03/build-record.json`（构建产物不纳入 Git）。 |

Build-01 在提示修正前构建并成功签名、实际启动。它只支持已执行的 UI 场景，不是最终源码包；没有将旧 bundle 冒充最终候选。

## UI 实际观察

build-01 的准确 app 首次启动进入 onboarding。UI 输入后完成 onboarding，Home 显示 stable planned income ¥10,000、必要生活和本月还款 ¥4,600、债务 ¥15,000、安全覆盖 8.26 / 3 个月。普通收入页可新增 ¥2,500、状态“已到账”的 Actual 收入，保存后列表出现该条；点击“查看收入历史”可见该记录。编辑弹窗历史按钮原先只显示泛化说明，没有呈现修订，这一误导性入口已在源码删除，但该修改未能取得有效新签名 bundle。

没有完成 stable income 编辑、月计划切换/跟随、Actual 修改/作废后历史、Expense、Cash/Asset 生命周期、Debt 月事实、Safety 边界与 recovery horizon 的完整 UI 场景；没有同一最终包的退出/重启回读。因此 Native UI Acceptance 和 restart persistence 对全产品范围为 NOT VERIFIED。

## DB 保存后只读检查

只对 WP-03 独立数据文件以 `mode=ro&immutable=1` 连接。路径：`~/Library/Application Support/com.personalfinance.console.wp03preview/personal-finance-console.sqlite3`。结果：schema `user_version=4`；migrations 1–4；integrity `ok`；foreign key violations 为空；sidecar 0；profiles 1、income_records 2、cash_accounts 1、assets 1、debts 2、expense_records 0；actual_income_revisions、asset_revisions、debt_revisions、planning_income_month_revisions 均 0。文件 SHA-256：`9b8b1a76394e30b671dd3087183f5a6fac294af4289e9e8ec4223c054d5d6bc2`。这是当前部分 UI 场景的数据状态，不代表全部业务域验收。

WP-03 app 已正常退出；观察时没有匹配进程。未进行同一包重启。
