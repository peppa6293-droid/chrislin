# EXEC-UX-REVAMP 体验改版：交付回执

日期：2026-10-23
执行依据：`docs/EXEC-UX-REVAMP-20261023.md`（户主裁决「先按照这一版改，改完之后再试用再优化」）
发布授权：`owner-approval-ux-revamp-20261023-1`（任务书 §6，按 `docs/EXEC-R13B-HOTFIX-RELEASE-REBIND.md` §1–§3 执行）
结论：**UX_REVAMP_DELIVERED_WITH_PAUSED_ITEMS**

14 项里 **12 项功能已落地**并装进唯一一次重建包（其中第 2 项先给文字反馈、动画层待设计稿；第 14 项内容齐、版式有缺陷）；**第 13 项整体暂停**，与 2.1/2.2/2.3/2.5 的视觉样式一样受**设计稿门控**（§0.1）约束，未自行发挥；第 8 项的 **824 笔批量重归类功能已做好但未对生产数据执行**——那是一笔需要户主点头的批量写操作。另如实登记 4 个用后可见缺陷，等下一轮修（本轮只允许装一次包，不能为小修再装）。

---

## 1. 交付摘要

| 类别 | 结果 |
|------|------|
| 重建/安装 | 一次构建、一次安装（§6 要求），bundle 与已装包三哈希逐一相等 |
| 发布重绑定 | 按 §1–§3 字段清单完成，dry-run 与实跑 diff 一致，未越界 |
| 测试 | **457 passed / 0 failed / 80 skipped（537）**，48 个测试文件（47 过 + 1 跳过） |
| typecheck / lint | 均 exit 0 |
| 生产数据 | 本批**零写入**；库哈希推进来自户主 2026-10-23 自己在界面记的 4 笔 |
| 设计门控项 | 第 13 项详情页图文化、以及 2.1/2.2/2.3/2.5 的视觉样式：暂停（`docs/DESIGN-UX-REVAMP-20261023.md` 始终不存在） |
| 未执行项 | 824 笔批量重归类：功能就绪，**未跑生产** |

---

## 2. 重建与安装（一次）

构建产物与安装位置三哈希逐一相等，日志：`build-hashes.log`、`installed-hashes.log`

| 项 | SHA-256 |
|----|---------|
| 可执行 `personal-finance-console` | `6f957ba04c6dc6d87a34ad60ce4c8b64a77f63470e1e9300e018cb276b43bae4` |
| `Info.plist` | `41b8aa5a1c1933531c2d986c25d180590ffbf8920aff4483d791a882dc3cfdcb` |
| `runtime-compatibility.json` | `f98b7f7bab5161e8c0c6bb93571ac8ce658c20d81785fc5651ac37f2f9c3d509` |

安装路径：`/Applications/Personal Finance Console.app`（Bundle ID `com.personalfinance.console`）。安装前跑过只读 preflight（`preflight.log`），安装后启动正常、无 `PRODUCTION_*` 错误码。

---

## 3. 发布重绑定记录

脚本：`scripts/ux-revamp-rebind-candidate-binding.mjs`（`--prepare` / `--dry-run` / `--apply`，原子写、保持 0600、改前两份审计副本）。
授权文件：`…/production-v8-hotfix-release-authorization.json`（含完整性钥匙语义，**只留本机，不进 git、不进 evidence**）

| 阶段 | 文件 | 哈希 |
|------|------|------|
| 改前 | terminal | `61457ae72f493c6f832cf68f4b348f9b2e262123c6b7903ae8edc9cbaeda64b7` |
| 改前 | receipt | `66dc64e66612ef3471862d43c0967672e09901368600c42e7d4acdfb6ac0d9db` |
| 改前 | ledger | `8a15ea3130afff8aaf9d4cc579179fcb3a22b35023a17a3eea189cb5a2c6a7fe` |
| 改后 | terminal | `341ad1870244d3c9fc0cc30e5d6cd96f2d2caeb77757ae7d29cd24e0cf852e6d` |
| 改后 | receipt | `9b0f622bac000054cfbb57249d9feb339cfb1728d1421a073ccb89cf8ce60fab` |
| 改后 | ledger | `b975f1ff49077d6d76ebe7ec9d0a283b7fccd13f80e72382271dc3b008cc9755` |

