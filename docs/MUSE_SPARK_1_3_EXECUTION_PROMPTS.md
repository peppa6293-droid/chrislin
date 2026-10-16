# meta/muse-spark-1.3 执行提示词方案

用途：把 `docs/XIAOQIANJIA_PRODUCT_DESIGN_V2.md` 交给实现模型执行。

执行原则：分阶段、单一写入者、每阶段保存并回读。Muse 的“代码完成”不等于本项目的最终验收；最终审计由 Codex 依据 `docs/XIAOQIANJIA_FINAL_AUDIT_CHECKLIST.md` 执行。

## 使用顺序

按 `P0 → P1 → P2 → P3 → P4 → P5` 顺序执行。每个阶段结束先停下来输出证据，再进入下一阶段。不要把六个提示词拼成一次无检查的长任务。

- `P0` 仓库审计与实施计划
- `P1` 跨平台壳层和视觉系统
- `P2` 今日主循环与快速记账
- `P3` 进展路径、我的财务和状态处理
- `P4` macOS/iOS 构建准备
- `P5` 自验、修复和交付候选

## P0：仓库审计与实施计划

```text
你是 meta/muse-spark-1.3，负责实现小钱家 V2。先不要修改任何文件。

工作目录：
/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2

必读：
1. docs/XIAOQIANJIA_PRODUCT_DESIGN_V2.md
2. docs/PRODUCT_SPEC.md
3. docs/FINANCIAL_MODEL_SPEC.md
4. docs/DATA_CONTRACT.md
5. docs/ACCEPTANCE_CRITERIA.md
6. PROJECT-STATE.md
7. package.json
8. src/ui/App.tsx、src/ui/HomeScreen.tsx、src/ui/MyFinancePages.tsx、src/style.css
9. src/application、src/model、src/persistence、src/runtime 和 src-tauri 的入口

先输出一份审计报告，必须包含：
- 当前 UI 入口和路由图；
- 可复用的业务服务和数据契约；
- 现有未提交修改清单；这些修改不是你的权限范围，不能覆盖或回退；
- 当前 Tauri/macOS 入口和 iOS 可行性风险；
- 会影响正式发布的测试控件、WP-03 identity、调试入口和测试夹具；
- 分 P1-P5 的文件级实现计划；
- 每阶段的回归命令、真实 UI 检查和停止条件。

硬性边界：
- 不访问、替换、迁移或删除 Production App、Production SQLite、/Applications 内容；
- 不修改 Financial Model V1.0 公式；
- 不把用户数字硬编码为默认值；
- 不覆盖现有未提交修改；
- 不在报告中把历史测试结果写成当前通过；
- 发现缺口时保留 UNKNOWN/BLOCKED，不用猜测补齐。

只输出审计和计划，等待下一阶段提示词。
```

## P1：跨平台壳层和视觉系统

```text
基于已完成的 P0 审计，开始实现小钱家 V2 的跨平台 UI 壳层和视觉系统。

严格遵守：
- 以 docs/XIAOQIANJIA_PRODUCT_DESIGN_V2.md 为唯一视觉方向；
- 复用现有 service/repository/model，不重写财务规则；
- 保留已有未提交修改，先对受影响文件做 diff，再决定如何合并；
- 不保留测试日期控件、“测试版”标题、WP-03 预览身份或 debug-only UI 到正式组件；
- 使用 lucide-react 处理通用图标；品牌角色使用明确的独立 asset/component，不用 CSS 拼脸作为最终资产；
- 不使用背景渐变、发光球、bokeh、复杂 dashboard 卡片嵌套或大段产品说明文字。

实现范围：
1. responsive app shell；
2. iPhone safe-area + 四个 bottom tabs；
3. macOS sidebar + 可缩放窗口布局；
4. 设计 token、字体、颜色、按钮、输入、sheet、toast、进度路径、状态标签；
5. loading、empty、error、offline/local-only、reduced-motion 状态；
6. 让旧页面可以在新壳层下逐步迁移，不要一次删除所有业务入口。

尺寸验收：
- iPhone 390x844、375x812、430x932；
- macOS 1280x800、1024x768、800x600；
- 不允许文字、金额、按钮、底部 Tab、sidebar 重叠或横向溢出；
- 金额使用稳定宽度，刷新不能造成布局跳动。

本阶段完成后执行 typecheck、lint、现有产品测试和 web build，并保存：
- 修改文件清单；
- 关键截图或 UI readback；
- 命令和结果；
- 尚未迁移的页面；
- 任何 BLOCKED 项。
不要把 P1 的 UI 通过写成业务验收通过。
```

## P2：今日主循环与快速记账

```text
实现小钱家 V2 的核心循环：今天 → 一个小任务 → 记录/确认 → 立即反馈。

页面要求：
- 今天页只能有一个主任务卡和一个主 CTA；
- 首屏 3 秒内能找到“记一笔”；
- 首页依次显示今日任务、即时结果、本月进度路径、最近三笔；
- 不显示五个并列任务；奖励/连续记录只作为轻量次级信息；
- 无明确问题时不制造焦虑，不新增未经批准的心理或财务建议。

快速记账要求：
- 金额自动聚焦；iPhone 使用数字键盘；
- 类别可选：餐饮、交通、购物、娱乐、日用、其他；
- 备注可选；日期/时间自动生成；保留 business_date；
- 保存目标 3–5 秒；
- 保存成功必须重新读取并刷新当前首页；
- 保存失败保留用户输入并显示错误，不显示成功 toast；
- 最近记录显示真实持久化结果，不显示本地假数据。

任务选择只能使用现有确定性 model output：
- RESTORE_CORE_BALANCE；
- REBUILD_CASH_FLOOR；
- ADDRESS_PRIMARY_DRAG；
- ADDRESS_SAFETY_GAP；
- NO_ACTION。

不要在 UI 层重新发明阈值、健康分、AI 建议或跨指标排序。

完成后执行：typecheck、lint、产品测试、UI 测试、web build，并对 iPhone 尺寸和 macOS 尺寸做真实渲染检查。报告必须给出保存前值、保存信号、保存后重新读取的值和失败项。
```

