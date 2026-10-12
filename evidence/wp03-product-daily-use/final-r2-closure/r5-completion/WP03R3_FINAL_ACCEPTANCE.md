# WP-03R3 — R5 最终日常产品验收

日期：2026-10-12（Asia/Shanghai）
最终状态：`WP03_PRODUCT_DAILY_USE_READY_FOR_PLANNING_REVIEW`

## 候选与冻结边界

- 候选：同一 R5 原生包；源码基线 `fd1d9e8714173167430baa2ab9325557a9e80775`。
- 当前 Git HEAD `f0fe61f685196beea660f506faccb187dc7e127d` 是此前报告提交；从冻结源码提交到当前 HEAD 的 runtime source diff 为空，本轮没有改源码或构建。
- App：`artifacts/wp03-isolated-product-preview-20261012/final-r5/cargo-target/release/bundle/macos/小钱家 WP-03 测试版.app`
- Bundle ID：`com.personalfinance.console.wp03preview`
- Executable SHA-256：`ecc46453d2aea39cd2f6232a38685827316f6c09e9b1f45e6fb6366cae182313`
- strict codesign：PASS。R5 数据域和包身份均与工单指定一致。

## 验收结论

- A / B / E / H2：继承 R5 已验收结果，没有重放写入。
- C：PASS。Oct override ¥12,345.67；Nov 使用 stable ¥10,001.01；切回 Oct override仍在；恢复继承；等值 override ¥10,001.01仍记录为 OVERRIDE；最终 Oct 为 INHERIT。历史共 4 条，顺序正确。
- D：PASS。正常 UI 创建 Actual：EXPECTED ¥1,234.56 / 2026-10-10；修订为 PENDING ¥1,345.67；再修订为 RECEIVED ¥1,456.78 / 2026-10-11；之后作废。当前有效列表为空，重启后历史仍完整。实际收入表单没有名称字段，因此不能输入工单示例名称；记录按金额、状态和业务日期验收。
- F：PASS。现金账户 ¥8,888.88 → 改名及 ¥7,777.77 → 安全资格 false → ¥0 → 停用。active list 只保留原账户；重启后历史及 ID 均在。
- G：PASS。Liquid Asset ¥5,555.55，LIQUID_INVESTMENT/eligible/active；Other Asset ¥3,333.33 改名、改为 ¥4,444.44 后仍为 OTHER/not eligible，再停用。active list 排除 B，重启历史完整，A 保持 active。
- H：PASS。Oct due=500、fixed=900 时使用 500；due=0/fixed=900 时使用 0；due 留空/fixed=900 时使用 900；清空 fixed 后留空状态使用 0，旧 fixed 未复活；零余额债务仍 active；Debt C lifecycle 停用并保留历史。H2 的 Nov A=0/B=200 在 revision 表保留，重启后 2026-11-01 session preview Home 显示本月还款 ¥200，未与 Oct 混用。
- I：PASS。Safety target=1.5 与 cash floor=0 分别保存；空白与 -1 均被 UI 拒绝；同值保存后仍为 2 条 settings revisions，没有新增修订。
- I2：PASS。提高 target 到 100 后正常 UI 要求恢复期限；输入 8 保存。settings revision 记录 target=100、floor=0、horizon=8。重启 Home/安全页显示 target 100、现金 floor 0，储备覆盖为 6.39/100 月，缺口为正。
- J：PASS。完整 UI 最终值见 `j-ui-final/UI_FINAL_STATE_MATRIX.md`。Home、Income、Planning、Actual/history、Expense、Cash/history、Assets/history、Debts/history、Safety 均已回读实际值。
- K：PASS。两次均经正常 UI Quit。PID、包路径、Hash、quit 后无进程/handle/sidecar 记录见 `k-quit/` 与 `m-restart/`。
- L：PASS。关闭态全表只读回读：v4、migrations 1–4、integrity `ok`、FK check 空；完整业务行、IDs、revision、snapshot、lifecycle、facts 及 table counts 见 `l-full-db/L_FULL_BUSINESS_READBACK.json`。摘要见同目录 Markdown。
- M：PASS。同一路径、同 Bundle ID、同 executable hash 重开；preview date 自动回到系统日 2026-10-12。逐页回读后再正常退出。before/after DB SHA-256 完全相同：`2659df609f35050df3197a7fa9ef961019fde5c569f3a788440242d196c66981`；所有表行和 revision counts 完全一致，没有重启业务写入。

## 完整性与边界

- UI 与 application persisted current state 一致。当前值来自各自最新的月度 revision/lifecycle 记录；初始 base 行保留其原始值。Debt 当前查询合并 `debt_period_facts` 与 `debt_revisions`，并按日期/revision 选最新记录；R5 重启后 Nov preview 的 ¥200 与两条 Nov revision 一致。
- 无确定产品缺陷；没有生成 R6。Financial Model V1.0 未改。WP-02、Production 未触碰。
- 自动测试没有重跑，沿用同一冻结 runtime source 的 R5 回归证据；本轮完成的是 UI 和持久化验收。
- Ready for Planning Review = YES。此结论不表示 Owner 已完成业务接受，也不授权 Production 或 WP-04。

## Evidence

本轮证据根：`evidence/wp03-product-daily-use/final-r2-closure/r5-completion/`。
完整 UI：`j-ui-final/UI_FINAL_STATE_MATRIX.md`；关闭态数据库：`l-full-db/`；重启 UI：`m-restart/M_RESTART_UI_MATRIX.md`；最终前后比对：`final-readback/RESTART_COMPARISON.json`。