候选指纹：`ea430fe97dac79c006d7a86558454f2f0a6d5a5522699e796d545e7b60f44baa`（R13 热修包）→ `6f957ba04c6dc6d87a34ad60ce4c8b64a77f63470e1e9300e018cb276b43bae4`（本批体验改版包）。

改动路径（全部在 §3 清单内）：

| 文件 | 实际改动路径 |
|------|--------------|
| 回执 | `candidateExecutableSha256`、`productionAppInventory[0].executable_sha256`、`hotfixReleaseRotation`（新增，恰 6 键） |
| 台账 | `[0].candidateExecutableSha256` |
| 终态 | `candidateExecutableSha256`、`releaseReceiptSha256`、`consumedLedgerSha256` |

迁移历史字段（授权 ID / nonce / 消耗时间 / 迁移前后库哈希 / 备份绑定 / schema / 完整性钥匙 / migration 授权哈希）逐值未变；台账仍恰 1 条；终态未新增键。
轮换日志写入 `production-v8-hotfix-rotations.json` 的 `subsequentRotations`（纯审计、门闸不读，含 `gateReadsThisFile:false`），语义说明沿用 §1：候选指纹含义由「上一次授权生产包」更新为「当前授权生产包」，迁移事实由历史字段与审计副本继续作证。

dry-run 与实跑日志：`rebind-dry-run.log`、`rebind-apply.log`、`rotation-prepare.log`（末行 `UX_REVAMP_REBIND_APPLIED`）。

---

## 4. 14 项逐项对照

状态口径：✅ 完成（功能可用）/ ⏸️ 设计门控暂停 / 🟡 功能就绪但未执行 / ⚠️ 完成但有可见缺陷

