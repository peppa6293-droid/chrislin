# WP-RELEASE-REBIND-01 生产门闸重绑定任务书（交执行者）

发布日期：2026-10-27 ｜ 授权：户主会话内确认（授权 ID `owner-approval-ledger-payment-20261027-1`）｜ 性质：P0 恢复生产可用性 ｜ 零代码变更、零重建、零数据改动

---

## 0. 一句话

`/Applications/Personal Finance Console.app` 已是今天 11:29 重建的新包，但生产门闸把「允许启动的可执行指纹」钉死在三件套里，新包启动即 `PRODUCTION_TERMINAL_CANDIDATE_BINDING_MISMATCH`。本批只按 `docs/EXEC-R13B-HOTFIX-RELEASE-REBIND.md` §3 的字段清单做一次**授权重绑定**，让新包能启动。

---

## 1. 现状（审核侧已实测，执行方需复测确认）

| 事实 | 值 |
| --- | --- |
| 安装包可执行（新） | `35c69ba50644920607b5b0b66393c7dcba718aca105c8906cdb83009a7217f92` |
| 门闸记录的旧可执行 | `d407b7bf554263a25c805cfb385b108393e626248a8aeb84f8adf88c0c09c86c` |
| Info.plist 哈希 | `41b8aa5a1c1933531c2d986c25d180590ffbf8920aff4483d791a882dc3cfdcb`（**新旧一致，无需改**） |
| runtime-compatibility.json 哈希 | `f98b7f7bab5161e8c0c6bb93571ac8ce658c20d81785fc5651ac37f2f9c3d509`（**新旧一致，无需改**） |
| 三件套交叉哈希 | 自洽：`terminal.releaseReceiptSha256` = 回执实际、`terminal.consumedLedgerSha256` = 台账实际 |
| 台账条数 | 1，指纹 `d407b7bf…` |
| 迁移许可文件 | 两份均不存在（正确） |
| 生产库 | 1,294,336 字节，mtime 2026-10-24 12:03，**未被动过** |

启动实测：`thread 'main' panicked ... "PRODUCTION_TERMINAL_CANDIDATE_BINDING_MISMATCH"`。

审核侧已在**数据副本**上跑通同一脚本（`R13B_APP_DATA` 指向 `/tmp` 副本）：`--prepare` / `--dry-run` / `--apply` 全部通过，diff 面恰好是 §3 允许的 3 个文件、10 个字段；副本内 `releaseReceiptSha256` 与 `consumedLedgerSha256` 回读一致。真机上未做任何写入。

---

## 2. 授权范围与红线

**授权**：仅 §3 字段清单。授权 ID `owner-approval-ledger-payment-20261027-1`，上一轮 `owner-approval-ux-round2-20261023-1`。

**禁止**（任一触碰即停手报告）：

- 不改任何代码、不重建、不动 `src-tauri`；
- 不动生产库、不动 `backups/**`、不动 `production_integrity_state`；
- 不创建/复活 `production-v8-migration-authorization.json`（或任何 v4 变体）；
- 不改 `Info.plist`、`runtime-compatibility.json`；
- 不追加台账第 2 条（门闸校验写死 1 条）；
- 不把带完整性钥匙的副本放进 `git` 或 `evidence/`。

---

## 3. 执行步骤

### 3.1 前置检查（只读）

```bash
cd "/Users/linte/Documents/ChatGPT/小钱家-新/个人财务模型app开发项目 2"
shasum -a 256 "/Applications/Personal Finance Console.app/Contents/MacOS/personal-finance-console" \
              "/Applications/Personal Finance Console.app/Contents/Info.plist" \
              "/Applications/Personal Finance Console.app/Contents/Resources/runtime-compatibility.json"
pgrep -fl personal-finance-console || echo "无进程"
```

期望：第一行为 §1 的新指纹；后两行与 §1 表中 Info.plist / manifest 哈希一致；无进程。
任何不符 → 停止并报告。

### 3.2 生成脚本（照上一轮改参数，不重写逻辑）

