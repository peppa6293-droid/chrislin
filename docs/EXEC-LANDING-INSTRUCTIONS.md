# EXEC-LANDING 执行指令（App 落地：V2 记账接入真实服务 + 独立 macOS 候选包 + 清理）

**角色：** 执行者
**基线：** build-37（D-01 双写）验收后的 HEAD `fee274d` 起算；当前 HEAD 为 `d6c08b3`（build-40），全量 392 passed / **1 failed** / 80 skipped（失败项与修复见第二节 F-01）
**日期：** 2026-10-20
**修订：** v3（L-03 首轮 RETURN 已受理并独立复核：图标门失败根因 = 两份 tauri 配置均未设 `bundle.icon`，v1/v2「smoke 继承基础 conf 图标」陈述作废；新增 F-01 修复批 build-41，**批准门控**；批号重排：L-01→build-42、L-02→build-43、证据提交→build-44；纠正执行顺序：L-01/L-02 未实现前不得再跑 L-03）

---

## 〇、目标与总原则

用户验收标准（原话压缩，逐条对应本指令）：
1. **真实可打开的独立 macOS 候选包**（不是 `tauri dev`，不是网页）；
2. **记账 → 财务结果真实同步**（记一笔后，首页/月度模型的变动支出随之变化，走 D-01 双写链路，不是界面假汇总）；
3. **退出重开数据仍在**（同一数据库文件第二次启动仍可见）；
4. **截图/录屏/测试证据**；
5. **剩余问题清单**；
6. **App 图标不得为空**（用户红线）；
7. **落地后删除本机无用测试 App 与测试残留**（见第六节 L-04）。

总原则：**候选包 = smoke 身份隔离包**。Production 身份（`com.personalfinance.console`）、已安装的 `/Applications/Personal Finance Console.app`、用户真实数据库（`~/Library/Application Support/com.personalfinance.console/`）**只读不碰**。本指令全部产出落在 `com.personalfinance.console.smoke` 身份与其隔离数据目录内（`ensure_smoke_data_dir_isolated` 已在 Rust 侧强制，`src-tauri/src/lib.rs:814`）。

**执行顺序（v3 强制）：** F-01（build-41，批准门控）→ L-01（build-42）→ L-02（build-43）→ L-03（build-44）→ L-04。逐批提交、逐批回执，**每批未验收前不得开始下一批**。F-01 必须最先：HEAD `d6c08b3` 全量已有 1 failed（`tests/smoke-identity.test.ts`），不修复则后续任何批次都过不了「0 failed」门槛。**若 F-01 未获用户批准，整条落地线停在 `d6c08b3` 并请示，不得变通**（不允许把图标或测试修改夹带进 L-01/L-02）。L-04 涉及本机删除，**用户已于 2026-10-20 显式批准**；执行时仍须逐条跑第六节的删除前校验门，任一事实不符即跳过该项并写入回执，不得猜测删除。

---

## 一、现状盘点（动手前必须自己复核一遍）

