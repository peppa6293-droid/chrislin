# 小钱家 V2｜GPT-6 Luna 执行总提示词

版本：`V2.1`
日期：2026-10-15（Asia/Shanghai）
执行模型：`GPT-6 Luna`，中等思考
执行角色：唯一实现负责人
最终验收角色：Codex
业务 Owner：用户

## 0. 你要怎么使用这份提示词

这不是让你只写一份计划，而是让你在指定工作区内完成实际代码实现、构建、自测和候选交付。

执行顺序必须是：

`P0 只读审计 → P1 UI 壳层 → P2 今天与记账 → P3 进展/我的 → P4 跨平台准备 → P5 候选交付`

每个阶段完成后暂停，输出阶段回报，等待下一阶段提示词或 Owner 明确继续。不要把全部阶段合并为一次不可检查的大改动。

最终实现完成后，把候选交给 Codex 审计。你的报告只能写技术事实，不能自行宣布业务接受、App Store 上架或最终完成。

## 1. 工作区和参考资料

工作区：

`/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2`

进入工作区后，所有相对路径均以该目录为基准。

必须读取：

1. `docs/XIAOQIANJIA_PRODUCT_DESIGN_V2.md`
2. `docs/PRODUCT_SPEC.md`
3. `docs/FINANCIAL_MODEL_SPEC.md`
4. `docs/DATA_CONTRACT.md`
5. `docs/ACCEPTANCE_CRITERIA.md`
6. `docs/XIAOQIANJIA_FINAL_AUDIT_CHECKLIST.md`
7. `PROJECT-STATE.md`
8. `package.json`
9. `src/ui/App.tsx`
10. `src/ui/HomeScreen.tsx`
11. `src/ui/MyFinancePages.tsx`
12. `src/application/`
13. `src/model/`
14. `src/persistence/`
15. `src/runtime/`
16. `src-tauri/`

已确认的设计原型：

- 原型目录：`/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2/prototype-v2/`
- 原型入口：`prototype-v2/index.html`
- 原型逻辑：`prototype-v2/main.tsx`
- 原型样式：`prototype-v2/styles.css`
- 视觉参考截图：`prototype-v2/references/xiaoqianjia-v2-approved-reference.png`
- 本地原型预览地址：`http://127.0.0.1:1421/`

视觉参考截图是 Owner 已确认方向的参考，不是可以直接复制的截图，也不是允许用静态图片覆盖真实功能的授权。

## 2. 当前 Owner 已确认的设计方向

最终方向不是儿童游戏，也不是传统金融后台。

方向是：

**Apple 原生、克制、干净、精致；交互反馈丝滑、有生命力。**

实现原则：

- 视觉上接近 Apple 原生应用：留白、清晰层级、系统字体、克制颜色、轻边框、细腻阴影、底部 sheet、sidebar、稳定的触控区域。
- 交互上允许有生动反馈，但生动感来自“动作的结果”，不是持续飘动和游戏化装饰。
- 不复制 Duolingo 的品牌、角色、图形、音效、文案或页面结构。
- 只借鉴它的“一个小步骤、即时反馈、连续完成感”。
- 重要按钮和整块内容都要容易点击；不要强迫用户点击一个很小的箭头才能进入详情。

## 3. 已确认的原型结构

### 3.1 四个主入口

主导航固定为四个目的地：

1. `今天`
2. `记录`
3. `进展`
4. `我的`

macOS：左侧 sidebar。

iPhone：底部 Tab Bar，必须处理 safe area。

同一个导航结构不能在桌面和移动端重复渲染两套可访问按钮。响应式切换必须保持单一语义导航，避免辅助技术看到重复入口。

### 3.2 今天页

从上到下：

1. 品牌、当前月份、设置图标、顶部 `记一笔`。
2. 欢迎区域：当前日期、用户称呼、简短趋势状态。
3. 今日任务：只显示一个任务和一个主要 CTA。
4. `照顾路径`：
   - 看清消费
   - 稳住现金
   - 理清责任
   - 建立余地
5. 最近消费记录。

四个路径板块必须整块可点击。箭头只能作为视觉提示，不得是唯一点击目标。

整卡点击要求：

- 点击卡片标题、图标、金额、说明文字或空白区域，都进入同一详情。
- 点击后有轻微 pressed 状态。
- 可访问名称清楚，例如 `查看本月可变消费详情`。
- 不在卡片内部嵌套另一个会抢焦点的重复按钮；如保留箭头，使用非交互元素。

### 3.3 记录页

快速记账目标：3–5 秒完成。

