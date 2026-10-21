# EXEC-E46 执行指令（build-46：smoke 候选包重建 + 真包内 U-10 视觉证据入库）

**角色：** 执行者
**基线：** HEAD `b39f0b4`（plan 提交）/ 代码基线 `4838fb6`（build-45，U-10 已验收）；全量基线 **403 passed / 0 failed / 80 skipped**
**日期：** 2026-10-21
**批准：** 用户于 2026-10-21 经 Studio 澄清批准（clarify_id `9850e588-766a-4340-84d3-123ae0b2d57e`）：**重建 smoke 包 + 真包视觉截图取证入库**。批准范围仅限本指令列出的动作与证据文件。
**明确排除：** 删除 `src/ui/assets/finance/brand-xiaoqianjia@2x.png` 与 `manifest.json` **未获批准**，本批不得触碰；任何源码（`src/`、`tests/`、`src-tauri/`、配置文件）一字不改。

---

## 〇、目标与性质

本批是**纯构建+证据批**：重新执行 `tauri:build:smoke`，让候选包含 build-45 的 lucide 图标瓷砖（U-10），然后打开真包截图取证并入库。门控等级同 L-03（原生构建，已获用户单独批准）。

预期事实：重建后真包内「我的」Hub 四卡、计划入口、子页行、汇总、空态、规划头图与首页品牌位全部为图标瓷砖，零贴纸；既有 smoke 数据（L-03 时的 3 笔 expenses / 5 笔 expense_records）在重建重开后仍在——顺带再次验证「退出重开数据仍在」。

## 一、执行步骤（顺序强制）

### E46-1 构建前体检
```bash
cd "/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2"
git log --oneline -2        # 须见 b39f0b4、4838fb6
git status --short          # 只允许 ?? .claude/、?? pelican-bike.html、?? pelican-cycling.html
env NODE_ENV=test npx vitest run --reporter=dot   # 403/0/80
npm run typecheck && npm run lint && npm run build
```
任一不过即 RETURN，不得构建。

### E46-2 构建（唯一允许的构建命令）
```bash
npm run tauri:build:smoke 2>&1 | tee /tmp/e46-build-smoke.log
```
- 产物路径与 L-03 相同（`src-tauri/target/release/bundle/macos/小钱家.app`，以实际输出为准）。
- 禁止任何不带 `:smoke` 的 tauri 命令；禁止动 `src-tauri/` 任何文件。
- 构建成功后把 `/tmp/e46-build-smoke.log` 拷入证据目录（见第三节）。

### E46-3 候选包身份与图标门（照抄 L-03 标准）
对产物逐项核验并写入回执：
1. `defaults read <产物>/Contents/Info.plist CFBundleIdentifier` = `com.personalfinance.console.smoke`
2. `CFBundleDisplayName` = 小钱家；`CFBundleIconFile` = `icon.icns`
3. `Contents/Resources/icon.icns` 的 `shasum -a 256` 与 `src-tauri/icons/icon.icns` 一致，字节数 43,431
4. 记录产物包总大小与 `du -sh`

### E46-4 打开真包、截图取证
```bash
open <产物路径>
```
**操作红线（违反即 RETURN）：**
- **禁止一切 GUI 自动化**：不得用 CGEvent、cliclick、AppleScript UI scripting、坐标点击等任何方式模拟鼠标/键盘。页面导航由**用户手工操作**；执行者只在用户就位某页面后用 `screencapture`（整屏或 `-l <windowID>` 窗口捕获）落图。
- 每张截图命名 `e46-NN-<内容>.png`，回执中逐张注明：截图时刻该页面由谁导航到位、截图命令是什么。
- 若用户不在场无法导航，把已能截到的画面（至少首屏+Dock）入库，其余页面在回执标注「待用户导航补拍」，不得伪造、不得借用旧图。

**最少截图清单：**
| # | 内容 | 核验点 |
|---|---|---|
| 01 | Dock：运行中的「小钱家」 | 绿色钱包图标+运行点 |
| 02 | 首页（今天） | 品牌位为 Sprout 瓷砖，非贴纸 |
| 03 | 「我的」Hub 全貌 | 收入/现金/资产/债务四卡+计划入口共 5 处均为图标瓷砖（用户红框五处的直接证据） |
| 04 | 任一子页（如收入） | 行内 `.finance-row-art` 为小瓷砖 |
| 05 | 首页或「我的」可见数据 | 与 L-03 回执的 smoke 数据一致（余额/最近消费仍在）→ 重建后数据持久 |

### E46-5 证据入库与提交
- 证据目录：`evidence/u10-visual-20261021/`，含 `E46-RECEIPT.md`（按第五节格式）、全部截图、`e46-build-smoke.log`。
- 逐一 `git add` 显式路径（证据目录内文件），禁止 `git add -A`。
- 提交信息：`build-46: U-10 evidence — smoke rebuild with icon tiles in package`
- 提交后 `git status --short` 只允许三个既有未跟踪文件。

## 二、红线汇总

1. **零源码改动**：本批提交只允许新增 `evidence/u10-visual-20261021/` 下文件；任何 `src/`、`tests/`、`docs/`、`src-tauri/`、根配置改动即 RETURN。
2. 不删任何东西——尤其 `src/ui/assets/finance/` 下两个孤儿文件（未获批准）、production 包、production/smoke 数据目录、桌面/下载任何文件。
3. 禁止启动/构建/修改 production 身份；不运行不带 `:smoke` 的 tauri 构建；不改基础 `tauri.conf.json`。
4. 禁止 GUI 自动化模拟输入（见 E46-4）；禁止网络请求；禁止安装依赖。
5. 测试命令必须带 `env NODE_ENV=test`。
6. 不得触碰未跟踪文件（`.claude/`、`pelican-bike.html`、`pelican-cycling.html`）；不得提交它们。
7. 截图不得修饰、裁切出与事实不符的画面；画面内容以真包实际渲染为准。

## 三、回执格式（READY_FOR_REVIEW 时必须齐备）

1. E46-1 体检输出（测试 403/0/80、typecheck/lint/build 结果）
2. 构建日志摘要（起止时间、成功标志）+ 日志文件已入库路径
3. E46-3 四项身份/图标门逐条结果（含 SHA256 全文）
4. 截图逐张清单：文件名、内容、导航方式、截图命令
5. 数据持久抽查：打开真包后读库（只读）`select count(*) from expenses; select count(*) from expense_records;` 与 L-03 回执（3 / 5）比对结果；如与预期不符，如实记录并 RETURN 请示，不得自行处理
6. `git show --stat`、HEAD、`git status --short`
7. 任何偏离本指令的事实（含补拍未完成项）

## 四、验收后（由审核员执行，执行者不碰）

我（审核员）将独立复核：产物哈希/身份门、截图目视核对瓷砖渲染、只读 SQL 复验数据、全量测试复跑、确认零源码 diff。通过后方可进入下一事项。