| 事实 | 位置 | 含义 |
|---|---|---|
| 生产入口已挂载 V2 界面 | `src/main.tsx` → `src/ui/App.tsx` → `HomeScreen.tsx:284` 渲染 `V2HomeSurface` | 界面层不需要"接入"，需要的是换掉它背后的数据链路 |
| 快速记账当前走 V1 直写 | `V2HomeSurface.onRecordExpense` → `App.tsx recordExpense` → `services.recordExpenseAndRecalculate`（`product-service.ts` 直写 `expense_records`） | 记账不经过 `expenses` 表、不经过 D-01 双写；"记账成功但任务推荐/财务结果不变"的旧病在生产路径上仍然存在 |
| V2 服务没有进入组合根 | `src/runtime/tauri-bootstrap.ts` 的 `TauriProductServices` 只含 V1 函数；数据库对 UI 保密（"The database stays private to this composition root"） | V2 能力必须以 services 方法形式暴露，**禁止把 `Repositories`/`V2*Service` 实例或数据库传给任何 `src/ui/` 组件** |
| Onboarding 不播种 V2 账户/分类 | `product-service.ts completeOnboarding`（:258）只建 profile/settings/essential/cash_accounts(V1) 等；`accounts`、`expense_categories` 表为空 | V2 记账需要 `account_id`/`category_id` 外键，落地时必须幂等播种默认数据（见第三节契约） |
| 双写已就绪 | `v2-expense-service.ts recordCashDebitExpense` → `createV2ExpenseWithLegacyMirror`；`writeImportBatchAtomically` 同事务镜像 | 只要生产记账改走 `recordCashDebitExpense`，V1 模型自动联动，**不得再为"同步"写任何新代码** |
| 导入组件已存在但未接生产 | `src/ui/v2-import.tsx` / `v2-surface.tsx` 直接持有 `V2ImportService` 实例 | L-02 要把它改造成 services 回调形式并挂载 |
| smoke 运行时允许 TS 迁移 | `lib.rs`：`migration_permitted=false` 仅对 production 生效；`begin_schema_migration` 对非 production 直接 `Ok(())` | smoke 包首次启动可由 `migrateDatabase` 建到 schema V7，无需 Rust 改动 |
| Production 运行时拒绝 TS 迁移 | `lib.rs`：`QUIESCENCE_IMPLEMENTATION_NOT_PRODUCTION_AUTHORIZED` | 本指令永远不启动 production 身份；`tauri:dev`/`tauri:build`（默认 conf 是 production identifier）**禁止运行** |
| **图标未打包（2026-10-20 RETURN 实测，更正 v1/v2）** | `tauri.conf.json` 与 `tauri.smoke.conf.json` 均**无 `bundle.icon`**；Tauri `bundle.icon` 默认空数组、**不存在继承**；产物 `小钱家.app/Contents/Resources/` 仅 `runtime-compatibility.json`，`Info.plist` 无 `CFBundleIconFile` | v1/v2「smoke 构建继承基础 conf 图标」陈述**作废**。仓库 `src-tauri/icons/icon.icns`（43,431 B，绿色钱包）存在但无配置引用；已安装 production 包同样无图标（历史缺口，列剩余问题，本轮不修） |
| **smoke identity 测试与改名裁决冲突** | `tests/smoke-identity.test.ts:18-22` 断言 smoke 的 productName/窗口标题必须与 production 不同；build-40 按用户批准把 smoke 显示名改为「小钱家」，与 production 同名 → 该用例失败（392/1/80） | 隔离的真实护栏是 identifier + 数据目录（+ Rust 启动排除），显示名同名是用户裁决；F-01 将断言对齐意图并钉住批准的显示名 |
| **L-01/L-02 未实现，执行员曾越序跑 build-40** | git log 无 build-38/39；`recordV2CashExpense` 不存在；`v2-import.tsx` 仍持有服务实例；首轮 L-03 因此不具备功能验收条件 | v3 恢复顺序：F-01→L-01→L-02→L-03；L-03 功能验收只在 L-01/L-02 验收通过后启动 |
| 兼容性清单尚未覆盖 schema 7 | `src-tauri/runtime-compatibility.json` `maxSupportedSchemaVersion: 4` | 仅影响未来 production 切换，**本批不改**；列入剩余问题清单 |

---

## 二、F-01（build-41）：smoke 候选包图标打包 + identity 测试对齐（**批准门控**）

**用户逐项批准后方可执行**（原生配置 + 测试护栏调整）。未批准则本节整体不启动，整条线停在 `d6c08b3` 并请示。

### 2.1 允许改动（仅 2 个文件，除此之外一律不动）