```bash
python3 - <<'PY'
import io
src = "scripts/ux-round2-rebind-candidate-binding.mjs"
dst = "scripts/ledger-payment-rebind-candidate-binding.mjs"
s = io.open(src, encoding="utf-8").read()
rep = [
 ("// UX round2 release: rebind the production gate's candidate executable\n// fingerprint under owner authorization owner-approval-ux-round2-20261023-1,",
  "// Ledger-payment release: rebind the production gate's candidate executable\n// fingerprint under owner authorization owner-approval-ledger-payment-20261027-1,"),
 ('const AUTHORIZATION_ID = "owner-approval-ux-round2-20261023-1";',
  'const AUTHORIZATION_ID = "owner-approval-ledger-payment-20261027-1";'),
 ('const TASK_BOOK = "docs/EXEC-UX-ROUND2-20261023.md §0";',
  'const TASK_BOOK = "docs/WP-RELEASE-REBIND-01-EXEC-INSTRUCTIONS.md §2";'),
 ('const PREVIOUS_AUTHORIZATION_ID = "owner-approval-ux-revamp-20261023-1";',
  'const PREVIOUS_AUTHORIZATION_ID = "owner-approval-ux-round2-20261023-1";'),
 ('const OLD_EXECUTABLE =\n  "bb74f2aa2462e87db26bb2d30ea63f7c05059669a68ef7dc9096c938d8148ece";',
  'const OLD_EXECUTABLE =\n  "d407b7bf554263a25c805cfb385b108393e626248a8aeb84f8adf88c0c09c86c";'),
 ('const NEW_EXECUTABLE =\n  "d407b7bf554263a25c805cfb385b108393e626248a8aeb84f8adf88c0c09c86c";',
  'const NEW_EXECUTABLE =\n  "35c69ba50644920607b5b0b66393c7dcba718aca105c8906cdb83009a7217f92";'),
 ('"ux-round2-20261023-calendar-fix"', '"ledger-payment-20261027"'),
 ('`pre-ux-round2-gate-${stamp}`', '`pre-ledger-payment-gate-${stamp}`'),
 ('name.startsWith("pre-ux-round2-gate-")', 'name.startsWith("pre-ledger-payment-gate-")'),
 ('ownerApproval: "2026-10-23 户主下发 EXEC-UX-ROUND2 任务书（§0 热修授权段）"',
  'ownerApproval: "2026-10-27 户主在会话语义下授权（WP-RELEASE-REBIND-01 §2）"'),
 ('ownerApproval: "2026-10-23 EXEC-UX-ROUND2 任务书 §0"',
  'ownerApproval: "2026-10-27 WP-RELEASE-REBIND-01 任务书 §2"'),
 ('console.log("UX_ROUND2_REBIND_APPLIED");', 'console.log("LEDGER_PAYMENT_REBIND_APPLIED");'),
]
for a, b in rep:
    assert a in s, a[:60]
    s = s.replace(a, b)
io.open(dst, "w", encoding="utf-8").write(s)
print("written", dst)
PY
node --check scripts/ledger-payment-rebind-candidate-binding.mjs
```

期望输出 `written scripts/ledger-payment-rebind-candidate-binding.mjs`。

### 3.3 三连：prepare → dry-run → apply

```bash
node scripts/ledger-payment-rebind-candidate-binding.mjs --prepare
node scripts/ledger-payment-rebind-candidate-binding.mjs --dry-run
node scripts/ledger-payment-rebind-candidate-binding.mjs --apply
```

`--prepare` 期望：`prepared: true`、`auditDir`/`backupDir` 生成、`before` 五个哈希。
`--dry-run` 期望：`diffs.receipt` 含 `candidateExecutableSha256`、`productionAppInventory[0].executable_sha256` 与 `hotfixReleaseRotation.*` 共 8 条；`diffs.ledger` 恰好 1 条 `[0].candidateExecutableSha256`；`diffs.terminal` 恰好 3 条。**多一条即停手**。
`--apply` 期望：最后一行 `LEDGER_PAYMENT_REBIND_APPLIED`，回读三项哈希全部通过（脚本自带断言，失败会抛错）。

### 3.4 启动验收

```bash
open "/Applications/Personal Finance Console.app"
sleep 6
pgrep -fl personal-finance-console
```

期望：进程存在、窗口进入首页、无 panic。若仍报门闸错误，**把错误码原文留证并停手**（不同错误码对应不同字段，不得自行扩大处置）。

---

## 4. 依赖与回滚

- 依赖：`node`（≥22）、`scripts/ux-round2-rebind-candidate-binding.mjs`（未跟踪，工作区已有）。
- 回滚：`--prepare` 生成的两份副本（应用数据目录内 `production-v8-hotfix-audit/ledger-payment-20261027/` 与 `backups/pre-ledger-payment-gate-<时间戳>/`）原样拷回即可恢复三件套；脚本全程原子写（临时文件 + rename）。
- 新脚本与授权文件、审计副本**不进 git**（沿用 r13b / ux-revamp / ux-round2 三轮的做法）。

---

## 5. 回执要求

报告：前置三哈希实测值、三个模式的关键输出、`git status --porcelain | wc -l`、启动结果与首页可见内容。不贴整份 JSON。

做完后本包的 GUI 点击验收（导出备份、固定支出两笔同类别支付）仍由户主完成，不属执行方。
