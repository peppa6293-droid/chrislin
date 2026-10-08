# V0.1.2 V4 Cutover Inventory — Phase A Capability Report

日期：2026-10-08（Asia/Shanghai）

项目：`/Users/linte/Documents/ChatGPT/个人财务模型app开发`

最终状态：`PF_V012_V4_CUTOVER_INVENTORY_CAPABILITY_BLOCKED`

## 1. 结论与停止点

普通权限下的批准契约能力未被证明。**停止在 Phase A；不实施完整门禁，不进入 Phase B。**

| 能力 | 唯一结论 | 实际含义 |
| --- | --- | --- |
| R：运行 executable 身份 | `R_CAPABILITY_INSUFFICIENT` | 原生路径和 PID/start 有用，但未可靠绑定运行映像；路径替换与 exec 已复现反例 |
| H：精确 DB namespace 引用 | `H_CAPABILITY_NOT_PROVABLE_WITH_CURRENT_APPROACH` | 当前路径查询会漏旧 vnode；protected PID、历史身份链、fileport 全覆盖未证明，不能签发 ABSENT_PROVEN |
| App 目录图 | `APP_GRAPH_CAPABILITY_PROVEN` | 仅授权 §6 A–G 的隔离目录图原型；不是完整 App collector PASS |

`RB-V4-CUTOVER-INVENTORY-01 = OPEN`。原因仍是为真实 macOS 切换改变已审计 inventory contract，且新契约能力未满足。`RB-V4-OLD-RUNTIME-01 = CLOSED` 保留历史 Owner closure，不重开。

Production V4 Migration = **NOT AUTHORIZED**。没有创建实施完成报告，也没有把“夹具行为符合预期”说成“安全能力通过”。

## 2. 来源、环境、边界

- 当次授权：`/Users/linte/.codex/attachments/5cb565b3-653a-4abd-bf25-829e35b1b16c/已粘贴的文本.txt`，仅 Phase A 隔离验证、只读宿主观察及条件式 Phase B。
- 设计：`V012_V4_CUTOVER_INVENTORY_GATE_DESIGN_REVIEW.md`，重点 §2–5、§7–9、§14。没有降低其 threat model。
- 已通过 `read_thread` 读取引用聊天：`个人财务模型｜评审 V4 切换盘点门禁`，`01a11b15-9539-7411-ad92-9b31b75bc89a`。历史记录不是新授权。
- 起始 HEAD：`c3a1d69857beff7dc96a145aebab93691e2d1c53`。既有八份未跟踪设计/计划/独立审计文档保留，不纳入本轮提交。
- 实测 macOS 26.6.2 / Darwin 25.6.0 / arm64，ordinary UID 501。使用系统 clang、Python、libproc、lsof 4.91（libproc-based）。没有 sudo、切换账号、修改权限、安装服务或申请 entitlement。
- R/H 可执行文件、SQLite、sidecar、映射均为新建临时合成夹具。只终止自己创建的进程；临时测试树在退出时清理。生产仅做文件字节哈希/stat 和目录项名称的只读前后核对，不建立 SQLite 连接。

## 3. R1–R8 实测

来源：`scripts/inventory_capability/r_fixture.c`、`r_native.c`、`r_run.py`；保存 `evidence/inventory-capability/r_result.json`。主任务独立复跑到 `r_independent_result.json`，逐项回读实际原生返回，不仅看子任务结论。

| 用例 | 观察 | 契约判断 |
| --- | --- | --- |
| R1 expected exe | `proc_pidpath` 返回实际夹具路径，路径文件 hash 匹配 | 有效提示，不单独证明内存映像字节 |
| R2 renamed exe | 启动后改名，原生路径更新至新名字 | 不依赖 basename |
| R3 symlink launch | 返回实际目标路径 | alias 可关联，但仍需映像绑定 |
| R4 hardlink launch | stat dev/inode 与原件一致 | 同文件身份已观察 |
| R5 copied same hash | 不同 inode、相同 SHA | hash 可发现复制，但当前路径文件不是运行映像证明 |
| R6 argv/name spoof | 两方向 argv0 伪装均不改变原生路径来源 | argv/name 不能作最终身份；无需逐无关 PID 的 lsof txt 才获得路径提示 |
| R7 unlink/replace | unlink 后 path 查询 0/ENOENT，但 child 仍回应；原路径原子替换后 path 仍指该路径，hash 却属于新 non-target，旧 target 仍回应 | 必须 UNKNOWN；不能 hash 新文件后排除旧进程 |
| R8 PID/start stability | 同一进程重复采样稳定；exec 到另一程序后 PID/start tuple 仍相同 | start 可辅助 PID reuse 检查，不能充当 exec generation；未强制产生 PID reuse，不声称该负例全覆盖 |

