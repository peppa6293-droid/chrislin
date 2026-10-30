# M1-T07 执行回执

任务编号：M1-T07
执行方：M1-T07执行员（deepseek-v4-1-flash-261017，在本机 Mac 终端直接执行，非 Linux 沙箱）
状态：PENDING_AUDIT

做了什么：
- 步骤 1 基线：跑 `git rev-parse --abbrev-ref HEAD`、`git rev-parse HEAD`、`git merge-base --is-ancestor 936118b HEAD`，三条输出存入 `evidence/m1-t07-20261030/git-head.txt`。
- 步骤 2 一键门禁：跑 `bash scripts/m1-gates.sh evidence/m1-t07-20261030/gates`（约 6 分钟，后台执行完成后取回输出）。
- 步骤 3 签名与身份：`cat evidence/m1-t07-20261030/gates/signing.txt`，并与 `gates/protected-now.sha256` 对照。
- 步骤 4 范围对照：13 个"不做"关键词在 `src/ui/M1Home.tsx` 的 `grep -c` 计数、`grep -n "scope" src/main.tsx src/ui/App.tsx`，另取"资产/债务"命中行原文。
- 步骤 5 真机取证：`xcrun devicectl list devices`（只读）→ `xcrun devicectl device copy from`（只读）取 appDataContainer 内 `personal-finance-console.sqlite3` → `shasum -a 256` → `sqlite3 -readonly` 计数与 `pragma integrity_check`。
- 步骤 6 未提交状态：`git status --short | grep -v ' 2\.'` 存文件并 `wc -l`。
- 步骤 7 状态更新：在 `PROJECT-STATE.md` 末尾追加 `## 2026-10-30 M1 收尾核验` 章节（只追加，`git diff -U0` 显示 0 删除行）。

证据：

1) 步骤 1（基线）——文件 `evidence/m1-t07-20261030/git-head.txt`，原始输出：
```
feat/mobile
81c8cd7f6a8c41a15cff02f60c9765383864f1d9
baseline 936118b is an ancestor of HEAD
```
说明：HEAD 不是 936118b 本身，而是其后的 3 个纯文档提交 `04ca8b0`、`5807ca0`、`81c8cd7`（见 `evidence/m1-t07-20261030/post-baseline-commits.txt`），符合任务卡步骤 1 "HEAD 可以是它或它之后的、只含文档的提交"。

2) 步骤 2（门禁）——文件 `evidence/m1-t07-20261030/gates/exit-codes.txt`，末尾原始输出：
```
lint exit=0
tsc exit=0
test exit=0
 Test Files  61 passed (61)
      Tests  629 passed | 44 skipped (673)
protected hash SAME as S0 (5eb32540f2bdbdaacfebccfd9ec7a94080c8ddf3948d5e4ce26a2da5dd2e2da3)
gates rc=0
```
与任务卡预期逐行一致。明细日志：`gates/lint.log`、`gates/tsc.log`（0 字节）、`gates/test.log`。

3) 步骤 3（签名与身份）——文件 `evidence/m1-t07-20261030/gates/signing.txt`，全文只有两行：
```
				DEVELOPMENT_TEAM = "SSRKA7A4TN";
				PRODUCT_BUNDLE_IDENTIFIER = com.personalfinance.console.smoke;
```
保护区哈希 `evidence/m1-t07-20261030/gates/protected-now.sha256`：
```
5eb32540f2bdbdaacfebccfd9ec7a94080c8ddf3948d5e4ce26a2da5dd2e2da3
```

4) 步骤 4（范围对照）——文件 `evidence/m1-t07-20261030/step4-scope-check.txt`，原始输出：
```
资产: 1
债务: 1
还款: 0
进展: 0
优先行动: 0
导入: 0
导出: 0
周期: 0
提醒: 0
多账本: 0
预测: 0
固定支出: 0
我的财务: 0
--- scope in entry files ---
src/ui/App.tsx:37:  scope = "M1",
src/ui/App.tsx:41:  scope?: "M1" | "FULL";
src/ui/App.tsx:380:  if (scope === "M1") return <M1Home home={home} onRecordExpense={recordExpense} />;
```
"资产""债务"的唯一命中行原文（`src/ui/M1Home.tsx:122`）：
```
122:              建议额度只按收入、必要支出和安全目标计算，没有计入你没录入的资产和债务。
```
`src/main.tsx` 无任何 `scope` 命中（上面 grep 输出里没有 main.tsx 行）。

5) 步骤 5（真机）——文件 `evidence/m1-t07-20261030/devicectl-list.txt`、`device-copy.log`、`device-readback.txt`：
```
林特的iPhone  00008140-001C55E91A40801C (UDID)  connected  iPhone 16 Pro (iPhone17,1)  physical
File received from Device
=== shasum -a 256 ===
345ac2d2dcf9e7760a9cb98b3f68516b4caaad9ad1d4c5242c4c8479d72bbf73  evidence/m1-t07-20261030/device.sqlite3
=== sqlite3 counts ===
1
4
4
=== integrity / user_version / tables ===
ok
8
30
```
即 profiles=1、expenses=4、expense_records=4，哈希与任务卡预期值相同。注意：该数据库副本命中 `.gitignore:21 /evidence/m1-*/*.sqlite3`，不会进入 git 历史（见 `guards.txt`）。

