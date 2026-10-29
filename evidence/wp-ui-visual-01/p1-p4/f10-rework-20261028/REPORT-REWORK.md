# 段 2 返工证据报告（R1–R3，返工修订版）

- 执行：小钱家执行员
- 日期：2026-10-28
- 触发：验收员 2026-10-28 验收不通过（2 项越权），审核员复核确认属实并出 `docs/STAGE2-REWORK-PLAN-20261028.md`
- 范围：只做 R1–R3 三项 + 同步测试与证据；段 2 其余实现、两项挂账、P1-b / P3 / P4 一概未动
- 结论：**R1–R3 已闭环，门禁全绿，68 场景重出无异常；未提交 git，等审核员复核 → 验收员复验。**

---

## 1. 逐项返工

### R1 删除环顶标记（任务书 §3.4「不在环上叠标记」）

- 删 `src/ui/V2StructureRings.tsx` 原 `75-86` 行：`v2-ring__over-mark` 的 `<line>` 整块（含注释）。
- 删 `src/ui/v2-structure-ring.css` 原 `184-188` 行：A 方案注释 + `.v2-ring__over-mark` 规则；`#8f352b` 全仓清零。
- 明细行标记 `.v2-ring-row__marker`（3×14、r2、`aria-hidden`、锚金额左侧 8px）结构未动。
- C-6 修复（`arcProps()` 在 `capped<=0` 返回 `null`）原样保留。

### R2 明细标记色恢复 `#C2503C`

- `src/ui/v2-structure-ring.css:191` `#b7483d` → `#c2503c`（RGB 194/80/60，与 `#C2503C` 同色；小写是 biome 格式化要求）。
- 未动 `v2-tokens.css`，未做任何其他色值或视觉微调。

### R3 移除新造断点

- 删 `src/ui/v2-fixed-page.css` 原 `297-301` 行 `@media (min-width: 720px)` 整块。
- 分类区回退 `.fixed-categories__grid` 单列基线（`:190` 起）；`v2-fixed-page.css` 现只剩 `620px` 与 `prefers-reduced-motion`，未用 760 重挂双列。

---

## 2. 测试同步（`tests/v2-ui.test.tsx`）

| 用例 | 改动 |
|---|---|
| S10（`:708`） | 名称改为「marks the row only」；`.v2-ring__over-mark` 由 `toHaveLength(1)` 改为 `toBeNull()`，并加 `svg .v2-ring__over-mark` 计数为 0；行标记 1、`已超出 ¥528.00`、`占收入 117.6%`、弧长 653.4~653.5 断言不动 |
| S10b（`:729`） | 保留无 over-mark 断言，补「恰好 100% 时行标记数量为 0」 |

其余测试一字未动。

---

## 3. 门禁（§13.2，返工后重跑）

```
npm run lint          → biome check src tests：172 files，No fixes applied，0 error
npm run typecheck     → tsc --noEmit，0 error
npm run test:product  → 53 files / 557 passed / 44 skipped / 0 failed
```

未用 `--no-verify`，未提交 git。

---

## 4. 证据重出（68 场景，原版 `../f10-20261028/shots/` 保留不覆盖）

重出方式与段 2 原版一致（真组件、真级联、`file://`、无网络）：

```bash
cd evidence/wp-ui-visual-01/p1-p4/f10-20261028/harness
../../../../../node_modules/.bin/vite build --config vite.config.ts
node shoot.mjs --out ../../f10-rework-20261028/shots
```

本次在探针里新增三项回归断言（只改证据台，不改产品）：

- `overMarks`：环内 `.v2-ring__over-mark` 数量；
- `markerColors`：明细标记 computed `background-color`；
- `categoryColumns`：`.fixed-categories__grid` 的 `grid-template-columns`。

实测（`shots/metrics.json`、`shots/contrast.json`、`shots/problems.txt`）：

