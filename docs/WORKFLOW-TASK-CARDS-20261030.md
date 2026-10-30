# 小钱家 iOS：任务卡规范与首张试运行卡

日期：2026-10-30　状态：DRAFT，Owner 确认后生效。
本文件给执行与审核 Agent 阅读。**不含任何模型名、排名、价格。** 项目目录（路径含空格，所有命令里必须加引号）：
`/Users/linte/Documents/ChatGPT/小钱家-新/个人财务模型app开发项目 2`

## A. 所有任务卡通用规则（先读完再动手）

1. **先读** `WORKLOG.md` 最近 20 行、`PROJECT-STATE.md` 顶部、本任务卡。然后追加一行 WORKLOG（7 列格式，见 `/Users/linte/Documents/ChatGPT/AGENTS.md`），再开始。
2. **每完成一个动作，立刻追加一行 WORKLOG**，再做下一个动作。方向锚 ≤15 字，填任务卡里的"方向锚"。
3. **只改任务卡"允许改动"列出的文件。** 其他一律不改。看到想改的别的东西，写进回执的"发现"一栏，不要自己改。
4. **绝对不改：** `src/model/**`、`migrations/**`、`src-tauri/gen/apple/**` 里的签名与 bundle id（`DEVELOPMENT_TEAM`、`PRODUCT_BUNDLE_IDENTIFIER`）、任何 `.sqlite3` 数据库文件、`evidence/` 里别的任务已有的文件（只能新增，不能改旧的）。
5. **不提交、不推送 git。** 不安装依赖。不删除任何文件。不使用 `rm -rf`。
6. **不确定就写"待验证"。** 禁止写"应该没问题""看起来通过"。一个"通过"必须附**命令的原始输出**或**文件路径**。
7. **工具退出码 0 不等于验收通过。** 任务卡写的验收标准要逐条对照。
8. **执行方的回执状态只能写 `PENDING_AUDIT`**（已执行，待独立复核）。不得自己写 PASS。
9. **遇到停止条件立刻停**，写回执，状态填 `BLOCKED` 或 `INCONCLUSIVE`，说明原因。不要绕过去。
10. **命令必须在 Mac 终端执行。** 如果你的环境是 Linux 沙箱（没有 `xcrun`、`devicectl`、`codesign`，或 `npx tsc` 报缺原生包），所有"需要 Mac"的步骤不要假装执行：把命令原样写进回执的"待 Owner 运行"清单，状态写 `BLOCKED`。
11. **路径含空格**：命令里项目目录永远用双引号包起来；不要用 `xargs` 处理含这个目录的路径（会被空格拆坏）；在项目目录内用相对路径。
12. **iCloud 换出文件**：原项目目录里的文件可能被换出（`ls -lO` 里有 `dataless`）。读到 `Resource deadlock avoided` 或命令卡住，就停止并报告，不要重试超过 1 次。

## B. 回执格式（每张卡完成后，写进 `evidence/<任务编号>/RECEIPT.md`）

```
任务编号：
执行方：（会话名）
状态：PENDING_AUDIT / BLOCKED / INCONCLUSIVE
做了什么：（每步一行：步骤号 + 一句话）
证据：（每条：说明 + 文件路径 或 命令原始输出）
没做/没验证：
发现（不属于本卡、没有处理的）：
待 Owner 运行：（需要 Mac、手机、解锁、点击的步骤和命令）
```

## C. 复核岗位的通用规则

