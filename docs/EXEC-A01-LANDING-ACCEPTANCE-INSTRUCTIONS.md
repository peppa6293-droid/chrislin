# EXEC-A01 落地验收交接包（交验收模型执行）

发布者：审核员 ｜ 发布日期：2026-10-22 ｜ 执行者：**独立验收模型**（非此前执行 build 批次的实现者）
性质：小钱家 macOS 版落地验收（用户最终验收标准的独立复核）。iOS/手机尺寸不在本次范围，单独记录。

---

## 0. 你的角色与结论权限

你是独立验收人。只做**只读核查 + 运行时验证 + 证据采集 + 出验收结论**，不做功能开发，不修缺陷，不「顺手改进」。发现问题按 §6 格式分级上报，不要自行修复。

你的结论是给户主看的最终建议，**最终验收通过与否由户主本人拍板**。不得把「测试通过」直接写成「产品完成」。

## 1. 候选身份（审计对象，全程冻结）

| 项 | 值 |
|----|-----|
| 源码提交 | `e6aa8d5`（main HEAD，2026-10-22） |
| 已装生产包 | `/Applications/Personal Finance Console.app` |
| Bundle ID | `com.personalfinance.console` |
| 可执行文件 SHA-256 | `444729451aafc3bbe6cf95b52ffd84a2191b75f6c1477d0d840656ace4711b5c` |
| Info.plist SHA-256 | `41b8aa5a1c1933531c2d986c25d180590ffbf8920aff4483d791a882dc3cfdcb` |
| 生产数据库 | `~/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3`（user_version=8，integrity ok，31 张表） |
| 启动后库哈希 | `319907d68dafd513a2ebed758d469a066793735677a1a462d034ea7b88b192a3`（此后任何合法写入都会推进此值，**不等于篡改**，见 §2 注） |
| V8 终态文件 | `production-v8-cutover-terminal.json`（sha `46d4e440…`，状态 V8_VERIFIED） |
| 双备份 | ① `~/Library/Application Support/com.personalfinance.console/production-v8-backups/personal-finance-console.sqlite3` ② `~/Documents/pfc-v8-migration-backup-20261022/personal-finance-console.sqlite3`（均 sha `ebdd7c2d…`，迁移前 V3 原件） |
| 测试基线 | 442 passed / 80 skipped（复跑 `env NODE_ENV=test npx vitest run`） |

**CANDIDATE_DRIFT 规则**：验收期间若源码提交、已装包哈希或库结构发生非 §5 预期的变化，停止验收、标记 `CANDIDATE_DRIFT`、全部结论作废。**禁止**重建生产包、禁止替换 `/Applications` 下的 App、禁止改生产配置（`src-tauri/tauri.conf.json` 的图标缺口是已知遗留，见剩余问题清单 A1，本批修它会毁掉候选身份）。

## 2. 已验证事实（上游已闭环，你复核锚点即可，不必重做迁移）

用户 5 项验收标准的现状对照：

| # | 用户标准 | 上游状态 | 证据入口 | 你要做的 |
|---|----------|----------|----------|----------|
| 1 | 真实可打开的独立 macOS 候选包 | ✅ 已达成 | `evidence/r10-production-migration-20261022/`（30-install、70-launch） | 启动真包确认可打开（§5.2） |
| 2 | 记账→财务结果真实同步 | ✅ 代码/测试层已达成 | D-01 双写契约 `docs/EXEC-D01-LEDGER-SYNC-INSTRUCTIONS.md`；L-03 真实链路 `evidence/landing-smoke-20261020/`；U-14 仪表盘真数 `evidence/u14-route-20261021/` | 运行时验证（§5.2 敏感步骤） |
| 3 | 退出重开数据仍在 | ✅ 代码/测试层已达成 | L-03 `l03-04-expense-after-restart.png` + 关库重开持久性测试；R10 `70-launch/73-quit、74-post-quit、76-post-launch-counts` | 运行时验证（§5.2） |
| 4 | 截图/录屏/测试证据 | ⚠️ 截图+测试齐，**录屏 0 份** | 证据索引见 §4 | 补录屏（§5.3，注意隐私） |
| 5 | 剩余问题清单 | ✅ 本次交付 | `docs/REMAINING-ISSUES-20261022.md` | 复核清单是否隐瞒/误报 |

**关于库哈希的特别说明**：本应用的启动会推进数据库 integrity head（设计见 `src-tauri/src/lib.rs:1268-1285`）。**库哈希 ≠ 上表启动后哈希不代表篡改**。判断数据安全看：integrity 是否 ok、业务表计数、备份文件是否原样（sha `ebdd7c2d…`）、terminal 绑定关系。R10 时点这些全部核过（`evidence/r10-production-migration-20261022/RECEIPT.md` §6-8）。

**财务锚点（真实数据，验收读数必须一致）**：5 笔债务；2026-11 债务合计 **157,228.31**；当月应还 **8,851.03**；仪表盘锚点：收入 13,791.25 / 经常性收入 12,791.25（含一次性收入徽标）/ 账户现金 5,325.93 / 安全资源 25,325.93 / 自由现金 21,525.93（= 25,325.93 − 3,800 预留下季房租）。口径裁决依据：2026-10-21 户主五项定案。

## 3. 范围外（明确不做、不报完成）

- iOS / 手机尺寸 / 真机：用户明确单独记录，本次**不验收、不混报**。
- App Store 发布准备：外部账号事项，缺条件标 `BLOCKED_EXTERNAL_ACCOUNT`。
- 功能缺口修复（剩余问题清单 B 类）：属 V0.2 开发，不属验收。
- 备份文件、`.v8-quarantined` 隔离件：历史证据，**只读，永不删除、永不改写**。

