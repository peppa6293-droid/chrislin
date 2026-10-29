# 美团「缺本月事实」缺口修复方案（草案 V1）

- 文档状态：**草案，只出方案，不改代码、不改数据**
- 出具人：小钱家审核员
- 日期：2026-10-29
- 背景：chris 10-29 拍板 **1-A**（美团缺本月事实＝产品层缺口，改程序修复），要求审核员先出方案，列清路线/涉及文件/是否动表动数据/需另批部分，chris 确认范围后才进执行与验收。
- 本轮边界：全程只读源码 + 内存库 SQL 复现；**未访问活库、未写任何数据、未改任何代码**。甲-2 验收结论不受本方案影响。

---

## 1. 一句话结论

App 的「停用债务」只写 `debt_revisions` 一行 `active=0`、不动基表 `debts.active`，而**「缺本月事实」检查只看基表 `debts.active=1`、不读修订行的停用状态**，于是美团被永久算作「本月缺事实」，每月复发、且用户在界面上没有任何办法把它清掉。

修法推荐 **路线 A：让「缺本月事实」检查认修订行的停用状态（纯查询逻辑改动，不动表、不动数据）**。

---

## 2. 根因（源码定位 + 复现证据）

### 2.1 现象

2026-11 起，每月底录入当月债务事实时：

- 其余债务全部确认完毕后，`saveCurrentMonthDebtFact` 仍返回 `SAVED_NEEDS_CURRENT_MONTH_DEBT_FACTS`，`unresolvedDebtIds` 永远剩美团一个 id；
- 界面（`src/ui/MyFinancePages.tsx:1065`）固定提示「这笔事实已保存；还需要确认其他本月债务后，首页才能完成计算。」——**永远清不掉**；
- 首页模型永远等不到 `SAVED_MODEL_READY`。

### 2.2 根因

| 位置 | 内容 |
|---|---|
| `src/persistence/repositories.ts:1443-1459` | `missingCurrentMonthDebtFactIds`：`SELECT d.id FROM debts d WHERE d.active=1 AND …`，**只读基表 `debts.active`**，两条 `NOT EXISTS` 只看「该月是否已有事实/修订」，完全不读 `debt_revisions.active` |
| `src/persistence/repositories.ts:1469-1512` | `debtsAt`：`WHERE d.active=1 AND COALESCE(p.active,d.active)=1` —— **正确**认了修订行停用 |
| `src/persistence/repositories.ts:1524-1547` | `priorDebtsForMaintenance`：`WHERE d.active=1 AND COALESCE(m.active,d.active)=1` —— **正确** |
| `src/application/v4-foundation-service.ts:575-602` | `deactivateDebt`：只 `INSERT INTO debt_revisions(…, active=0)`，基表 `debts.active` 保持 1 |

即：**三条查询里有两条认停用状态，一条不认**。停用的美团因此从所有债务列表里消失（正确），却永远留在「缺本月事实」清单里（错误）。

### 2.3 复现证据（内存库 SQL 重放，未碰活库）

复现脚本：`~/.hermes/cache/scratch/meituan-gap-repro.py`（用 `repositories.ts` 原版 SQL 文本，在 `:memory:` SQLite 上重建甲-2 之后的表状态：5 笔债务基表 `active=1`、`debt_revisions` 1 行美团 2026-10 `active=0`、`debt_period_facts` 若干行）。实测输出：

| 目标月 | 缺事实清单含美团 | 美团出现在维护屏债务清单 |
|---|---|---|
| 2026-10 | 否 | 否 |
| 2026-11 | **是** | 否 |
| 2026-12 | **是** | 否 |
| 2027-01 | **是** | 否 |

**逐月复发成立，且用户无法通过界面消掉**——美团根本不在维护屏的债务列表里（`FinancialMaintenanceState.debts` 不含它），没有「确认本月事实」按钮可点；要清掉只能给美团写当月事实行，而写事实＝写 `active=1` 修订＝**复活美团**（红线禁止）。

> **对既有表述的一处更正**：此前终裁口径写作「2026-12 起维护屏逐月把美团标『缺本月事实』」。按上面实测，准确表述应为：**维护屏的债务列表里看不到美团，但服务层的「缺本月事实」清单里永远有它**，表现为保存后的固定提示与 `SAVED_MODEL_READY` 永不返回。缺口性质、严重度、修复必要性不变。

