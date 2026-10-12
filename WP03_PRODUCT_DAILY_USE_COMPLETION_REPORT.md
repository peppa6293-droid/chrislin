# WP-03 小钱家日常产品完整化报告

## Final Status

`WP03_PRODUCT_DAILY_USE_REGRESSION_FAILED`

## 项目基线与交付

- Baseline Commit：`92ec24136d732e05375760d736ef508c66dd2c0e`
- Final Commit：`0a98e7e`（`feat: complete isolated WP03 daily finance workflows`；提交源码与测试及本报告）。
- Capability inventory：[`evidence/wp03-product-daily-use/CAPABILITY_INVENTORY_BEFORE.md`](evidence/wp03-product-daily-use/CAPABILITY_INVENTORY_BEFORE.md)
- Evidence Root：`evidence/wp03-product-daily-use/`
- Product regression/readback：[`evidence/wp03-product-daily-use/REGRESSION_AND_READBACK.md`](evidence/wp03-product-daily-use/REGRESSION_AND_READBACK.md)

## 发现与实现

实现了普通产品的月度收入计划、Actual Income 新增/编辑/作废及列表历史入口、现金/资产/债务直接管理、单笔月度债务事实确认、Safety Targets 直接设置、历史读取、保存后 Application readback 与 Home 刷新；V4 持久层针对停用状态回读和无变化修订做了修复。Financial Model V1.0 公式未更改。WP-03 新增专属启动保护，限制准确 Bundle ID、App Data 路径、数据库类型及 sidecar；WP-02 保护路径与 Production 路径均不进入 WP-03 数据域。

源文件范围包括 `src/ui/`、`src/application/`、`src/persistence/repositories.ts`、`src/runtime/tauri-bootstrap.ts`、`src-tauri/`、WP-03 build/test scripts、package scripts，以及三个旧测试文件仅格式化修正。WP-02 先前未提交的隔离实现保留在工作区，并作为本轮源码/build 输入的一部分。

## 自动测试

TypeScript、lint、正式 product Vitest、WP-03 package tests、web build 与 Rust WP-03 feature library tests 全通过：17 个文件 / 295 个 product tests，2 个 packaging tests，37 个 Rust tests。Lint 有 25 条 CSS selector specificity warnings。首次正式 native build-02 的严格签名验证因 `com.apple.FinderInfo` 失败。根据该证据在 WP-03 构建脚本添加生成 `.app` 的扩展属性清理后，build-03 仍在严格签名验证处观察到相同属性并失败。保留两个失败 receipts，没有继续重试。

## Native UI 与持久化状态

准确的 build-01 WP-03 App（Bundle ID `com.personalfinance.console.wp03preview`，可见名“小钱家 WP-03 测试版”）在最终提示修正之前成功构建、签名并真实启动。首次设置完成；Home 数字与输入数据一致；Actual 新增 ¥2,500、状态“已到账”后保存并在收入列表和收入历史看到。此包的 UI 场景仅是部分证明，且它不是最终源码 bundle。针对误导性编辑历史提示的源码修正尚未获得可签名最终 App。

WP-03 数据库只读检查为 schema v4、migrations 1–4、integrity `ok`、无外键违规、无 sidecar。检查时 app 进程已退出。未验证完整 A–M 场景，也未以同一个最终包重启；全域持久化验收 NOT VERIFIED。具体表计数和哈希见 `REGRESSION_AND_READBACK.md`。

## 隔离与剩余事项

- WP-02 数据未读取或更改；WP-02 源码和数据保留。
- Production App、Production SQLite、`/Applications` 安装和 Production migration 均未操作。
- Remaining Product Gaps：完整真实 UI 流程未覆盖；最终提示修正后的 WP-03 包没有通过签名门槛；stable income、month override、expense、cash/assets lifecycle、debt fact 和 safety 业务验收及全域重启均未确认。
- Remaining Native Migration Gaps：原有 Native Migration gates 状态不变；此任务没有关闭任何 gate。
- Known P2/nonblocking：25 条 CSS specificity lint warnings；`V012_USABILITY_AND_DIRECT_MANAGEMENT_FEASIBILITY_REVIEW.md` 在仓库和相邻项目目录中未找到；原始 V4 Foundation 独立终审不在项目树，内容只按项目现有 Current Phase 摘要引用。

## Planning 回报字段