额外只读 PID1 边界：`proc_pidpath=/sbin/launchd` 成功，`PROC_PIDTBSDINFO` 返回 0 / EPERM。未取得 start identity，不能由路径成功推导完整 R 排除证据。

未证明的是 kernel-bound 主运行映像 vnode/bytes 绑定、exec generation/连续保障、全部 PID（其他用户/受保护域）覆盖。没有声称所有其他 macOS 原生机制都不可能，也没有声称提权必能补齐。

## 4. H1–H13 实测

来源：`h_native.c`、`h_probe.py`；正式接受的本轮能力证据是 **`h_results_corrected.json`**，不是初次控制失败的 `h_results.json`。

工具组合：精确路径 `proc_listpidspath(PROC_ALL_PIDS, ..., flags=0)`；目标 holder 的 `PROC_PIDLISTFDS` / `PROC_PIDFDVNODEPATHINFO`；region path 枚举；fileport 列表边界；`lsof -nP +w -F0pcfDins -- <synthetic-path>`。没有查询 Production 文件句柄。

| 用例 | 实测/范围 | H 判定 |
| --- | --- | --- |
| H1 DB open | 独立进程用 SQLite 打开合成 DB；原生目标查询及 lsof 均列出 holder | PRESENT |
| H2 DB closed | holder 确认 close、退出；creator 连接亦显式 close；精确目标空 | 受控 holder 已关闭；全宿主仍 UNKNOWN，非 ABSENT_PROVEN |
| H3 WAL open | 独立合成 `-wal` 文件 FD，命中 inode/holder | PRESENT；这是文件引用控制，不冒充真实 WAL 事务测试 |
| H4 SHM open | 独立合成 `-shm` 文件 FD，命中 | PRESENT |
| H5 journal open | 独立合成 `-journal` 文件 FD，命中 | PRESENT |
| H6 hardlink/alias | hardlink、POSIX symlink 两种；不同路径仍命中相同文件身份 | PRESENT；不代表 Finder alias 已实现 |
| H7 renamed while held | 旧文件改名，同名新文件创建；当前路径查询空 / lsof exit1 空；旧 inode FD 仍存在，已知新名字查询能找到 | current-path-only 会漏报；已知旧身份时 PRESENT，首次采集无 lineage 时 UNKNOWN |
| H8 unlinked while held | 旧文件 unlink、同名新 inode 创建；查询当前路径空，但 native FD 与 child fstat 均证实旧 inode 仍活着 | 同上，`BLOCKED_TARGET_LINEAGE_UNKNOWN` |
| H9 mmap | mmap(2) 后 close 原 FD；目标数字 FD=0、目标 region=1，child 仍能读取字节；lsof txt 和路径查询检出 | 此同权限映射 PRESENT；不能把 FD 空当引用空 |
| H10 another ordinary process | 所有正向 holder 均为不同于 collector 的 ordinary UID501 进程 | 已覆盖同用户不同进程；其他 UID 未测，未切账号/伪造成功 |
| H11 protected PID | PID1 BSD/FD/region/fileport 均返回 0 / EPERM；精确查询仍为空 | UNKNOWN；没有 root-holder 正向控制，不能声称实际漏掉某个 root holder |
| H12 warning/error/timeout | warning、error、exit0 空/截断为明确标注的注入输入；真实受控工具子进程 timeout | 均 UNKNOWN；不是宿主真的发生 warning 的声明 |
| H13 exit1 empty | lsof 实际 exit=1，stdout/stderr 均为空 | UNKNOWN，绝不是 absence |

H7/H8 的 native 查询拿到旧 inode，是因为**夹具创建者事先记录了它**。这构成 exact-current-path 方案的真实反例，却不是首次 collector 自动恢复历史身份链的实现。不能把测试 oracle 的已知身份偷偷放进生产假设。

`proc_listpidspath` 部分成功/空返回同时留下 errno22；errno 在非失败返回时不能被单独当成错误或静默漏报证据。本结论依赖返回集合、实际旧 vnode 持有证据和明确 EPERM，未从 errno22 推导额外事实。

