# V0.1.2 V4 切换静默契约｜SQLite 实验报告

实施与实验：2026-10-08；交付：2026-10-09（Asia/Shanghai）。

结论：**实验尚未满足完整验收，不可进入独立复审。** Q01–Q18 中，2 项完整通过、15 项部分完成、1 项未执行。未执行或缺少子场景的项目没有标记 PASS。

本报告仅记录本次隔离实现自测及主任务回读，不是未来独立审计报告。不授权 Production 的恢复、副作用、迁移或任何写入。

## 1. 权威证据与复现

最终实验命令：

```text
python3 scripts/quiescence_experiments.py --native --output evidence/quiescence/authoritative-final.json
```

退出码为 0，没有 `controller_error`。这只说明已编排的实验执行完毕，不代表缺失场景通过。实验使用真实跨进程 SQLite 竞争者，通过 stdin/stdout 管道屏障约定顺序；不是用 sleep 猜测竞争时机。哈希子进程的短周期超时轮询不是竞态证明。

| 文件 | 用途 / SHA-256 |
| --- | --- |
| `evidence/quiescence/authoritative-final.json` | 2,102 条有序环境/进程/SQL/文件/状态事件；`0fa42cf72ef9e1a0d5990f0a4915077a60b2236f4e831e2f43002df3a449592c` |
| `evidence/quiescence/authoritative-final-fixtures.tar.gz` | 276 个合成 DB、sidecar、许可及结果状态成员，无 executable；`6603884edf2937c715b1e0d73e2fb955129c3dc08786fa650e64a400c0203666` |
| `evidence/quiescence/main-verification.json` | 主任务从归档读取准确的合成 DB，再通过最终 bundled peer 独立核对完整 schema、双版本、integrity/FK 和全部19张既有业务表 |
| `evidence/quiescence/regressions.json` | 最终回归命令、退出码、完整输出与源码指纹 |
| `evidence/quiescence/regressions-prior-failure.json` | 保留一次并行单测临时目录名碰撞的失败，不冒充 SQLite 迁移失败，也未删除该记录 |
| `evidence/quiescence/production-preservation.json` | Production 原始文件只读前后观察；不是冻结 C0 或全系统审计 |

归档特意保留 `native-reject-db_symlink` 反例的符号链接元数据，其目标仅为原实验临时根内的另一个合成 DB。**不要将整个归档随意解压到工作或生产目录。** 主任务验证器只读取已确认的普通文件成员，不解压或跟随该链接。

之前的 `experiments.json`、`native-first.json`、`native-canonical.json`、`final.json`、`reviewed-final.json` 及相应归档保留为开发过程证据；不能代替 `authoritative-final`。临时目录里的原始文件不是唯一证据副本。

## 2. 实际环境与配置

- 目标库：项目 `rusqlite 0.37.0` / bundled SQLite **3.50.2**，不是系统 sqlite3、Python 或 Node SQLite 的替代结论。
- `sqlite_source_id`: `2025-06-28 14:00:48 2af157d77fb1304a74176eaee7fbc7c7e932d946bf25325e9c26c91db19e3079`。
- OS：macOS 26.6.2 / Darwin 25.6.0；架构 aarch64；默认 VFS `unix`。完整 `compile_options` 已保存在 peer 和 native 的环境事件中。
- 执行配置：DELETE-only、EXCLUSIVE locking、BEGIN EXCLUSIVE、busy_timeout=0、foreign_keys=1、synchronous=2/FULL、fullfsync=1、NO_CKPT_ON_CLOSE=true、wal_autocheckpoint=0。错误保留 SQLite 主码、扩展码和发生阶段。
- 最终 runtime 二进制 SHA：`5216da5d6daee44354a23293c7183ef69f3286a2ce13a46da9379ec4c25f4110`。控制器逐 fixture 校验二进制未在实验中变更。
- 实验时 `quiescence.rs` SHA：`7cd1ecaf5f64e1ab46a9ec7d937d8071431fc4aea1ea7762e7e450437f3b28e5`。随后仅 `#[cfg(test)]` 临时目录名增加 AtomicU64 计数器，最终源 SHA 为 `2ac06a5c28df1e916832fb04e209bae56ea1960454df57fd372c782e748000e8`。非测试 runtime 代码和上述执行文件 SHA 均未变；最终回归针对修正后的测试代码运行。

