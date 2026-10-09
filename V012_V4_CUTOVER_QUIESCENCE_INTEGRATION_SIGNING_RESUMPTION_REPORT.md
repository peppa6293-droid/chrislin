# V0.1.2 quiescence 签名环境更新后续跑报告

日期：2026-10-09（Asia/Shanghai）。本报告保留历史 BLOCKED 报告，不覆盖它。

## 结论

最终状态：`PF_V012_V4_CUTOVER_QUIESCENCE_INTEGRATION_BLOCKED`。

原环境缺失项 `MACOS_SIGNING_PREREQUISITE_REQUIRED` 已不再成立：Xcode 与有效 Apple Development 签名身份可用，隔离包实际签名且 deep/strict 校验成功。但 `spctl --assess --type execute --verbose=4` 返回 3 / rejected，当前阻塞为 `BLOCKED_GATEKEEPER_ASSESSMENT`。另有回归失败和尚未验证的打包入口绑定，不能声明 READY_FOR_REAUDIT。

`RB-V4-CUTOVER-QUIESCENCE-01` 保持 OPEN。未执行 Production 切换、数据库迁移、Owner 数据写入；未修改 `docs/CURRENT_PHASE.md`。未关闭 Gatekeeper、移除 quarantine、改签 Production 或尝试绕过系统策略。签名成功不等于启动成功；本轮未启动新构建的合成 app，AMFI 运行结果仍未知。

## 范围与基线

- 工作区：`/Users/linte/Documents/ChatGPT/个人财务模型app开发`。
- 起始 HEAD：`3517a115cd8da78985bd0fc13ab63e81e29c527e`；相关集成基线：`ffa8940da4a5950759a807f7f86333c9c46656fe`。
- 当前用户授权只允许隔离合成续跑、验证与报告；不进入下一阶段。
- 原有九份未跟踪项目文档不改动、不纳入本轮提交。

## 本轮新完成

1. 只读确认 `xcode-select --print-path` 为 `/Applications/Xcode.app/Contents/Developer`，`xcodebuild -version` 为 Xcode 27.0 / 27A266a，codesigning 有效身份 1 个。
2. Tauri 官方打包流程完成；使用 `Apple Development: 8619814730147 (FW5KHTFNZ6)` 实际签名。证书 OU 与包 TeamIdentifier 均为 `SSRKA7A4TN`，不能把 identity 名称的括号内容当 TeamIdentifier。
3. 修正资源配置合并导致生产 manifest 混入的问题。最新包 plist 和 manifest 均绑定 `org.pfc.quiescence.integration`；codesign deep/strict 验证返回 0，资源封印与证书链存在。
4. 增加项目自有 synthetic old-runtime 和 session/PID/hash 绑定的 readiness 握手实现；已编译，真实 S1 尚未执行。
5. Recovery 增加历史 ledger、active claim、fresh authorization/replay 防护和终态前置记录实现；主任务重新运行 Rust 测试通过。只是模块测试，不是 recovery 完整故障矩阵验收。
6. Lease 测试脚本补充重复 gate、native ACK 前后退出等场景；仅静态检查，运行矩阵未执行。

## 构建与签名证据

证据目录均在 `evidence/quiescence-integration/`，包含每步命令、stdout、stderr、SHA-256 与时间：

- `signed-runtime-20261009T022215275268Z/`：构建签名完成；manifest 仍为生产 ID，前置检查拒绝。报告打印另有 None 分支错误，已修正；未启动。
- `signed-runtime-20261009T022507542010Z/`：资源冲突修正；签名验证器错误地将括号值当 TeamIdentifier，拒绝。经只读证书 subject 核对后修正预期；未启动。
- `signed-runtime-20261009T022630059624Z/package-validation.json`：签名通过，Gatekeeper exit 3 / rejected，状态 `BLOCKED_GATEKEEPER_ASSESSMENT`。这不是 AMFI 启动失败记录，不虚构 PID 或截图。

最新 app 可执行文件 SHA-256：`9ee3a55b3326ee62d0fff9a436b384c3e3b624f2b901b28b24569acbca20382e`。

额外只读 `codesign -dr -` 输出：

```text
designated => identifier "org.pfc.quiescence.integration" and anchor apple generic and certificate leaf[subject.CN] = "Apple Development: 8619814730147 (FW5KHTFNZ6)" and certificate 1[field.1.2.840.113635.100.6.2.1] /* exists */
```

