# build-49 · U-13 执行回执

- 基线：HEAD `4442c39`（build-48）
- 分支：`main`
- 执行日期：2026-10-21
- 任务书：`docs/EXEC-U13-DASHBOARD-REALNUMBERS-INSTRUCTIONS.md`（按审核员已裁决的工作区修订实现，未修改、未提交任务书）

## 一、逐项状态

### A. 迁移 v8 + 仪表盘真实数字 — 完成

- `CURRENT_SCHEMA_VERSION` 7 → 8；新增 `migrationV8`：
  - `income_entries`（含 `period_month` 校验、`one_time` 0/1 约束、`(profile_id, occurred_at, label, amount)` 唯一约束、`income_entries_profile_month` 索引）
  - `cash_accounts.reserved_amount TEXT NOT NULL DEFAULT '0.00'`
  - `fixed_expense_plans`（含 `active` 0/1 约束、`fixed_expense_plans_profile_lookup` 索引）
  - `PRAGMA user_version = 8`，并写入 `schema_migrations(version=8)`；迁移在事务中执行，`applied >= 8` 时提前返回，保持幂等。
- `getDashboardProps`：
  - `income` = 当月 `income_entries.amount` 聚合（含一次性）；`recurringIncome` = 仅 `one_time=0` 聚合；`incomeIncludesOneTime` = 当月是否存在一次性收入。
  - `accountCash` = 当月月末 `cashAccountsAt(monthEnd, profileId)` 各账户最新余额快照聚合（`LIQUID_INVESTMENT` 资产不计入）。
  - 无字面量 `"0.00"` 兜底；全部金额经 decimal.js 计算后 `toDecimalPlaces(2, ROUND_HALF_UP).toFixed(2)`。
- `getSafetySnapshot`：`safetyResources` = 计入安全资源的现金 + `kind='LIQUID_INVESTMENT'` 且计入安全资源的资产；`reserved` = 全部活跃现金账户 `reserved_amount` 之和；`freeCash = safetyResources - reserved`（不做负值截断）。
- 自测锚点（与审核员待播种数据同形假数据，内存库）：
  - `income 13791.25` / `recurringIncome 12791.25` / `incomeIncludesOneTime true`
  - `accountCash 5325.93`
  - `safetyResources 25325.93` / `reserved 3800.00` / `freeCash 21525.93`
  - 见 `dashboard-props.json` 与 `dashboard-income-cash.png`。

### B. `fixed_expense_plans` CRUD + 月度核心义务 — 完成

- Repositories 新增：`createFixedExpensePlan`、`listFixedExpensePlans(profileId, effectiveFrom?)`（`active=1 AND effective_from<=?`）、`updateFixedExpensePlan`、`deactivateFixedExpensePlan`；不存在时抛 `FIXED_EXPENSE_PLAN_NOT_FOUND`。
- `getMonthlyCoreObligations(profileId, month)` = 当月生效固定计划合计 + 当月债务 `current_month_due` 合计（`null` 视为无当期应还）。
- 未建水电预算项、未硬编码 500、未写死户主金额；金额全部来自库表。
- 自测：10 月固定计划合计 `5076.31`（1900 + 728 + 300 + 1500 + 648.31）；11 月含债供 `8851.03` → `13927.34`，与锚点一致。

### C. 一次性收入口径与仪表盘标签 — 完成

- `one_time=1` 计入 `income`、排除出 `recurringIncome`。
- 收入卡片在 `incomeIncludesOneTime=true` 时渲染精确文本「含一次性收入」（`data-testid="income-one-time-badge"`），否则不渲染。
- 自测：9 月工资 12791.25 + 进步奖 1000.00 → 收入 13791.25、经常性 12791.25、标签可见；10 月仅经常性收入时标签不出现。

### D. 构建与证据 — 完成

- `npm run build` + `npm run tauri:build:smoke` 退出码 0。
- 证据目录：`evidence/u13-realnumbers-20261021/`
  - `preflight-test.log`、`preflight-typecheck.log`、`preflight-lint.log`
  - `build-smoke.log`
  - `dashboard-income-cash.png`、`dashboard-props.json`
  - 本回执 `RECEIPT.md`
- DMG：`src-tauri/target/release/bundle/dmg/小钱家_0.1.0_aarch64.dmg`
  - SHA256：`58e9cc6e43cc73c51628d420017d0311baa05f76f95b973e06093c8024b5c853`
  - App：`src-tauri/target/release/bundle/macos/小钱家.app`（12.96 MiB）

## 二、测试数量

| 项目 | 基线 | 本次 |
|---|---|---|
| Test Files | 41 passed / 1 skipped | 41 passed / 1 skipped |
| Tests | **403 passed / 80 skipped** | **412 passed / 80 skipped（+9）** |

