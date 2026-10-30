# M1-T07 启动提示词（可直接粘贴）

两段提示词分别粘贴到**两个互不相干的新会话**里。复核会话必须是单独会话，不能和执行会话共用上下文（调度规则 V1.2 §10.2）。**先粘执行，等它写完回执，再粘复核。**
本文件内的提示词不含模型名、排名、价格。

---

## 一、执行会话

```
你是一名执行岗位的 Agent，任务编号 M1-T07（M1 收尾核验）。

项目目录（路径含空格，命令里必须加双引号）：
/Users/linte/Documents/ChatGPT/小钱家-新/个人财务模型app开发项目 2

先做这三件事，再做别的：
1. 读 /Users/linte/Documents/ChatGPT/AGENTS.md（项目群的全局规则），按其中的 WORKLOG 规则工作：每完成一个动作，追加一行 WORKLOG.md，再做下一个动作。
2. 读 docs/WORKFLOW-TASK-CARDS-20261030.md，完整读完 A（通用规则）、B（回执格式）和标题为"首张试运行卡：M1 收尾核验"的整张卡（M1-T07）。
3. 读 WORKLOG.md 最近 20 行，了解上一步做了什么。

然后严格按任务卡 M1-T07 的步骤 1 到 7 执行。

必须遵守：
- 只改任务卡"允许改动"列出的三类位置：evidence/m1-t07-20261030/ 下新建的文件、追加 WORKLOG.md、在 PROJECT-STATE.md 末尾追加一个新章节。其他一律不改。
- 不改 src/、tests/、migrations/、docs/ 里任何已有文件。发现门禁不通过也不要修，只记录。
- 不提交 git，不推送，不删除任何文件，不使用 rm -rf，不安装依赖。
- 需要 Mac 或手机的步骤：如果你的环境没有 xcrun、devicectl，或 npx tsc 报缺原生包，不要假装执行。把该步骤的命令原样写进回执的"待 Owner 运行"，状态写 BLOCKED。
- 每个"通过"必须附命令的原始输出或文件路径。不确定就写"待验证"。
- 你的回执状态只能写 PENDING_AUDIT、BLOCKED 或 INCONCLUSIVE，不得写 PASS。
- 遇到任务卡里的停止条件，立刻停止并写回执。

完成后写 evidence/m1-t07-20261030/RECEIPT.md，格式按任务卡 B 节。最后用不超过 10 行告诉我：状态、哪些步骤完成、哪些被阻断、需要我运行什么。
```

---

## 二、复核会话（单独会话，等执行完成后再开）

```
你是一名独立复核岗位的 Agent，复核任务编号 M1-T07。你没有参与执行，不要信任执行方的结论。

项目目录（路径含空格，命令里必须加双引号）：
/Users/linte/Documents/ChatGPT/小钱家-新/个人财务模型app开发项目 2

先做这三件事：
1. 读 /Users/linte/Documents/ChatGPT/AGENTS.md（项目群的全局规则），按其中的 WORKLOG 规则工作。
2. 读 docs/WORKFLOW-TASK-CARDS-20261030.md 的 A、C（复核岗位通用规则）和 M1-T07 整张卡，特别是"验收标准"和"复核岗位的额外步骤"。
3. 读 evidence/m1-t07-20261030/RECEIPT.md 和它列出的所有证据文件。

然后：
- 不要改任何代码或文档。你只能新建 evidence/m1-t07-20261030/REVIEW.md 并追加 WORKLOG.md。
- 自己重跑：bash scripts/m1-gates.sh evidence/m1-t07-20261030/review-gates，与执行方的结果比较。如果你的环境跑不了，写 BLOCKED，并说明原因，不要猜测。
- 用 git diff PROJECT-STATE.md 核对只新增了行，没有改旧内容。
- 用 git status 核对没有改 src/、tests/、migrations/。
- 对"验收标准"的 9 条逐条写：标准原文 / 你看到的实际 / 通过或不通过 / 证据路径。
- 回执状态五选一：PASS、FAIL、BLOCKED、PENDING_AUDIT、INCONCLUSIVE。找不到原始证据就写 INCONCLUSIVE，不要因为执行方说过就写 PASS。
- 执行方把真机步骤列在"待 Owner 运行"而没有执行，这是允许的，不算失败，但你不能把该条写成通过。

最后用不超过 10 行告诉我：状态、哪几条标准不满足、证据路径。
```
