# V2 综合面板隔离说明（EXEC-U-03）

## 范围

本文件对应 `EXEC-U-03`，仅覆盖隔离 V2 UI 候选、synthetic fixtures、mock props 和静态渲染测试。它不是 Production 功能、不是正式发布说明，也不代表项目验收完成。该组件未接入 Production ledger。

## 设计原则

- **成熟克制**：采用 macOS 风格排版（SF Pro 字体族、圆角卡片、浅灰背景），不使用像素风或幼稚视觉；
- **名称保留**：页面中明确展示"收入""日常支出""账户现金""资产""债务""安全储备""资产更新""债务确认"等必需名称；
- **不重复计入**：信用卡还款仅展示为待还压力状态，不与"日常支出"合并展示；
- **可访问性**：使用语义化标题层级（h1 > h2 > h3）、`aria-label`、`role="status"`；
- **动效降级**：支持 `prefers-reduced-motion: reduce` 媒体查询和显式 `reducedMotion` prop。

## 依赖边界（只读衔接）

| 依赖 | 引用方式 | 约束 |
|---|---|---|
| L-04 (`v2-cashflow.ts`) | `import type { BillStatus }` | 仅类型引用，通过 mock props 传入 |
| L-05 (`v2-savings-goal.ts`) | `import type { SavingsPlan, AffordableSavingsResult }` | 仅类型引用，通过 mock props 传入 |
| U-04 (`v2-trends.tsx`) | `import { TrendPanel }` + `import type { TrendSummary, TrendWindow }` | 只读引用已 REVIEWED 的隔离组件 |

U-03 不修改上述任何文件，不在运行时调用 L-04/L-05 的计算函数（所有数据由 props 传入）。

## Synthetic / Mock 说明

专项测试中所有数据均为手工构造的 mock props，包括：
- 合成账单状态（UPCOMING/NONE/OVERDUE）；
- 合成储蓄计划（ON_TRACK/COMPLETED/SHORTFALL/OVERDUE）；
- 合成趋势摘要；
- 零值、超大金额边界测试。

没有连接真实数据库、支付平台或外部 API。

## 验证覆盖

- 正常渲染与必需名称存在性；
- 空态（无账单、无目标、无趋势）；
- 零值与超大金额不出现 NaN/Infinity；
- 四种现金压力状态徽章；
- 四种储蓄状态徽章；
- 可负担性信息展示；
- U-04 TrendPanel 集成；
- reduced-motion class 应用；
- 不重复计入声明验证。

## 边界

- 不连接真实银行账户或支付平台；
- 不写入 Production App/DB；
- 不修改 Financial Model V1.0；
- 不代表产品发布或审核通过；
- 不启动 U-01。
