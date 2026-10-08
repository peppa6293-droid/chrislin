# Writable Source Workspace Bootstrap Report

状态：**PF_PERSONAL_FINANCE_WRITABLE_WORKSPACE_READY**  
日期：2026-10-08（Asia/Shanghai）

本次仅准备可写开发源码 checkout，没有开始 `P1-SANDBOX-RESET-01` 修复。

## 1. Old read-only mirror

```text
/Users/linte/.codex/.chatgpt-projects/g-p-6abfad7e7dac8191bf8203695f175df0
```

该目录的 `AGENTS.md` 将其定义为只读同步镜像。本次复制时未修改镜像。镜像没有 `.git` 元数据，因此无可恢复的本地仓库历史。

## 2. New writable source

```text
/Users/linte/Documents/ChatGPT/个人财务模型app开发
```

这是新建的独立目录，不位于 `.chatgpt-projects` 内。包含 `src/`、`src-tauri/`、`tests/`、`docs/`、`v4-acceptance-web/`、npm/Tauri/Vite/TypeScript 配置和锁文件，并复制独立审计报告作为只读证据。未复制 `node_modules/`、Cargo target、构建输出、Production 数据库或 RC2 二进制。

复制前确认目标目录不存在。用保留文件内容、权限和链接的本地目录复制；之后从新目录执行 `npm ci`。

## 3. Git baseline

镜像无可用 Git 仓库。本次只在新目录初始化 Git，并建立接受实现的基线提交：

```text
d5b0380609815f4b6de6115b0f12b91473327a60
baseline: V0.1.2 V4 sandbox before reset P1 correction
```

新目录 `.gitignore` 后续增加 `artifacts/`，只用于忽略本地验收构建输出；没有改动应用行为或身份配置。Bootstrap 报告和最终验证记录在后续文档提交中保存。

## 4. Source equivalence

复制时逐文件 SHA-256 比对了 `src/`、`src-tauri/`、`tests/`、`docs/`、`v4-acceptance-web/` 及根目录关键配置，共 **144 个文件**：

- 缺失：0
- 多余：0
- 内容不一致：0

随后再次将镜像与复制时保存的 144 文件基线比对，镜像改动数仍为 **0**。新 checkout 除上述 `.gitignore` 输出目录规则外，源码文件仍与基线完全一致。

机器核对记录：

- `evidence/WORKSPACE_SOURCE_EQUIVALENCE.json`
- `evidence/WORKSPACE_SOURCE_BASELINE_SHA256.json`
- `evidence/WORKSPACE_FINAL_VERIFICATION.json`

## 5. Build and test results

从新目录运行：

| 项目 | 结果 |
|---|---|
| `npm ci` | PASS；安装 76 个包，审计报告 0 vulnerabilities |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS；保留 24 条既有 CSS specificity 警告 |
| `npx vitest run tests` | PASS；13 个文件、270 项测试 |
| `npx vitest run tests/v4-acceptance-sandbox.test.ts` | PASS；3 项测试 |
| 验收 Web 构建 `npm run build:v4acceptance` | PASS |
| 验收 Rust 测试 | PASS；11 项测试 |
| `npm run tauri:build:v4acceptance` | PASS；生成隔离 `.app`，12.52 MiB |

Rust 测试第一次运行时因验收前端产物尚未生成而被 Tauri 配置拒绝；先按项目脚本构建验收 Web 资源后，Rust 测试重跑通过。没有使用 bare `npm test`。

原生候选生成在：

```text
artifacts/v012-v4-owner-acceptance-sandbox-20261007/cargo-target/release/bundle/macos/小钱家 V4 验收版.app
```

构建产物 `CFBundleIdentifier` 为 `com.personalfinance.console.v4acceptance`，可执行文件 SHA-256 为 `43c572411c4d5ec195239fedea3e96d44dfe2a741e540b6e62435683e6a98f9f`。只构建，未启动。

## 6. Production preservation

Production DB 只读复核前后均为：

- SHA-256：`4b69c93356967fb8eec6fa25b7eedb6cf2a886bddf6b9ea9040182028beacf35`
- Schema：V3；migrations `[1,2,3]`
- integrity：`ok`
- foreign-key violations：0

未复制、打开写入、启动运行时或迁移 Production DB。

## 7. Acceptance DB preservation

验收 DB 只读复核前后均为：

- SHA-256：`f6fba4790c750bf8dcdb14303cb816fcf2fd22d8eae3fcc0d8dc09da8cc1e3ce`
- Schema：V4；migrations `[1,2,3,4]`
- integrity：`ok`
- foreign-key violations：0

没有重置、修改或用任何应用进程打开该库。

## 8. Path/config assumptions

- 验收 Vite/Tauri 输出仍写入新 checkout 下 `artifacts/v012-v4-owner-acceptance-sandbox-20261007/`；已在新 checkout 的 `.gitignore` 忽略 `artifacts/`。从新根目录执行完整 native build 已验证该路径有效。
- Bundle ID、Production identity、Tauri 配置及业务代码均未改动。
- 暂无阻止后续实现的路径或配置问题。后续 reset 修复应在这个可写目录中进行，并继续使用隔离验收构建配置。

## 9. Scope confirmation

本次没有实现重置确认修复，没有启动 App，没有进入其他阶段。Production 和验收数据库均保持原状态。

## 10. Ready for implementation

**PF_PERSONAL_FINANCE_WRITABLE_WORKSPACE_READY**

可写 checkout、基线提交、源码一致性、指定测试和验收 native build 均已就绪。按 Owner 本次限制，下一步实现尚未开始。
