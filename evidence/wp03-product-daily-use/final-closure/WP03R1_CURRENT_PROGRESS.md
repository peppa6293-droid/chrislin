# WP-03R1 当前进度

日期：2026-10-12  
最终状态：`WP03_PRODUCT_DAILY_USE_REGRESSION_FAILED`

## 已完成

- 最终源码已固定在 commit `112191eebbe4cf3c62f942f034064237ee92514a`，runtime source 无未提交修改。
- FinderInfo 根因已定位：CloudDocs 对 `.app` 根目录异步附加 FinderInfo；切换到 APFS sparse image 挂载的构建输出后，签名成功。历史 build-02/build-03 失败记录保留。
- 从最终源码构建了唯一用于本轮验收的 WP-03 包：`artifacts/wp03-isolated-product-preview-20261012/final-build/cargo-target/release/bundle/macos/小钱家 WP-03 测试版.app`。Bundle ID `com.personalfinance.console.wp03preview`；executable SHA-256 `7791d20845abbba2d33cfa60feb3a135cc98a3b9b4524a74bd8620b2f374f8d3`；strict codesign PASS。
- 自动回归通过：typecheck、lint、17 个文件 / 295 个 product tests、WP-03 packaging tests、37 个 Rust tests、web build。Lint 有 25 条 CSS specificity warnings。
- 最终包真实 UI 已验证稳定月收入修改及 revision history、本月 override 保存和 Home 刷新；正常退出后使用同一个 app 重启，Home 仍显示 ¥12,000 的本月计划。
- 最终 WP-03 DB 关闭态回读：schema v4、migrations 1–4、完整性 `ok`、外键检查空、无打开句柄或 SQLite sidecar。摘要见 `db-readback/final-r2-closed-state.txt`。

## 尚未完成 / 未确认

- A–M 完整真实 UI 流程未完成；此前其他候选包的操作没有拼接为最终包验收。
- 最终包尚未完成 Actual Income、expense、cash/assets 生命周期、债务完整边界和 Safety Targets 全场景。
- 当前 UI 不能在不改系统日期、不直写 DB、不调用内部 service 的情况下完成新月份缺债务事实待确认及单笔确认隔离验收；该要求仍是未验证项。
- Financial Model V1.0、WP-02 和 Production 未触碰。

## 下一步

需要继续用最终包补齐其余 A–M UI 场景，并找到符合正常产品流程的方式验证新月份债务事实。如果产品当前没有对应普通 UI，则应先由 Owner 决定产品验收范围或批准产品实现变更；在该项及完整 A–M 通过前，不应将状态改为 READY。

完整报告：[`WP03_PRODUCT_DAILY_USE_COMPLETION_REPORT.md`](../../../../WP03_PRODUCT_DAILY_USE_COMPLETION_REPORT.md)
