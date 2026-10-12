# 当前受支持 Entry Point Map

基线：`b59dbfe5c00a2ed01a793b0602d6b48b246dc748`。本图只映射源码可达路径，不代表 Production 运行通过。

| 入口 | 分类 | 说明 |
|---|---|---|
| `src-tauri/src/main.rs → personal_finance_console_lib::run()` | GATED | 正式 Tauri main；setup 先检查 app-data 中未解决 cutover receipt，再进行 Production identity/path/manifest/schema 预检。 |
| `src-tauri/src/lib.rs::run / setup` 普通业务连接 | GATED | Production 只接受正式 Bundle ID、正式安装路径、正式 app-data 与数据库 basename；sidecar metadata 先检查，再只读 schema preflight；V3 会被拒绝，不调用旧 TS Migration 4。V4 才进入普通 connection。 |
| `src/runtime/tauri-bootstrap.ts::bootstrapTauriApplication()` | GATED | 依次构造 `TauriSqlDatabase`、调用 `database_open`、开始 schema migration、调用 TS `migrateDatabase`。对正式 Production V3，native setup 早先拒绝启动。 |
| `database_schema_migration_begin/end` | GATED | Native `migration_permitted` 默认为 false；sidecar 在迁移开始时重新检查。正式 authorization consumer 代码未连接到可用的 Production setup/invoke 切换路径，故 V3 migration 保持关闭。 |
| `database_execute/select/begin/commit/rollback` | GATED | 仅经已建立的 `DatabaseState` 和 SQL authorizer/token 检查。Production V3 在 connection 创建前被拒绝。 |
| `acceptance_reset` | PREVIEW_ONLY | 命令在普通 handler 列表可见，但函数要求精确 V4 acceptance Bundle ID、隔离 data path 和 acceptance runtime。 |
| WP-03 test date IPC 与 `WP03PreviewDateControl` | PREVIEW_ONLY | Rust 模块只在 `wp03-preview` feature 编译；IPC 只在该 feature 的 handler 注册。Vite default define 为 false；正式 candidate 的 packaged JS 扫描未发现 `wp03_preview_get_test_date`、`wp03_preview_set_test_date`、`WP03PreviewDateControl` 或“验收日期”。 |
| WP-02 / WP-03 / V4 acceptance alternate identity paths | PREVIEW_ONLY | 各自由独立 feature/config/identity guard 隔离；默认 Production candidate 未启用这些 Cargo feature。 |
| `scripts/production_v4_release_gate.py` | TEST_ONLY / BLOCKED_FOR_PRODUCTION_ACTION | synthetic fixture 单测可运行；正式 migration/retirement CLI 明确 fail closed，禁止替代当前 quiescence 与 Owner authorization。 |
| `src-tauri/src/bin/quiescence_tauri.rs` 与 `quiescence.rs` | TEST_ONLY | 专用 synthetic runtime identity、synthetic marker、临时 fixture root；不是 Production main，也不是可直接装入 `/Applications` 的生产迁移入口。 |
| `#[cfg(test)]` direct Migration 4 tests | TEST_ONLY | 仅测试编译路径中的临时数据库；不暴露给 Production Tauri invoke。 |

**结论：** 在代码检索范围内没有发现 WP-03 session date IPC 注册到默认 Production handler 的路径，也没有发现新业务 SQLite alternate adapter。正式 Production V3→V4 的可执行 gate 尚未与当前 quiescence runner 绑定；因此这次工作不能声称当前 Production cutover 可执行或已验收。
