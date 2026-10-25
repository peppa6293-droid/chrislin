# WP-UI-HOME-02 执行证据（T1–T3）

日期：2026-10-25（本机 2026-10-26 00:04 +08）
执行范围：仅 T1（超支卡白底）、T2（V2ProgressBar ARIA）、T3（注释）。

## 修改文件

- `src/style.css`：删除 `.v2-month-card.is-over-budget` 4 行规则。
- `src/ui/V2ProgressBar.tsx`：`clamped`、`aria-valuenow`、`aria-valuemax`、`aria-valuetext`。
- `src/ui/v2-home-revamp.css`：仅第 3–5 行注释。
- 新增 `tests/v2-progress-bar.test.tsx`（3 例）。

## 基线

`/tmp/wp02-baseline/` 保存 style.css、V2ProgressBar.tsx、v2-home-revamp.css 开工前副本；
`diff.txt` 为 `diff -u` 原始输出（收尾时临时目录已删除）。

## 自验结果

- `npx tsc --noEmit` → exit 0，无输出（`tsc.txt`）。
- `npx biome check src/ui/V2ProgressBar.tsx tests/v2-progress-bar.test.tsx` → clean，exit 0（`biome.txt`）。
- `npx vitest run tests/v2-ui.test.tsx tests/v2-progress-bar.test.tsx` → 2 files / 22 tests passed，exit 0（`vitest.txt`）。

## 视觉实测（无头 Chrome，headless=new）

临时验收页按任务书附录 A，位于 `preview-check/`，验证后已删除。原始读数见 `metrics.json`，截图为真实渲染。

| 检查项 | 实测 |
|---|---|
| 1000px `.v2-page` / 列宽 | 812 / `398px 398px` |
| 1000px normal 两卡高 | 395 / 395 |
| 1000px over 两卡高 | 413 / 413（超支说明多折一行，见报告未验证/观察项） |
| 900px 两卡高 | 413 / 413 |
| 875px 列数 | 单列（`699.5px`） |
| 880px 列数 | 两列（`344px 344px`） |
| scrollWidth == innerWidth | 760/870/875/880/900/1000/1440 全部相等 |
| 超支卡背景 | `rgb(255, 255, 255)` |
| 超支卡左边框 | `4px solid rgb(244, 123, 104)` |
| 结构卡背景 | `rgb(245, 251, 248)` |
| 超支进度 ARIA | `now=118`、`max=120`、`text=118%` |
| 卡内 padding | `24px` |

截图：`screenshots/before-*`（临时回退 style.css 取得）与 `screenshots/after-*`。

## 收尾

`preview-check/`、`/tmp/wp02*` 已删除；未执行 `git add` / `git commit`；`git status --porcelain` 原始输出见 `git-status.txt`。
