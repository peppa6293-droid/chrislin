# 提交清单（2026-10-26）

用途：把 WP-UI-HOME-01/02 与 WP-TEST-01 的成果按包分开提交，避免 106 条工作区改动越滚越乱。
**执行者：Owner 本人**（不要在 WP 里让实现 agent 提交）。

---

## 0. 先看清一件事

`HEAD` 现在是**编不过**的：`src/ui/V2HomeSurface.tsx`（已跟踪）import 了 21 个未跟踪文件（整套 V2 表面组件与样式）。
所以第一批提交不是"补四个文件"，而是**把整套 V2 表面一起入库**，否则提交出来仍是一个坏快照。

验一下：

```bash
git ls-files src/ui/V2HomeSurface.tsx          # tracked
git ls-files src/ui/V2StructureCard.tsx        # 空 = untracked
```

---

## 1. 第一批：V2 表面 + 首页两卡（含 WP-UI-HOME-01/02）

```bash
git add \
  src/ui/V2CalendarPicker.tsx src/ui/V2CashflowDetail.tsx src/ui/V2DayComplete.tsx \
  src/ui/V2DetailHero.tsx src/ui/V2EmptyState.tsx src/ui/V2FeedbackStage.tsx \
  src/ui/V2MonthSummary.tsx src/ui/V2MonthlySpendCard.tsx src/ui/V2ProgressBar.tsx \
  src/ui/V2RepaymentDetail.tsx src/ui/V2SafetyDetail.tsx src/ui/V2SavingsRoomPage.tsx \
  src/ui/V2StatusBadge.tsx src/ui/V2StructureCard.tsx \
  src/ui/v2-calendar-picker.css src/ui/v2-card.css src/ui/v2-detail-visual.css \
  src/ui/v2-feedback.css src/ui/v2-home-revamp.css src/ui/v2-savings-room.css \
  src/ui/v2-tokens.css

git add src/main.tsx src/style.css src/ui/V2HomeSurface.tsx tests/v2-ui.test.tsx
git add tests/v2-progress-bar.test.tsx evidence/wp-home-02-20261025 \
        docs/WP-UI-HOME-02-EXEC-INSTRUCTIONS.md
```

提交信息建议：

```
feat(ui): V2 首页两卡改版 + 超支卡白底 + 进度条 ARIA 区间
```

> **更正我先前的说法**：不需要 `git add -p src/style.css`。那 258 行整块都是本次未提交的新增（`git diff -U0` 只有一个 `@@ -3801,0 +3801,258 @@` 的 hunk），删掉超支卡那 4 行只是让新增从 262 变成 258，不存在"混入旧改动"的问题。

**暂不提交**（属别的包，留在工作区）：`tests/v2-ledger/landing-services.test.ts`、`tests/v2-ui/dashboard*.tsx`、`tests/v2-ui/import-flow.test.tsx`、`docs/CURRENT_PHASE.md`、`src-tauri/**`。

---

## 2. 第二批：测试环境（WP-TEST-01）

```bash
git add tests/helpers/node-sqlite.ts tests/helpers/sqlite-snapshot.ts \
        tests/future-schema-guard.test.ts tests/r8-production-schema-authority.test.ts \
        docs/WP-TEST-01-EXEC-INSTRUCTIONS.md
```

提交信息建议：

```
test: 修复 node:sqlite 打包与 serialize 缺失，全仓 460/460 通过
```

---

## 3. 第三批：WP-UI-HOME-03（做完再提交）

```bash
git add src/ui/V2ProgressBar.tsx src/ui/V2StructureCard.tsx tests/v2-progress-bar.test.tsx \
        docs/WP-UI-HOME-03-EXEC-INSTRUCTIONS.md
```

提交信息建议：

```
fix(ui): 结构卡去掉重复进度条（设计稿 §4.2），负值进度读屏归零
```

---

## 4. 第四批：WP-ENV-01（做完再提交）

```bash
git add -p package.json          # 只暂存 engines 那个 hunk，Tauri 脚本改动留在工作区
git add docs/WP-ENV-01-EXEC-INSTRUCTIONS.md
```

提交信息建议：

```
chore: 声明 Node >=22.3（getBuiltinModule 依赖）
```

---

## 5. 每批提交后都要验

```bash
git show --stat HEAD             # 文件清单是否正好是这一批
git status --porcelain | wc -l   # 应逐批减少，不应增加
npx tsc --noEmit && npx vitest run
```

第一批之后额外跑一次构建，确认这个快照不是坏的：

```bash
npx vite build --outDir /tmp/commit-check --emptyOutDir
rm -rf /tmp/commit-check
```

---

## 6. 红线

- **不要** `git add -A` / `git add .`：工作区还有 70+ 条别的包（src-tauri、docs、tests/v2-ui/*）的改动。
- **不要**把 `docs/WP-UI-HOME-02-EXEC-INSTRUCTIONS.md` 之外的三份任务书塞进第一批；它们各自跟着自己的包走。
- 提交前后各存一份 `git status --porcelain > /tmp/status-<批号>.txt`，出问题能对账。

---

## 7. 已知待决（不影响提交）

1. `tests/ui.test.tsx` 80 个 skip 与 `docs/V2_TEST_MIGRATION_DISPOSITION.md`（写的是 34 跳过 / 46 继续跑）已经漂移。**先别删**，等 Owner 决定改记录还是拆回 46 个。
2. `docs/` 下还有十几份更早的未提交文档，与本轮无关，按你们自己的节奏处理。
