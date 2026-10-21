# U-14 执行任务书（build-50）：仪表盘接入生产路由 + 验收真包

发布者：审核员。执行者：按任务书实现并自测，完成后回执；审核员复验通过方可合并交付。
基线：HEAD `bb933a0`（build-49）；测试基线 **412 passed / 80 skipped**（审核员 2026-10-21 复跑实测）。
背景：build-49 交付了真数机制，但 `V2Dashboard` 未接任何生产路由（执行者回执偏差 4；审核员 grep 复核：仅 service 类型引用，无生产消费者）。户主在真实包里看不到真数，本任务书收口该缺口并出验收真包。

## 0. 红线（违反即 RETURN）

1. 继承 U-13 全部红线：禁止写生产库、禁止写 T2 文件（spike-01/T2_REPORT.md、evidence/T2_FLOW_EVIDENCE.md、T2_TEST_RESULTS.md、evidence/T2_SHA256.txt）、禁止改 V2→V1 镜像规则、禁止改 `src-tauri/` 源码、禁止加依赖、禁止网络请求。
2. **生产身份只构建、禁止在本机启动**：启动 production 身份 app 会自动触发 v3→v8 迁移，属写库行为；迁移与真实数据播种是审核员职责。smoke 身份可启动自测。
3. 禁止 `git add -A`；按显式路径提交；提交前缀 `build-50`。
4. preflight（必须带 `env NODE_ENV=test`）全绿：`npx vitest run --reporter=dot`、`npm run typecheck`、`npm run lint`。

## 1. 已核实事实（直接按此实现，不要重复探索）

- 路由图：`src/ui/HomeScreen.tsx`、`src/ui/MyFinancePages.tsx`、`src/ui/V2HomeSurface.tsx` 为生产路由；`src/ui/v2-dashboard.tsx` 的 `V2Dashboard` 当前无生产消费者。
- 数据入口唯一：`V2ExpenseService.getDashboardProps(profileId, month)`（src/application/v2-expense-service.ts:370）；禁止新增任何硬编码金额。
- U-11（品牌 logo、点击回首页）与 U-12（截断规则）为验收红线，不得回退。
- 生产库现 v3、2026-11 债供 8,851.03；审核员将在 build-50 复验通过后统一迁移 v8 并播种真实数据。

## 2. U-14-A 路由接线（必改项）

1. 选最小侵入点让 `V2Dashboard` 生产可达：推荐 `MyFinancePages.tsx` 列表加固定入口，或 `V2HomeSurface.tsx` 内嵌账本区；执行者如有更优方案先 RETURN 提议，不得自行扩大范围。
2. 入口渲染月份默认当前月；income / recurringIncome / accountCash 与「含一次性收入」标签必须在真实包界面可见。
3. 不新增图标、不改底部导航；入口样式复用现有列表/卡片样式。
4. 测试：新增路由级用例（从路由入口渲染，断言账本金额与标签文本可达，fixture 走 service）；既有导航/快照用例如有同步更新；测试总数只增不减。

## 3. U-14-B 验收真包

1. `npm run build && npm run tauri:build`（production 身份）；回执 DMG 路径 + SHA256。
2. 证据目录 `evidence/u14-route-20261021/`：三项 preflight 日志、build-production.log、路由截图（临时库 + 无头渲染，方法同 U-13，脚本不提交）、RECEIPT.md、dmg-sha256.txt。
3. 截图必须包含：路由入口页 + 仪表盘真数区（临时种子：income 13791.25、recurringIncome 12791.25、一次性标签可见、accountCash 5325.93）。

## 4. U-14-C flake 治理

- `import-flow` 相关测试文件连跑 3 次，结果全部写入 RECEIPT；再Fail 则定位修复并计入改动清单；全绿则维持现状并注明"三连绿"。

## 5. 验收锚点（审核员播种后复验；执行者自测用临时库对齐格式）

- 路由可达：真实包界面能进入仪表盘并见真数区。
- income 13791.25 / recurringIncome 12791.25 / 标签可见；accountCash 5325.93；safetyResources 25325.93；freeCash 21525.93；固定计划合计 5076.31；2026-11 债供 8851.03 不变。
- U-11 / U-12 规则不回退。

## 6. 回执格式

逐项 A/B/C 状态；测试数量旧→新；改动文件清单；路由接线说明（入口文件:行号）；DMG 路径+SHA256；证据目录；flake 三连跑结果；`git status --short`；WORKLOG.md 的归属与用途一句话说明。
任何超出任务书的改动需求：RETURN 请示，不要自行决定。
