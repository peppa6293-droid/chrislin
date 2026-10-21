# U-14 验收回执（build-50）

日期：2026-10-21 ｜ 执行者：build-50 ｜ 任务书：`docs/EXEC-U14-DASHBOARD-ROUTE-WIRING-INSTRUCTIONS.md` ｜ 基线：代码 HEAD `bb933a0`、plan HEAD `9a7754a`

## 一、任务项状态

| 项 | 状态 | 说明 |
|----|------|------|
| A. 路由接线（V2Dashboard 生产可达） | ✅ 完成 | 我的财务 → 收支账本（details）→ 懒加载 V2DashboardLoader → V2Dashboard；入口默认当前月 |
| B. 验收真包（production DMG + 证据目录） | ✅ 完成 | production 身份只构建未启动；DMG + SHA256 + 三项 preflight + build 日志 + 路由截图 + 本回执 |
| C. flake 治理（import-flow 三连跑） | ✅ 完成 | 相关 4 文件连跑 3 次，31/31、31/31、31/31 全绿 |

## 二、回执九要素

### 1. A/B/C 逐项状态
见上表，A、B、C 三项全部完成，无 RETURN 事项——任务书与真实代码核对过程中未发现不符点。

### 2. 测试数量：412 → 415（+3，只增不减）
- 最终 preflight：`env NODE_ENV=test npx vitest run --reporter=dot` → **415 passed | 80 skipped (495)**，exit 0（`preflight-vitest.log`）
- `env NODE_ENV=test npm run typecheck` → exit 0（`preflight-typecheck.log`）
- `env NODE_ENV=test npm run lint` → exit 0（`preflight-lint.log`）
- 新增：`tests/v2-ui/dashboard-route.test.tsx`（3 用例，路由级、走 service 边界）：
  1. 经 details 入口展开后仪表盘可见：收入 13791.25 / 经常性收入 12791.25 / 账户现金 5325.93 / 含一次性收入徽标；
  2. 入口默认当前月：`getV2DashboardProps` 首参为 "2026-09"（fixture 会话日）；
  3. 纯经常性收入时不渲染一次性徽标。

### 3. 改动文件清单（本次提交，显式路径 add）
- `src/runtime/tauri-bootstrap.ts`（修改）
- `src/ui/HomeScreen.tsx`（修改）
- `src/ui/v2-dashboard.tsx`（修改）
- `tests/v2-ui/dashboard-route.test.tsx`（新增）
- `evidence/u14-route-20261021/`（新增，10 个文件）
- 未提交（按要求排除）：`.claude/`、`WORKLOG.md`、`pelican-*.html`（×5）、`/tmp` 下全部 harness 文件

### 4. 路由接线说明（入口文件：行号）
组合根 `src/runtime/tauri-bootstrap.ts`：
- `TauriApplicationServices.getV2DashboardProps` 接口声明 — `src/runtime/tauri-bootstrap.ts:276`
- `TauriProductServices.getV2DashboardProps` 接口声明 — `src/runtime/tauri-bootstrap.ts:329`
- 实现：getProfile → `new V2ExpenseService(repositories).getDashboardProps(profile.id, month)` — `src/runtime/tauri-bootstrap.ts:384-394`
- 惰性包装（`open()` 后转发）— `src/runtime/tauri-bootstrap.ts:447`

UI `src/ui/HomeScreen.tsx`：
- 仪表盘样式与组件 import（带 vite/core 注释）— `src/ui/HomeScreen.tsx:25-26`
- `importServices` / `dashboardServices` 经 `getTauriProductServices()` 捕获组合根 — `src/ui/HomeScreen.tsx:67,70`
- MY_FINANCE 分支「收支账本」details 入口，onToggle 置 dashboardOpen 懒加载 — `src/ui/HomeScreen.tsx:299-310`
- 入口默认当前月：`month={date.slice(0, 7)}`（date = asOfDate ?? home.asOfDate）— `src/ui/HomeScreen.tsx:306`（date 归一 `src/ui/HomeScreen.tsx:132`）
- `V2DashboardLoader`（待读取文案 → props 到达后渲染 V2Dashboard）— `src/ui/HomeScreen.tsx:481,504-505`

`src/ui/v2-dashboard.tsx`：CSS import 移除（样式统一由 HomeScreen 引入，避免 TS2882 重复模块图）；根节点 `data-testid="v2-dashboard"`、财务概览标题、`data-testid="ledger-recurring-income"` 经常性收入行与一次性收入徽标。

