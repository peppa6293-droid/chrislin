# M1-T07 第二次独立复核

任务编号：M1-T07
状态：PASS
方向锚：M1收尾复核

## 独立结论

九条验收标准均满足；六项额外核对均已执行。本结论写入时尚未读取牵头人 LEAD-SPOTCHECK.md，不沿用上次 INCONCLUSIVE 的判断。首次报告已逐字节复制为 REVIEW-attempt1.md。当前现场与用户清单一致，无额外差异。

本 PASS 只针对 M1-T07 重复核验任务，不宣布 M1 产品全部完成，不关闭既有审查问题，不自动推进阶段。

## 九条验收标准

### 1

标准原文：`evidence/m1-t07-20261030/git-head.txt` 存在，分支为 `feat/mobile`，且含 `baseline 936118b is an ancestor of HEAD`。

你看到的实际：原始 git-head.txt 存在且三行符合要求。当前分支 feat/mobile，HEAD 为 20ea0ce32e041d722a67883bdf42eeb96217c638，936118b 仍为祖先；比执行时增加的 20ea0ce 仅改两份 docs。当前工作树 docs 无改动。

通过或不通过：通过（PASS）。

证据路径（相对 evidence/m1-t07-20261030/）：git-head.txt；review-gates/start-head-2.txt；review-gates/post-execution-commits-2.txt。

### 2

标准原文：`gates/exit-codes.txt` 末尾含 `gates rc=0`，且 lint、tsc、test 三个 exit 都是 0，测试数字为 61 个文件、629 通过、44 跳过。

你看到的实际：执行方与独立重跑的 exit-codes.txt 逐字节、逐行一致，无差异行。lint/tsc/test 都为0；61文件、629通过、44跳过；末行为 gates rc=0。已回读原始 lint、tsc、test 日志。

通过或不通过：通过（PASS）。

证据路径（相对 evidence/m1-t07-20261030/）：gates/exit-codes.txt；review-gates/exit-codes.txt；review-gates/exit-codes-comparison-2.txt；两目录 lint.log、tsc.log、test.log。

### 3

标准原文：`gates/protected-now.sha256` 的值等于 `5eb32540f2bdbdaacfebccfd9ec7a94080c8ddf3948d5e4ce26a2da5dd2e2da3`。

你看到的实际：独立脚本重算与原始 gates 文件均为 5eb32540f2bdbdaacfebccfd9ec7a94080c8ddf3948d5e4ce26a2da5dd2e2da3，等于 S0 基线。

通过或不通过：通过（PASS）。

证据路径（相对 evidence/m1-t07-20261030/）：gates/protected-now.sha256；review-gates/protected-now.sha256；../m1-s0-20261030/protected-model-migrations.sha256。

### 4

标准原文：`gates/signing.txt` 只含上述两种设置，值如步骤 3。

你看到的实际：执行方和独立重跑 signing.txt 均恰好两行：DEVELOPMENT_TEAM = "SSRKA7A4TN"; 与 PRODUCT_BUNDLE_IDENTIFIER = com.personalfinance.console.smoke;，没有其他设置。

通过或不通过：通过（PASS）。

证据路径（相对 evidence/m1-t07-20261030/）：gates/signing.txt；review-gates/signing.txt。

### 5

标准原文：步骤 4 的 13 个词的计数全部在回执里，符合预期或已标 FAIL。

你看到的实际：回执列齐13词。独立 grep -c 与原始证据一致：资产1、债务1；还款、进展、优先行动、导入、导出、周期、提醒、多账本、预测、固定支出、我的财务全部0。前两词均在 M1Home.tsx:122 说明行；main.tsx 无 scope，App.tsx:37 默认 M1。

通过或不通过：通过（PASS）。

证据路径（相对 evidence/m1-t07-20261030/）：RECEIPT.md；step4-scope-check.txt；review-gates/scope-check-2.txt；review-gates/required-commands-2.txt。

### 6

标准原文：步骤 5 要么有真机输出，要么明确列在"待 Owner 运行"，**不得写已通过**。

你看到的实际：原始设备清单、copy 日志、readback 文件存在。独立向同一物理 iPhone 执行 list 与 copy from，数据库仅写入 /tmp/m1-t07-review-ppw0urqi/device.sqlite3；sqlite3 -readonly 得到1/4/4、integrity ok；SHA256为345ac2d2dcf9e7760a9cb98b3f68516b4caaad9ad1d4c5242c4c8479d72bbf73。执行回执状态为 PENDING_AUDIT，没有把本卡自报为已通过。本项通过仅指取证要求，不代表重新目视验收。

通过或不通过：通过（PASS）。

证据路径（相对 evidence/m1-t07-20261030/）：devicectl-list.txt；device-copy.log；device-readback.txt；review-gates/device-list-2.txt；review-gates/device-copy-2.txt；review-gates/device-readback-2.txt。

### 7

标准原文：`PROJECT-STATE.md` 末尾有新章节，每条事实有来源，没有"已完成/已通过"字样，没有改动旧内容（用 `git diff PROJECT-STATE.md` 核对只有新增行）。

你看到的实际：HEAD 旧内容是当前文件的逐字节前缀；diff 为15条新增、0删除。末尾章节标题正确，各事实附来源；七份 S0–S6 报告及三份文档存在并已读取，新章节无“已完成/已通过”。步骤6的6行是当时快照，追加状态后7行、本次含牵头目录8行，时间点不同。