| 类型 | 文件与改法 |
|---|---|
| 修改 | `src-tauri/tauri.smoke.conf.json`：仅新增 `"bundle": { "icon": ["icons/icon.icns"] }`（`--config` 深度合并覆盖基础 conf 的空 icon）。productName、identifier、窗口标题**不再改** |
| 修改 | `tests/smoke-identity.test.ts`：第一个用例对齐隔离意图——保留 `smoke.identifier !== production.identifier`；**删除** productName/窗口标题"必须不同"两条断言；改为钉住用户批准的显示名：`smoke.productName === "小钱家"` 且 `smoke.app.windows[0].title === "小钱家"`。第二个用例（数据目录分离）一字不动 |

**禁止触碰：** 基础 `tauri.conf.json`、`src-tauri/` 其余全部、Rust 源码、`src/persistence/`、`src/model/`、`src/application/`、`src/ui/`、`package.json`、`biome.json`、`vitest.config.ts`、工作区未跟踪文件。

### 2.2 重建与图标门

1. `npm run tauri:build:smoke`，要求 exit 0。
2. **门 ①**：`find src-tauri/target/release/bundle/macos/小钱家.app/Contents/Resources -name '*.icns' -size +0c` 有命中，字节数与源文件一致（43,431，回执记实测值）；`plutil -p .../Info.plist` 含 `CFBundleIconFile`。
3. **门 ②**：启动候选包一次，截一张含 **Dock 图标**的截图存 `evidence/landing-smoke-20261020/f01-dock-icon.png`，目视确认为绿色钱包图形而非空白/通用白板；截图后立即正常退出。本次启动**仅做图标目视**，不做功能验收、不记账、不导入。
4. 任一门不满足 → RETURN，不得交付。
5. 全量回归回到 **393 passed / 0 failed / 80 skipped**；`npm run typecheck`、`npm run lint` 绿。
6. evidence 目录本批**不提交**（随 build-44 一并入库）；`git status --short` 允许出现 `?? evidence/landing-smoke-20261020/`，回执中说明。

### 2.3 F-01 提交

仅 `src-tauri/tauri.smoke.conf.json`、`tests/smoke-identity.test.ts`（逐一 `git add` 显式路径）。
提交信息：`build-41: landing — package smoke bundle icon and realign identity test to isolation intent`

---

## 三、L-01（build-42）：V2 记账接入真实服务链路

**目标：** 候选包里的快速记账走 `V2ExpenseService.recordCashDebitExpense`（D-01 双写），首页财务结果与最近记录真实联动；重启后数据仍在。

### 3.1 允许改动的文件（共 6 个，除此之外一律不动）

| 类型 | 文件 |
|---|---|
| 修改 | `src/runtime/tauri-bootstrap.ts`（组合根：新增 V2 services 方法与幂等播种；数据库仍只在此文件内） |
| 修改 | `src/ui/contracts.ts`（`ProductApplicationServices` 追加 V2 方法签名） |
| 修改 | `src/ui/App.tsx`（`recordExpense` 改走 V2 服务；回读与 `UNCONFIRMED` 语义保留） |
| 修改 | `tests/ui.test.tsx`（mock services 追加新方法的 vi.fn；现有断言不删改语义） |
| 新增 | `tests/v2-ledger/landing-services.test.ts` |
| 修改 | `src/application/v2-expense-service.ts` **仅当**需要暴露既有 `getDashboardProps`/`getMonthSummary` 之外的只读方法且无法在组合根完成时；否则不动 |

**禁止触碰：** `src/persistence/`（含 `migrations.ts`、`repositories.ts`——D-01 契约冻结）、`src/model/` 全部、`src/application/product-service.ts` / `monthly-model-service.ts` / `financial-maintenance-service.ts`（V1 读取与既有写入路径一字不动）、`src/ui/` 中除 `App.tsx` 外的组件、`src-tauri/` 全部、`package.json`、`biome.json`、`vitest.config.ts`、工作区未跟踪文件（`.claude/`、`pelican-bike.html`、`pelican-cycling.html`）不得提交、不得删除。

