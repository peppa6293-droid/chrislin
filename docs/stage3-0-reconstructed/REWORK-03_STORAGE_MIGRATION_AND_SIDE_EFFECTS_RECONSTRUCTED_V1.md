# REWORK-03｜Storage、Migration 与 Side Effect 边界（重建版 V1）

- 状态：`RECONSTRUCTED_NOT_HISTORICAL`
- 范围：只读静态边界，不是运行验收

## 已确认的静态事实

- `src-tauri/src/lib.rs` 存在启动期 `create_dir_all` 和 `Connection::open` 路径。
- `src/runtime/tauri-bootstrap.ts` 对非 Production identity 进入 TypeScript migration chain；Production 走 native V8 authority。
- 数据库、备份、lock 和 sidecar 相关路径均需按 identifier/app-data 派生链审查。
- Tauri 配置中未确认存在 external sidecar binary；`src/bin/*` 不得仅凭文件存在推定会被打包。

## 保护清单

- Production SQLite 及 `-wal`、`-shm`、`-journal`；
- Production App 包及 `/Applications` 安装路径；
- terminal、receipt、ledger、permit、authorization、双备份和 authority namespace；
- 真实用户目录、真实账单和任何凭证。

## 启动前条件

- 不执行迁移、测试、构建或 App 启动。
- 不以“空库”或“目录不存在”作为安全证明。
- 运行验证若获另行授权，必须使用独立普通账户和独立非生产目录，并先完成路径正向绑定检查。

## 未验证

- SQLite 实际创建、WAL/SHM/journal 生成、备份写入和锁竞争；
- 真实迁移序列及其副作用；
- 任何 Production 文件的当前内容或状态。

## 结论

当前只能形成静态副作用清单，不能给出数据库隔离运行 PASS；Stage 3-1A-1 的 `BLOCKED_EVIDENCE` 保留。