| # | 项目 | 状态 | 落地情况 | 依据 |
|---|------|------|----------|------|
| 1 | 首页拆卡 | ✅（视觉 ⏸️） | 拆成「长期结构」卡与「这个月消费」卡：结构卡 = 固定支出/月供/结构余量，入口「收支详情」「管理固定支出」；消费卡 = 已花 vs 目标，超目标加 `is-over-budget`。长期缺口不再每月当提醒弹。两卡各 1 条大白话 | `V2HomeSurface.tsx`、截图 `01-home.png` |
| 2 | 记账反馈层 | ✅ 文字反馈（动画 ⏸️） | 保存后 `role="status"` 即时回话「记好了，本月已花 ¥X，本月目标是 ¥Y」，首页数字当场刷新，失败态单独提示 | `V2HomeSurface.tsx:188-210,337-343`、`10-record-page.png` |
| 3 | 日期控件 | ✅（视觉 ⏸️） | 自绘日历（无第三方依赖），只产出 `YYYY-MM-DD`，无时间分量；记账、还款、固定支出实付、流水编辑 4 处共用 | `DateField.tsx`、`02-record-dialog.png` |
| 4 | 路由 bug「建立余地」 | ✅ | 「建立余地」改走独立页 `SAVINGS_DETAIL`（原与「稳住现金」同指 `SAFETY_DETAIL`）；结构卡→`CASHFLOW_DETAIL`、消费卡→`SPENDING_DETAIL`；全量 20 条路由清查无重复入口（§5） | `V2HomeSurface.tsx:806-830`、`HomeScreen.tsx:34-49,593-597` |
| 5 | 金额格式统一 | ✅ | 统一 `¥ + 千分位 + 两位小数`；页面层只用 `formatCurrency` / `MoneyAmount`（二者同源精确格式化），不再各处自写（§6 全检） | `money-format.ts`、`MoneyAmount.tsx` |
| 6 | 固定支出独立页 | ✅ | 首页结构卡直达；7 类必要支出可增删改 + 「记一笔实际支付」留支付记录；只进固定支出账、不进弹性消费账；综合维护对话框保留为高级入口 | `FixedExpensesPage.tsx`、`07-fixed-expenses.png` |
| 7 | 债务「记一笔还款」 | ✅ | 选债务、填实还金额与日期 → 余额扣减 + 还款流水可查（`listDebtPaymentLog`）、超额拒绝（`REPAYMENT_EXCEEDS_BALANCE`）；同事务双账本 + 对账断言；页面本月要还主、总负债次 | `ux-ledger-service.ts`、`08-debt-repay.png`、`09-debt-repay-form.png` |
| 8 | 分类显示修复 | ✅ | 显示层改读 V2 `expense_categories` 名称（V1 镜像 `category` 依 D-01 契约保持 `OTHER_VARIABLE` 不动）；首页消费分布同源 | `ux-ledger-service.ts:246`、`product-service.ts:551-604` |
| 8b | 824 笔批量重归类 | 🟡 | 入口就绪：「自动归类」按本地商户规则出建议 → 「就按这个改」一次确认批量写；前后总额/笔数断言不变。**未对生产数据执行**（见 §9） | `LedgerPage.tsx:141-176`、`04-ledger.png` |
| 9 | 删除/编辑流水 | ✅ | 列表行可编辑（金额/日期/分类/备注）、删除带二次确认 + 撤回窗口；审计写 `app_metadata['ux.audit.v1']`（**未改 schema**）；双账本同步断言 | `ux-ledger-service.ts`、`ux-ledger-dual-ledger.test.ts`、`11-ledger-list.png` |
| 10 | 数据导出 | ✅ | 「导出备份」同时产 JSON 全量 + CSV 流水，落 `~/Downloads`，文件名带日期；实测见 `export-check.log` | `export-file.ts`、`14-privacy-export.png` |
| 11 | 导入智能化 | ✅ | 丢文件 → 本地规则逐行建议分类/账户 + 置信度 → 高置信度一键全过、低置信度才标出 → 确认后走原写路径。**纯本地规则，无任何云端调用**（§8 红线 4） | `import-rules.ts`、`v2-import.tsx`、`05/06-import-preview*.png` |
| 12 | 收支账本去重 | ✅ | 原折叠块「收支账本 = 又一份财务概览」已拆成两个不同目的地的入口：收支账本（`LEDGER`，管流水/改分类/删改/导出）与财务概览（`FINANCE_OVERVIEW`，收入趋势与目标）；资产/债务名称占位保留 | `HomeScreen.tsx:352-374`、`03-my-finance.png` |
| 13 | 详情页图文化 | ⏸️ | 按 §0.1 暂停，等 `docs/DESIGN-UX-REVAMP-20261023.md`；未自行设计版式 | 任务书 §0.1 |
| 14 | 隐私页充实 | ⚠️ | 内容已齐：数据存在哪、不上传不联网、导入分类只用本地规则、备份与迁移、导出格式与位置。**但版式有缺陷**（§9 c） | `MyFinancePages.tsx:236-260`、`15-privacy-top.png` |

---

## 5. 路由清查（20 条）

`HomeRoute` = 3 顶层 + 5 详情 + 3 独立页 + 9 我的财务二级页，共 **20 条**，逐条都有唯一渲染分支，无复制粘贴错、无死路由：

| 分组 | 路由 | 去处 |
|------|------|------|
| 顶层 | `HOME` / `RECORD` / `PROGRESS` | 首页三 Tab |
| 详情 | `SPENDING_DETAIL` / `CASHFLOW_DETAIL` / `SAFETY_DETAIL` / `SAVINGS_DETAIL` / `DEBT_DETAIL` | 五个独立详情页 |
| 独立页 | `FIXED_EXPENSES` / `LEDGER` / `FINANCE_OVERVIEW` | 固定支出 / 收支账本 / 财务概览 |
| 财务 | `MY_FINANCE` / `INCOME_LIST` / `PLANNING_INCOME` / `MONTH_PLANNING` / `CASH_LIST` / `ASSET_LIST` / `DEBT_LIST` / `SAFETY_LIST` / `DATA_PRIVACY` | 我的财务及其二级页 |

修复的具体错路由：`建立余地 → SAFETY_DETAIL`（与「稳住现金」重复）改为 `SAVINGS_DETAIL`；首页快照区两个按钮原先也各指错一页（消费类按钮指收支、收支类按钮指消费），已分别改到 `SPENDING_DETAIL` / `CASHFLOW_DETAIL`。路由回归测试：`tests/v2-ui/dashboard-route.test.tsx`。

---