Final Status = `WP03_PRODUCT_DAILY_USE_REGRESSION_FAILED`
Baseline Commit = `92ec24136d732e05375760d736ef508c66dd2c0e`
Final Commit = `0a98e7e`
Report = `WP03_PRODUCT_DAILY_USE_COMPLETION_REPORT.md`
Evidence Root = `evidence/wp03-product-daily-use/`
WP-03 App = build-01 曾成功启动（可执行文件 SHA-256 `4b5e5c75e21d9511f740da190fc2d9a281d3ea669cd849008982c5ad3bd972ab`，仅代表源码提示修正前的构建）；build-03 最终源码签名失败
Executable SHA = build-01 receipt 中可核；build-03 无验签通过的最终 SHA
Automatic Tests = PASS（详见回归表）；final native packaging = FAIL
Native UI Acceptance = PARTIAL / NOT VERIFIED
Restart Persistence = NOT VERIFIED（仅完成只读数据库检查）
Remaining Product Gaps = 完整真实 UI 链、最终源码包有效签名、同一包重启回读
Remaining Native Migration Gaps = 既有 native migration gates 状态不变
Production Touched = NO

## WP-03R1 Final Closure（2026-10-12）

本节补充最终收口结果，保留上文 build-02/build-03 的失败记录。原报告中“最终源码尚无签名通过包”的判断已被本轮 fresh build 更新；之前的候选和部分 UI 记录没有并入最终包的验收。

- Final Status：`WP03_PRODUCT_DAILY_USE_REGRESSION_FAILED`。最终源码 `112191eebbe4cf3c62f942f034064237ee92514a` 已提交；FinderInfo 根因已定位；同一最终包通过 strict codesign、自动回归、真实启动、正常退出、重启和只读 DB v4 检查。但完整 A–M 原生 UI 未完成，不满足 READY。
- FinderInfo 根因：签名时间线显示，FinderInfo 异步出现在 iCloud File Provider（CloudDocs）下 `.app` bundle 根目录；source 中 `src-tauri/icons/.DS_Store` 的 FinderInfo 并未作为 app bundle 内 offending resource。清理后 CloudDocs 仍可能重新附加元数据。最终构建输出改用独立 APFS sparse image 挂载点，避免该异步元数据路径；签名前检查、签名后 strict verify 均通过。build-02/build-03 的失败记录仍保留。
- Signing Fix：在本地 Apple Development identity 下，从最终源码新构建到 APFS 输出卷，签名前检查 xattrs，签名后执行 `codesign --verify --deep --strict`；没有在签名后修改 bundle。TeamIdentifier `SSRKA7A4TN`，Authority `Apple Development: 8619814730147 (FW5KHTFNZ6)`。
- Final App：`artifacts/wp03-isolated-product-preview-20261012/final-build/cargo-target/release/bundle/macos/小钱家 WP-03 测试版.app`；Bundle ID `com.personalfinance.console.wp03preview`；executable SHA-256 `7791d20845abbba2d33cfa60feb3a135cc98a3b9b4524a74bd8620b2f374f8d3`。Receipt 与实测 strict verify 见 `evidence/wp03-product-daily-use/final-closure/final-build/`。
- 自动回归：最终源码变更后的 typecheck、lint、17 files / 295 product tests、WP-03 packaging tests、37 Rust tests、web build 均通过；lint 留有 25 条既存 CSS specificity warnings。日志见 `evidence/wp03-product-daily-use/final-closure/automatic-regression/source-zero-target-final-r2-*`。
- 最终包真实 UI：首次设置数据由隔离的 WP-03 用户 profile 保存。最终包上验证了稳定收入版本新增和历史展示、2026-10 本月收入计划 override 的保存及 Home 刷新、正常退出；相同路径/Bundle ID/executable hash 重启后，Home 仍显示 ¥12,000 计划。此前其他候选包的 A–I 操作不作为最终包 PASS。最终包未完成 Actual Income、expense、cash/assets lifecycle、债务缺失月份与单笔确认、Safety Targets 的完整逐项 A–M 验收。
- Restart / DB：同一个 final `.app` 正常退出并重开，再正常退出。最终 closed-state readback：WP-03 DB `user_version=4`、migrations `[1,2,3,4]`、`integrity_check=ok`、`foreign_key_check=[]`、无打开 handle、无 SQLite sidecar。详细值、行数及数据库哈希见 `evidence/wp03-product-daily-use/final-closure/db-readback/final-r2-closed-state.txt`。这是局部持久性证据，不代表 A–M 全部写入。
- 原始 A–M 中“新月份缺少债务事实时显示待确认、单笔确认不得确认其他债务”尚未由当前正常 UI 流程验证。没有通过改系统日期、直接写 DB 或调用内部 service 模拟该业务验收。
- WP-02 与 Production 均未触碰；Financial Model V1.0 未改。没有 runtime-affecting dirty source。最终进度摘要：`evidence/wp03-product-daily-use/final-closure/WP03R1_CURRENT_PROGRESS.md`。