### 3.2 默认账户/分类播种契约（照抄）

在组合根启动流程（`createTauriApplicationServices` 内、`getApplicationInitializationState` 判定 `READY` 之后、任何 V2 方法首次被调用之前）**幂等**执行：

1. `listAccounts(profileId)` 为空 → 创建恰好一个默认现金账户：`{ name: "现金", type: "CASH", currency: "CNY" }`（id 用 `crypto.randomUUID()`）。已有任何账户则不创建。
2. `listExpenseCategories(profileId)` 为空 → 按下表创建恰好 6 个内置分类（`builtin: true`、`active: true`、`monthlyBudget: null`、`overspendingAlert: false`、`savingsRelated: false`、`adjustable: true`；icon/color 复用 `V2HomeSurface` 或测试夹具中已有的既有取值，不得发明新风格）：

| name | 对应快速记账表单 category 枚举 |
|---|---|
| 餐饮 | `FOOD` |
| 交通 | `TRANSPORT` |
| 购物 | `SHOPPING` |
| 娱乐 | `ENTERTAINMENT` |
| 家居 | `HOUSEHOLD` |
| 其他 | `OTHER_VARIABLE`（未选分类时的落点） |

已有任何分类则整组不创建（不做部分补齐）。播种与首次记账无事务耦合，各自独立失败各自抛错。

3. **固定映射表**写死在组合根（不进数据库、不进 `src/model/`）：`ExpenseSubmission.category`（V1 六值枚举，可缺省）→ 上表同名分类的 `category_id`；缺省 → 「其他」。禁止更精细的映射、禁止读配置文件。

### 3.3 services 契约（`contracts.ts` 追加，命名沿用现有风格）

```
recordV2CashExpense(submission: ExpenseSubmission, asOfDate: string): Promise<{ expenseId: string }>
```

- 组合根实现：构造 V2 draft（`kind: "CASH_DEBIT"`，`accountId` = 播种的默认现金账户，`categoryId` = 3.2 映射，`occurredOn = submission.businessDate`，`description = submission.note ?? ""`，`currency: "CNY"`，id 用 `submission.id ?? crypto.randomUUID()`）→ `V2ExpenseService.recordCashDebitExpense`。**不得绕过服务直接调仓储。**
- `App.tsx recordExpense`：改为先调 `recordV2CashExpense`，随后沿用现有 `getExpenseRecordById`（镜像行共用 id，`expenseById` 可读回）做回读比对与 `RESOLVED/REJECTED + UNCONFIRMED` 判定——现有判定逻辑逐行保留，只替换写入调用。`services.recordExpenseAndRecalculate` 保留在契约上（维护对话框等既有调用方不动）。

### 3.4 测试要求（`tests/v2-ledger/landing-services.test.ts`，最少 4 例）

数据库搭建照抄 `tests/v2-ledger/ledger-sync.test.ts` 的 `seedDatabase` 模式，但**不手动建账户/分类**（验证播种本身）：

1. **播种幂等**：对空库连续执行播种两次，`accounts` 恰 1 行、`expense_categories` 恰 6 行；第二次无新增。
2. **端到端联动（防糊弄核心断言）**：经组合根方法记一笔当月现金支出 → 记账前/后各调一次 `calculateMonthlyModelFromDatabase`，断言 `actualVariableSpending` 增量等于该笔金额（用基准对象 `money().plus()` 推导，**禁止手写期望数字**；`asOfDate = localDate(new Date())` 动态计算）。
3. **V2/V1 双行**：同一 id 在 `expenses` 与 `expense_records` 各一行，`kind='VARIABLE'`、`category='OTHER_VARIABLE'`、`business_date` 与 `occurredOn` 一致。
4. **退出重开**：文件库写入 → `close()` → 同路径重开 + 幂等 `migrateDatabase` → 组合根方法读回：`getV2ExpenseById` 与 `expenseById` 均命中，且播种不重复创建账户/分类。