### 2.4 影响面（全部由 `missingCurrentMonthDebtFactIds` 一处漏判引起）

1. `src/application/debt-fact-service.ts:259/402` —— 返回状态永久停在 `SAVED_NEEDS_CURRENT_MONTH_DEBT_FACTS`，`SAVED_MODEL_READY` 永不出现。
2. `src/application/debt-fact-service.ts:301` —— 事务内整体模型校验（`buildMonthlyModelInput` + `calculateMonthlyModel`）**永久跳过**（`unresolved.length === 0` 永不成立）。这是最实质的损失：保存债务事实后不再做全量模型校验。
3. `src/application/debt-fact-service.ts:387-393` —— 模型就绪的 Home 读回永久跳过。
4. `src/ui/MyFinancePages.tsx:1065` —— 误导性提示每月出现、永不消除。
5. 每月都可能诱发「补一行事实把提示清掉」的冲动操作，而补事实＝复活美团（红线）。

---

## 3. 可选路线

### 路线 A（**推荐**）：让「缺本月事实」检查认修订行停用状态

- **改哪**：`src/persistence/repositories.ts:1443-1459`（`missingCurrentMonthDebtFactIds` 的 SQL）。把判定条件从「基表 `debts.active=1`」改成与 `debtsAt` **完全一致**的有效态口径：取 `debt_revisions`（`period_month<=目标月 AND as_of_date<=截止日`）与基表合并后的最新有效 `active`，即 `COALESCE(latest_revision.active, d.active)=1`。
- **建议实现**：把 `debtsAt` / `priorDebtsForMaintenance` 已在用的「latest_payment / metadata」CTE 抽成同一段口径（或同构复制），保证三处永不漂移；不改任何调用方签名。
- **是否动表**：**否**（零表结构改动）。
- **是否动数据**：**否**（零数据行改动，含活库、备份库）。
- **涉及代码文件**：`src/persistence/repositories.ts`（唯一必改）。
- **涉及测试文件**（新增/扩充，均在 `tests/`）：`tests/debt-fact-service.test.ts`、`tests/persistence.test.ts`、`tests/financial-maintenance-service.test.ts`（反例 + 回归）。
- **UI / 文案**：**不改**。`MyFinancePages.tsx:1065` 的提示语原样保留，缺口清零后它自然不再出现。因此**不触发文案冻结**，不需要新编号槽位。
- **优点**：改动面最小、零数据、零表结构、零文案；同时修复影响面 1–5 全部五条；历史月读回完全不受影响（只改「缺事实」判定，不碰 `debtsAt`）。
- **风险**：口径必须与 `debtsAt` 严格一致，否则会出现「列表里没有但缺事实里有」或反向漏报。控制手段＝共享同一 CTE + 第 4 节验收测试双向反例。

### 路线 B：数据侧补行把缺口填掉（**不推荐**）

- **改哪**：不动代码，每月给美团写一行当月 `debt_revisions`。
- **是否动表**：否。**是否动数据**：**是**（每月一行，永久滚动）。
- **致命缺陷**：① 若写 `active=1` → **复活美团**（红线禁止）；② 若写 `active=0` → 每月都要补一行，无穷无尽，且属纯数据规避、掩盖产品缺陷；③ 需要动活库＝需 chris 亲自发起回合授权。
- **结论**：不推荐，仅列出备查。

### 路线 C：只改提示文案/流程，把「还需要确认其他本月债务」改成忽略停用债务（**不推荐**）

- **改哪**：`src/ui/MyFinancePages.tsx`、`src/ui/App.tsx`、`src/ui/HomeScreen.tsx` 按 `unresolvedDebtIds` 里是否只剩停用债务分支。
- **是否动表/数据**：否。
- **致命缺陷**：只治标。影响面 2（事务内模型校验永久跳过）与 3（Home 读回永久跳过）**仍在**；且要新增文案 → 撞文案冻结、要走新编号槽位签认。
- **结论**：不推荐。

### 路线 D：同时做 A + 补一条「停用债务不参与缺事实」的契约注记（**A 的收尾动作，非独立路线**）

- 在 `src/application/debt-fact-service.ts` 的函数注释（JSDoc）里写明「只统计有效债务」，不改行为。
- 是否动表/数据：否。属路线 A 的一部分。

### 对比

