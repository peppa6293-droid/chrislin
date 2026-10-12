# WP-04 当前 Cutover Capability Matrix

检查基线：`b59dbfe5c00a2ed01a793b0602d6b48b246dc748`。所有 Production 状态均为只读代码判断或候选包静态检查；本轮没有读取 Production 数据。

| 能力 | 当前分类 | 当前证据 / 限制 |
|---|---|---|
| Production startup forward-schema guard | NEEDS_REVALIDATION | 当前普通 runtime 在 setup 阶段先检查未解决 cutover 状态；Production 另校验正式身份、安装路径和 manifest。V3 会被拒绝并要求隔离 quiescence 路径；候选未启动。 |
| Runtime compatibility manifest | UNCHANGED_AND_REUSABLE | 新候选嵌入 manifest SHA-256 `f60ebff85a28d67750cd4b77084cb7d549f24f8c833811ca4e16a9c41ec583e7`，runtime generation 4、schema max 4、正式 bundle/executable 身份相符。 |
| Release gate | CURRENT_DEFECT | 40 项合成 gate 用例通过，metadata/sidecar 现已 fail closed；但旧正式 CLI migration/retirement 路径仍明确禁用，且 native authorization consumer 没有连入 Production setup / invoke 的可用执行链。 |
| Candidate identity binding | NEEDS_REVALIDATION | 两次 fresh build 和 strict signature 核验通过；这是 pre-production candidate，不是 C1 Owner-approved candidate。 |
| App/process managed isolation | NEEDS_REVALIDATION | managed integration 30 项在显式签名环境通过；尚未把新 Production candidate 安装进隔离 managed rehearsal。 |
| Maintenance lease | NEEDS_REVALIDATION | 当前 quiescence feature 33 项单测通过；完整 15 项 native lease 矩阵来自较早 source-bound 证据，本轮未重跑该整套动态矩阵。 |
| Permit generation/consumption | NEEDS_REVALIDATION | release gate 与 native replay 单测通过；本轮未从 C0 到 C7 为完整当前业务 V3 fixture 运行正式 synthetic permit 流。 |
| Durable ledger | NEEDS_REVALIDATION | native 单测覆盖消费账本与 fail-closed；端到端全 synthetic C0-C10 回读未完成。 |
| Native Migration 4 runner | NEEDS_REVALIDATION | 单连接、固定 M4、DELETE journal 代码及单测仍在；当前 source commit 上的完整正式 S0-S10 rehearsal 未完成。 |
| Exact source fidelity | NEEDS_REVALIDATION | candidate 建立在当前 git archive commit；build logs、lock/config hashes、manifest 和 asset inventory 已保存；完整 final source-to-runner receipt 尚未生成。 |
| Recovery | NEEDS_REVALIDATION | 当前 recovery Rust 测试 33 项通过；10 组恢复矩阵与正式完整场景证据是历史证据，未与当前候选和本轮 synthetic C0-C10 重新绑定。 |
| Post-commit guarded readback | NEEDS_REVALIDATION | 保护实现和历史独立验收保留；本轮没有在当前版本完成带完整业务数据的 C8/C9 迁移与只读 readback。 |
| Startup unresolved-state fail-closed | UNCHANGED_AND_REUSABLE | 当前源码和 Rust 单测仍拒绝 orphan/pending/corrupt 状态；本轮 39 项普通 Rust lib 单测通过。 |
| Real IPC | NEEDS_REVALIDATION | 30 项 managed integration 和 33 项 Tauri binary tests 通过；真实 5 场景 IPC 证据是既有报告，未在新 source commit 上重新签包并复跑。 |
| Renderer termination | BLOCKING_DEFECT | 没有 WebKit renderer-only termination 的真实隔离证明；不能据 whole-App kill 或 document navigation 推断。 |
| Sidecar policy | NEEDS_REVALIDATION | Production gate 与 native startup 在精确 NotFound 以外均 fail closed；sidecar 现在会在 SQLite 打开前拒绝。40 项 Python gate 与 39 项 Rust lib 测试覆盖本轮改动。 |
| Path metadata / symlink / hardlink | NEEDS_REVALIDATION | gate scan root、bundle、DB、manifest 与 sidecar 的 metadata error 不再映射为空缺；regular/single-link 校验和 symlink negative tests 通过。完整 adversarial namespace 仍超出证据范围。 |
| Replay / authorization replacement | NEEDS_REVALIDATION | 当前 Rust/quiescence 测试保留相关负例；未在完整 C7 下用所有新 synthetic authorization bytes 复跑端到端矩阵。 |
| Candidate/runtime/DB binding | CURRENT_DEFECT | 新候选只完成静态 identity/provenance；Production C0/C1 与当前 native runner/gate 尚未形成可执行同一版本 binding。 |
| Old-runtime compatibility protection | HISTORICAL_ONLY | `RB-V4-OLD-RUNTIME-01 = CLOSED` 是历史 Owner 结论，未因本轮重开；本轮没有执行真实 runtime replacement。 |

首个正式迁移支持范围继续冻结为本地 SQLite、DELETE journal、`busy_timeout=0`、`locking_mode=EXCLUSIVE`、`BEGIN EXCLUSIVE`、单一 native connection、V3→V4 固定 Migration 4。WAL 迁移、network filesystem、任意 SQL、自动恢复和 downgrade 均不支持。