不新增图标、不改底部导航。生产可达路径：底部导航「我的财务」（aria-label）→ MY_FINANCE 路由 → 「收支账本」details 展开 → V2Dashboard。

### 5. DMG 路径 + SHA256
- 路径：`src-tauri/target/release/bundle/dmg/小钱家_0.1.0_aarch64.dmg`
- SHA256：`3c13cdd7b5da3eddaad470b22223358952434e6abe7bfcc91e941137ade1fc59`（`dmg-sha256.txt`）
- 构建身份：production（`__WP03_PREVIEW_BUILD__=false`），**只构建、未启动**（遵守红线：启动会触发 v3→v8 迁移属写库行为）；构建日志 `build-production.log`（exit 0）

### 6. 证据目录 `evidence/u14-route-20261021/`
| 文件 | 内容 |
|------|------|
| `preflight-vitest.log` | 415 passed / 80 skipped，exit 0 |
| `preflight-typecheck.log` | typecheck exit 0 |
| `preflight-lint.log` | lint exit 0 |
| `build-production.log` | production 构建 exit 0 |
| `dmg-sha256.txt` | DMG SHA256 |
| `flake-import-flow-3runs.log` | import-flow 相关 4 文件 3 连跑：31/31 × 3 全绿 |
| `route-entry-home.png` | 截图①：首页，底部导航「我的财务」入口可见 |
| `route-entry-myfinance.png` | 截图②：我的财务路由页，「收支账本」「账单导入」入口卡片可见（资产 ¥20,000.00 / 现金 ¥5,325.93 真数） |
| `route-dashboard-ledger.png` | 截图③：收支账本展开后 V2Dashboard 真数区 |
| `RECEIPT.md` | 本回执 |

截图③可见全部财务锚点：**收入 13791.25 / 经常性收入 12791.25（含一次性收入徽标）/ 账户现金 5325.93**，与任务书验收锚点一致。

截图方法（脚本不提交，位于 /tmp/u14-shot/）：Node 侧 `seed.mjs` 用仓库 `dist/` 真实 production services + node:sqlite 内存库播种裁决基线（U-13 同方法），预生成全部 payload 写 `u14-data.json`；vite 将生产 UI 图中的 `../runtime/tauri-bootstrap.js` 别名到 shim（只读 JSON 提供 payload，UI 代码零改动零复制）；生产 App 渲染于无头 Chrome（`http.server` + CDP 实时驱动：轮询 DOM 至仪表盘挂载且锚点值出现，`scrollIntoView` 后截图）。关键教训：`--screenshot --virtual-time-budget` 的绘制帧滞后于 React 提交（跨预算字节级相同 hash、动画中间帧），CDP 真实时间驱动消除该竞态；仪表盘卡片位于内层 `.v2-content` 滚动容器内，`captureBeyondViewport` 不展开内层容器，须显式 `scrollIntoView`。

### 7. flake 三连跑结果
`flake-import-flow-3runs.log`：import-flow 相关 4 文件连跑 3 次 → **31 passed、31 passed、31 passed**，三连绿。

### 8. `git status --short`（提交后应仅剩排除项）
```
?? .claude/
?? WORKLOG.md
?? pelican-bicycle-animation.html
?? pelican-bicycle.html
?? pelican-bike-ride.html
?? pelican-bike.html
?? pelican-cycling.html
```
（3 个源文件 + 1 个测试 + evidence/ 已入库；以上排除项按红线一律不提交。）

### 9. WORKLOG.md 归属与用途
`WORKLOG.md` 是仓库根部的**跨会话实时工作日志**（个人助理会话维护，非本次任务产物、非 build-50 改动），用于记录各会话的动作与结果摘要；按红线不提交、保持未跟踪。

## 三、验收锚点核对
| 锚点 | 值 | 依据 |
|------|-----|------|
| income | 13791.25 | dashboard-route 测试断言 + 截图③ |
| recurringIncome | 12791.25 | 测试断言 + 截图③ |
| 一次性收入标签可见 | ✅ | 测试断言（badge）+ 截图③「含一次性收入」 |
| accountCash | 5325.93 | 测试断言 + 截图③ |
| safetyResources | 25325.93 | seed.mjs 预生成 home payload 输出 |
| freeCash | 21525.93 | = 25325.93 − 3800.00 预留 |
| 固定计划合计 / 2026-11 债供 8851.03 | 未触碰 | 本次无任何模型计算改动 |
| U-11、U-12 不回退 | ✅ | 415 passed 全量含 U-11/U-12 用例 |

## 四、超范围改动
无。未发生需 RETURN 请示的事项。