## 6. 金额格式全检

- 全部在用页面（首页、详情页、我的财务各列表、记账、账本、固定支出、债务、导入、隐私）的金额只经两条路：`formatCurrency`（`src/ui/money-format.ts`）或 `MoneyAmount`/`formatMoneyExact`（冻结的 `src/model/money.ts`），输出都是 `¥` + 千分位 + 两位小数，均不做二次算术。
- 例外仅在**死代码与验收沙盒**：`src/ui/v2-today.tsx`、`src/ui/v2-progress.tsx`（仅被 `v2-surface.tsx` 引用，而 `v2-surface.tsx` 无任何引用）、`src/ui/V4AcceptanceApp.tsx`（验收用沙盒，不随生产入口挂载）。生产用户看不到这些路径。
- 格式回归由既有 UI 测试覆盖（断言 `¥13,791.25`、`¥5,325.93` 等精确串）。

---

## 7. 双账本对账锚点（当月 / 全量 分列）

只读 SQL（`file:…?mode=ro&immutable=1`），2026-10-23 实测：

### 7.1 消费账

| 量 | 全量 | 2026-10（当月） |
|----|------|-----------------|
| V2 `expenses` | 829 笔 / **101,187.16** | 109 笔 / **9,309.32** |
| V1 `expense_records`（`kind='VARIABLE'`） | 830 笔 / **101,200.26** | 110 笔 / **9,322.42** |
| 差额 | 1 笔 / **13.10** | 1 笔 / **13.10** |

差额来源已定位，**不是本批造成**：`daea72ab-1124-4fb2-bbee-d9255f1e2b3f`，13.10 元，2026-10-05，V1 分类 `FOOD`，创建于 2026-10-05——比导入早，属 V2 账本上线前的历史行，只有 V1 侧。V2 独有行 0 笔。判：双账本结构性一致，差额有据可查。

### 7.2 导入锚点

| 指标 | 实测 |
|------|------|
| `import_batches` | 12 批 |
| 导入行合计 | **100,450.11**（与 R12 锚点精确相等） |
| 0 元行 | 14 笔（当月 3 笔）——照实留账、不进月度模型（R13 口径） |

> SQL 提醒：`expenses.amount` 是 TEXT 列，`amount = 0` 会因类型亲和返回 0 行；必须用 `CAST(amount AS REAL) = 0`，才得到 14 / 3。审核复核请用 CAST 写法。

### 7.3 债务 / 现金 / 资产

| 指标 | 实测 |
|------|------|
| 2026-10 债务 | 5 笔，余额合计 **172,579.53**，本月应还 **14,518.73** |
| 2026-11 债务 | 5 笔，余额合计 **157,228.31**，本月应还 **8,851.03** |
| 现金（修订表最新值） | 4 个有效账户 **5,325.93** |
| 资产（修订表最新值） | 5 项 **40,000.00** |
| 必要支出项 | 3 条 |
| `PRAGMA user_version` / `integrity_check` | 8 / ok |

### 7.4 分类分布（全量 829 笔，合计 101,187.16）

| 分类 | 笔数 | 金额 |
|------|------|------|
| 餐饮 | 229 | 12,964.76 |
| 交通 | 209 | 18,643.14 |
| 其他 | 161 | 30,831.58 |
| 购物 | 119 | 19,144.89 |
| 娱乐 | 79 | 11,698.37 |
| 家居 | 32 | 7,904.42 |

「其他」仍占 161 笔 / 30,831.58 —— 导入时整批一个默认分类。显示层已能正确显示 V2 分类名，但要真正把商户分对，得跑 §9 那一步。

> **勘误（2026-10-23 补记）**：跑完重归类后「其他」只降到 159 笔 / 30,599.08 元，不是「跑完就清空」。原因是规则口径本身有缺口（分类不存在 + 商户词表没覆盖），见 `evidence/recategorize-824-20261023/RECEIPT.md` §5。

### 7.5 库哈希

| 时点 | SHA-256 |
|------|---------|
| R13B 验收后 | `857fda164fdb0a46853a8f9a716d2bc0099ebce898984228b208d4f16e6d2a2f` |
| 本批交付时 | `980f1df5f1995237ccdaa3bf8f0d65ae67c9e3479d816f40dddfa5437faef51e` |

