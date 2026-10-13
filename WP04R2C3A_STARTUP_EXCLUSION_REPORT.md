# WP-04R2C3A｜Production Startup / Migration Mutual Exclusion

- 日期：2026-10-13（Asia/Shanghai）
- Final Status：`WP04R2C3A_STARTUP_EXCLUSION_READY`
- 范围：只关闭 Production 普通启动与正式 V4 Migration 临界区之间的并发启动缺口。验证使用隔离合成域。
- 不包含：Production 访问、最终候选构建/冻结、R2C 最终验收、独立审计。

## 结果

普通 Production App 在创建 `tauri::Builder` 前获取共享 `flock`，检查未解决的持久化切换状态，并将锁持有到 Tauri 事件循环退出。正式 native migration 命令在读取或 claim permit、打开数据库前取得排他 `flock`，并将锁持有到 Migration 4、COMMIT 和提交后 schema/sidecar 回读结束。两者使用同一 canonical authority 下不兼容的共享/排他模式。

锁对象采用固定 `maintenance.lock` 名称，使用 `O_NOFOLLOW|O_CLOEXEC`、owner-only 权限、当前 UID、单链接普通文件、canonical 目录和前后 inode/device 校验。锁文件不会在正常路径被 unlink。实现复用项目已有 `flock` / `maintenance.lock` OS 锁约定，没有引入第二种并发原语。

## 验收矩阵

| 项目 | 结果 | 证据 |
|---|---|---|
| UI Guard 在 Tauri Builder 前取得 | PASS | `src-tauri/src/lib.rs::run`；真实隔离 Tauri probe |
| UI Guard 覆盖 App 生命周期 | PASS | guard 在 `builder.run(context)` 返回后释放 |
| Migration 排他 Guard | PASS | 在 permit 检查/claim 及 DB 打开前 acquire；源码回读及编译 |
| 同一 authority namespace | PASS | Production 固定为 `$HOME/Library/Application Support/com.personalfinance.console/maintenance.lock`；合成 UI/Gate 使用同一临时根 `maintenance.lock` |
| UI 持锁 → Gate 拒绝 | PASS | 合成 Tauri UI 持共享锁时，Gate 排他 acquire 被拒绝 |
| Gate 持锁 → UI 拒绝 | PASS | 隔离 Tauri probe 返回 `STARTUP_EXCLUSION_BUSY`，Builder/WebView 未创建 |
| S5 UI launch / Renderer | 拒绝 / 0 | `05-s5/startup-attempt.json`；native migration 保持运行 |
| Post-COMMIT UI launch / Renderer | 拒绝 / 0 | `06-post-commit/startup-attempt.json`；native migration 保持运行 |
| S10 release → UI launch | 允许 / Renderer 1 | `07-s10-release/startup-attempt.json`；`VERIFIED_HANDOFF`、M4 version 4 行数为 1 |
| crash 后 OS lock 释放 | PASS | `08-crash-unresolved/crash-lock-release.json` |
| 未解决状态仍阻止 UI | PASS | `COMMIT_OUTCOME_UNKNOWN` 在 Builder 前拒绝；未访问数据库 |
| 50 次并发 race | PASS | 50 次，double-win 0；`09-race/STARTUP_EXCLUSION_RACE_MATRIX.json` |
| Renderer attribution | PASS | S5=0、post-COMMIT=0、S10=1；以进程路径和 launchd coalition bundle ID 归属，并保存 launchctl / lsappinfo 记录 |
| UI→Gate IPC | 未新增 | diff/source readback |
| Permit / ledger / Migration4 / recovery contract | 未改变 | implementation diff review |
| 产品业务行为 / Financial Model | 未改变 | implementation diff review |
| Production App/DB | 未触碰 | 全程使用 synthetic isolated root 和独立 bundle ID |

## 回归

- TypeScript typecheck：PASS。
- Lint：命令退出码 0；25 条既有 CSS specificity warnings。
- Product：300/300。
- WP03 preview packaging：5/5。
- Release Gate：40/40。
- R2A wiring、R2B1A Gate-owned、unified synthetic contract、recovery diagnostic：合计 34/34；其中 recovery diagnostic 9/9。
- Rust default：40/40；quiescence fixture：33/33；Tauri harness：44/44。
- R2B1B native handoff：16/16；recovery hooks：12/12；native lease：15/15。
- R2C3A 专项：4/4；startup exclusion race：50/50，无双赢。
- Forward synthetic Migration 4：exactly once；S10=`VERIFIED_HANDOFF`。

详细命令及计数见 [`REGRESSION_SUMMARY.md`](evidence/wp04-release-cutover-readiness/51-r2c3a-startup-exclusion/11-regression/REGRESSION_SUMMARY.md) 与 JSON。一次重跑因未注入已有 Apple Development signing identity 而停在环境前置检查；设置同一身份后 16 项 handoff、12 项 recovery hooks 与 15 项 native lease 均通过。失败前置检查记录予以保留。

## 边界与下一阶段

- 起始 HEAD：`266c55d77ee4ca1cee5f6ef40300c9c637c83664`。
- Startup Exclusion 实现提交：`7b4a9c16bbbfc6ad1cd602af479d8aaa9a11f756`。未 amend 旧提交。
- 旧候选 executable `e4097fc566bbe9d3e0a6eafb7044b283dae37504427a25ca08917c2b046ae1bf` 分类为 `R2C_PRE_STARTUP_EXCLUSION_BASELINE`，历史证据保留。
- 实现源码已提交，Runtime Dirty Source=`NO`；这不代表 final source freeze 或最终候选已经生成。
- 未重新运行完整 17 场 recovery matrix，因为本轮没有修改 recovery 或 migration state-machine 语义。
- 未构建 final Release Candidate；仅构建、签名并运行一个隔离 synthetic UI probe App 用于真实 WebView attribution。probe 的绑定、构建记录与签名回读保存在 `11-regression/startup-exclusion-ui-probe/`；已验证的签名测试 app 保留于 `/private/tmp/PFC-WP04R2C3A-Synthetic-UI-Probe.app`，executable SHA-256 为 `d808d2c8783a17c4e3a75b268f31388b2d2346f6ad1d64ab03b040114546ad2e`。
- WP03 acceptance 保留；WP02 未触碰；Production App、Production DB、真实 authorization 和真实 permit 均未触碰/创建。
- 下一步：Planning/Owner 可进入 R2C final source freeze 与 final acceptance 阶段。本报告不代替下一阶段验收，也不授权 Production 操作。

## Evidence

Evidence root：[`evidence/wp04-release-cutover-readiness/51-r2c3a-startup-exclusion/`](evidence/wp04-release-cutover-readiness/51-r2c3a-startup-exclusion/)。