| | 动表 | 动数据 | 改代码 | 改文案 | 修复影响面 1–5 | 需 chris 另批 |
|---|---|---|---|---|---|---|
| **A（推荐）** | 否 | 否 | 1 个文件 | 否 | 全部 | 是（persistence 层 + tests） |
| B | 否 | **是** | 否 | 否 | 只治 1/4，且引入复活风险 | 是（动库，需 Owner 回合） |
| C | 否 | 否 | 3 个 UI 文件 | **是** | 只治 4 | 是（UI 层 + 文案签认） |

---

## 4. 路线 A 验收标准（草案，供 chris 确认后固化为验收条款）

| 编号 | 验收点 | 判定方法 |
|---|---|---|
| V-1 | 2026-11 / 2026-12 / 2027-01 情景下，`missingCurrentMonthDebtFactIds` **不返回**美团 id | 单元测试（内存库） |
| V-2 | 未停用债务仍正常报缺：2026-12 未录入事实前，其余 4 笔仍在缺事实清单里 | 单元测试反例 |
| V-3 | 反例双向：把美团恢复为有效（或删掉停用修订行）后，缺口**重新出现** | 单元测试反例 |
| V-4 | 其余债务全部录入后，`saveCurrentMonthDebtFact` 返回 `SAVED_MODEL_READY` | 集成测试 |
| V-5 | `debt-fact-service.ts:301` 事务内整体模型校验恢复执行（不再被永久跳过） | 集成测试 + 断言 |
| V-6 | 历史月读回不变：2026-10 **14,187.36**、2026-11 **8,849.15**、债务清单 4 笔、总额 **172,248.16** | 只读副本回归（需 chris 回合授权）或内存库对拍 |
| V-7 | UI 文案零改动、`src/ui` 零改动 | diff 复核 |
| V-8 | 门禁 `npm run lint` / `npm run typecheck` / `npm run test:product` 全绿 | 实跑 |

**停止条件**：任一验收点需改白名单外文件、需动表、需动数据行，或 V-6 数值漂移 → 停手上报 chris，不得自行扩大范围。

---

## 5. 需 chris 另行授权 / 确认的部分

1. **改 `src/persistence/repositories.ts`**（persistence 层，超出当前 `src/ui` + P1-b 白名单授权）→ 需 chris 批范围。
2. **改/增 `tests/` 下 3 个测试文件** → 需 chris 批范围（含在本次修复包内）。
3. **V-6 的活库/只读库副本回归** → 按授权规则，只能在 chris 亲自发起的回合做；如不批，可用内存库对拍替代并在报告里标注。
4. **第 7 条解除**：修复验收通过后，「12 月起逐月复发时执行员停手上报、不补事实」的临时纪律是否随之解除 → 需 chris 明示。
5. **生产包重建 / 门闸轮换 / codesign 补签**：不在本方案内，仍为 Owner 唯一权限，与生产重建批次同批处理。

**本方案明确不做**：不动表结构、不动任何数据行、不改 `production-v8-*.json`、不写活库、不新增依赖、不新增文案、不动 `src/ui`、不碰甲-1/乙-1/丙类数据修正（那些另有通道与授权）。

---

## 6. 风险与回退

- **回退**：路线 A 是单文件纯查询改动，回退＝revert 该 commit；无数据迁移、无表结构变更，回退零成本。
- **回归风险**：`missingCurrentMonthDebtFactIds` 只有 3 个调用点（`debt-fact-service.ts:241/300/371`），全在债务事实保存链路上，影响面封闭；`debtsAt`、`priorDebtsForMaintenance`、首页模型、月度读回**均不改**。
- **口径漂移风险**：用共享 CTE 消除；并在测试里加「三处查询对同一状态给出一致有效态」的契约测试。
- **测试基线**：现有门禁基线 `test:product` 565 passed / 44 skipped / 0 failed；本方案落地后该数字应只增不减。

---

## 7. 下一步（等 chris 批范围）

1. chris 确认路线（A / B / C）与授权范围（第 5 节 1–4 条）。
2. 批准后：审核员出执行任务书（含白名单、停止条件、验收条款 V-1～V-8）→ 执行员实施 → 审核员复核 → 验收员独立验收 → 人事简报 + 验收任务书。
3. 在此之前：**不改代码、不动数据**；12 月起若缺口复发，执行员照旧停手上报、不补事实。
