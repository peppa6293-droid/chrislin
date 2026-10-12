# Q01–Q18 当前 Closure

分类仅反映现有证据覆盖，不将旧报告的 PARTIAL 自动提升为当前 PASS。历史 SQLite experiment 曾记录 Q05、Q08 完整通过，Q11 当时未运行；后续独立真实 IPC 验收补上列出的五场景，但 renderer-only termination 仍未验证。WAL migration、pager I/O/断电、fsync 故障和恶意全机 namespace 不在首发支持 profile。

| Q | 当前分类 | Closure / 保留限制 |
|---|---|---|
| Q01 | SUPPORTED_BUT_NOT_FULLY_VERIFIED | 锁前 idle / 锁后 BUSY 有历史证据；与 old-runtime 准入的完整同一次串联未证明。 |
| Q02 | SUPPORTED_BUT_NOT_FULLY_VERIFIED | 真实读者阻止取锁有证据；fresh authority 的完整串联缺失。 |
| Q03 | SUPPORTED_BUT_NOT_FULLY_VERIFIED | writer 与 C0 漂移拒绝有证据；提交后旧 C0 新 attempt 串联未完成。 |
| Q04 | SUPPORTED_BUT_NOT_FULLY_VERIFIED | 多类 preflight 后竞争有证据；与旧 runtime 准入的完整整合未完成。 |
| Q05 | PASS_REUSED_WITH_CURRENT_REVALIDATION | SQLite/BUSY 与 lease 相关测试在当前提交编译运行通过；不扩大至 Q12/Q14 helper 执行中竞争。 |
| Q06 | SUPPORTED_BUT_NOT_FULLY_VERIFIED | 部分崩溃边界及拒绝重放有测试；所有 crash point 同 permit replay 的端到端矩阵未完成。 |
| Q07 | SUPPORTED_BUT_NOT_FULLY_VERIFIED | constraint/rollback 控制测试存在；真实 pager I/O 与 rollback I/O failure 未证明。 |
| Q08 | PASS_REUSED_WITH_CURRENT_REVALIDATION | 当前 native fixture tests 通过；历史完整 M4 schema/readback 被保留，但本轮没有 full-business C9。 |
| Q09 | INTENTIONALLY_UNSUPPORTED | WAL migration、TRUNCATE/PERSIST/OFF/MEMORY 不进入首发范围；DELETE profile 保持唯一支持。 |
| Q10 | SUPPORTED_BUT_NOT_FULLY_VERIFIED | BUSY/timeout 处理存在；SQLITE_LOCKED 专项注入缺失。 |
| Q11 | PASS_REUSED_WITH_CURRENT_REVALIDATION | 后续独立真实 IPC 五场景验收可复用；只覆盖已列导航/刷新/断联场景，不覆盖 renderer process death。 |
| Q12 | SUPPORTED_BUT_NOT_FULLY_VERIFIED | 部分 hash helper timeout/mismatch 和 post-hash 竞争拒绝有证据；helper 执行中同步竞争的全矩阵缺失。 |
| Q13 | SUPPORTED_BUT_NOT_FULLY_VERIFIED | NORMAL/EXCLUSIVE 锁语义有历史对照；真实 pager fault 后锁行为未证明。 |
| Q14 | SUPPORTED_BUT_NOT_FULLY_VERIFIED | FD/hash 保护及历史 readback 有证据；helper 执行中竞争屏障缺失。 |
| Q15 | OUT_OF_SCOPE_BY_THREAT_MODEL | symlink/hardlink 与 metadata errors 本轮已有 fail-closed 单测；全机恶意 namespace、任意 unlink-only 竞态不承诺。 |
| Q16 | SUPPORTED_BUT_NOT_FULLY_VERIFIED | permit claim/replay 与部分 failpoint 测试通过；真实 fsync/IO 故障及双 gate/native handoff 全矩阵缺失。 |
| Q17 | SUPPORTED_BUT_NOT_FULLY_VERIFIED | schema/M4 fidelity 测试在当前 native library 通过；所有 legacy constraint 独立子例未完整复跑。 |
| Q18 | INTENTIONALLY_UNSUPPORTED | WAL reader coexistence 不支持迁移；首发只支持 DELETE journal。 |

## Renderer-only termination

**BLOCKING_DEFECT（实测缺口阻断最终就绪）**。当前 real Tauri runtime只记录 navigation/page-load 断联；没有本轮可复现的 WebKit renderer-only kill 入口和保存证据。现有代码的 barrier timeout / commit fence 策略不足以替代对 renderer death 后 native process、lease、permit/ledger、transaction、业务 IPC 和 restart 的同一场景证明。不得写成 `VERIFIED_SAFE` 或 `VERIFIED_FAIL_CLOSED`。