1. 复核必须在**单独会话**进行，不能与执行方共用上下文。
2. 不改任何代码或文档（除了写自己的 `REVIEW.md`）。不替执行方补证据。
3. 读执行方的 `RECEIPT.md` 和它列出的证据文件，**不要相信回执里的结论**，自己重跑第 B 节要求的命令。
4. 逐条对照任务卡的"验收标准"，每条写：标准原文 / 你看到的实际 / 通过或不通过 / 证据路径。
5. 回执状态五选一：`PASS`（全部标准满足且证据独立核实）、`FAIL`（有可核实且未解决的缺陷，写明哪条）、`BLOCKED`（被权限、环境、手机等阻断，写明原因）、`PENDING_AUDIT`（还缺独立证据）、`INCONCLUSIVE`（证据缺失或矛盾）。
6. 不能因为"执行方说过了"就写 PASS。找不到原始证据就写 `INCONCLUSIVE`。
7. 复核结果写进 `evidence/<任务编号>/REVIEW.md`，并追加一行 WORKLOG。

## D. 任务卡模板

```
任务编号：M?-T??
方向锚：（≤15字）
岗位：执行 / 复核
目标：（一句话）
允许改动：（文件白名单；没有则写"只写 evidence/<任务编号>/ 与 WORKLOG.md"）
禁止：（在通用规则之外，本卡特有的）
前置条件：（必须先成立的事；不成立就停）
步骤：（每步：命令 / 预期输出 / 失败时怎么办）
验收标准：（可数的、可复核的条目）
证据路径：evidence/<任务编号>/
停止条件：（出现就停并写 BLOCKED 的情况）
交付物：
```

---

# 首张试运行卡：M1 收尾核验

任务编号：M1-T07
方向锚：M1收尾核验
岗位：执行（由独立复核岗位复核）
目标：确认 M1 当前状态在 Mac 上全部门禁通过，核对保护区与签名没有变化，范围对照"不做"清单，并把状态文件更新到真实进度。**这是纯重复核验，不改业务代码。**

允许改动：
- 新建 `evidence/m1-t07-20261030/` 下的所有文件
- 追加 `WORKLOG.md`
- 追加（只追加，不改已有行）`PROJECT-STATE.md` 末尾一个新章节，标题 `## 2026-10-30 M1 收尾核验`

禁止：
- 改 `src/**`、`tests/**`、`migrations/**`、`docs/` 里的任何已有文件
- 修复门禁里发现的任何问题（只记录，不修）
- 提交 git

前置条件：
- 你能在 Mac 终端执行命令。如果不能，停止，写 `BLOCKED`，把下面命令整理成清单交给 Owner。

## 步骤

**步骤 1：基线**
```bash
cd "/Users/linte/Documents/ChatGPT/小钱家-新/个人财务模型app开发项目 2"
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git merge-base --is-ancestor 936118b HEAD && echo "baseline 936118b is an ancestor of HEAD"
```
预期：分支 `feat/mobile`；第三条命令输出 `baseline 936118b is an ancestor of HEAD`（`936118b` 是 2026-10-30 的 M1 基线提交，HEAD 可以是它或它之后的、只含文档的提交）。把三条输出原样存入 `evidence/m1-t07-20261030/git-head.txt`。
不符：停止，写 `INCONCLUSIVE`。
说明：本卡之后所有"你新增了什么"的判断，都以 `936118b` 为基线：`git diff --name-status 936118b -- src tests migrations` 必须没有任何输出；整体 `git diff --name-status 936118b` 里除了本会话新增的 `evidence/m1-t07-20261030/`、`WORKLOG.md`、`PROJECT-STATE.md` 之外不应出现别的文件。`git status` 里已有的 `evidence/m1-post-commit-gates-20261030/` 与 `evidence/wp-ui-visual-01/...` 三个目录不是本卡产生的，不要动。

**步骤 2：一键门禁**
```bash
bash scripts/m1-gates.sh evidence/m1-t07-20261030/gates
```
预期（最后几行）：
```
lint exit=0
tsc exit=0
test exit=0
 Test Files  61 passed (61)
      Tests  629 passed | 44 skipped (673)
protected hash SAME as S0 (5eb32540f2bdbdaacfebccfd9ec7a94080c8ddf3948d5e4ce26a2da5dd2e2da3)
gates rc=0
```
不符：**不要修**。把 `evidence/m1-t07-20261030/gates/` 里的 `*.log` 保留，写 `FAIL` 候选发现，继续做步骤 3 到 5，最后在回执里列出每个不符项。
如果命令本身报"找不到 `npx`/缺原生包"：停止，写 `BLOCKED`，原因 = 环境，不是代码失败。
如果测试报 `Failed to start forks worker`：脚本已用 `--pool=threads`；仍出现则停止并写 `BLOCKED`。

