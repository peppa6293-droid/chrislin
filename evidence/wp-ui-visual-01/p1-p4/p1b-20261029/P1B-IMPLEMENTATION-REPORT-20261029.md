# P1-b 实现报告：首页结构卡改读所选月份实际收入

- 状态：`IMPLEMENTED_PENDING_REVIEW`（代码已落，门禁全绿；未提交 git、未启动 App、未访问活库）
- 执行人：小钱家执行员 ｜ 复核人：小钱家审核员 ｜ 依据：`docs/P1-B-RELEASE-APPLICATION-20261029.md` + 审核员 2026-10-29 00:56 裁定（`PASS_WITH_CONDITIONS`，K-1～K-6）
- 回合边界：本回合由审核员发起（**非 Owner 回合**）→ 零活库访问、零写库、未启动生产 App、未改生产门闸/`production-v8-*.json`、未改代码以外资产；`src/style.css` 0 改动；未提交 git。

---

## 1. 白名单执行对照

| 文件 | 是否按白名单 | 本回合改动 |
| --- | --- | --- |
| `src/application/product-service.ts` | ✅ | `HomeApplicationState` 增 `actualIncomeTotal: string`；映射处用 `money()` 对 `facts.actualIncomeRecords` 内存求和（D-2 窄授权）。无新 SQL、无新查询、未改 `calculateMonthlyModel` 入参/出参、未动 `planningIncome`/`baseSurplus` 语义。 |
| `src/ui/structure-ring.ts` | ✅ | 仅新增 `StructureSurplus` + `structureSurplus()` 纯函数（D-2 允许「仅新增 `structureSurplus`」）。既有 `ringDatum/percentOf/structureRings` 语义未动。 |
| `src/ui/V2StructureCard.tsx` | ✅ | 三处同源：环心/两环分母/结构余量全读 `home.actualIncomeTotal`；余量与比例改由 `structureSurplus` 派生（不再用 `home.baseSurplus`）；缺失态数值位「—」；比例行「占收入 …」。 |
| `src/ui/V2StructureRings.tsx` | ✅ | 仅缺失态中心：`income <= 0` 时中心印「—」、图表可访问名「收入 —」；圆环/明细/标记/交互未动。 |
| `src/style.css` | ✅ 0 改动 | 未改。新增行只用既有 class（`.v2-card__value small`）。 |
| `tests/structure-ring.test.ts` | ✅ 新增 | 7 例纯函数（含 2026-10 对拍、缺失、零、负、超 200%、单表反例）。 |
| `tests/v2-ui.test.tsx` | ✅ | 夹具补字段 + S2–S10b 改为按实际收入驱动 + 新增 S12 真数据反例断言。 |

**未碰**：`src/model/**`、`src/persistence/**`、migrations、`schema_migrations`/`user_version`、导出、`src-tauri/**`、参考资产、生产库、授权/门禁文件、`production-v8-*.json`。零新增页面/入口/依赖/可见设计元素。

## 2. 本回合语义改动（逐处）

1. **取数源**：`product-service.ts` 新增只读派生
   ```ts
   actualIncomeTotal: built.input.facts.actualIncomeRecords
     .reduce((total, income) => total.plus(money(income.amount)), money(0))
     .toString(),
   ```
   `facts.actualIncomeRecords` 即 `repositories.listIncome(...)` 中 `kind='ACTUAL'` 的所选月份记录（V4 路径 `actualIncomeAt`），与收入页同源；只加一次内存求和。
2. **余量同源**：`structure-ring.ts` 新增
   `structureSurplus({income, essentialExpenses, mandatoryDebtService})` →
   `available / amount / ratio / percent`；`income <= 0` 返回 `UNAVAILABLE`（**不补零**）。
3. **卡片**：`V2StructureCard` 的环心、两环分母、结构余量、主标题档位、`is-short/is-even/v2-card--over`、查看债务按钮，全部改由同一份 `structureSurplus` 输出驱动；缺失态数值位「—」。
4. **中心缺失态**：`V2StructureRings` 以 `rings.incomeZero || rings.incomeNegative` 判定，中心印「—」，`aria-label` 用「收入 —」。

### 2.1 两个需要复核拍板的小决定（不自行扩权）

- **缺失态判定用「合计 > 0」而不是 `actualIncomeRecordCount === 0`**：数据层 `assertPositiveIncomeAmount` 禁止 0/负金额，故两者在活库等价；用合计判定可避免「有记录但合计 0」这种不可达状态误画环。已登记为等价口径。
- **缺失态「—」的可访问名称复用既有「结构余量待确认」**：K-2/D-5 禁止任何新串（含 aria）。该既有串原用于「月供资料不齐」，缺失收入时语义为「余量暂时算不出」，我未新造串；若判为语义混淆，请给一句既有词范围内的替换指令，我不自行发明。
- **「占收入 -30.9%」用 ASCII 负号**：沿用 `percentOf`/`MoneyAmount` 的负数约定（`-¥4,255.48` 同源）；页面公式行的排版减号 `−` 未改。若要求排版减号，属新增格式化规则，请裁。

## 3. 白名单外连带（请追认或给回退指令）

`HomeApplicationState` 新增必填字段后，**5 个既有测试夹具各补 1 行**（仅补字段，零断言改动、零行为改动）：