## WP-03R2 Final Native Acceptance Closure

### 当前状态

`WP03_PRODUCT_DAILY_USE_REGRESSION_FAILED`。本次发现并修复了 R4 真实跨月 UI 中的残留金额缺陷，R5 新包签名和自动回归通过，R5 的跨月待确认、单笔债务确认隔离和首页金额隐藏已通过真实 UI 验收。**完整 A–M 尚未在同一个 R5 最终包上完成，因此不满足 READY，也不放行 Planning Review。** R4 数据和记录已保留，不与 R5 拼接验收。

### 最终源码和包

- Starting HEAD：`a8b5306a20b750133247094ed8d57a4b48c611f1`
- Preview-Date Implementation Commit：`83cde18dade613f94966d6f8af8272c649b50717`
- Final Product Fix Commit / Final Source Commit：`fd1d9e8714173167430baa2ab9325557a9e80775`（`fix: hide stale debt due on pending month`）
- Final App：`artifacts/wp03-isolated-product-preview-20261012/final-r5/cargo-target/release/bundle/macos/小钱家 WP-03 测试版.app`
- Bundle ID：`com.personalfinance.console.wp03preview`
- Executable SHA-256：`ecc46453d2aea39cd2f6232a38685827316f6c09e9b1f45e6fb6366cae182313`
- Strict Codesign：PASS；Apple Development `Apple Development: 8619814730147 (FW5KHTFNZ6)`；TeamIdentifier `SSRKA7A4TN`
- Runtime source：`fd1d9e8` 已提交，运行时代码无未提交改动。

### R5 回归

Typecheck、lint、300 个 product tests、5 个 WP-03 packaging tests、40 个 Rust preview tests、37 个 Rust default tests、web build 均通过。Lint 有 25 条 CSS specificity warnings。日志与 build receipt 位于 [`evidence/wp03-product-daily-use/final-r2-closure/`](evidence/wp03-product-daily-use/final-r2-closure/)。

### R5 真实 UI 范围

- A Onboarding：PASS，输入收入、必要支出、现金、资产、债务和目标后首页数据吻合。
- B Stable：PASS，收入修改与同值 no-op 通过。
- E Expense：PASS，UI 保存 68.50，Home 读回正确。
- H2 Debt Rollover：PASS，11 月无事实显示待确认；仅将债务 A 保存为 0 后，债务 B 仍待确认；首页不再显示旧 500；债务 B 再保存 200 后首页恢复为 200。
- K/M：部分通过。R5 normal Quit / same-bundle restart 通过，preview 日期重启后恢复系统日期，Home 与消费数据仍在；重启前后 DB hash 相同。
- C、D、F、G、H 完整场景、I、I2、J、L 完整核验、M 全页逐项核验：R5 未完成，均不得视为 PASS。

R5 Rollover 与闭库记录：[`h2-r5-home-debt-rollover.md`](evidence/wp03-product-daily-use/final-r2-closure/h2-r5-home-debt-rollover.md)、[`l-r5-db-readback.md`](evidence/wp03-product-daily-use/final-r2-closure/l-r5-db-readback.md)、[`m-r5-restart.md`](evidence/wp03-product-daily-use/final-r2-closure/m-r5-restart.md)。阶段状态：[`WP03R2_CURRENT_PROGRESS.md`](evidence/wp03-product-daily-use/final-r2-closure/WP03R2_CURRENT_PROGRESS.md)。

### 闭库、边界与剩余工作

R5 DB 只读检查：`user_version=4`、migrations `[1,2,3,4]`、integrity `ok`、foreign-key check 空；无 DB handle、WAL/SHM/journal；关闭后 hash `e0b0b1a74ac51051077ad1a2060832f17fa0b9fce9f88dbbc431a98834bf2526`。这只覆盖所列元信息和部分计数，不是 A–I 全量业务表审计。

Financial Model V1.0 未修改；WP-02 和 Production 未访问。Planning Review 暂不放行。下一步须在 R5 同一候选包上完成剩余 A–M 场景并补足完整 closed-state DB 与重启逐页回读；如运行时代码再变更，需重新构建并对新包重做全量验收。