## P3：进展路径、我的财务和状态处理

```text
把剩余财务能力迁移到新的信息架构，不要回退到旧控制台。

进展页：
- 看清消费、稳住现金、理清责任、建立余地四个节点；
- 显示当前值、方向、短解释；
- 不显示 0–100 健康分；
- 不把不同单位的值相加或加权；
- 目标未达不使用羞辱性失败视觉。

我的页：
- 收入、现金、资产、债务、安全目标、数据与隐私；
- 事实、参数、derived result 分离；
- 编辑后保存、重新读取、刷新相关页面；
- 历史和停用记录保持可追溯；
- 当前月债务事实缺失必须显示待确认，不能沿用上月金额伪装当前状态。

边界回归：
- NO_CORE_OBLIGATION：覆盖为空，不出现 NaN/Infinity；
- STRUCTURAL_DEFICIT 与 BALANCED_NO_SURPLUS 分开；
- planning income 与 actual income 分开；
- 安全资源资格按数据字段判断；
- 用户本地 business_date 按本地月份聚合；
- 货币精度和输入校验遵守 DATA_CONTRACT。

所有空态、加载态、错误态、待确认态都必须有可执行的下一步。不要用“数据暂无”把用户带进死路。
```

## P4：macOS/iOS 构建准备

```text
在功能和 UI 已自验后，开始跨平台构建准备。默认沿用 Tauri 2 + React + Rust/SQLite，共享业务核心，不复制两套规则。

先做可行性检查，再改配置：
1. 确认 Tauri 版本、Rust target、iOS project、Xcode scheme；
2. 确认 SQLite/Rust 依赖可以为 iOS 编译；
3. 确认 app data 路径、迁移、bundle identifier、App Group 和权限；
4. 确认 macOS window/sidebar 与 iOS safe-area/bottom-tab 分别可用；
5. 确认所有 Preview/WP-03/test-only feature 不会进入 release configuration。

必须生成并验证：
- macOS debug/release 构建；
- iOS Simulator 构建；
- 能在模拟器启动、完成 onboarding、记一笔、退出重开并读回；
- macOS 启动、完成同一条流程并读回；
- 迁移前后数据库 integrity/FK 检查；
- 代码签名预检和 archive 说明。

不要伪造 App Store 已准备。若缺 Apple Developer team、签名、Bundle ID 或 App Store Connect 权限，明确标记 BLOCKED_EXTERNAL_ACCOUNT，并继续完成可在本地完成的工程准备。

禁止：
- 写入 /Applications；
- 覆盖正式 bundle identifier；
- 访问或迁移 Production 数据库；
- 删除旧候选和验收证据；
- 用网页预览代替 iOS native build 证据。
```

## P5：自验、修复和候选交付

```text
现在执行交付前自验。不要只运行单元测试；按真实用户路径逐项回读。

必须覆盖：
1. 全新空数据 onboarding；
2. 今天页找到任务；
3. 快速记一笔并确认首页/记录页更新；
4. 进展路径四个节点进入详情；
5. 修改收入、现金、资产、债务、安全目标；
6. 债务当前月事实缺失、逐笔确认隔离；
7. NO_CORE_OBLIGATION、STRUCTURAL_DEFICIT、BALANCED_NO_SURPLUS；
8. 正常退出、重开、数据库 integrity 和完整 readback；
9. iPhone 390x844/375x812/430x932；
10. macOS 1280x800/1024x768/800x600；
11. reduced motion、键盘焦点、VoiceOver/可访问名称；
12. release 配置没有 debug/test controls。

每项报告：目标、实际对象、操作、保存信号、重新读取结果、截图/日志路径、结论（PASS/PARTIAL/FAIL/UNKNOWN/BLOCKED）。

只有在没有遗漏失败项时才报告 READY_FOR_EXTERNAL_AUDIT。否则报告 PARTIAL 或 BLOCKED，并保留可恢复入口。
```

## Muse 每阶段固定回报模板

```text
阶段：P?
状态：PASS / PARTIAL / BLOCKED
实际修改对象：
未修改对象：
已验证行为：
验证命令及结果：
真实 UI / native build 证据：
保存后 readback：
未确认项：
失败项和停止原因：
下一阶段入口：
```

## 交给 Muse 的禁止事项

- 不要把“看起来像多邻国”当作完成标准。
- 不要为了视觉重做而改业务模型、迁移或身份。
- 不要把模拟数据、假成功 toast、localStorage 财务数据或静态 HTML 预览写成真实功能。
- 不要删除现有测试来让测试通过。
- 不要覆盖用户未提交修改。
- 不要把 macOS 构建通过写成 iOS 可用。
- 不要把 iOS Simulator 启动写成 App Store 已上架。
- 不要在没有 readback 的情况下报告保存成功。