证据限制：package receipt 的 designated_requirement 字段仅采集 stderr，实际 requirement 在 stdout；以上保存补足，不将该字段当完整 DR。构建输出同时含 `personal-finance-console` 和 `quiescence-tauri` 两个可执行文件；尚未证明 plist 主入口就是所需隔离 IPC 实现。即使 Gatekeeper 后续放行，也必须先核验并修正这一绑定，不能直接启动。当前不能仅凭签名、plist ID 或 manifest ID 判定运行入口安全。

## 回归与未完成项

完整日志：`evidence/quiescence-integration/regressions-20261009T023534643740Z.json`。运行期间 source drift 为空；总体结果 FAILED，非 PASS。

| 检查 | 实际结果 |
|---|---|
| TypeScript 两项类型检查 | 通过 |
| npm test | 291 通过，1 失败；旧源码断言仍要求 controller 内出现 `env["TAURI_CONFIG"]`，新流程已移到 bundler 配置；尚未完成等价安全断言修正 |
| Production gate / entry boundary 单测 | 38 通过；不连接 Production 数据库 |
| quiescence gate 单测 | 25 通过 |
| 精选 integration 单测 | 2 通过，6 项 fixture 初始化被 Gatekeeper 拒绝；不是业务断言通过 |
| 完整 managed integration suite | BLOCKED_NOT_RUN |
| Rust lib / fixture / Tauri test targets | 分别 29 / 27 / 27 通过；不能替代 app 启动 |
| 合成旧运行时实际 readiness / S1 | 未完成 |
| AMFI 与真实 IPC / Q11 五场景 | 未执行，不能确认 |
| native lease 完整矩阵 | 未执行；ACK 前/中部分 race 尚缺确定性故障注入 |
| recovery 完整 E2E / DB fault matrix | 未完成；普通启动对新 ledger/terminal binding 的独立检查尚待集成核验 |
| 正式 synthetic S0→S10 E2E | 未完成 |

此次 blocked 模式仍运行了六项需要创建签名 fixture 的初始化，全部在 Gatekeeper 前置检查停止；没有启动相应 app。其日志保留，不掩盖为纯静态测试。历史 runner 的跳过理由提到 AMFI/启动拒绝；本轮准确事实只有 Gatekeeper 评估拒绝，没有新的 AMFI 启动观测。

## Production 保护与独立回读

仅原始文件 SHA-256，不打开 SQLite 连接。开始观测 `2026-10-09T02:22:08.606067Z`，结束观测 `2026-10-09T02:35:53Z`；以下哈希前后一致：

| 对象 | SHA-256（before = after） |
|---|---|
| `/Users/linte/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3` | `4b69c93356967fb8eec6fa25b7eedb6cf2a886bddf6b9ea9040182028beacf35` |
| `/Applications/Personal Finance Console.app/Contents/MacOS/personal-finance-console` | `0e6dcb261de20eb96fcb2f85eaa7fe78fc3cd8c72a96bee78856ac081153911f` |
| `/Applications/Personal Finance Console.app/Contents/Info.plist` | `4ffd536b7f152b97e2cccb94c7dc82aaa68918ffb2286bfeba7069fcbed4ea6a` |

`docs/CURRENT_PHASE.md` 与起始 HEAD 无差异，SHA-256 `695c7742af66f3d7f448646ed1f3eeecaa944b923ba5d4f406512ab4e2fd6081`。这些证据不是全 OS 零副作用证明，也不是 SQLite 完整性审计。

## 收据与下一步

实施增量和失败证据作为 checkpoint 提交；不代表完成验收。依据续接及分包验收规则，历史失败不覆盖，子任务模块测试不升级为整体验收。

可交独立审计：**否，尚未达到 ready 标准**。可以只读检查本报告和失败现场，但不能当作正式复审就绪或 blocker 关闭。

后续由 Owner 决定受支持的 macOS 测试/签名路径；不得自动申请公证、上传包、变更系统安全策略。取得新的有效环境证据后，实施方先校正并验证主可执行入口绑定及等价回归，再续跑 S1、lease、recovery、Q11 和正式 E2E。当前停止在报告和提交，不进入下一阶段。
