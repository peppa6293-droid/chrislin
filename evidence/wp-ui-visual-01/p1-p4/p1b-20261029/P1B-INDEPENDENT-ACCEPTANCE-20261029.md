# P1-b 独立验收报告（代码＋测试）

- 时间：2026-10-29 01:13 CST
- 验收人：小钱家验收员
- 结论：**PASS（仅限代码＋测试范围）**
- 返工项：**无**
- 边界：非 Owner 回合；未访问活库、未启动 App、未改生产包/门闸/授权文件、未提交 git。本结论不闭合第 9 条，不代替 chris 裁 Q-①/②/③，也不构成生产发布或最终视觉签认。

## 1. 独立核验

1. **证据一致性**：按 `P1B-SHA256.txt` 对当前 4 个源码文件、`src/style.css` 与 7 个测试文件复算 SHA256，**12/12 OK**。
2. **红线差异**：`git diff --exit-code -- src/model src/persistence src/style.css` 无输出，确认 model/persistence/style.css 零 diff。
3. **取数链路**：
   - `src/application/product-service.ts:429` 只对 `built.input.facts.actualIncomeRecords` 内存求和，无新 SQL。
   - `src/application/monthly-model-service.ts:44-55` 从 `listIncome(targetMonth, asOfDate)` 过滤 `kind='ACTUAL'`。
   - `src/persistence/repositories.ts:790-854` 的 V4/V3 路径均只从 `income_records` 及其修订关系取 ACTUAL 收入，并按 `asOfDate` 截断；未混入 `income_entries`。
4. **展示同源**：`src/ui/V2StructureCard.tsx:49-54,119-137` 的余量、比例、环心与双环均使用 `home.actualIncomeTotal`；缺失态不补零。
5. **门禁独立重跑**：原始输出保存于 `P1B-INDEPENDENT-ACCEPTANCE-GATES-20261029.txt`。
   - `npm run lint`：exit 0，173 文件，无修复。
   - `npm run typecheck`：exit 0。
   - `npm run test:product`：exit 0，54 文件，**565 passed / 44 skipped / 0 failed**。

## 2. K-1～K-6 验收

| 条件 | 结果 | 独立依据 |
|---|---|---|
| K-1 同批同源、单表求和 | PASS | 取数链路仅 ACTUAL `income_records`；S12 实测环心 ¥13,791.25、25.6%、105.3%、已超出 ¥727.48、−¥4,255.48、占收入 −30.9%；断言不含 27,582.50 与 13,000.00。 |
| K-2 文案冻结 | PASS | 仅复用既有「收入」「占收入」「—」「结构余量待确认」等词元；未发现新增可见文案。 |
| K-3 model/persistence 红线 | PASS | 两目录零 diff；派生字段不改 Financial Model 输入输出。 |
| K-4 style.css 零改动 | PASS | 零 diff，SHA256 与证据一致。 |
| K-5 反例测试＋门禁 | PASS | 双计、规划值回填、缺失补零反例均在；三门禁独立全绿；未使用 `--no-verify`。 |
| K-6 停止条件与回合边界 | PASS | 本轮只读工作区源码/证据并运行测试；零活库访问，未触发停手条件。 |

## 3. 观察项与未闭环事项

- 沿用审核员观察项 **P-1（不返工）**：部分夹具同时存在 `actualIncomeRecordCount: 0` 与正数 `actualIncomeTotal`，属生产不可达态；下次触碰同批夹具时对齐，不影响本次代码结论。
- 夹具截图矩阵仍归证据交付阶段，本轮未以代码测试冒充视觉证据。
- **第 9 条继续 `BLOCKED_EVIDENCE（B）`**：仍须按 chris 对 Q-② 的裁定，由 chris 发起回合补 2026-10 首页截图，证明环心实际收入为 13,791.25 且无 27,582.50。
- Q-①/②/③ 仍待 chris；生产包重建、codesign、门闸轮换、git 提交均不在本验收授权内。

## 4. 结论

P1-b 代码与测试达到已放行条件，**独立验收 PASS，无返工项**。Phase 1 整体与第 9 条尚未闭环，暂不输出最终验收任务书。
