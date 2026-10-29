# REWORK-02｜Runtime Identity 与数据边界（重建版 V1）

- 状态：`RECONSTRUCTED_NOT_HISTORICAL`
- 范围：只读静态边界，不是运行验收

## 当前静态基线

- Production identifier：`com.personalfinance.console`，配置见 `src-tauri/tauri.conf.json`。
- Smoke identifier：`com.personalfinance.console.smoke`，配置见 `src-tauri/tauri.smoke.conf.json`。
- V4 acceptance：`com.personalfinance.console.v4acceptance`。
- Quiescence：`org.pfc.quiescence.integration`。
- TS runtime 白名单见 `src/runtime/tauri-bootstrap.ts`；未知身份拒绝选择 schema authority。
- `package.json` 中默认 `tauri:dev`/`tauri:build` 未显式指定 Smoke 配置；Smoke dev/build 需要显式 `--config`。

## 静态偏差

1. 默认命令可能落到 Production 配置。
2. Production 分支在可执行路径拒绝前存在目录/锁文件准备路径。
3. Smoke 检查已确认存在“不得等于 Production 目录”的负向断言，但其正向目录绑定仍需运行前门禁和后续验证。
4. Production/Smoke 产品名及 SQLite 文件名存在混淆风险。

## 启动前必须确认

- 使用显式 Smoke 配置；禁止默认 Tauri 命令。
- 预先记录目标 identifier、目标数据目录和停止条件。
- 不触碰 `/Applications/Personal Finance Console.app`、Production app-data、SQLite/WAL/SHM/journal、备份或 authority namespace。
- 任何目录解析无法证明非生产隔离时停止。

## 未验证

本文不证明 Tauri `app_data_dir` 实际解析、LaunchServices 选择、SQLite sidecar 行为或运行时环境继承。