通过或不通过：通过（PASS）。

证据路径（相对 evidence/m1-t07-20261030/）：../../PROJECT-STATE.md；review-gates/project-state-diff-2.txt；review-gates/required-commands-2.txt；review-gates/source-manifest-2.json。

### 8

标准原文：`WORKLOG.md` 每个步骤至少一行，7 列格式。

你看到的实际：HEAD 的633行前缀逐字节未变。执行方新增第634–652行共19行，均恰好8个竖线（7列），覆盖步骤1–7及更正、终检。允许读取的独立复核行亦为7列；第653行及其后牵头人行不展示、不采信。diff 排除文件头后无删除行。

通过或不通过：通过（PASS）。

证据路径（相对 evidence/m1-t07-20261030/）：../../WORKLOG.md:634–652；review-gates/worklog-check-2.json；review-gates/required-commands-2.txt。

### 9

标准原文：没有改动 `src/**`、`tests/**`、`migrations/**`、`docs/` 已有文件（用 `git status` 与门禁里的保护区哈希核对）。

你看到的实际：初始与结论前 git status 均无 src/tests/migrations/docs 改动；git diff --name-status 936118b -- src tests migrations 为空，HEAD 对上述四目录 diff 也为空；保护区哈希一致。基线后文档提交为既存历史，不认作本次执行修改。

通过或不通过：通过（PASS）。

证据路径（相对 evidence/m1-t07-20261030/）：review-gates/initial-status-2.txt；review-gates/pre-conclusion-status-2.txt；review-gates/baseline-diff-2.txt；review-gates/protected-now.sha256。

## 六项额外步骤

1. 门禁重跑并逐行比较：一致，无差异行，见 review-gates/exit-codes-comparison-2.txt。
2. PROJECT-STATE 只新增：15个“+”，无删除行，见 review-gates/required-commands-2.txt。
3. WORKLOG 旧行逐字未变；执行新增19行均7列，见 review-gates/worklog-check-2.json。
4. 保护区、13词、手机库三项均重新计算，证据见上述第3、5、6项。
5. S5 报告所引 owner-device-home-screenshot.jpg 存在，114529字节；SHA256为07c06d2fa006fb094ed91184d4c23e6e0b4d28a6777bff66ca2cc4aa7c73c562，见 review-gates/screenshot-check-2.txt。本次只核对存在性，不冒充新一次手机目视验收。
6. 已核对旧行未变；这是一次原地编辑的先例。执行方自报曾把自己新写行里的竖线改成斜杠，WORKLOG:650 留有更正说明。目前 diff 无删除行，不能据此重建那次编辑前的瞬间，也不因该先例直接判 FAIL。

## 观察与边界

- PROJECT-STATE 顶部仍是过时的任务书摘要；按本卡只追加约束，本次未改。历史审查里的产品口径、界面问题仍留给 Owner/牵头人另行处理。
- guards.txt 的“新增行数”写16，实际 diff 新增15；16包含“+++”文件头的计数，执行回执写15，与独立结果一致，不构成第7条缺陷。
- WORKLOG:641 与执行回执称门禁“约6分钟”，原始测试日志只证明测试阶段5.85秒，不能由此验证整个门禁耗时。该耗时说明不作为验收依据。
- 复核未改代码、任务卡、状态文件或执行方证据。仅在 review-gates 新建证据，留档旧 REVIEW、重写本报告并追加 WORKLOG；手机仅 list、copy from，库仅在 /tmp，只读查询；未执行任何写类 git 命令。
- 本会话启动的首次 status 与读取全局规则在获知逐动作日志要求前合并记录；随后证据读取均追加日志，但集中读取阶段未严格每5动作插入周期自检。该复核过程偏差如实保留，不归于执行方，不改变上述独立核验结果。
- 未重新执行安装、启动、重启或人工操作；这些不在本次授权内。
- 下一责任人：Owner/牵头人接收本复核，决定后续任务。本卡无剩余复核事项；不自动归档或推进。

## 与牵头人抽查的差异

本节在独立结论保存并回读之后才编写。保存顺序的证据为 review-gates/independent-conclusion-before-lead-2.md；它保留读取抽查前的完整报告。

- 技术结果一致：保护区、签名、13词、手机库哈希、表行数、状态追加、旧日志前缀均相同。
- 版本时点不同：牵头人抽查时 HEAD 为81c8cd7，本次是20ea0ce；新增提交仅两份流程文档，已有提交不能归责本次执行方。不能沿用抽查中“之后没有新提交”的当前时态表述。
- 取证范围不同：本次重跑全套门禁并逐行比较 exit-codes；按限制读取执行日志全文，独立重新取库到 /tmp，并核对截图存在。牵头人抽查不能代替这些动作。
- append-only 先例与状态顶部过时的观察一致。时间乱序与原地改列分隔符是两个不同现象；现有证据不能证明修改分隔符导致时间乱序，因此不沿用该因果解释。
- 抽查建议未来改变数据库保存位置；本次已按当前用户要求仅复制到 /tmp，未修改任务卡，也未删除执行方原有数据库。
- 状态不同是岗位与时点差异：牵头人当时保留 PENDING_AUDIT；本次完成独立核对后为 PASS，仅限 M1-T07。