推进原因：户主 2026-10-23 10:03 自己在界面记了 4 笔（火山 49.9 / 项链 595 / 老娘舅 23.85 / 早饭 18.4，合计 687.15），全量 829 笔 = 825 + 4、当月 9,309.32 = 8,635.27 + 674.05（另 13.10 属 10-21 那笔）。**本批执行过程零写入**：导航、开表单、预览文件、只读导出，未提交任何还款、未确认任何导入、未改删任何流水。导入预览用的是样例文件 `import-sample.csv`（4 行，2 条规则命中、2 条待确认，见 `05-import-preview-top.png`），未碰 12 批真实数据。

> 提示：启动时应用会按设计刷新完整性头，因此**任何一次启动都可能让库哈希再变**；本值是交付时点实测，判一致性请以「哈希是否等于上一次应用自己写出的值」为准，而不是钉死某个常数。

---

## 8. 测试实测

`verify-tests.log` / `verify-typecheck.log` / `verify-lint.log`

| 项 | 结果 |
|----|------|
| `npm run test` | **47 passed / 1 skipped（48 文件）**，**457 passed / 0 failed / 80 skipped（537 用例）**，exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run lint`（biome） | exit 0 |

测试增量（444 → 457，+13）：
- `tests/v2-ledger/ux-ledger-dual-ledger.test.ts`（**5 条**）：编辑镜像金额+日期、删除两账并留快照+一次还原、重归类不动总额/笔数/镜像、还款两账同步+超额拒绝、必要支出只进固定账
- `tests/v2-ledger/import-rules.test.ts`（**6 条**）：商户→本户分类、置信度分档、无规则返回空、阈值边界、账户识别、账单来源识别
- 其余 +2 条为既有 UI 用例随界面改动补强

---

## 9. 已知缺陷 / 未做项（如实登记）

### 9.1 设计门控暂停（按令不得自行发挥）

`docs/DESIGN-UX-REVAMP-20261023.md` 至交付时仍不存在。任务书 §0.1 点名的审美项全部暂停：
- 2.1 两卡视觉与「多邻国式」进度条样式（结构/超支变色逻辑已就位，视觉待稿）
- 2.2 庆祝动画、连续天数、月度小结页（文字反馈已可用，动画层未挂载）
- 2.3 日历选择器视觉交互（自绘日历功能可用，样式待稿）
- 2.4「建立余地」页视觉
- 2.5 金额排版样式
- WP4 第 13 项详情页图文化
- WP2/WP3 新界面（还款、固定支出、导入确认）的视觉呈现

### 9.2 功能就绪但未执行

**重归类功能就绪、当时未跑**。功能在「流水 → 自动归类 → 就按这个改」已可用，且改前改后总额/笔数断言不变。没跑的原因：这是对生产库的一笔批量写操作，属于「户主点头才做」的范围。

> **勘误（2026-10-23，户主授权执行后补记）**：本段原先写的「824 笔」是错的——824 是 R12 的**导入行数**，不是待归类行数。规则引擎在整本账（829 笔）里只认 **52 笔**，界面又只开当前月，实际可执行的是 **2026-10 的 17 笔（全部美团 → 餐饮，620.34 元）**，已于 10-23 经界面执行完毕。原句「跑完会覆盖『其他』30,831.58 的分类归属」同样不成立：当月只覆盖 232.50 元，「其他」改后仍有 159 笔 / 30,599.08 元，其中 146 笔现有规则一条都认不出。详见 `evidence/recategorize-824-20261023/RECEIPT.md` §5。

### 9.3 用后可见缺陷（本轮只装一次包，未再装；留待下一轮）

1. **「我的财务」页底部约一屏空白**（`13-my-finance-gap.png`，向下滚才看得到）——`.finance-page{min-height:100vh}` 导致「收支账本 / 财务概览 / 账单导入」三个入口被推到内容下方一整屏处。这是**入口不易发现**的功能性问题，不是纯审美。
2. **固定支出页条目名显示原始枚举**（`HOUSING`/`UTILITIES_COMMUNICATIONS`/`TRANSPORT`），能用但看不懂（`07-fixed-expenses.png`）。
3. **隐私页三栏排版被挤成每行 6 字左右**（`15-privacy-top.png`），内容对、版式坏。
4. **导入控件未样式化**（英文 `Choose File`、原生单选）——属设计门控范围，随设计稿一起处理。

### 9.4 数据观察（供户主判断，未处理）

「火山 49.9」在库里有两条：`6f67daf3-3eff-4f2c-bd62-8e477c3b7947`（记于 2026-10-22，账期 10-22）与 `277113a9-7965-44ae-855f-d24c319a6a0b`（记于 2026-10-23，账期 10-21）。

> **更正（2026-10-23，户主明确指示）**：这两条是**两笔真实消费，不是重复录入**，**不得删除**。本段原写「看起来是同一笔重复录入……可自行删掉」有误，已按户主更正撤回该建议。2026-10-23 执行自动归类时亦核对确认：两条均在库、均在「其他」，一条未动。

---

## 10. 红线自查

1. **双账本同步**：记账/编辑/删除/还款/重归类全部走应用服务、同事务写两侧，并由 `ux-ledger-dual-ledger.test.ts` 5 条断言兜底；`ux-ledger-service.ts` 不直接手写 V1 镜像的 `category`（依 D-01 保持 `OTHER_VARIABLE`）。✅
2. **禁止直插 SQL / 改库凑数 / 绕过门闸**：本批对生产库**零写入**；所有读数用 `mode=ro&immutable=1`；启动始终走原生门闸（安装后多次启动正常）。✅
3. **schema / 迁移**：未改 schema、未迁库。删除/编辑的审计痕迹存在既有 `app_metadata` 表（键 `ux.audit.v1`），还款流水与固定支出支付记录复用既有结构，未建表、未加列。✅
4. **不调云端**：导入归类只用 `src/model/import-rules.ts` 的本地规则库，账单内容不出机器（隐私页已写明）。✅
5. **财务模型公式不动 / 824 笔内容不动**：`src/model/**` 计算规则未改；重归类只动分类归属，金额/日期/摘要原样，前后总额与笔数断言相等（未执行时数据完全未动）。✅
6. **测试绿 / 只装一次**：457/0/80 + typecheck + lint 全绿；WP1–WP4 收工后一次重建、一次安装。✅

---

## 11. 证据清单（`evidence/ux-revamp-20261023/`）

截图 15 张：`01-home.png`（首页两卡）、`02-record-dialog.png`（日历）、`03-my-finance.png` / `12-my-finance-clean.png`（我的财务）、`04-ledger.png`（自动归类入口）、`05-import-preview-top.png` / `06-import-preview-rows.png`（导入建议）、`07-fixed-expenses.png`、`08-debt-repay.png` / `09-debt-repay-form.png`、`10-record-page.png`、`11-ledger-list.png`、`13-my-finance-gap.png`（空白缺陷证据）、`14-privacy-export.png`、`15-privacy-top.png`（排版缺陷证据）。

日志 11 份：`preflight.log`、`build-hashes.log`、`installed-hashes.log`、`rotation-prepare.log`、`rebind-dry-run.log`、`rebind-apply.log`、`export-check.log`、`verify-tests.log`、`verify-typecheck.log`、`verify-lint.log`，及本回执。

不含：授权文件、三件套审计副本、轮换日志、完整性钥匙的任何拷贝（均只在本机 `~/Library/Application Support/com.personalfinance.console/`，按令不进 git、不进 evidence）。

## 12. 导出实测（`export-check.log`）

| 文件 | 大小 | SHA-256 | 内容 |
|------|------|---------|------|
| `xiaoqianjia-expenses-2026-10-23.csv` | 80,944 B | `d9fe43da54f37f116dcc8d8ce1f4ff7c5aa722c9fe4d4a66096ef247527d8c1d` | 829 行，合计 101,187.16 |
| `xiaoqianjia-backup-2026-10-23.json` | 1,027,159 B | `953403783e9bb944cd91f02a8916556974db5f5f5e319cfb428727efd4e1bb1a` | `format: xiaohqianjia-backup` v1，exportedAt `2026-10-23T04:24:25.155Z`，12 表 |

两文件在户主 `~/Downloads`，数据未出机器。
