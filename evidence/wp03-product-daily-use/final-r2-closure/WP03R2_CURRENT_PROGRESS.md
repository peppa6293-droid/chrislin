# WP-03R2 当前执行进度 — 2026-10-12

## 当前结论

**状态：`WP03_PRODUCT_DAILY_USE_REGRESSION_FAILED`。** R5 最终源码包已构建并通过严格签名。跨月待确认和单笔隔离在 R5 的真实界面中通过，首页旧金额显示缺陷已修复并通过回归。完整 A–M 尚未在同一个 R5 包上完成，因此不能标记 READY。

## 版本与候选包

- Starting HEAD：`a8b5306a20b750133247094ed8d57a4b48c611f1`
- Preview-Date Implementation Commit：`83cde18dade613f94966d6f8af8272c649b50717`
- Final Product Fix Commit：`fd1d9e8714173167430baa2ab9325557a9e80775`
- Final Source Commit：`fd1d9e8714173167430baa2ab9325557a9e80775`
- App：`artifacts/wp03-isolated-product-preview-20261012/final-r5/cargo-target/release/bundle/macos/小钱家 WP-03 测试版.app`
- Bundle ID：`com.personalfinance.console.wp03preview`
- Executable SHA-256：`ecc46453d2aea39cd2f6232a38685827316f6c09e9b1f45e6fb6366cae182313`
- Strict codesign：PASS；Apple Development `Apple Development: 8619814730147 (FW5KHTFNZ6)`；TeamIdentifier `SSRKA7A4TN`
- Build receipt：`artifacts/wp03-isolated-product-preview-20261012/final-r5/build-record.json`，源码 HEAD 与最终源码提交一致，构建器记录未启动 app。
- Runtime source clean：是（文档与验收证据尚未提交）。

## 自动化回归（R5 源码）

- TypeScript：PASS
- Lint：PASS，仍有 25 条既有 CSS specificity warnings
- Product：PASS，17 个文件 / 300 tests
- WP-03 packaging：PASS，5 tests
- Rust `wp03-preview`：PASS，40 tests
- Rust default：PASS，37 tests
- Web build：PASS

日志位于 `automatic-tests/*-r5.log`。Preview date 的 default-build surface scan 沿用先前证据；R5 未改变该隔离代码。

## R5 真实 UI 已核实

- A 初次设置：收入 10,000；必要支出 2,000/1,000/300/200/100/400；现金 10,000（纳入安全储备）；流动资产 10,000（纳入）；债务 A 10,000 / 本月 500 / 固定 500，债务 B 5,000 / 本月 300 / 固定 300；安全目标 3 个月、现金底线 1 个月、弹性消费目标 1,000。首页读回本月应还 800。
- B 稳定收入：UI 保存为 10,001.01，修订计数 1；同值再保存提示“金额没有变化，未新增计划版本”，计数仍为 1。
- E 消费：UI 保存 68.50，备注“日用测试”；Home 显示本月已花 68.50。
- H2 跨月：Preview date UI 切至 2026-11-01；首页显示“本月债务待确认”以及两笔待确认。只确认债务 A 的 0 后，债务 B 仍待确认；债务页显示 A 为 0、B 待确认。修复后的首页卡显示“本月应还待确认 / 待确认”，未显示 October 的 500。随后债务 B 保存 200，首页重新显示本月应还 200。
- 真实日期恢复：Home 显示 2026-10-12 并提示已恢复系统日期。
- K/M 部分：通过正常 Quit 后，以同一 R5 app 路径重启。首页仍显示系统日期 2026-10 与消费 68.50；closed DB hash 重启前后相同，未发现重启新增业务写入。

对应人工记录：`h2-r5-home-debt-rollover.md`、`m-r5-restart.md`、`l-r5-db-readback.md`。

## 还未在 R5 完成

- C 本月收入 override / inherit 与显式相等 override。
- D Actual income 新增、修改、状态变更、作废及历史回读。
- F 现金账户新增、编辑、0 余额和 lifecycle/history 的全项验收。
- G 资产新增、编辑、停用和历史的全项验收。
- H October due precedence / fallback / fixed-clear / zero-balance / Debt C lifecycle 的完整组。
- I Safety targets（1.5、0、空白、负数、同值无 revision）以及 I2 recovery horizon 流程。
- J 完整导航与各页同一数据集对照。
- L 全部 A–I 关键表、revision、snapshot、lifecycle 的完整只读数据核验及逐表清单。
- M 全页面同包重启读回与正常终止后的第二轮完整 DB 核验；当前只完成 Home + Expense 的读回和相同 hash 检查。

R4 在修复首页卡片前的现场已封存到 `preservation/wp03-r4-partial-original.sqlite3`，不可与 R5 结果拼接成完整验收。

## 隔离边界

Financial Model V1.0 未改；WP-02 与 Production 未访问。只使用 WP-03 Bundle ID 对应的 synthetic 数据域。R5 closed DB `user_version=4`、migrations 1–4、integrity `ok`、foreign_key_check 空、无打开句柄或 WAL/SHM/journal sidecar。闭库 hash：`e0b0b1a74ac51051077ad1a2060832f17fa0b9fce9f88dbbc431a98834bf2526`。

## 下一步

继续只能基于 R5 同一候选包完成尚缺 A–M 场景；如果修改运行时源码，需另起最终包并重新执行完整验收。Planning Review 不放行。
