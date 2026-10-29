# 小钱家 V3｜Stage 3-0 交接包（重建版 V1）

- 文档状态：`RECONSTRUCTED_NOT_HISTORICAL`
- 重建日期：2026-10-24（Asia/Shanghai）
- 用途：为 Stage 3-1A-1 提供可审计的当前交接基线；不伪称为历史 Stage 3-0 原件。
- 授权边界：仅规划、非敏感配置和源码静态证据；不授权运行、构建、测试、迁移、Smoke 或 Production 操作。

## 1. 重建依据

1. `小钱家V3_Stage00A_规划审核/STAGE00_A_PLANNING_AUDIT.md`
2. `小钱家V3_Stage00C_规划收口/STAGE00_C_EVIDENCE_AND_CONFLICT_MATRIX.md`
3. `小钱家V3_Stage00C_规划收口/STAGE00_C_BASELINE_READINESS.md`
4. `个人财务模型app开发项目 2/愿景与规划-10.24/00_FINAL_VISION_AND_CHARTER.md`
5. `个人财务模型app开发项目 2/愿景与规划-10.24/01_APPROVED_DECISIONS_REGISTER.md`
6. `个人财务模型app开发项目 2/愿景与规划-10.24/02_EXECUTION_AND_ACCEPTANCE_ROADMAP.md`
7. `个人财务模型app开发项目 2/docs/PRODUCT-VISION-XQJ-V3-20261024.md`
8. `个人财务模型app开发项目 2/PROJECT-STATE.md`
9. 当前源码静态核查回执及审核方对 `src-tauri`、`src/runtime/tauri-bootstrap.ts`、Tauri 配置和能力文件的只读复核。

## 2. 原始材料定位结果

- 原始 Stage 3-0 交接文件：本次定向查找未发现，状态 `MISSING_RECONSTRUCTED`。
- `REWORK-01`～`REWORK-04` 历史文件：未发现，状态 `MISSING_RECONSTRUCTED`。
- Stage00-A/C 与 V3 规划材料：已发现且可读，状态 `AVAILABLE_CURRENT_EVIDENCE`。
- 本文及配套 REWORK 文件：新建重建版本，不覆盖任何现有成果。

## 3. 当前可继承的边界

- Stage 1、Stage 2、Stage 3-0 的既有批准不因本文档重建而撤销；本文不重新裁定其业务批准效力。
- Financial Model V1.0 保持冻结；既有生产 V8、Production App、Production SQLite、三件套、双备份和真实凭证均属于不得触碰对象。
- 本重建包不代表 Stage 3-1A-1 已通过，也不代表具备 3-1A-2/3-1B 准入条件。

## 4. Stage 3-0 重建结论

`RECONSTRUCTED_WITH_OPEN_EVIDENCE_GAPS`

可确认：当前项目存在 V3 规划材料、阶段治理材料和可供静态核查的源码/配置。

不可确认：历史 Stage 3-0 是否曾按原任务书完成 `PASS_WITH_CONDITIONS`、Gate P 是否正式通过、REWORK-01～04 是否曾完成、Owner 是否对全部交接条目作出书面收口。

## 5. 交接准入条件（重建后的明确版本）

进入 3-1A-1 仅限只读静态核查，必须：

1. 使用明确的 Smoke/非生产配置，不使用默认生产命令；
2. 只读检查 identifier、数据目录派生、数据库打开/迁移/备份/sidecar、硬编码路径和凭证/环境输入；
3. 不启动 App、不运行脚本/构建/测试、不读 Production SQLite、真实账单、Keychain 值或凭证；
4. 每项证据写明真实路径、行号/配置键、摘要和状态；
5. 任何运行期属性标记为 `UNVERIFIED_RUNTIME_IMPACT`；
6. 发现可能触碰 Production 数据或真实用户目录时立即停止并保留证据。

## 6. 未验证内容

- Tauri `PathResolver` 的实际 macOS 运行解析；
- SQLite/WAL/SHM/journal 的实际运行副作用；
- LaunchServices 对同名 App 的实际选择；
- 独立 macOS 账户下环境变量、Keychain、权限和 App 安装路径的运行行为；
- Stage 3-0 历史交接文件、REWORK 原件、Gate P 正式记录。

## 7. 结论

本文仅恢复当前可用的文档化交接骨架。Stage 3-1A-1 的安全结论仍须以实际静态证据为准，当前阻断状态 `BLOCKED_EVIDENCE` 保留；不得因本文落盘自动推进下一阶段。
