# WP-04R2B3C2 — Recovery Test-Hooks Source Freeze & Candidate Rebuild

**Final Status: `WP04R2B3C2_SOURCE_FREEZE_READY`**
日期：2026-10-13（Asia/Shanghai）

## 结论

Recovery Test Hooks 后的运行时源码已冻结到 `c3da2f73c03b681957b4334751b7933d102caad1`。冻结回归最终全部通过。已从该提交的 clean Git archive 重建一个新的 synthetic R2B3C3 acceptance candidate，并完成 source/candidate binding 与 strict code-signature 验证。候选未启动；Production 未访问。

本状态仅表示候选已准备交给下一轮 WP-04R2B3C3 full-chain recovery acceptance。Full-Chain Recovery Matrix、Q01–Q18、Renderer 均按本工作单未执行；总体 WP04R2B 仍为 `WP04R2B_SYNTHETIC_CUTOVER_BLOCKED`。

## 源码冻结与产品保护

- Starting HEAD：`622ecece2b27a88d2ada85bbbc33427794fbabb3`。初始 staged/working tracked diff 均为空；已存在的未跟踪文档、报告及证据均保留。
- Runtime Source Commit：`c3da2f73c03b681957b4334751b7933d102caad1`。当前工作区 runtime source 无 dirty diff。
- 从上一冻结点 `713e4c5c8a5c5ccfb1ad06481f4d6e138da294b2` 到该提交的 `src`、`src-tauri`、`scripts` 变化仅有 `src-tauri/Cargo.toml`、`src-tauri/src/quiescence.rs` 和 Recovery Hooks harness。运行时变化仅增加 compile-time synthetic hook feature 与 unified native runner test points；无 UI、application business behavior、Financial Model 或普通 persistence 业务变化。
- 与 WP-03 R5 基线 `fd1d9e8714173167430baa2ab9325557a9e80775` 比较，`src/ui`、`src/application`、`src/model`、`src/persistence` diff 为空。`Product Behavior Changed = NO`；`Financial Model Changed = NO`。
- Hook feature 为 `wp04-r2b-recovery-test-hooks`，依赖 `wp04-r2b-synthetic`。Recovery hook 需要精确 `UNIFIED_R2B_SYNTHETIC` domain、marker `PFC_WP04_SYNTHETIC_CUTOVER_V1\n` 和已验证 Gate authority；未知 test point 拒绝。默认构建的 hook 参数忽略用例及默认 executable 字符串检查均通过。

## 冻结回归

所有项目要求项最终均 PASS。首次在 Git archive-only 目录运行时，依赖 Git metadata、Apple identity 和模块搜索路径的少数用例因执行上下文而失败；随后在精确 `c3da2f7` detached worktree 配置 `APPLE_SIGNING_IDENTITY` 与 `PYTHONPATH=scripts` 定向补跑并通过。首次失败和修正后结果都保留在证据中，最终结果以修正后回读为准。

| 项目 | 最终结果 |
|---|---|
| Typecheck / lint / product tests | PASS；product 300/300 |
| WP03 preview / release gate / web build | PASS |
| Rust default / quiescence fixture / Tauri | PASS |
| R2A Gate / R2B1A C3 / R2B1B native authority | PASS |
| R2B3A unified recovery diagnostic | PASS，9/9 |
| Recovery Hooks harness | PASS，12/12；包含全部 hook points、domain/marker/unknown point negatives、no-hook consumer 与 default executable negative |
| Native lease | PASS，15/15 |
| Component recovery | PASS，16/16，`COMPONENT_ONLY` |
| Formal Gate → Rust → S0–S10 → Migration 4 exactly once | PASS |

Component recovery 16/16 未提升为 full-chain acceptance。未运行完整 16 场 full-chain recovery、Q01–Q18、Renderer 或 recovery acceptance。

## Source provenance 与候选包

