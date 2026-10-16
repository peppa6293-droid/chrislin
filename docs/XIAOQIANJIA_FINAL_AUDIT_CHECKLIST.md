# 小钱家 V2 最终审计与验收清单

审计人：Codex
适用对象：Muse 完成后的同一源码、同一构建配置、同一候选包
目标：macOS + iOS 可用，并达到 App Store 发布准备；不把计划、模拟、静态预览或单平台成功升级为最终完成。

## 0. 审计前置

- [ ] 明确本次候选的源码 commit、工作区状态、构建配置、Bundle ID 和输出路径。
- [ ] 检查是否有未授权的 Production App/DB、`/Applications`、正式身份或迁移操作。
- [ ] 检查 WP-03、preview、test-only、debug 控件是否被误带入候选。
- [ ] 保存候选 manifest、关键文件 hash 和构建日志；之后只对同一候选审计。
- [ ] 若候选在审计期间发生变化，停止并标记 `CANDIDATE_DRIFT`。

## 1. 产品与视觉验收

### 首屏层级

- [ ] iPhone 390x844 首屏 3 秒内能找到“记一笔”。
- [ ] macOS 1280x800 首屏能同时理解当前状态、今日任务和下一步。
- [ ] 首页只有一个主任务和一个主 CTA。
- [ ] 不再同时显示五个任务、四个同权重 dashboard 卡片和遗留维护入口。
- [ ] 页面不会因金额、长标题、空态或错误态发生重排/重叠。

### 视觉系统

- [ ] 多邻国式原则被使用，但没有复制第三方品牌资产、角色或文案。
- [ ] 颜色不是单一绿色/米色模板；状态有文字或图标辅助。
- [ ] 没有背景渐变、发光球、bokeh、大面积装饰性动画。
- [ ] 通用图标来自现有 icon library；纯图标按钮有 aria-label/tooltip。
- [ ] 角色只作为轻量陪伴，不遮挡财务信息，也不在每个模块重复出现。
- [ ] 支持 `prefers-reduced-motion`。
- [ ] 金额和中文在小屏、宽屏、极端值下都可读。

## 2. 真实功能链

- [ ] 空数据库 onboarding 完成，输入在每一步可返回且不丢失。
- [ ] 快速记账从金额自动聚焦开始，在 3–5 秒内完成。
- [ ] 类别、备注、business_date、timestamp 语义正确。
- [ ] 保存成功后首页和记录页显示重新读取的真实数据。
- [ ] 保存失败不显示成功，输入可恢复。
- [ ] 收入、现金、资产、债务、安全目标编辑后保存并回读。
- [ ] 债务本月事实缺失时显示待确认；确认一笔不会自动确认其他债务。
- [ ] 正常退出和同一候选重开后，页面和数据库状态保持一致。

## 3. 模型不变量

- [ ] Financial Model V1.0 公式未被 UI 重写。
- [ ] Facts、parameters、derived results 可区分。
- [ ] Planning Income 与 Actual Income 可区分。
- [ ] `NO_CORE_OBLIGATION` 不产生 NaN、Infinity、虚假覆盖或现金警报。
- [ ] `STRUCTURAL_DEFICIT` 与 `BALANCED_NO_SURPLUS` 行为正确且不同。
- [ ] 安全资源只使用符合资格的数据。
- [ ] 投资资产价值变化不会单独伪造流动性安全改善。
- [ ] 任务选择只映射现有 action code，不新增未经批准的阈值或综合健康分。
- [ ] 用户输入金额精度、范围、科学记数法和聚合/派生值边界符合 `docs/DATA_CONTRACT.md`。

## 4. macOS 验收

- [ ] release 构建成功，包身份与候选记录一致。
- [ ] 640x420 最小窗口可用；800x600、1024x768、1280x800 无溢出。
- [ ] sidebar、键盘焦点、快捷入口、关闭/重开行为正常。
- [ ] 本地 SQLite 路径、迁移、integrity、foreign key、关闭态句柄已回读。
- [ ] 代码签名在签名后没有再修改 bundle。
- [ ] 测试版标题、预览日期、模拟夹具和 debug 日志不进入 release UI。

## 5. iOS 验收

- [ ] iOS target/scheme 可由 Xcode 或项目指定命令构建。
- [ ] iPhone 375x812、390x844、430x932 均无 safe-area、底部 Tab、键盘或 sheet 问题。
- [ ] 快速记账使用数字键盘，点击区域至少适合触控，返回/取消不丢输入。
- [ ] 冷启动、后台恢复、正常退出/重开后的本地数据一致。
- [ ] iOS SQLite/迁移路径不是网页 localStorage 伪实现。
- [ ] VoiceOver 能读到主任务、金额、状态、进度和操作名称。
- [ ] 真机验证与 Simulator 验证分开记录；只有 Simulator 不足以标记 iOS 可用。

## 6. App Store 准备

这些项目需要外部 Apple 账号/签名条件，缺失时必须标记 `BLOCKED_EXTERNAL_ACCOUNT`，不得猜测已完成：

- [ ] 生产 Bundle ID、Team、证书、Provisioning Profile 已确认。
- [ ] Release archive 成功。
- [ ] 签名、entitlements、隐私权限说明与实际行为一致。
- [ ] App icon、启动图、名称、分类、版本号和隐私政策 URL 已准备。
- [ ] 无测试 identity、预览数据库、调试控件、未声明网络/隐私行为。
- [ ] TestFlight 安装包可在至少一台真实 iPhone 安装并完成关键链路。
- [ ] App Store Connect metadata、截图、审核说明、支持 URL 已由 Owner 提供/确认。
- [ ] 最终上传由有权限的 Owner 执行；Codex 不把“archive 成功”写成“已上架”。

## 7. 结论规则

- `COMPLETED`：功能、同一候选保存回读、macOS、iOS 真机/模拟器和发布准备项均有证据，没有遗漏失败项。
- `READY_FOR_REVIEW`：技术验收通过，但仍等待 Owner/Apple 外部审核或业务接受。
- `PARTIAL`：部分链路通过，仍有未完成验收或未覆盖页面。
- `BLOCKED`：外部账号、构建链、身份、签名、数据边界或关键行为阻断。
- `CANDIDATE_DRIFT`：审计对象在过程中变化，所有后续结论作废，需重新冻结。

不能使用以下替代结论：

- “看起来更像多邻国” = 视觉验收通过；
- “npm test 通过” = 产品完成；
- “macOS .app 存在” = macOS 可用；
- “iOS Simulator 能启动” = iOS 真机可用；
- “archive 成功” = 已上架 App Store；
- “Muse 说完成” = Codex 已验收。

## 8. 审计报告最小格式

```text
候选身份：
源码 commit：
macOS 包：
iOS 构建/真机对象：

已验证事实：
技术结论：
业务接受：PENDING / ACCEPTED / UNKNOWN
App Store 外部状态：READY / BLOCKED_EXTERNAL_ACCOUNT / UNKNOWN

P0/P1/P2 问题：
未覆盖项：
证据路径：
最终状态：COMPLETED / READY_FOR_REVIEW / PARTIAL / BLOCKED / CANDIDATE_DRIFT
下一责任人：
```