顺序：

1. 金额自动聚焦。
2. 使用数字键盘 / `inputMode="decimal"`。
3. 分类为可选：餐饮、交通、购物、娱乐、日用、其他。
4. 备注可选。
5. 保存后回到原上下文。

### 3.4 进展页

展示四个路径节点，不做 0–100 健康分，不把不同单位相加。

### 3.5 我的页

使用原生风格分组列表：

- 收入
- 现金
- 资产
- 债务
- 安全目标
- 数据与隐私

设计原型中的“本地优先”说明只代表设计方向。正式实现必须以真实 SQLite 状态为准。

## 4. 动效与交互反馈规范

动效要短、准、可解释。默认 150–350ms，必要时最多 1000ms；禁止循环大动画。

### 4.1 通用点击

- 鼠标 hover：颜色或阴影轻微变化。
- 鼠标按下 / 触控按下：`scale(.985)` 或轻微位移。
- 页面切换：淡入 + 轻微上移，不超过 280ms。
- 关闭弹窗：反向淡出，不阻断操作。

### 4.2 记账保存

保存成功后：

- 金额变化使用短促数字过渡或轻微强调，不跳动布局。
- 新记录从列表顶部淡入/上移进入。
- 显示轻量状态反馈，例如“已记入本月消费”。
- 不播放声音。
- 不出现强制庆祝弹窗。
- 保存失败保留输入，显示错误，禁止显示成功。

### 4.3 现金更新

在真实现金保存成功并完成 readback 后，允许显示一次性的“现金进入安全储备”动效：

- 2–3 个金币/圆形金额标记向现金或安全储备节点移动。
- 动画必须和真实保存成功绑定，不能在点击保存前播放。
- 动画结束后只保留更新后的真实数字。
- 如果保存失败或回读失败，不播放成功动效。

### 4.4 债务更新

在真实债务保存成功并完成 readback 后，允许显示一张简洁的负债卡片进入“理清责任”区域：

- 卡片内容必须来自用户刚保存的债务事实。
- 不能使用随机金额或演示数据替代真实回读。
- 不能将“本月待确认”动画成“已确认”。
- 待确认、保存中、保存失败、已确认必须有清楚文字状态。

### 4.5 减少动效

必须支持 `prefers-reduced-motion: reduce`：

- 禁止金币移动、卡片飞入和缩放过渡；
- 保留即时静态结果和文字反馈；
- 不影响保存和导航功能。

## 5. 财务业务逻辑不可改写

以下内容只能复用现有服务、模型和 SQLite；不要在 UI 里重新计算或重新发明规则：

- Financial Model V1.0 公式和状态语义。
- Facts、parameters、derived results 分离。
- Planning Income 和 Actual Income 分离。
- 当前月债务事实缺失显示待确认，禁止沿用上月值冒充当前值。
- `NO_CORE_OBLIGATION` 不显示 NaN、Infinity 或虚假覆盖。
- `STRUCTURAL_DEFICIT` 与 `BALANCED_NO_SURPLUS` 必须区分。
- 安全资源只使用符合资格的数据。
- 用户本地 `business_date` 与 instant timestamp 分开保存。
- 金额精度、范围、科学记数法和聚合/派生边界遵守 `docs/DATA_CONTRACT.md`。

## 6. 平台要求

### macOS

- 侧栏导航稳定。
- 窗口至少支持 640×420。
- 800×600、1024×768、1280×800 不重叠、不横向溢出。
- 顶部 `记一笔` 始终易于找到。
- 键盘焦点和 Escape 关闭可用。

### iPhone

- 375×812、390×844、430×932 无溢出。
- 底部 Tab 处理 safe area。
- 触控目标接近 44×44px。
- 记账 sheet 不被键盘遮挡。
- 数字输入使用数字键盘。

## 7. 重要实现边界

- 默认继续使用现有 Tauri 2 + React + Rust/SQLite。
- 不把原型的内存数据带进正式产品。
- 不使用 localStorage 保存财务事实。
- 不删除旧迁移、Production 路径或历史验收证据。
- 不改变正式 Bundle ID：`com.personalfinance.console`。
- 不启动、替换、迁移或写入 Production App、Production SQLite、`/Applications`。
- 不把 WP-03 preview identity 带入正式 Release。
- 不把“测试日期”控件带入正式 Release。
- 不覆盖现有未提交修改；修改前先读取 diff。
- 不删除失败证据，不通过删除测试来获得绿色结果。

## 8. 阶段执行提示词

### P0：只读审计