`classify_lsof` 只是隔离负向语义实验，不是正式 parser：它尚未完整按 dev/inode、PID/start 校验字段。正向 PRESENT 由保存原始输出、受控 holder 和 native 身份对照支持。其缺陷未进入任何正式入口。fileport 仅采集列表返回，详情/正向 fileport fixture 未实现；region 终止和固定容量也没有形成全覆盖证明。因此整个实验从未提供 H=ABSENT_PROVEN。

### 测试夹具纠正记录

初次 H13 实际为 PRESENT，不是 exit1：Python SQLite context manager 提交但未 close，creator 自己还持有 DB。初次 Python mmap 也复制了 FD，不能作为“FD 全关仅映射”控制。原始失败证据保留 `h_results.json`，未删改成成功。

一次有依据纠正：显式 close creator；以 libc mmap(2) 创建映射并关闭原 FD。修正后 H13 真正 exit1 空输出，H9 native 验明数字 FD=0/region=1。新增相应断言，全部通过。没有重复尝试无新依据的失败路径。

## 5. 为什么不简化成“只需要提权”

权限缺口确实存在；**`ELEVATED_PRIVILEGE_REQUIRED` 只描述受保护进程读取这一子问题，不是本轮唯一或最终状态**。

缺少的目标事实：受保护/其他用户进程是否持有指定 DB/sidecar 的当前及相关旧 vnode、mmap/fileport；其真实 PID/start/exec 身份；首次观察前 unlink/replace 的目标 lineage；检查到迁移写入期间是否出现新 holder/runtime。

供 Owner 另行评审的最小只读机制候选：固定 scope、短时单次 native collector，在额外读取权限获批后枚举进程及 FD/vnode/region/fileport，输出仅限目标身份匹配、每项拒绝/截断/退出及时间区间；不接受 shell 命令、不读取财务行、不写库、不启动 App、不安装常驻服务。先在不同 UID/受保护权限的**合成 holder**上验证，再讨论业务使用。此为提案，未请求或使用 sudo，未验证该权限对 SIP/保护域一定足够。

即使其可见性提高，也不能据此宣称恢复所有首次观察前历史、取得完整主映像绑定或消除窗口竞态。还需可核验 lineage 起点、运行映像绑定和经批准的持续观察/准入方案；不允许以新假设默默缩小 threat model。因此选择 `H_CAPABILITY_NOT_PROVABLE_WITH_CURRENT_APPROACH`，而不是声称已证明“只差提权”。

## 6. App graph 原型 A–G

`graph_prototype.py` 与 `graph_fixtures.py` 仅针对临时 fixture domain；没有安装 App 扫描，没有正式根路径 override。

| 授权项 | 主任务独立复跑结果 |
| --- | --- |
| A framework graph | 1,502 symlink 边，9 canonical 节点，0 UNKNOWN；不按品牌/Frameworks 名称跳过 |
| B unrelated outer + nested target | 多层无关 App 内发现 Production-like 目标 |
| C hidden target symlink | 任意名字链接保留对隐藏/改后缀目标的 reachability |
| D external target | 未声明范围 UNKNOWN；显式有限 root 则发现并保留 alias 边，两种均测试 |
| E cycles | 按 dev/inode 有限终止，两条 alias 仍可达目标 |
| F malformed unrelated app | 真实 app 边界保持 BUNDLE_IDENTITY_UNKNOWN |
| G flat/wrapper/nested | flat 与 nested 可表示；wrapper 保持 WRAPPER_PARSER_NOT_APPROVED，不继承 child 身份 |

保存 `graph_capability.json` 和主任务复跑 `graph_independent_result.json`。8 个场景（D 拆两种）均达到上述原型预期。每个结果仍 `appComplete=false`，总 `fullAppInventoryCapabilityProven=false`。

Finder alias/bookmark 安全识别/无挂载解析未实现，是完整批准 threat model 的阻塞缺口，不能删 A18 或声称正常启动路由全覆盖。wrapper 平台解析、严格 candidate/exe byte binding、目录/symlink 连续稳定性也未实施。初次开发中 Contents/Info.plist 被误认作 flat 边界，原型已用显式平台约束纠正；不是生产布局解析器的批准。

## 7. Phase B、竞态与历史回归

Phase A 的三项 AND 条件不成立，未启动以下工作：