`tests/ui.test.tsx`：mock services 追加 `recordV2CashExpense: vi.fn()`；现有"记账后回读不一致 → UNCONFIRMED"类用例改为在新链路上断言，**语义不删改**。

### 3.5 验证命令

```bash
cd "/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2"
env NODE_ENV=test npx vitest run tests/v2-ledger/landing-services.test.ts tests/ui.test.tsx --reporter=verbose
env NODE_ENV=test npx vitest run --reporter=dot   # 393 + 本批净增，80 skipped 不变，0 failed
npm run typecheck
npm run lint
npm run build
```

### 3.6 L-01 提交

仅提交（逐一 `git add` 显式路径，禁止 `git add -A`）：
`src/runtime/tauri-bootstrap.ts`、`src/ui/contracts.ts`、`src/ui/App.tsx`、`tests/ui.test.tsx`、`tests/v2-ledger/landing-services.test.ts`（+ 3.1 条件下动过的 `src/application/v2-expense-service.ts`，未动则不加）。

提交信息：`build-42: landing — wire V2 quick entry through dual-write services`

---

## 四、L-02（build-43）：账单导入接入生产链路

**目标：** 候选包内可完成一次 CSV 导入（`V2ImportService.writeConfirmedImport`），镜像行随之产生，重启仍在。

**前置：** 动手前先读 `src/ui/v2-import.tsx`、`src/ui/v2-surface.tsx`、`src/model/v2-import.ts`，确定解析器（CSV → `ImportedExpenseCandidate`）所在的纯函数文件；解析器若是纯函数，保持纯函数直接调用，只为**写库**一步新增 services 方法。

### 4.1 允许改动

| 类型 | 文件 |
|---|---|
| 修改 | `src/runtime/tauri-bootstrap.ts`（追加 `writeConfirmedImport` 的 services 包装；文件选择读取由 UI 以字符串传入，组合根不碰文件系统） |
| 修改 | `src/ui/contracts.ts`（追加导入方法签名） |
| 修改 | `src/ui/v2-import.tsx`（由"持有 `V2ImportService` 实例"改为"接收 services 回调 props"；组件交互与文案不变） |
| 修改 | `src/ui/v2-surface.tsx` 或 `src/ui/HomeScreen.tsx`（二选一：把改造后的导入页挂到「我的」或既有导航可达处；挂载点选择写进回执） |
| 新增 | `tests/v2-ledger/landing-import.test.ts` |
| 修改 | 被改动组件的既有测试（若有，不删改语义） |

文件选择用 HTML `<input type="file">` + `File.text()`，**禁止安装 Tauri dialog 插件或任何新依赖**。

### 4.2 测试要求（最少 3 例）

1. 夹具 CSV 经完整链路导入 → `writtenRows > 0`，`expense_records` 镜像行数 === `writtenRows`，抽样一行字段一致（复用 `import-write.test.ts` 的夹具）。
2. 同文件二次导入全去重 → 镜像行数不增长。
3. 文件库导入后关库重开 → 镜像行仍在。

### 4.3 验证与提交

验证命令同 3.5（专项换成本批测试文件）。提交信息：`build-43: landing — wire CSV import through V2 services`。

---

## 五、L-03（build-44）：smoke 候选包重建与真机验收证据

**用户已于 2026-10-20 批准本节（含改名与图标要求）。前置：L-01/L-02 验收通过。**

### 5.1 已完成项（不重做）

- build-40（`d6c08b3`）：smoke conf 的 productName/窗口标题改「小钱家」，identifier 未动。
- 旧 production 身份 dmg `src-tauri/target/release/bundle/dmg/小钱家_0.1.0_aarch64.dmg`（11,577,372 B）已删；中断残留 `rw.41763.小钱家_0.1.0_aarch64.dmg` 已清理。
- F-01（build-41）：bundle.icon 打包 + 图标门 ①② 首验。