**步骤 3：签名与身份**
```bash
cat evidence/m1-t07-20261030/gates/signing.txt
```
预期恰好包含（顺序无所谓，可重复）：`DEVELOPMENT_TEAM = "SSRKA7A4TN";` 与 `PRODUCT_BUNDLE_IDENTIFIER = com.personalfinance.console.smoke;`
不符：写 `FAIL`，列出实际内容。

**步骤 4：范围对照**
逐条核对"不做"清单在**当前真实入口**里没有入口。这 8 条每条给出命令输出：
```bash
for w in 资产 债务 还款 进展 优先行动 导入 导出 周期 提醒 多账本 预测 固定支出 我的财务; do printf "%s: " "$w"; grep -c "$w" src/ui/M1Home.tsx; done
grep -n "scope" src/main.tsx src/ui/App.tsx | head
```
预期：`src/ui/M1Home.tsx` 里"资产""债务"各出现 1 次（都在同一行说明文字"没有计入你没录入的资产和债务"里），其余 11 个词都是 0；`src/main.tsx` 没有 `scope`；`src/ui/App.tsx` 第 37 行 `scope = "M1",`。（我已在 2026-10-30 实测这些输出与预期一致。）
不符：写 `FAIL`，贴出输出。

**步骤 5：真机取证（需要 Owner）**
这一步需要 iPhone 连接并解锁。如果你的环境没有 `xcrun`，不要执行，把下面命令原样写进回执的"待 Owner 运行"：
```bash
DEV=00008140-001C55E91A40801C; ID=com.personalfinance.console.smoke
xcrun devicectl device copy from --device $DEV --domain-type appDataContainer --domain-identifier $ID --source "Library/Application Support/$ID/personal-finance-console.sqlite3" --destination evidence/m1-t07-20261030/device.sqlite3
shasum -a 256 evidence/m1-t07-20261030/device.sqlite3
sqlite3 -readonly evidence/m1-t07-20261030/device.sqlite3 "select count(*) from profiles; select count(*) from expenses; select count(*) from expense_records;"
```
预期：库的 `sha256` 仍是 `345ac2d2dcf9e7760a9cb98b3f68516b4caaad9ad1d4c5242c4c8479d72bbf73`（如果 Owner 之后没有再记账）；`profiles=1`、`expenses=4`、`expense_records=4`。
哈希不同但行数更多，说明 Owner 之后又记了账，不算失败，如实记录。

**步骤 6：未提交状态**
```bash
git status --short | grep -v ' 2\.' > evidence/m1-t07-20261030/git-status.txt
wc -l evidence/m1-t07-20261030/git-status.txt
```
记录行数。只记录，不处理。预期（本卡开始前）：4 项 `??`——`evidence/m1-post-commit-gates-20261030/` 和 `evidence/wp-ui-visual-01/` 下的 3 个目录——外加 `WORKLOG.md` 的 ` M`。如果出现 `src/`、`tests/`、`migrations/` 下的任何改动，写 `FAIL` 并停止。

**步骤 7：更新 `PROJECT-STATE.md`（只追加）**
在文件末尾追加一个章节，只含这些事实，**每条标注来源文件**：
- M1 步骤 0 到 6 已在真机通过（来源：`evidence/m1-s0-20261030` 到 `evidence/m1-s6-20261030` 各自的 `S*-REPORT.md`）
- 平台修复已装机（来源：`docs/M1-PLATFORM-FIXES-20261030.md`）
- 审查报告与待决问题（来源：`docs/M1-AUDIT-20261030.md`、`docs/M1-OWNER-FEEDBACK-20261030.md`）
- 本次门禁结果（来源：`evidence/m1-t07-20261030/gates/exit-codes.txt`）
- 尚未提交的改动数量（来源：步骤 6）
不要写"M1 已完成"或"通过"，写"M1 步骤 0 到 6 的证据已存在，步骤 7 的独立复核待做"。