```text
你是 GPT-6 Luna，中等思考，负责实现小钱家 V2。

工作目录：
/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2

现在只做只读审计，不修改文件。

必须读取：
- docs/XIAOQIANJIA_PRODUCT_DESIGN_V2.md
- docs/PRODUCT_SPEC.md
- docs/FINANCIAL_MODEL_SPEC.md
- docs/DATA_CONTRACT.md
- docs/ACCEPTANCE_CRITERIA.md
- docs/XIAOQIANJIA_FINAL_AUDIT_CHECKLIST.md
- PROJECT-STATE.md
- package.json
- prototype-v2/index.html
- prototype-v2/main.tsx
- prototype-v2/styles.css
- prototype-v2/references/xiaoqianjia-v2-approved-reference.png
- src/ui/App.tsx
- src/ui/HomeScreen.tsx
- src/ui/MyFinancePages.tsx
- src/application/
- src/model/
- src/persistence/
- src/runtime/
- src-tauri/

必须实际输出：
1. 当前代码入口和真实路由图；
2. 原型与正式代码的差异；
3. 可复用的业务服务和数据契约；
4. 当前未提交修改完整清单；
5. Tauri/macOS/iOS 现状和风险；
6. WP-03、preview、debug、test-only、fixture 引用点；
7. 逐文件 P1-P5 实施计划；
8. 每阶段验证命令和停止条件；
9. 已验证事实、假设、未知分别列出。

硬边界：只读；不接触 Production；不改 Financial Model；不修改任何文件；不凭历史结果宣称当前通过。

只输出 P0 报告并停止。
```

### P1：实现 Apple 风格跨平台壳层

```text
基于 P0 的真实报告，开始实现 V2 壳层。

视觉基线：
- prototype-v2/ 是 Owner 已确认的框架基线；
- prototype-v2/references/xiaoqianjia-v2-approved-reference.png 是参考截图；
- Apple 原生、克制、干净、精致；动效只在操作结果发生时出现。

实现：
1. 复用现有 React/Tauri 入口和业务服务；
2. macOS sidebar，iPhone bottom tabs；
3. 单一语义导航，不能同时渲染一套桌面导航和一套重复移动导航；
4. 首页、记录、进展、我的四个目的地；
5. 整块路径卡片可点击，箭头不作为唯一按钮；
6. 页面不允许横向溢出、文字竖排、内容挤压或绝对定位漂移；
7. 不使用背景渐变、装饰性大插画、bokeh、持续动画；
8. 支持 reduced motion、键盘焦点和 VoiceOver 名称。

必须实际检查：
- macOS 800x600、1024x768、1280x800；
- iPhone 375x812、390x844、430x932；
- 页面截图、DOM 几何和横向溢出检查。

不要把 P1 写成产品完成。输出实际修改文件、截图路径、命令、失败和未确认项。
```

### P2：实现今天、记录和反馈动效

```text
实现今天页和快速记账，不改财务模型。

今天页：
- 一个今日任务；
- 一个主要 CTA；
- 四个照顾路径；
- 最近三笔真实记录。

交互：
- 整张路径卡片点击进入详情；
- 点击不依赖小箭头；
- 金额输入自动聚焦；
- 分类、备注、business_date、timestamp 保持真实语义；
- 保存前不播放成功动画；
- 保存、重新读取、确认结果后再播放反馈。

动效：
- 消费保存：新记录进入顶部 + 数字短暂强调；
- 现金保存：金币进入现金/安全储备节点；
- 债务保存：真实债务卡片进入责任节点；
- reduced motion 下全部退化为静态结果。

每项真实写入必须报告：保存前状态、保存信号、保存后重新读取状态、动画触发条件、失败结果。
```

### P3：实现进展和我的财务

```text
把进展和我的财务接到真实服务。

进展：
- 看清消费；稳住现金；理清责任；建立余地；
- 每个节点整行可点击；
- 当前值、方向、解释来自真实 Home/Model 输出；
- 不新增健康分、不跨单位求和。

我的财务：
- 收入、现金、资产、债务、安全目标、数据与隐私；
- 编辑后保存、重新读取、刷新相关页面；
- 历史和停用记录可追溯；
- 待确认债务不能显示为已确认。

覆盖边界：
- NO_CORE_OBLIGATION；
- STRUCTURAL_DEFICIT；
- BALANCED_NO_SURPLUS；
- 失败保存、空态、加载态、错误态；
- 正常退出和重开。
```

### P4：跨平台构建准备

