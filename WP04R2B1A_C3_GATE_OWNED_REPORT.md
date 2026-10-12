# WP-04R2B1A — C3 Gate-Owned Permit Mode 报告

## 状态

`WP04R2B1A_C3_GATE_OWNED_READY`

本状态只覆盖 Python managed-isolation / C3 contract。此前 `WP04R2B1 = BLOCKED` 的历史保持不变；C3 已具备交给下一阶段的技术条件，不代表完整 R2B、native authority handoff、Migration 4 或 Production 发布已完成。

## 实现结果

- 增加显式模式 `STANDALONE_COMPONENT` 与 `UNIFIED_R2B_GATE_OWNED`。省略参数仍采用历史 standalone 默认值；不探测文件猜模式。未知模式拒绝。
- Unified 仅接受精确 marker `PFC_WP04_SYNTHETIC_CUTOVER_V1\n`，固定 Bundle ID `org.pfc.quiescence.integration`，固定数据库 `<canonical synthetic root>/personal-finance-console.sqlite3`。
- Gate-owned C3 执行 managed isolation 后停止在 `MANAGED_ISOLATED`，写入 `SYNTHETIC_C3_MANAGED_ISOLATED.json`，绑定 marker、候选 executable/manifest、旧运行时、归档/安装路径、时间、lease/session、managed contract/state 和 V3 DB 哈希。
- Gate-owned 路径不写 migration authorization、permit、consumed ledger、migration terminal/outcome 或 Migration 4 状态。发现已有 legacy authorization/permit 或正式 Gate permit 时 fail closed 并保留原文件。
- Standalone component 行为保持原合同，继续生成其测试 authorization/permit。Rust/native 文件没有修改。

## 验证

正向 synthetic C3 回读通过：receipt 1 份；migration authorization、permit、consumed ledger 均为 0；数据库 user_version 为 3，migration rows 为 `[1,2,3]`；Migration 4 未执行；上下文结束后 lease 已释放，临时 root 已清理。receipt 文件 hash 与回读 hash 相同。

Double-authority 负例覆盖已有 standalone migration authorization、legacy permit、formal Gate permit，均拒绝且保留原对象。Mode/marker 负例覆盖 unknown mode、wrong/missing/symlink marker。失败保全覆盖 candidate mismatch、archive、copy、install 失败及旧 runtime 仍运行；每项均无 migration authority。

| 回归 | 结果 |
|---|---|
| typecheck / lint / product | PASS / PASS（25 warnings）/ PASS（300） |
| WP03 preview / release gate / build | PASS（5）/ PASS（40）/ PASS |
| C3 专测 / Python quiescence | PASS（15）/ PASS（88） |
| Rust default / quiescence fixture | PASS / PASS（33） |
| recovery component matrix | PASS（16/16） |
| R2A CLI→Rust integration | PASS（5） |

每条命令的原始日志和退出码见证据目录 `07-regression/`；聚合结果见 `summary.json`。这些是 synthetic/component 回归，不是完整 R2B 验收。

## 边界与剩余工作

未触碰 Production App/DB，未创建真实 authorization、permit、receipt 或 backup，未安装或迁移；未执行 Migration 4。未改 Rust consumer、native runner、S4 或 renderer。完整 WP04R2B1 仍为 `BLOCKED`，后续由 WP04R2B1B 负责 Native Authority Handoff。

## 提交

- Starting HEAD：`9643bb1575ec32e3b8646beebf0f368b9ba2bed6`
- C3 Implementation Commit：`75b2d87fe89f8b0a2fe990ed3f2d65c5116d22fe`
- Final Source Commit：`75b2d87fe89f8b0a2fe990ed3f2d65c5116d22fe`
- Final Report Commit：以本报告和证据的提交记录为准（详见最终回读）。

## 证据

`evidence/wp04-release-cutover-readiness/35-r2b1a-c3-gate-owned/`