6) 步骤 6（未提交状态）——文件 `evidence/m1-t07-20261030/git-status.txt`，`wc -l` = 6：
```
 M WORKLOG.md
?? evidence/m1-post-commit-gates-20261030/
?? evidence/m1-t07-20261030/
?? evidence/wp-ui-visual-01/p1-p4/interaction-i01-batch-a-review-20261029/
?? evidence/wp-ui-visual-01/p1-p4/r1-20261029/review-bprime-default-20261029/
?? evidence/wp-ui-visual-01/p1-p4/r1-20261029/review-bprime-recheck-20261029/
```
即任务卡预期的 4 项非本卡未跟踪目录 + `WORKLOG.md` 的 ` M` + 本卡新增的 `evidence/m1-t07-20261030/`。无 `src/`、`tests/`、`migrations/` 改动：`git diff --name-status 936118b -- src tests migrations` 无输出（`evidence/m1-t07-20261030/baseline-diff.txt`）。

7) 步骤 7（PROJECT-STATE）——`git diff -U0 PROJECT-STATE.md` 只有新增行、删除行检查为空，新增 15 行；新章节内不含"已完成""已通过"字样（`grep` 无命中）。核对记录：`evidence/m1-t07-20261030/guards.txt`。

没做/没验证：
- 独立复核（REVIEW）不是执行岗位的活，未做，留待复核会话。
- 未做任何代码修复：门禁与范围对照均与预期一致，没有需要修的地方，也没有被授权修。
- 未验证手机上的目视观感（本卡步骤 5 只要求取证读库，不含目视）。

发现（不属于本卡、没有处理的）：
1. `git diff --name-status 936118b`（整体）会显示 `WORKLOG.md`、`docs/WORKFLOW-OWNER-VIEW-20261030.md`、`docs/WORKFLOW-T07-PROMPTS-20261030.md`、`docs/WORKFLOW-TASK-CARDS-20261030.md` 四项。这四项来自 baseline 之后的 3 个纯文档提交（`04ca8b0`、`5807ca0`、`81c8cd7`），不是工作树改动——`git status --short` 里它们不出现。任务卡步骤 1 说明里"整体 diff 不应出现别的文件"这句与"HEAD 可以是之后的、只含文档的提交"这句互有张力，建议复核时以 `git status --short`（工作树）为准。留痕：`post-baseline-commits.txt`。
2. `PROJECT-STATE.md` **顶部**仍写着"M1：READY_FOR_REVIEW（仅任务书）…S0–S7 未执行，无功能通过结论"，与 M1 步骤 0-6 已真机验收的现状不符。本卡只允许末尾追加，我没有改顶部；建议后续单独出一张卡更新顶部摘要。
3. `evidence/m1-post-commit-gates-20261030/` 与 `evidence/wp-ui-visual-01/p1-p4/` 下 3 个目录处于未跟踪状态，不是本卡产生的，未动。
4. 门禁实测约 6 分钟（lint + tsc + 61 文件 629 用例）。若后续多张卡串行，安排时间时按 6-8 分钟估。
5. `xcrun devicectl list devices` 里还有一台 `simulated` 的 iPhone 18 Pro（UDID 0BF810EB-…），本卡未使用，仅记录以免误认。
6. **本回执的自我更正：** 步骤 2 那一行 WORKLOG 初写时单元格内误用了竖线（"629 passed | 44 skipped"），导致该行变成 8 列。发现后用 `sed` 仅把该单元格内的竖线改成斜杠，该行恢复 7 列；只改动了本会话自己新写的那一行，没有触碰任何历史行，amend 过程已在 WORKLOG 21:08 那行留痕。
7. `git status --short` 在**步骤 6 当时**是 6 行；步骤 7 追加完 `PROJECT-STATE.md` 后变成 7 行（多出 ` M PROJECT-STATE.md`）。两个数字都如实保留，未回改步骤 6 的证据文件（`git-status.txt` 是当时的快照）。最终状态见 `final-guards.txt`。

待 Owner 运行：无必须项（步骤 5 需要 iPhone 已连接并解锁，本次连接正常，已在执行机上直接完成）。
- 若要推进复核：另开独立会话，执行 `bash scripts/m1-gates.sh evidence/m1-t07-20261030/review-gates`，再用 `git diff PROJECT-STATE.md` 核对只新增。

附：验收标准自检（仅供复核参考，不替代复核，不构成 PASS）
1. git-head.txt 存在、分支 feat/mobile、含 ancestor 行 —— 是。
2. exit-codes.txt 末尾 gates rc=0，三个 exit 全 0，61/629/44 —— 是。
3. protected-now.sha256 = 5eb32540…e2da3 —— 是。
4. signing.txt 只含两种设置 —— 是。
5. 13 个词计数全在回执且符合预期 —— 是。
6. 步骤 5 有真机输出 —— 有（本机 devicectl 只读取回）。
7. PROJECT-STATE 末尾新章节、每条有来源、无"已完成/已通过"、只新增 —— 是。
8. WORKLOG 每步至少一行、7 列 —— 是。
9. 未改 src/tests/migrations/docs 已有文件 —— 是（保护区哈希 SAME，`git status` 无相关改动）。