```text
开始 macOS/iOS 构建准备，但不声称已经上架。

必须先确认：
- 当前 Tauri 是否已有 iOS target/project/scheme；
- Rust/SQLite 依赖是否能为 iOS 编译；
- iOS 本地数据路径、迁移、App Group 和权限；
- Preview/WP-03/debug feature 不会进入 release。

必须输出：
- macOS 构建结果；
- iOS Simulator 构建结果；
- 真机条件和缺失条件；
- 签名、Team、Bundle ID、Provisioning Profile 状态；
- BLOCKED_EXTERNAL_ACCOUNT 项。

禁止访问 Production、禁止写 /Applications、禁止覆盖正式 identity。
```

### P5：候选交付

```text
执行交付前自验并停止在候选状态。

必须覆盖：
- onboarding；
- 今天主循环；
- 整卡点击详情；
- 快速记账；
- 现金/债务/安全/消费反馈动效；
- 保存后回读；
- 退出重开；
- macOS 四个窗口尺寸；
- iPhone 三个尺寸；
- reduced motion；
- 错误、空态、加载、待确认；
- release 没有 debug/test-only 控件。

输出 READY_FOR_EXTERNAL_AUDIT 或 PARTIAL/BLOCKED。
不要输出 COMPLETED，不要声称 App Store 已上架。
```

## 9. 每阶段回报格式

```text
阶段：P?
状态：PASS / PARTIAL / BLOCKED
实际修改对象：
未修改对象：
设计基线核对：
真实行为：
保存前状态：
保存信号：
保存后 readback：
验证命令及结果：
截图/DOM/日志证据：
未确认项：
失败项和停止原因：
下一阶段入口：
```

## 10. 必须交付给 Codex 的文件

### 代码交付

- 所有实际修改的源码文件；
- 新增组件、样式、资源和测试；
- 不允许只交截图或静态 HTML 代替正式代码。

### 设计交付

- `docs/XIAOQIANJIA_PRODUCT_DESIGN_V2.md` 如有调整，必须说明差异；
- 视觉 token 和动效说明；
- 页面/路由清单；
- 状态矩阵：正常、空态、加载、错误、待确认、保存中、保存成功、保存失败、reduced motion。

### 工程交付

- 源码 commit 或明确工作区状态；
- `package.json` 实际运行命令；
- typecheck/lint/test/build 结果；
- macOS candidate 输出路径；
- iOS Simulator 输出路径或阻断原因；
- Bundle ID、签名和候选 manifest；
- 数据库迁移和 integrity/FK 结果。

### 视觉证据

至少保存这些截图：

- macOS 800×600 首页；
- macOS 1280×800 首页；
- iPhone 390×844 首页；
- iPhone 390×844 记录 sheet；
- iPhone 390×844 进展页；
- macOS 1280×800 现金加入动画；
- macOS 1280×800 债务卡片加入动画；
- reduced-motion 静态反馈；
- 空态、错误态、待确认债务态。

截图要求：

- 使用真实渲染页面；
- 不能用设计软件拼图替代；
- 同一候选源码和同一构建身份；
- 截图期间候选不得漂移；
- 每张截图写明路径、视口尺寸、状态和来源。

## 11. 验收交接词

GPT-6 Luna 完成后，把以下内容发送给 Codex：

```text
LUNA_HANDOFF_READY

候选源码 commit：
工作区状态：
macOS candidate：
iOS Simulator candidate：

已完成阶段：
自动验证：
真实 UI 验证：
保存后 readback：
动效触发证据：
截图目录：
未完成项：
BLOCKED 项：
已知风险：

我没有声称：
- Owner 业务接受；
- Production 已迁移；
- App Store 已上架；
- iOS 真机已验证（如果没有真实设备证据）。
```

收到 `LUNA_HANDOFF_READY` 后停止改动，等待 Codex 审计。不要继续自行扩展范围。

## 12. Codex 最终验收原则

GPT-6 Luna 的执行报告只是候选交付，不是最终验收。

Codex 会独立检查：

- 候选身份、源码 commit、manifest 和 hash；
- 截图对应的实际候选；
- 页面几何是否重叠、裁切、竖排或横向溢出；
- 整卡点击和可访问名称；
- 财务写入是否保存后回读；
- 动效是否绑定真实保存成功；
- 模型边界是否保持；
- macOS/iOS 证据是否真实；
- Production、正式身份和发布授权是否被越权触碰。

Codex 结论只允许使用：

`COMPLETED / READY_FOR_REVIEW / PARTIAL / BLOCKED / CANDIDATE_DRIFT`

不能把“GPT-6 Luna 说完成”当成最终完成。