## 3. Q01–Q18 对账

PARTIAL 表示已有真实证据，但整项所需子场景尚未齐全；不等于 PASS。

| ID | 结果 | 已有证据 | 仍缺证据 |
| --- | --- | --- | --- |
| Q01 | PARTIAL | idle peer 不阻止取锁；取锁后读写 BUSY | 已知旧 runtime 的分类未与同一次 native 实验整合 |
| Q02 | PARTIAL | 真实读事务阻止取锁，错误码5；仅 BEGIN DEFERRED 可通过 | 同一 DB 读者释放后，使用全新授权再次迁移的串联场景 |
| Q03 | PARTIAL | 写事务使 native 阻断且无 M4；已提交变化触发 C0 不符 | 同一 writer 提交后，用旧 C0 的新 attempt 完整串联 |
| Q04 | PARTIAL | 前检屏障后 idle、reader、writer、completed commit，以及 deferred 对照 | 四种子例与已知 V3 runtime 准入规则整合 |
| Q05 | **PASS** | native 取锁后新进程才 open；锁后、hash 完成、COMMIT 后、post-readback 时真实 SELECT/UPDATE 均 BUSY；无第二次 BEGIN | 无本项已列子场景缺口；不补足 Q12/Q14 的 helper 执行中竞争 |
| Q06 | PARTIAL | M4 语句后、COMMIT 前后 SIGKILL；保留恢复前副本；回读完整 V3/V4；pending 拒绝启动 | 每个崩溃点均再执行同 permit 重放的验证 |
| Q07 | PARTIAL | 真实约束错误19、回滚隔离控制、提交后回读失败 | 真正 pager I/O 错误和 rollback I/O 失败；跳过 rollback 的注入不等效 |
| Q08 | **PASS** | 单 C 固定 M4 提交；完整 V4 schema、双版本及[1,2,3,4]、integrity/FK；主任务对归档 DB 再查全部19张旧业务表，与合成备份逐表一致 | 无本项已列子场景缺口；不是 UI/Owner 业务验收 |
| Q09 | PARTIAL | DELETE 成功；WAL sidecar、前检后切 WAL、孤立 SHM、cold journal 拒绝；OD-04(a)/(b) 未批控制；替换成真实 spill hot-journal 目标时拒绝并保持字节 | 锁前原目标产生 hot journal 的自动恢复竞态；TRUNCATE/PERSIST/OFF/MEMORY 全部控制 |
| Q10 | PARTIAL | 0/100/5000ms 下真实 BUSY 与等待时长 | SQLITE_LOCKED 注入及对应语义 |
| Q11 | **NOT_RUN** | 无真实 Tauri/TS IPC 证据；明确不以 CLI 或历史 node 链代替 | 前端暂停/断联、交错业务 IPC、错误 token、重复请求、提前 commit/end、重启的真实入口验证 |
| Q12 | PARTIAL | 锁内 C0/schema 漂移；helper 锁内超时/不匹配；hash 完成后的竞争写入被拒 | helper 正在执行时的同步竞争；错 inode、截断结果子例 |
| Q13 | PARTIAL | NORMAL 提交释放与 EXCLUSIVE 提交保留的真实对照；raw FD close 反例 | 正常 rollback 完整对照、真实 pager 故障后的锁行为 |
| Q14 | PARTIAL | macOS unix VFS 上，同进程 raw open/read/close 后竞争 writer 成功；正式 helper 结果报告无继承 DB FD | helper 执行中的竞争屏障，因此尚不能将 safe hashing 判为完整验收 |
| Q15 | PARTIAL | manifest 漂移、DB replacement、hardlink、symlink 拒绝；外部合成目标不变；hot-journal replacement 在普通访问前拒绝且 main/journal SHA 不变 | unlink-only、其他锁协议/VFS 配置；不宣称完整对抗性 namespace 防护 |
| Q16 | PARTIAL | claim/consumed/prelock/commit 边界崩溃；持久消费故障控制；成功后重放拒绝；native 继承租约 | 真 fsync crash/IO、双 native gate、native handoff 失败的完整矩阵 |
| Q17 | PARTIAL | 同名错误 M4 表/索引、legacy schema 改动拒绝且无 M4 | 仅旧约束变化的独立子例 |
| Q18 | PARTIAL | WAL reader 与 BEGIN EXCLUSIVE 并存；native WAL 拒绝；禁 close checkpoint 的 sidecar 快照 | clean WAL 首访、checkpoint/main-hash 对照、实际 I/O trace；不支持 WAL |

