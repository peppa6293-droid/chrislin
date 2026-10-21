# E46 — smoke 重建 + U-10 真包视觉证据回执

- 日期：2026-10-21（Asia/Shanghai）
- 计划 HEAD：`9071563` — `plan: E46 smoke rebuild + U-10 visual evidence instructions (build-46, approved via clarify 9850e588)`
- 代码基线：`4838fb6` — `build-45: U-10 — replace sticker illustrations with lucide icon tiles`
- 构建命令：`npm run tauri:build:smoke`
- 构建时间：2026-10-21 11:02:42 → 11:03:19
- 本批状态：`COMPLETED`（执行与证据提交完成；视觉验收结论待 Owner/Audit 复核）

## 1. 构建前门

| 项目 | 结果 | 说明 |
|---|---|---|
| 全量测试 | **403 passed / 0 failed / 80 skipped** | 41 files passed，1 skipped；构建前门执行结果，11:12 复跑一致 |
| `npm run typecheck` | 0 errors | `tsc --noEmit` |
| `npm run lint` | 0 problems | `biome check src tests`，121 files，No fixes applied |
| `npm run build` | success | vite 产物：`index-CjoyGXXc.css` 100.42 kB；`index-BKcEW2yA.js` 528.38 kB |

复跑日志：

- `e46-preflight-tests.txt`
- `e46-preflight-typecheck.txt`
- `e46-preflight-lint.txt`

说明：构建前门按指令在构建前执行；上表测试结论与 11:12 复跑完全一致，复跑日志随本批入库。

## 2. smoke 构建

- 命令：`npm run tauri:build:smoke 2>&1 | tee /tmp/e46-build-smoke.log`
- 退出码：0
- 日志：`e46-build-smoke.log`（2,390 B）
- 产物：
  - `src-tauri/target/release/bundle/macos/小钱家.app` — 12.96 MiB（`du -sh` 13M）
  - `src-tauri/target/release/bundle/dmg/小钱家_0.1.0_aarch64.dmg` — 3.85 MiB（`du -sh` 3.8M）
- Web 产物：`web-dist/index.html` 0.39 kB；`web-dist/assets/index-CjoyGXXc.css` 100.42 kB；`web-dist/assets/index-BKcEW2yA.js` 528.38 kB

## 3. 身份与图标门

| 检查项 | 期望 | 实际 | 结果 |
|---|---|---|---|
| `CFBundleIdentifier` | `com.personalfinance.console.smoke` | `com.personalfinance.console.smoke` | PASS |
| `CFBundleDisplayName` | `小钱家` | `小钱家` | PASS |
| `CFBundleIconFile` | `icon.icns` | `icon.icns` | PASS |
| `Contents/Resources/icon.icns` 大小 | 43,431 B | 43,431 B | PASS |
| 产物图标 SHA256 | 与源一致 | `6fb51b77f61987e85a0c83ada416d1a0ca14637599aab3ebe1533283cde6a80a` | PASS |
| 源图标 SHA256 | — | `src-tauri/icons/icon.icns` 同为 `6fb51b77f61987e85a0c83ada416d1a0ca14637599aab3ebe1533283cde6a80a` | PASS |

原始输出：`e46-identity-gate.txt`

## 4. 截图证据

全部页面导航由 Owner 手工完成；执行者只调用 `screencapture` 落图，未使用 CGEvent、cliclick、AppleScript UI scripting 或坐标点击。