| 文件 | 补入值 | 理由 |
| --- | --- | --- |
| `tests/ui.test.tsx` | `actualIncomeTotal: "13000"` | 夹具 `planningIncome=13000`、`essential=3528`、`debt=14518.73`、`baseSurplus=-5046.73`，自洽 |
| `tests/v2-cards-loading.test.tsx` | `"13000"` | 夹具 `baseSurplus=8672` = 13000−3528−800，自洽 |
| `tests/v2-ui/icon-unification.test.tsx` | `"13000"` | 同上 |
| `tests/v2-ui/v2-surface.test.tsx` | `"10000"` | `baseSurplus=8000` = 10000−1500−500 |
| `tests/v2-ui/dashboard-route.test.tsx` | `"12791.25"` | `baseSurplus=9263.25` = 12791.25−3528−0 |

不补则 `money(undefined)` 在运行时抛错（`Decimal` 非法入参），且 `HomeApplicationState` 契约与夹具不一致。**这是 D-2 的机械连带，不是新范围**；若不接受，请指示回退方式（回退后 `test:product` 必红）。

## 4. K-1～K-6 逐条自检

| 条件 | 自检 | 证据 |
| --- | --- | --- |
| K-1 同批同源、单表求和；禁 27,582.50、结构卡禁 13,000.00 | ✅ | S12：环心 `¥13,791.25`、25.6%/105.3%、`已超出 ¥727.48`、`-¥4,255.48`、`占收入 -30.9%`；`not.toContain("27,582.50")`、`not.toContain("13,000.00")`；纯函数 7 例含单源反例（双计会变 9,535.77 / 52.7%，已断言不出现）。 |
| K-2 文案冻结、零新增可见字符串 | ✅（待复核两点见 §2.1） | 新增可见文本只有 `占收入 `（现网既有）＋`—`（现网既有，缺失态）；无新词、无新 aria 串。 |
| K-3 model/persistence 红线 | ✅ | `git diff --stat -- src/model src/persistence src/style.css` 输出为空；`calculateMonthlyModel` 未改。 |
| K-4 style.css 0 改动 | ✅ | 同上；`src/style.css` sha256 `1d077536…`（与仓库 HEAD 一致，无 diff）。 |
| K-5 反例测试＋三门禁全绿、禁 `--no-verify`、未复核不提交 | ✅ | `lint` exit 0、`typecheck` exit 0、`test:product` 54 文件 / **565 passed / 44 skipped / 0 failed**；未提交 git。 |
| K-6 申请 §9 停止条件原样生效 | ✅ 未触发 | 本回合零活库访问（未读库、未启 App），未出现需改 model/persistence/schema、未新增页面/入口、无双计路径、未触碰活库哈希/锚点。 |

## 5. 2026-10 对拍（代码输出，非预填）

| 项 | 输出 |
| --- | --- |
| 环心 | `¥13,791.25` |
| 外环 固定支出占收入 | `25.6%` |
| 内环 必须偿还月供占收入 | `105.3%` → A 标记 + `已超出 ¥727.48`（1 个 `.v2-ring-row__marker`） |
| 结构余量 | `-¥4,255.48`，`占收入 -30.9%` |
| 主标题 | `收入：我一个人打五个？`（DEEP_DEFICIT，现网既有文案） |
| 禁止项 | `27,582.50`、`13,000.00` 均未出现 |

注：月供 14,518.73 含花呗 4,362.56，属债务三问待裁；裁决改数后首页随之变化，本批不预判、不改债务。

## 6. 测试覆盖

- 新增 `tests/structure-ring.test.ts`（7 例）：2026-10 对拍、正余量、精确 0、缺失不可用、负收入不可用、单源 vs 双计反例、超 200% 不截断。
- 更新 `tests/v2-ui.test.tsx`：
  - S1 默认夹具（13,000/3,528/800）保持双环与 27.1%/6.2%；
  - S2–S6b 档位测试改为按实际收入−固定支出−月供驱动（7.7% / 0 / −5% / −20% / 20% / −10%）；
  - S7/S8 缺失态：中心「—」、`aria-label="收入 —"`、数值位无 `¥0.00`、不回落 `¥13,000.00`；
  - S9 月供待确认行为不变（遮余量、内环无弧、「查看债务」）；
  - S10/S10b 超额与 100% 边界不变；
  - S12 新增真数据反例（见 K-1）。

## 7. 门禁原始记录

`P1B-GATES-20261029.txt`：`lint` exit 0（173 文件）、`typecheck` exit 0、`test:product` exit 0（54 files / 565 passed / 44 skipped）。

## 8. 未做 / 未闭合（不在本批）

- **夹具截图矩阵**（正常/缺失/待确认 × 390/760/1000/1440）：需构建/预览与浏览器，本回合未做；属证据交付阶段，不属代码放行。
- **首页真数据截图**：须 chris 发起回合 + 预览构建/生产重建（Q-②），本回合按回合边界不启动 App、不读活库。
- **Q-①/②/③**：两套余量并存书面接受、第 9 条证据路径、D-1/D-6 知悉——归 chris，人事汇总上呈。
- 生产包重建、codesign、门闸轮换、git 提交：均未做，等授权。

## 9. 证据文件

| 文件 | 说明 |
| --- | --- |
| `P1B-IMPLEMENTATION-REPORT-20261029.md` | 本报告 |
| `P1B-GATES-20261029.txt` | 三门禁原始输出（含 exit code） |
| `P1B-SHA256.txt` | 4 个源码 + 1 个 CSS + 7 个测试文件哈希 |
| `P1B-DIFF-20261029.patch` | `git diff`（product-service / V2StructureCard / tests）；`V2StructureCard` 的 diff 含段2既有未提交改动，语义归属见 §2 |

## 10. 结论

代码实现完成、门禁全绿、反例齐备，请复核。复核通过前不提交 git、不进入截图/验收阶段；截图与第 9 条闭环等 chris 裁 Q-② 并由其发起回合。