| 项 | 结果 |
|---|---|
| 宽度档 | 390 / 760 / 980（真实容器基线）/ 1440；200% 字号另出 390/980。任务书提到的 1000 档与 980 同为单列、尚未单独出图，复验若要求可补 |
| 截图 | 68 场景 + 4 交互态 = 72 张，`shots/SHA256.txt` 逐张 |
| 环顶标记 | **全部 42 个 home 场景 `overMarks = 0`** |
| 明细标记色 | 全部 `rgb(194, 80, 60)`（=`#C2503C`），无第二色值 |
| 超额标记落点 | 只在 `over-outer` / `over-both` / `over-large` / `text200-over-large` 的明细行，其余 0 |
| 分类区列数 | 单列（`324px` / `686px` / `824px`，空态无网格），无 720px 双列 |
| 横向溢出 | 0 |
| 运行时异常 / 远程请求 | 0 / 0 |
| 200% 字号中心净空 | 最小 **1.84px**（与返工前一致，未回退；不缩字、不藏金额） |
| 对比度 | 最低正文 4.87:1；最低图形 4.35:1；明细标记 4.45:1（装饰性，且同信息有「已超出 ¥X」文字）；超计划次行 `#b7483d`/白 5.24:1 |
| `problems.txt` | `none` |

目验：`shots/home-over-outer-390.png` 环顶干净、红标记在 `¥15,600.00` 左侧。

---

## 5. 文件哈希（返工前 → 返工后）

`BEFORE-HASHES.txt` / `HASHES-AFTER.txt`。

| 文件 | 返工前 | 返工后 |
|---|---|---|
| `src/ui/V2StructureRings.tsx` | `65dc1e65…` | `b2ad2e0f1dcfdde1f008d6d94ead31ae3ea3c6e65cd1099b1ccb54438a2a7d3c` |
| `src/ui/v2-structure-ring.css` | `224a0a9a…` | `af4cb3816ceca3ab8ce0399480b9486389b8c8895cd484139ae25dc1b40da7b7` |
| `src/ui/v2-fixed-page.css` | `16192b2e…` | `a259db480bd01f461f024ebf8c67b1e3a9c4ec545fc51c8d8d1048995ac7adec` |
| `tests/v2-ui.test.tsx` | `44c0f2fe…` | `55b9fda53f3ab6498ed366cb4a7725cb7a4b12b8d24c5e5558e4b627395a98b1` |

段 2 其余 10 个交付文件哈希与 `../f10-20261028/HASHES.txt` 完全一致（未触碰）：

`structure-ring.ts 461bf9e0…`、`fixed-expenses-model.ts 7762ec16…`、`V2PaidRing.tsx 7523d0f4…`、`V2StructureCard.tsx 8e4a63e6…`、`FixedExpensesPage.tsx 7bd97fea…`、`v2-home-revamp.css 97abe3d7…`、`v2-card.css 58a443b7…`、`main.tsx ffd71dcb…`、`p1p2-models.test.ts f3d92512…`、`p1p2-fixed-page.test.tsx 68abb820…`。

改动面：2 个 `src/ui` 文件 + 1 个 `src/ui` CSS + 1 个测试 + 本证据目录（含证据台 `harness/shoot.mjs` 探针新增）。未碰库、未碰 Financial Model、未提交 git。

---

## 6. 未做 / 需要复验时明示

1. **两项挂账保留**（不重复判）：圆环色 vs 轨道 1.63:1；条目行状态组合句挂文案签认清单。
2. **观察项（本次未改）**：`src/ui/v2-fixed-page.css:234`（超计划进度条填充）与 `:254`（超计划次行文字）仍用 `#b7483d`，非 A 标记、不在本次退回清单。实测：文字 `#b7483d`/白 **5.24:1**；若统一到 `#C2503C` 会降到 4.66:1（仍过 4.5 但余量变小），进度条填充 `#b7483d`/轨道 4.47:1（≥3）。建议文字保持 `#b7483d`，是否统一填充请验收员复验时明示；要改同批一次改。
3. 段 3 及以后未启动；**数据修正未执行**：活库与 chris 补发的 13 张分期截图都在当前授权工作区之外（详情见 `WORKLOG.md` 同日「数据修正未执行」），未读、未备份、未写入；等解阻后按方案 §3 走。