## 4. 主任务独立回读

执行 `python3 scripts/verify_quiescence_evidence.py`。只从最终归档读取 `native-success` 的普通文件成员，以另一个最终 bundled peer 进程核对：

- `user_version=4`，迁移记录准确为 `[1,2,3,4]`。
- `sqlite_master` 完整定义与 `migrations/v4-schema.json` 一致，而非只比版本号。
- integrity 为 `ok`，FK 无错误。
- 19 张既有业务表全部逐表、逐行与合成 V3 backup 一致，未只抽查 sentinel。
- 归档 SHA、实验 JSON SHA、成功 outcome 的 DB SHA 均一致。

验证器第一次拒绝了归档中故意保存的 symlink 反例。确认准确成员及目标后，改为仅核对其元数据且永不跟随该链接；随后回读通过。这不是删除反例或弱化 DB 打开保护。

## 5. 回归与新旧保护映射

最终回归输出保留于 `regressions.json`：TypeScript 类型检查、287 项既有前端/领域测试、既有 gate 与新入口边界38项、受管隔离25项、native library22项、新 runner7项。输出的实际退出码优先于本报告摘要。一次 runner 并行单测目录名碰撞已保留并修正，最终正常并行运行通过。

| 旧保护 / 问题 | 本轮处理 | 验收边界 |
| --- | --- | --- |
| 全机 R/H 不可证明 | 保留失败历史；新受管范围不把无关 protected PID 当缺失证明 | 不声称旧 R/H 已通过 |
| nested / canonical / manifest / installed identity | 旧测试保留；新 fixture 图及身份反例继续拒绝 | 全 managed inventory 尚未绑定 native |
| 可执行 staging / archive | 新复制从文件创建起不可执行；额外运行入口拒绝 | 整体 S1 安装流程尚未完成 |
| retirement precheck/rollback | 历史 helper 在临时 fixture 回归；真实旧 mutating 入口封锁 | 没有把旧自动恢复接到新 UNKNOWN/V4 后面 |
| sidecar / one-time permit | 旧回归保留；native 增加分阶段观察、durable pending/replay 拒绝 | 恢复和持久故障矩阵未齐 |
| formal preflight/migrate/retirement | 保留预检回归；旧 migrate/retire 明确 BLOCKED；新 native fixture 独立验证 | 缺完整新 formal 工作流，不据此宣称 Python/native 对齐完成 |

## 6. 最终判定与下一步

已完成的实验有保存后证据，但关键缺口不允许用“多数通过”抵消。实施仍为 BLOCKED；`RB-V4-CUTOVER-QUIESCENCE-01` 保持 OPEN。

下一步由隔离实现工作补齐完整 S0–S10 集成、真实 IPC 与本表缺失子场景，再交独立复审。本报告不要求 Owner 现在批准生产切换，也不将未来恢复/sidecar 写入授权提前绑定到 Production。