### 5.2 重建

```bash
npm run tauri:build:smoke
```

- 身份 `com.personalfinance.console.smoke`、数据目录与 production 隔离（Rust 既有保证），**不安装进 /Applications**——产物留在 `src-tauri/target/release/bundle/` 下，把绝对路径写进回执。
- **除 F-01 已批准的一处外禁止改动 `src-tauri/` 下任何文件**。若构建失败且原因在 Rust/配置，停下，把错误原文进回执，等待指示；不得自行修。

### 5.3 候选包手工验收脚本（逐步做并留证据）

1. 打开候选包 → 完成 onboarding（记录填写值）→ 截图首页。
2. 快速记账一笔（金额、分类、备注自定）→ 截图首页：本月变动支出/快照数字应按该笔金额变化（对照记账前截图）。
3. 正常退出（⌘Q）→ 重新打开同一候选包 → 截图：该笔记录与该笔带来的财务结果仍在。
4. 导入一份小夹具 CSV（可从 `tests` 夹具复制）→ 截图导入结果 → 退出重开 → 截图导入行仍在。
5. 只读检查数据目录（**只读，不复制、不修改**）：`ls -l ~/Library/Application\ Support/com.personalfinance.console.smoke/`，记录 `personal-finance-console.sqlite3` 存在与大小；用 `shasum -a 256` 记录两次启动间该文件哈希变化（记账后应变化，属预期）。
6. **图标校验复核（用户红线：不得为空）**：产物 `Contents/Resources/` 下 `.icns` 非零字节且字节数与源一致；`Info.plist` 含 `CFBundleIconFile`；再截一张含 **Dock 或 Finder 图标**的截图目视确认绿色钱包。任一不满足 → RETURN，不得交付。
7. 汇总剩余问题清单（含：基础 `tauri.conf.json` 亦无 `bundle.icon`（已安装 production 包无图标，历史缺口）；`runtime-compatibility.json maxSupportedSchemaVersion=4` 未覆盖 schema 7；V2 编辑/删除无镜像同步；V2 自由分类在 V1 侧无细分语义）。

截图/录屏存到 `evidence/landing-smoke-20261020/`（含 F-01 阶段已产生的截图），随提交一并入库。

### 5.4 L-03 提交

`git add` 显式路径添加 `evidence/landing-smoke-20261020/`。提交信息：`build-44: landing — smoke candidate package evidence`。

---

## 六、L-04：清理本机无用测试 App 与测试残留（无代码提交）

**用户已于 2026-10-20 批准本批。** 前置：L-03 验收通过后才执行。每项删除前跑校验门；**任一事实不符 → 跳过该项并在回执说明，禁止猜测删除**。删除一律精确路径，禁止通配符扩散。

| # | 目标 | 删除前校验门 |
|---|---|---|
| 1 | `/Applications/小钱家.app` | `CFBundleIdentifier == com.personalfinance.console` 且 realpath **不等于** `/Applications/Personal Finance Console.app`（production 运行时只允许从后者启动，故此副本永远无法启动，属死副本）；且 `pgrep -f` 确认未在运行。满足才删 |
| 2 | `artifacts/wp03-isolated-product-preview-20261012/`（整目录，含 19 个「小钱家 WP-03 测试版.app」与 cargo 产物；实测约 18G） | 先 `git check-ignore -q artifacts/wp03-isolated-product-preview-20261012`：**已被忽略才删**（已确认命中 `.gitignore:4:artifacts/`）；若被 git 跟踪 → 不删，RETURN 请示 |
| 3 | `~/Library/Application Support/` 下九个旧测试身份数据目录：`com.personalfinance.console.build21candidate`、`com.personalfinance.console.build21candidatev2`、`com.personalfinance.console.phase3devsmoke`、`com.personalfinance.console.phase3smoke`、`com.personalfinance.console.trialv3`、`com.personalfinance.console.v4acceptance`、`com.personalfinance.console.wp02preview`、`com.personalfinance.console.wp03preview`、`org.pfc.quiescence.integration` | 目录名与清单逐字一致；且不是符号链接（`[ -L "$d" ]` 为假）。逐个删 |
| 4 | 回收站/桌面/下载里的本项目测试包 | **不清**：`~/Desktop/v251_page_acceptance.zip`、`~/Downloads/XiaoQianJia_HighModel_Handoff_*.zip` 等不在授权范围，原样保留 |