## 验收标准（复核岗位逐条对照）

1. `evidence/m1-t07-20261030/git-head.txt` 存在，分支为 `feat/mobile`，且含 `baseline 936118b is an ancestor of HEAD`。
2. `gates/exit-codes.txt` 末尾含 `gates rc=0`，且 lint、tsc、test 三个 exit 都是 0，测试数字为 61 个文件、629 通过、44 跳过。
3. `gates/protected-now.sha256` 的值等于 `5eb32540f2bdbdaacfebccfd9ec7a94080c8ddf3948d5e4ce26a2da5dd2e2da3`。
4. `gates/signing.txt` 只含上述两种设置，值如步骤 3。
5. 步骤 4 的 13 个词的计数全部在回执里，符合预期或已标 FAIL。
6. 步骤 5 要么有真机输出，要么明确列在"待 Owner 运行"，**不得写已通过**。
7. `PROJECT-STATE.md` 末尾有新章节，每条事实有来源，没有"已完成/已通过"字样，没有改动旧内容（用 `git diff PROJECT-STATE.md` 核对只有新增行）。
8. `WORKLOG.md` 每个步骤至少一行，7 列格式。
9. 没有改动 `src/**`、`tests/**`、`migrations/**`、`docs/` 已有文件（用 `git status` 与门禁里的保护区哈希核对）。

## 复核岗位的额外步骤

- 自己重跑 `bash scripts/m1-gates.sh evidence/m1-t07-20261030/review-gates`，与执行方的 `gates/exit-codes.txt` 比较。
- 用 `diff` 核对 `PROJECT-STATE.md` 只新增。
- 抽查 `evidence/m1-s5-20261030/S5-REPORT.md` 里引用的截图文件确实存在。

## 停止条件

- 当前分支或 HEAD 不符，且无法解释。
- 命令在 Linux 沙箱里无法运行。
- 读文件出现 `Resource deadlock avoided`。
- 门禁结果与预期不符（**记录后继续做其余步骤，但最终状态不得写 PASS**）。
- 任何步骤需要改 `src/**`、`tests/**`、`migrations/**`。

## 交付物

`evidence/m1-t07-20261030/RECEIPT.md`（执行）、`evidence/m1-t07-20261030/REVIEW.md`（复核），以及上述证据文件。

---

# 后续任务卡的拆分模式（牵头人使用）

下面是我为后续功能预先定好的"拆卡模式"，不是已授权的任务，每张实际任务仍要单独出卡并经 Owner 确认。

| 类型 | 谁做 | 例子 |
|---|---|---|
| 口径与设计 | 牵头人 | 现金是否随消费扣减；固定支出页的信息结构；底部弹层的交互 |
| 重复改动 | 执行岗位 | 给 N 个组件批量加按下反馈；批量替换样式变量；补既有模式的测试 |
| 门禁、取证、读库、状态更新 | 执行岗位 | 每次装机前后的取库对比、跑门禁、写证据 |
| 复核 | 复核岗位 | 每个会改共享逻辑或进手机的任务 |
| 手机上看和点 | Owner | 每次装机后的截图确认 |

**一条硬规则：** 任何会碰财务计算（`src/model/**`、`product-service.ts`、`monthly-model-service.ts`）、数据库结构（`migrations/**`）、两本账同步（`v2-expense-service.ts`、`repositories.ts` 的写路径）的任务，**不分派给执行岗位**，由牵头人自己做或牵头设计后再拆。M1 里发现的几个真问题（现金不扣、未录债务抬高建议上限、建议为 0 时隐藏超支）全部出在这一类代码上。