新增用例：收入按月聚合与一次性标记、现金快照取月末最新、reserved 扣减与 `freeCash`、投资资产不计入 `accountCash`、固定计划 + 债供核心义务、fresh→v8 可写、v7→v8 保数据、v3→v8；UI 侧新增一次性收入标签显隐。

preflight（全绿，退出码 0）：

```
env NODE_ENV=test npx vitest run --reporter=dot   # 412 passed / 80 skipped
npm run typecheck                                  # exit 0
npm run lint                                       # exit 0（122 files checked）
```

## 三、迁移验证

| 场景 | 覆盖位置 | 结果 |
|---|---|---|
| fresh → v8 | `tests/v2-ledger/v2-expense-service.test.ts` | `user_version=8`，三张新表可读写，`reserved_amount` 默认 `0.00` |
| v7 → v8 | 同上 | 既有行保留，新增列默认值正确，重跑迁移幂等 |
| v3 → v8 | `tests/future-schema-guard.test.ts`、`tests/v4-foundation.test.ts` | 3→8 全链路成功，V3 业务行与 Home/model 输出不变 |
| v5 / v6 → v8 | `tests/v2-ledger/expense-persistence.test.ts`、`tests/v2-ledger/import-write.test.ts` | 增量迁移成功，v8 逆向回滚（drop 列/表）后可重迁 |
| 未来版本守卫 | `tests/future-schema-guard.test.ts` | 版本 9 拒绝降级，当前版本判定为 8 |

生产库未被打开、未被写入；全部自测使用内存库或临时文件库（临时文件已清理）。

## 四、改动文件清单（12 个受控文件）

源码：

1. `src/persistence/migrations.ts`
2. `src/persistence/repositories.ts`
3. `src/application/v2-expense-service.ts`
4. `src/ui/v2-dashboard.tsx`

测试：

5. `tests/v2-ledger/v2-expense-service.test.ts`
6. `tests/v2-ui/dashboard.test.tsx`
7. `tests/v4-foundation.test.ts`
8. `tests/future-schema-guard.test.ts`
9. `tests/product-restart.test.ts`
10. `tests/v4-acceptance-sandbox.test.ts`
11. `tests/v2-ledger/expense-persistence.test.ts`
12. `tests/v2-ledger/import-write.test.ts`

新增证据：`evidence/u13-realnumbers-20261021/`（6 个文件 + 本回执）。

## 五、与任务书的偏差 / 需知会事项

1. 任务书称 `tests/v2-ui/dashboard.test.tsx` 有 5 处 `ledger` fixture，实际为 3 处；已更新全部 3 处，并在新增标签测试中再构造 2 处，需求已完整覆盖。
2. 除任务书列出的测试外，另有 5 个版本断言测试需随 v8 机械更新（`future-schema-guard`、`product-restart`、`v4-acceptance-sandbox`、`expense-persistence`、`import-write`），仅改版本号/表清单/回滚清单，无业务逻辑变更。
3. 金额输出统一用 `toDecimalPlaces(2).toFixed(2)`（即服务层 `formatMoney`），未使用会丢尾零的 `moneyString`，以满足两位小数与 `0.00` 要求。
4. 截图方式：`V2Dashboard` 目前是独立 prop 驱动组件、未接入生产路由，故截图由临时 SSR 脚本（`/tmp/u13-shot/render.mjs`，仓库外、未提交）加载真实 `dist` 服务与内存库、内联真实 CSS 后渲染，再由无头 Chrome 截图；数值全部来自真实服务调用，非手写 HTML。
5. 全量测试首轮出现 `tests/v2-ui/import-flow.test.tsx` 状态文案偶发失败，单跑与复跑均通过，判定为既有 flake，未改动该文件。

## 六、git status --short（提交前）

```
 M src/application/v2-expense-service.ts
 M src/persistence/migrations.ts
 M src/persistence/repositories.ts
 M src/ui/v2-dashboard.tsx
 M tests/future-schema-guard.test.ts
 M tests/product-restart.test.ts
 M tests/v2-ledger/expense-persistence.test.ts
 M tests/v2-ledger/import-write.test.ts
 M tests/v2-ledger/v2-expense-service.test.ts
 M tests/v2-ui/dashboard.test.tsx
 M tests/v4-acceptance-sandbox.test.ts
 M tests/v4-foundation.test.ts
?? .claude/
?? WORKLOG.md
?? evidence/u13-realnumbers-20261021/
?? pelican-bicycle-animation.html
?? pelican-bicycle.html
?? pelican-bike-ride.html
?? pelican-bike.html
?? pelican-cycling.html
```

仅提交上述 12 个受控文件与 `evidence/u13-realnumbers-20261021/`；`.claude/`、`WORKLOG.md`、`pelican-*.html` 与本任务无关，不纳入提交。