| 文件 | 尺寸（px） | SHA256 | 内容 | 导航方式 |
|---|---|---|---|---|
| `e46-01-dock.png` | 3420 × 200 | `de182496065c8e541310c34e7759076c1ba96b49ab94dcbf236b01f29b4dfdb3` | Dock；绿色钱包图标（小钱家）在右侧分隔符附近，图标下方有运行点 | 构建后 `open` 启动候选包，Dock 常显 |
| `e46-02-home.png` | 1243 × 899 | `3bbb183688e6c7902b2b6749a6c1fe8577476bc8bdcbc6fe2ad84e53c98ba75a` | 「今天」首页；左上品牌位为 Sprout 图标瓷砖，无贴纸；显示本月 ¥12,000、已花 ¥1,636.38、最近一笔 ¥88.88 | Owner 手工点击左侧「今天」 |
| `e46-03-hub.png` | 1621 × 1155 | `c6a558668fe2304aad79eae102baf2cc41c51f736520369e8e3500f0466863b0` | 「我的财务」Hub 全貌；收入/现金/资产/债务/生活支出与计划五处均为 lucide 图标瓷砖，无贴纸 | Owner 手工点击左侧「我的」并停在顶部 |
| `e46-04-subpage.png` | 1243 × 899 | `762a66150d382eb7a56701496a39cd28c16ec2936d513bb7652a55d4fd211f1c` | 「收入」子页；行内为红色收据图标瓷砖，空态为 inbox 图标，无贴纸 | Owner 手工点击「收入」卡片 |
| `e46-05-data.png` | 1621 × 1155 | `1269f32b44909214f6fff66293f70246e4b06fc608aef1d13417226e3a540518` | 「记录」页最近消费；可见 ¥88.88（L03验收）、¥250.00、¥1,250.00 三笔持久数据 | Owner 手工点击左侧「记录」 |

截图命令（窗口 ID `563720` 为本次候选包窗口；重跑时 ID 可能变化）：

```bash
screencapture -x -R0,1007,1710,100 evidence/u10-visual-20261021/e46-01-dock.png
screencapture -x -o -l563720 evidence/u10-visual-20261021/e46-02-home.png
screencapture -x -o -l563720 evidence/u10-visual-20261021/e46-03-hub.png
screencapture -x -o -l563720 evidence/u10-visual-20261021/e46-04-subpage.png
screencapture -x -o -l563720 evidence/u10-visual-20261021/e46-05-data.png
```

### 逐张核验

- **e46-01 Dock**：绿色钱包图标可见，带运行点；同屏包含其他无关应用，按原图保留，不作裁剪。
- **e46-02 首页**：品牌位为绿色 Sprout 图标瓷砖；首页无贴纸资产。余额与最近消费同时可见。
- **e46-03 Hub**：五处目标位全部为图标瓷砖，逐一对应收入、现金、资产、债务、生活支出与计划；无贴纸。
- **e46-04 收入子页**：大图标瓷砖为红色收据，空态为 inbox；行内无贴纸。
- **e46-05 数据画面**：记录页可见 L03验收 ¥88.88，证明重建后本地数据仍可读取。

## 5. 只读 SQL 复验

数据库：`~/Library/Application Support/com.personalfinance.console.smoke/personal-finance-console.sqlite3`（319,488 B；mtime 2026-10-21 09:51:33）

| 查询 | 结果 |
|---|---|
| `select count(*) from expenses` | **3** |
| `select count(*) from expense_records` | **5** |
| `sum(amount)` from `expenses` | **136.38** |

`expenses` 明细：

| amount | occurred_on | description | kind |
|---|---|---|---|
| 35.00 | 2026-10-01 | 合成早餐店 | CASH_DEBIT |
| 12.50 | 2026-10-02 | 合成交通服务 | CASH_DEBIT |
| 88.88 | 2026-10-21 | L03验收 | CASH_DEBIT |

原始输出：`e46-sql-check.txt`

与 L-03 回执比对：`expenses=3` / `expense_records=5` 完全一致，数据持久通过。

说明：`e46-05-data.png` 的「最近消费」显示的是 `expense_records` 中按时间倒序的最近 3 条（88.88、250、1250）；SQL 中 `expense_records` 共 5 条（另含 35.00、12.50）。两处不矛盾，页面只是未展示全部 5 条。

## 6. 范围与红线