**永远不删（红线）：** `/Applications/Personal Finance Console.app`；`~/Library/Application Support/com.personalfinance.console`（用户真实数据）；`~/Library/Application Support/com.personalfinance.console.smoke`（新候选包数据主场）；仓库内任何被 git 跟踪的文件。

回执附：删除前后 `/Applications` 与 `~/Library/Application Support/` 的 `ls -la` 对比、被删 artifacts 目录的 `du -sh` 原值。

---

## 七、红线（违反即 RETURN）

1. 禁止启动/构建/修改 production 身份：不运行 `npm run tauri:dev`、`npm run tauri:build`（不带 `:smoke` 后缀的），不改基础 `tauri.conf.json`，不触碰 `/Applications/Personal Finance Console.app` 与 `~/Library/Application Support/com.personalfinance.console/`。
2. 禁止任何 schema 变更（`migrations.ts` 不动）；禁止改 `runtime-compatibility.json`；除 build-40 两处与 F-01 已批准的 `bundle.icon` 一处外，禁止改 `src-tauri/` 下任何文件。
3. **F-01 未获用户逐项批准不得启动；未批准时整条线停在 `d6c08b3` 并请示，不得变通**（含不得把图标或测试修改夹带进 L-01/L-02）。
4. 记账链路必须经过 `recordCashDebitExpense` / `writeConfirmedImport`（D-01 双写）；禁止为"让首页数字变化"直写 `expense_records` 或在界面层拼汇总。
5. 禁止把数据库、`Repositories`、`V2*Service` 实例传入 `src/ui/` 组件；UI 只经 `contracts.ts` 声明的 services 方法。
6. 禁止安装新依赖、禁止网络请求（`tauri build` 仅允许拉取本地已缓存的 crates；若需联网，停下请示）。
7. 测试命令必须带 `env NODE_ENV=test`。
8. 禁止提交未跟踪文件 `.claude/`、`pelican-bike.html`、`pelican-cycling.html`；禁止 `git add -A`。
9. V1 冻结层（`src/model/`、`monthly-model-service.ts` 等）与 `src/persistence/` 的读取/既有写入路径一字不动。
10. L-04 只删第六节清单内且通过校验门的目标；清单外一律不删。
11. 批次顺序 F-01→L-01→L-02→L-03→L-04 不得越序；越序批次一律 RETURN。

---

## 八、回执格式（每批一份）

```
LANDING F-01/L-0X（build-41/42/43/44）执行回执

1. 专项测试结果：<文件> X passed, Y failed
2. 全量测试结果：A passed, B failed, C skipped（F-01 后基线 393/0/80）
3. TypeCheck：N errors；Lint：N problems；Build：success/failure
4. 本批关键决策说明（播种取值/挂载点/映射表等，照对应小节）
5. （F-01/L-03）图标门：.icns 字节数实测、CFBundleIconFile 有无、Dock/Finder 截图文件名与目视结论
6. （L-03）候选包产物绝对路径、数据目录只读检查结果、两次启动哈希、证据目录清单
7. （L-03）剩余问题清单
8. （L-04）逐项删除结果（已删/跳过+原因）、前后 ls 对比、artifacts du -sh 原值
9. HEAD：commit-hash
10. git status --short 输出
```