# M2-T02 跨月补记支付失败（ESSENTIAL_ITEM_NOT_FOUND）修复任务书

版本 v2 · 2026-11-03 · 状态：**CODE_FIXED，未重新构建/未重装手机**
触发：G5 真机验收 V14-3 实测失败，见 [evidence/m2-t02-fixed-expenses-20261101/phone-g5-20261103/V14-3-UNSAVED.md](../evidence/m2-t02-fixed-expenses-20261101/phone-g5-20261103/V14-3-UNSAVED.md)

## 0. 更正（v1 → v2）

v1 曾写"根因已经钉死，不是悬而未决的判断题"——这句错了。落地前发现 `tests/m2-fixed-expenses-service.test.ts` 的 `E16-B` 原本就**故意**断言"生效日之前拒付"是对的行为，说明这不是单纯代码写错，而是此前一次有意的产品决策，和 Owner 今天的真实需求（补记生效日之前的真实支付）相冲突。已就"要不要允许补记"单独向 Owner 确认，Owner 选择**允许补记**。第 2～5 节按这个决定更新；第 6 节结论不变。

## 0b. 执行记录

- 代码改动：[src/application/ux-ledger-service.ts](../src/application/ux-ledger-service.ts#L501) 第 501 行查找改用 `listEssentialExpenses()`（不按日期过滤，只看当前有效项）。
- 测试改动：`E16-B` 重写为断言补记成功、字段与月汇总独立正确，保留"同项目生效日当天再付一次"的非回归对照。
- 门禁：`tsc --noEmit` 0 输出；`npm run lint`（biome）0 错误；`npm run test:product` 63 文件 **759 passed / 44 skipped / 0 failed**，与之前基线一致、无新增失败。
- 已提交：`929785f`（`feat/mobile` 分支），范围仅这一处查找逻辑 + 对应测试 + 本任务书。
- **未做、不要误读为已完成**：没有重新构建 iOS 包、没有重新安装到手机、手机上当前跑的仍是修复前的旧二进制。这个修复要生效，必须走一次新的构建+安装，而那一步目前仍卡在 [docs/M2-T02-PHONE-ACCEPTANCE-PLAN-20261103.md](M2-T02-PHONE-ACCEPTANCE-PLAN-20261103.md) 里那套一次性授权流程——按第6节的流程建议，这一步的授权仪式应该简化，但本任务书不代为执行安装。

## 1. 问题

Owner 在手机上给固定支出项目「HOUSING」补记一笔**上月（2026-10）**的真实支付，提交后 App 提示「暂时无法确认是否保存」；两次独立取库核验 `ESSENTIAL` 支付记录为 **0 条**——确认没写入，不是误报。

## 2. 根因（源码定位，已读未改）

`recordEssentialPayment`（[src/application/ux-ledger-service.ts:501](../src/application/ux-ledger-service.ts#L501)）用**支付日期 `paidOn`** 去查「当时有效的固定支出项」：

```ts
const items = await repositories.listEssentialExpensesAt(input.paidOn);
const item = items.find((row) => row.id === input.itemId);
if (!item) throw new ApplicationDataError("ESSENTIAL_ITEM_NOT_FOUND", ...);
```

`listEssentialExpensesAt(asOfDate)`（[src/persistence/repositories.ts:718](../src/persistence/repositories.ts#L718)）按 `essential_expense_snapshots.as_of_date<=?` 过滤版本。只要这个固定支出项是**在要补记的月份之后**才被加入系统的（本例 HOUSING 就是这种情况），用 10 月去查，版本表里找不到任何 `as_of_date<=2026-10-xx` 的快照，物品直接"不存在"，于是抛 `ESSENTIAL_ITEM_NOT_FOUND`——这不是校验拒绝，是**查询条件用错了日期**。被 UI 的 catch-all 吞成一句无差别的「暂时无法确认是否保存」。

旁证：11-2 23:58 执行员预检已写到同一结论（"E16-B拒付原因实为该项目当日无版本而抛 ESSENTIAL_ITEM_NOT_FOUND，非生效日校验"），比今天真机实测早了近一天，当时未被处理。

## 3. 修复方向（待执行员核实后落地，非最终代码）

`recordEssentialPayment` 要回答的问题是「这个 itemId 现在是不是一个有效固定支出项」，不是「它在 paidOn 那天是否存在」——补记历史支付天然允许 `paidOn` 早于项目入库日。

候选修复：把第 501 行的查找源换成不按日期过滤的现有方法 `listEssentialExpenses()`（[repositories.ts:706](../src/persistence/repositories.ts#L706)，只按 `active=1` 取当前有效项），而不是 `listEssentialExpensesAt(input.paidOn)`。

执行员落地前必须自行核实、不能照抄：
- 确认 `listEssentialExpenses()` 返回的 `category` 字段对后续 `ESSENTIAL_CATEGORIES.has(item.category)` 判断等价，不引入新分支。
- 搜索 `listEssentialExpensesAt(` 和 `ESSENTIAL_ITEM_NOT_FOUND` 的全部调用点/测试，确认没有依赖"按 paidOn 校验历史有效性"这一行为的既有用例；若存在，按该用例单独处理，不能一刀切改坏它。
- 新增一个跨月补记的单测（item 的 snapshot/revision 的 as_of_date 晚于 paidOn，仍应成功写入）作为本次改动的回归锁，防止再退化。

## 4. 范围与边界

- **允许改：** `src/application/ux-ledger-service.ts` 的 `recordEssentialPayment` 查找逻辑；`tests/` 下新增/修正的对应单测。
- **不允许动：** 表结构、迁移、其他 essential 相关读路径（如维护页、`listEssentialExpensesAt` 本身的语义）、签名、包名、UI 文案（除非验证这条路径本来就该报错，那是另一个决策，不在本任务书内）。
- **不在本任务书内：** M2 视觉设计（M2-DESIGN-00/01/02/03）尚未实现的问题——那是独立的产品范围缺口，不是 bug，需要单独排期，不要借本次修复顺手一起做。

## 5. 验收标准

1. 新增回归测试覆盖「paidOn 早于项目创建快照的 as_of_date」场景，断言写入成功、月汇总正确。
2. 既有 `test:product` 全量门禁（lint / typecheck / vitest）保持 0 失败。
3. 在构建副本上用同样的「补记上月已存在项目的真实支付」路径人工复测一次，确认不再出现 `ESSENTIAL_ITEM_NOT_FOUND` 或"暂时无法确认"，且库内读回字段与提交一致。
4. 本次改动走正常 git 提交（修复 + 测试同一个提交），不再堆积到未提交工作区。

## 6. 流程建议（配合诊断一起看，减少再卡住）

这次卡点不是技术难度，是流程本身变成了瓶颈，给三条具体收紧建议，供 Owner 采纳或调整：

1. **按风险分级，不是所有改动都走四道关卡。** 像这种"查询条件用错日期"的单点代码缺陷，有回归测试兜底就可以一次性提交+复核，不必再铺开独立取库哈希、证据目录、分角色逐条回执的全套仪式——那套重流程留给"真机上对 Owner 真实账本做写入"这一类真正高风险的操作。
2. **不要让已批准的设计方案悬空。** M2-DESIGN-00~03 已经批准三天，期间资源全部转向了别的功能，设计方案变成没人认领的待办。建议明确一个顺序：要么先把已批的视觉实现上去再继续功能加固，要么正式说明"本阶段先不做视觉，设计方案延后到 X 时间"，不要让 Owner 下次看手机时才发现设计没上。
3. **改动随时提交，不要攒在工作区。** 当前 M2 相关代码从 10-30 起一直未提交，WORKLOG 一次 diff 就有 1000+ 行——这既有丢失风险，也让每次复核都要重新梳理一遍同一批未提交改动。建议改完一小块就提交一次，哪怕标 WIP。

## 7. 下一责任人

代码修复、测试、门禁已完成并提交（见 0b）。下一步是 Owner 决定：是否按第6节简化流程，走一次新构建+安装把这个修复带到手机上，再重跑 G5 的 V14-3/V14-4。产品决策（允许补记）已经 Owner 本人确认过，不需要再排一轮"审核员判断是否产品缺陷"。