- Frozen source commit：`c3da2f73c03b681957b4334751b7933d102caad1`
- Git archive：1,323 个文件，97,146,880 bytes；SHA-256 `e2f06d023eca661079406821cac23373b874a81867c95dccb6f1e503ecef6ce3`
- Archive/tree mismatch：0；候选源码解包的 1,323 个 Git blob 全部匹配。只在候选解包副本替换了 `src-tauri/tauri.conf.json` 为已记录的完整 synthetic build config；runtime source 无改动。该隔离配置用于避免 default Production resource mapping 留在 synthetic bundle。
- Cargo.lock：`5a58d1e21d6de8bbfdb3d3cb0332e2fe06516ea0790f2e9c14127b0943f054c8`
- package-lock：`3f2152b71eba56701d63ae1c39b1c583543f8109a146bf5dc2e955256cbfba16`
- Base Tauri config：`0c442bf8421f16d737d086d5036de3f56237f6f01033867e14e6c5cd04baf425`
- Effective synthetic Tauri config：`98599f692bf27a6c2a88f81d43aef12ffaa4fe0e7bc0e382b8debe5fb23f5355`
- Effective synthetic Vite config：`7244158dee5a7fc3b9d2eea4efc43cfc737247d17b6073973beba44c8f58609b`
- Build 使用 `npm ci`、Vite production build 和 Tauri bundle build；feature set 精确为 `wp04-r2b-synthetic,wp04-r2b-recovery-test-hooks,tauri/custom-protocol`。构建目录位于 APFS `/Users/linte/Library/Caches`，不在 CloudDocs。
- 新候选：`/Users/linte/Library/Caches/pfc-wp04r2b3c2-c3da2f7/candidate-build-02/cargo-target/release/bundle/macos/小钱家.app`
- Bundle ID：`org.pfc.quiescence.integration`；executable `personal-finance-console`
- Executable SHA-256：`e4097fc566bbe9d3e0a6eafb7044b283dae37504427a25ca08917c2b046ae1bf`
- Manifest SHA-256：`cdb8f040b9250a23ba0df0f89a0c91313ba881cdd715bed8945201e1f51b7ecc`
- Signing：Apple Development `Apple Development: 8619814730147 (FW5KHTFNZ6)`，Team ID `SSRKA7A4TN`；`codesign --verify --deep --strict` PASS。
- Candidate binary 有 recovery diagnostic/hooks 来源及指定 hook marker；默认 Production executable 无任何已检查 hook 字符串，no-hook consumer 在注入参数存在时正常完成 Migration 4 exactly once 且不生成 injection receipt。`Production Hook Reachability = NONE`。
- Candidate 未启动。不会据此宣称最终 recovery acceptance、安装、Promotion、Production readiness 或业务接受。

首次 build attempt 的保存后读回发现 default bundle ID/resource 泄漏，因不满足 synthetic identity 而分类为 `REJECTED_BUILD_ATTEMPT_01_DEFAULT_CONFIG_LEAKAGE`，未绑定。修正隔离构建配置后的 attempt 02 为本报告唯一绑定候选。两次均未启动。

## 旧候选与边界

旧候选 `/Users/linte/Library/Caches/pfc-wp04r2b3b1-713e4c5/candidate-build/cargo-target/release/bundle/macos/小钱家.app` 保持 `R2B_PRE_RECOVERY_TEST_HOOKS_BASELINE`，executable SHA `7c640378b10a8bbdb40cd5f9b65069de19443b8e65b9e6cc2f704a69e7f578d4`，manifest SHA `cdb8f040b9250a23ba0df0f89a0c91313ba881cdd715bed8945201e1f51b7ecc`；当前重新校验 strict codesign 通过。更早 `f7625ec…` baseline 分类不变；历史 evidence 未删除。

Production App/DB 未触碰；未创建真实 authorization、recovery authorization、backup、receipt、permit 或真实 migration；未执行 restore、安装、`/Applications` 写入或关闭 blocker。WP-02 未触碰，WP-03 acceptance 保留。

## 证据目录

`evidence/wp04-release-cutover-readiness/46-r2b3c2-source-freeze/`

含 intake、runtime/product review、hook contract、逐项 regression logs 与 final readback、default-build negative evidence、source archive/provenance、build logs、codesign readback、`R2B3C3_SOURCE_CANDIDATE_BINDING.json`。

下一责任人：Planning / Owner 下发 WP-04R2B3C3 full-chain recovery acceptance。Execution 到此停止；本轮不运行 full-chain matrix、Q closure、Renderer 或 Production。