## 4. 证据索引（上游交付物全图）

| 主题 | 路径 |
|------|------|
| 生产 V3→V8 真实迁移 + 启动验证 | `evidence/r10-production-migration-20261022/`（RECEIPT.md 为主回执；10-preflight…84-final-hashes） |
| 迁移前合成演练 | `evidence/r9-rehearsal-20261022/` |
| 生产 schema 权威升 V8（代码+测试） | `evidence/r8-production-v8-20261022/` |
| 仪表盘真数 + 路由 + 生产 DMG 构建 | `evidence/u13-realnumbers-20261021/`、`evidence/u14-route-20261021/`（含 DMG sha `3c13cdd7…`，该 DMG 为构建产物，**已装包以 §1 哈希为准**） |
| 落地线：双写记账/导入/onboarding | `evidence/landing-smoke-20261020/`（L03-RECEIPT.md + 10 张截图） |
| 图标统一视觉证据 | `evidence/u10-visual-20261021/` |
| 测试证据 | 各批 preflight-*.log；冻结点复跑 442/0/80 |
| 验收标准原文 | `docs/ACCEPTANCE_CRITERIA.md`（V1 模型不变量）、`docs/XIAOQIANJIA_FINAL_AUDIT_CHECKLIST.md`（全量审计清单，**本次只做 macOS 节**） |
| 剩余问题 | `docs/REMAINING-ISSUES-20261022.md` |

## 5. 验收程序

### 5.1 只读核查（先做，全程 `mode=ro&immutable=1`）

1. 核 §1 全部哈希与路径（库哈希允许不等于启动后锚点，见 §2 注；但 integrity 必须 ok、user_version 必须 8）。
2. 核两份备份 sha 均为 `ebdd7c2d…`。
3. 核 terminal/receipt/consumed-authorizations 绑定关系（方法见 R10 回执 §11 与 `84-final-hashes.log`）。
4. 复跑测试：`env NODE_ENV=test npx vitest run`，记录 passed/skipped 数与基线 442/80 比对。
5. 只读 SQL 核财务锚点（5 笔债务、157,228.31、8,851.03）。只读命令模板：
   `sqlite3 "file:$HOME/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3?mode=ro&immutable=1" "<SQL>"`

### 5.2 运行时验证（真包）

1. **打开**：启动 `/Applications/Personal Finance Console.app`，确认进入主界面、无崩溃、无门闸报错。
2. **数据在**：首页/我的财务核对财务锚点（§2 末段数字）。
3. **退出重开**：正常退出（Cmd+Q 或 `tell application id "com.personalfinance.console" to quit`，**禁止 kill**）→ 重开 → 数字一致。
4. **记账→财务同步（敏感步骤，先选方案）**：
   - **方案 A（推荐）**：请户主本人在真包记一笔真实支出（真实发生过的小额即可），你只读核对：仪表盘「已花」增加、V1 侧变动支出同步增加（镜像规则：仅现金支出、category=OTHER_VARIABLE）。
   - **方案 B**：户主明确批准你记一笔测试支出，并接受该笔**永久留在账本里**（当前无删除 UI，删除会引入新问题，禁止事后「清理」）。
   - **方案 C**：跳过真库写入，改在 smoke 身份包（若有）复验写入链路，并把真包同步验证标为 `NOT_VERIFIED_REAL_WRITE`。
   - **禁止**：未经户主选择就向真库写入；禁止用 SQL 直插/直改业务表（那验证的不是应用链路）。

### 5.3 证据采集

1. 每个运行时步骤至少 1 张截图（真包实拍，注意界面含真实金额）。
2. **补录屏**（用户标准第 4 项缺口 C1）：录制「打开→核数字→记账（若做）→退出→重开」全过程。录屏含真实财务数据，存放位置与是否入库**先问户主**。
3. 全部证据放 `evidence/a01-landing-acceptance-20261022/`，附 `RECEIPT.md`。

### 5.4 复核剩余问题清单

对照 `docs/REMAINING-ISSUES-20261022.md` 逐项验证「现状」描述属实（例如 `V2HomeSurface.tsx:960` 确为 `slice(0, 3)`；`tauri.conf.json` 确无 `bundle.icon`）。发现清单隐瞒、误报或有新问题，写进你的报告。

## 6. 结论格式（照抄结构填）

```text
候选身份（§1 哈希逐项）：
源码提交：
验收范围：macOS 落地（iOS 不在本次）

已验证事实（按用户 5 项标准逐项）：
运行时验证记录（含记账同步采用的方案 A/B/C）：
证据路径：

P0/P1/P2 问题（P0=数据丢失/无法使用；P1=主链路缺陷；P2=体验/外观）：
未覆盖项：
剩余问题清单复核结果：

最终状态：READY_FOR_REVIEW / PARTIAL / BLOCKED / CANDIDATE_DRIFT
（READY_FOR_REVIEW=技术验收通过待户主最终拍板；不得写 COMPLETED，最终验收权在户主）
下一责任人：户主
```

## 7. 红线（违反即验收作废）

1. 不写生产库业务表（§5.2.4 方案内的应用级记账除外）；不改库结构；不动 terminal/receipt/permit 文件。
2. 不删、不改两份备份与 `.v8-quarantined`。
3. 不重建/替换生产包，不改 `src-tauri/`，不动 `src/`（你没有开发任务）。
4. 不 kill 应用进程（按 bundle id 退出）。
5. 不把 iOS/App Store 项写成本次已完成。
6. 发现数据异常：**保留现场**，停止操作，先报告，不自行修复。