- **零源码改动**：本批未修改 `src/`、`tests/`、`docs/`、`src-tauri/` 或根配置。
- **未删除任何文件**：两个孤儿资产未获批准，本批未触碰。
- **未执行 production 构建/启动**：只使用 `tauri:build:smoke`。
- **未使用 GUI 自动化**：所有页面切换由 Owner 手工完成；执行者只做窗口截图与只读 SQL。
- **未提交无关文件**：`.claude/`、`pelican-bike.html`、`pelican-cycling.html` 保持未跟踪，不纳入本批。

## 7. 偏差与备注

1. 首次窗口截图时，候选包处于 Stage Manager 左侧缩略图栏，窗口仅 94×97 pt，无法作为证据；Owner 手工将窗口恢复到桌面并放大后重新截图。此前生成的 `e46-02-home.png` 已覆盖为重拍版本。
2. `e46-03-hub.png` 与 `e46-05-data.png` 为 1621×1155，`e46-02-home.png` 与 `e46-04-subpage.png` 为 1243×899；系窗口/显示器缩放变化，内容完整可读，不影响证据效力。
3. 截图期间 Owner 手工导航，执行者未抢鼠标键盘；窗口 ID 与坐标仅用于 `screencapture -l`。

## 8. 提交前 Git 快照

```text
HEAD=9071563
9071563 plan: E46 smoke rebuild + U-10 visual evidence instructions (build-46, approved via clarify 9850e588)
 docs/EXEC-E46-VISUAL-EVIDENCE-INSTRUCTIONS.md | 90 +++++++++++++++++++++++++++
 1 file changed, 90 insertions(+)

git status --short:
?? .claude/
?? evidence/u10-visual-20261021/
?? pelican-bike.html
?? pelican-cycling.html
```

## 9. 证据文件清单

| 文件 | 大小 | SHA256 |
|---|---|---|
| `e46-01-dock.png` | 338K | `de182496065c8e541310c34e7759076c1ba96b49ab94dcbf236b01f29b4dfdb3` |
| `e46-02-home.png` | 111K | `3bbb183688e6c7902b2b6749a6c1fe8577476bc8bdcbc6fe2ad84e53c98ba75a` |
| `e46-03-hub.png` | 135K | `c6a558668fe2304aad79eae102baf2cc41c51f736520369e8e3500f0466863b0` |
| `e46-04-subpage.png` | 351K | `762a66150d382eb7a56701496a39cd28c16ec2936d513bb7652a55d4fd211f1c` |
| `e46-05-data.png` | 98K | `1269f32b44909214f6fff66293f70246e4b06fc608aef1d13417226e3a540518` |
| `e46-build-smoke.log` | 2.3K | `e99ad38f695ad04c12733b146732bca0bab0218ce1922a65f0c317539f2bea4e` |
| `e46-identity-gate.txt` | 754B | `cbde50e810b7321248d563a864b2a48bc34ee5d173c0ecc652e2c547244e7b44` |
| `e46-sql-check.txt` | 944B | `fdbe9d6c6ccb119791fc3cfd4e79e0d973ee2321320c35fb151f04f991ac645a` |
| `e46-preflight-tests.txt` | 327B | `ac9b87771ef5130c679517a3a94e9dc649082f585bf7e2c4e7d6726da26bad8b` |
| `e46-preflight-typecheck.txt` | 60B | `bcc4bdc987f92c30bcd08ea02d64a96afb0be1228d277b7eb5e1d3bf9d2be448` |
| `e46-preflight-lint.txt` | 110B | `bb640c7f6e75a052042918fc771e1b74b87420886cd0f1733febe55df223755b` |

## 10. 结论

- 5 张截图全部完成，无「待补拍」项。
- 真包内 14 处贴纸替换后的关键视觉位已覆盖：Dock 图标、首页品牌位、Hub 五处、收入子页行内图标。
- 身份/图标门全部通过；SQL 数据 `3 / 5` 与 L-03 回执一致。
- 下一步：提交本批 evidence 文件，随后由 Owner/Audit 复核视觉证据。
