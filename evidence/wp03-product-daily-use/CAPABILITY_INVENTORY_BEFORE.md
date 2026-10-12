# WP-03 正常产品能力盘点（实现前）

- 日期：2026-10-12（Asia/Shanghai）
- 基线：`92ec24136d732e05375760d736ef508c66dd2c0e`；工作区另有上一轮 WP-02 未提交隔离实现，保留并纳入后续来源核对。
- 检查对象：普通产品 `src/ui/App.tsx` / `HomeScreen.tsx` / `MyFinancePages.tsx` 与 Application/Repository 调用路径；不以 `V4AcceptanceApp.tsx` 作为正常产品能力证据。

| 能力 | 当前状态 | 源码路径与依据 |
|---|---|---|
| Home | PARTIAL | `HomeScreen` 有首页、快速消费、摘要与详情；没有各域日常维护的直接链路。 |
| 我的财务入口 | PARTIAL | 四域入口可达，但只有列表与综合维护 fallback。 |
| 稳定月收入 | COMPLETE（范围内） | 正常页面可修改、展示修订历史；保存走 `updateFinancialDataAndRecalculate` 并读回。 |
| 本月计划收入 | MISSING | Repository/V4 Foundation 有月份决策 API；正常 `MyFinanceRoute` 无本月覆盖/恢复入口。 |
| Actual Income | PARTIAL | 本月记录只读展示；综合维护可追加，无法在正常产品中新增/编辑/作废/看历史。 |
| Expense | PARTIAL | Home 有新增消费快速入口；目前没有消费列表/修改/日常分类维护界面。WP-03最低要求新增与首页回算。 |
| Cash | PARTIAL | Repository 有快照与生命周期修订，正常界面只读当前有效记录；不能新增/编辑/停用/看历史。 |
| Assets | PARTIAL | Repository 有资产修订和 active 字段，正常界面只读有效资产；不能新增/编辑/停用/看历史。 |
| Debts | PARTIAL | 综合维护可改余额/月供；当月事实有单独应用服务；正常界面只读，不能新增/停用/管理历史。 |
| Safety Targets | PARTIAL | Model 和综合维护支持设置；正常界面无直接设置页。 |
| 历史/修订查看 | PARTIAL | 只有稳定收入历史在正常界面可读；其余修订历史未呈现。 |
| 保存后 Home 权威刷新 | PARTIAL | 稳定收入与 Expense 已接权威服务；综合维护会刷新 Home。其他正常日常编辑入口不存在。 |
| restart persistence | PARTIAL | WP-02 已对稳定收入限定场景完成真实包重启验证；其它产品域未验证。 |
| 高级维护 fallback | COMPLETE | `FinancialMaintenanceDialog` 保留为综合维护 fallback。 |

## 文档可用性

- `docs/FINANCIAL_MODEL_SPEC.md`、`docs/DATA_CONTRACT.md`、`docs/PRODUCT_SPEC.md`、`docs/ACCEPTANCE_CRITERIA.md` 与 `docs/FINAL_DOD_MATRIX.md` 可读取。
- 粘贴任务要求的 `V012_USABILITY_AND_DIRECT_MANAGEMENT_FEASIBILITY_REVIEW.md` 在当前仓库及相邻项目目录搜索未找到。
- V4 Foundation 的原始独立终审文件不在当前项目树；`docs/CURRENT_PHASE.md` 和 `V012_PRODUCTION_V4_CUTOVER_READINESS_DIAGNOSTIC.md` 记录了其 Owner 接受和原始报告位于受管证据目录。本轮不推断不可读报告的细节。

## 实施前结论

当前产品具备稳定收入单项编辑、快速消费录入及可复用的修订服务基础；多域管理仍依赖大型综合维护页。缺口集中在正常入口、单项工作流、月计划决策入口、Actual 修订与历史展示，以及明确停用和回读体验。Financial Model V1.0 不作修改。