- 完整门禁重写、versioned Python/native contract、正式 preflight/migrate 入口新逻辑。
- A01–A20 / P01–P20 全矩阵。§3–6 是 Phase A 对应子集，不把它们改名成全矩阵 PASS；Finder alias、PID reuse、其他 UID、fileport 等缺口明确保留。
- inventory → receipt → permit → native consume → migration start 连续绑定/准入保护。`SNAPSHOT_RACE_PROTECTION_NOT_IMPLEMENTED`；两次快照、TTL、同 PID/start 均不冒充连续保证。
- 受影响历史实施回归、正式入口隔离执行。没有修改运行代码，因此本轮以全部既有受管运行代码字节不变保留历史保护；**没有声称重新运行或重新审计 PASS**。

原 nested / UNKNOWN blocks / rollback / WAL-SHM-journal / manifest bytes / installed identity / one-time replay / native guard / diagnostic receipt / Python-native alignment / structured BLOCKED / formal run_gate protections均未改。日后实施仍需按批准设计全部回归，不能引用本轮测试代替。

未创建真实 migration authorization、permit、release receipt、Production backup；未构建/冻结/安装最终候选；未替换/退役/启动 Production；未写/checkpoint/migrate 库或修改 Owner 数据；未进入 Stage4–7/V0.2。

## 8. Production 与历史决定保留

开始只读指纹：DB SHA `4b69c93356967fb8eec6fa25b7eedb6cf2a886bddf6b9ea9040182028beacf35`，size 229376、inode 21120760。该 SHA 不是冻结 C0。

安装 exe SHA `0e6dcb261de20eb96fcb2f85eaa7fe78fc3cd8c72a96bee78856ac081153911f`；Info.plist SHA `4ffd536b7f152b97e2cccb94c7dc82aaa68918ffb2286bfeba7069fcbed4ea6a`。前后核对范围是这两个文件，不夸称整个 bundle 所有字节已枚举。

前后保存证据：`h_preservation_before.json`、`h_preservation_after.json`；独立机器核对见 `verification.json`。生产 DB/上述安装文件 hash、stat 未变，app-data 仍只有原 sqlite3，无新 sidecar/permit/receipt。全部既有 tracked 文件除明确治理更新的 `docs/CURRENT_PHASE.md` 外不变，原有报告均不变。没有 SQL 查询财务行、没有备份/恢复操作。

¥13.10 继续为 `OWNER_RECOGNIZED_NORMAL_USE_EXPENSE`，未重新调查或归类为不明。`PF_V012_V4_OWNER_SANDBOX_ACCEPTED` 保留；证据问题仅 `OWNER_ACCEPTANCE_RECORD_NOT_PRESENT_IN_CURRENT_PROJECT_EVIDENCE`，未重跑 Sandbox 接受。

## 9. 复现、保存与任务收据

从上述真实项目根执行；这些命令仅编译/运行隔离测试，不构建生产候选：

```sh
python3 scripts/inventory_capability/r_run.py --output evidence/inventory-capability/r_independent_result.json
python3 scripts/inventory_capability/h_probe.py --output h_results_corrected.json
python3 scripts/inventory_capability/graph_fixtures.py
python3 scripts/inventory_capability/h_verify.py
```

原始 JSON 保留实际 argv、时间、PID/start、文件身份、native 返回/错误、lsof 原始 stdout/stderr/exit（适用时）；R 构建来源 SHA 和 H source SHA 已保存。graph 为已清理夹具的节点/边证据，不把临时路径当现存交付物。统一输入/源文件 SHA 见 `verification.json`。

分包 `PKG-R-1008` 只写 r_*；`PKG-G-1008` 只写 graph_*。主任务负责 H、汇总、治理状态和 Git；独立复跑 R/graph，逐项复核 H raw 输出。R 分包另只读交叉检查 H 反例、权限及结论，没有声称这是未来独立正式审计。模型/推理参数未覆盖；实际后端模型、token/credits/金额未知。

项目记忆站索引未匹配该项目，受管记忆仅定向定位；当前事实来自当次授权/设计/保存证据。连续性规则用于保留历史 closure/Sandbox 接受；未写受管长期记忆。仅提交本轮文档、治理更新、隔离 test-evidence；不 amend 既有提交，不夹带独立审计报告。

已完成：Phase A 能力实验、原始证据、独立复跑/回读及阻塞报告。未完成：完整实施、全矩阵、连续竞态保证及独立实施复审。下一步由 Owner 审阅上述缺口，决定是否另行授权机制设计/最小只读权限能力验证；本任务不自动提升权限、不继续生产切换。到报告及本轮 test-evidence 提交为止停止。
