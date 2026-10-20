# EXEC-U-05 执行指令（build-31）

**角色：** 执行者
**基线：** `163d8bf`（build-30，U-03 + U-04 已验收）
**目标：** 实现今天页今日任务卡（确定性选择，产品设计 §4.2 层级 2），接入 V2Surface today 页
**日期：** 2026-10-20

---

## 一、背景与边界

**已完成：**
- build-28：`src/ui/v2-quick-entry.tsx`（U-01 快速记账）
- build-29：`src/ui/v2-surface.tsx`（U-02 四目的地导航）
- build-30：`src/ui/v2-today.tsx` + `src/ui/v2-progress.tsx`（U-03/U-04）

**本批次目标：**
- 新增 `src/model/v2-task-selector.ts` — 纯函数任务选择器
- 新增 `tests/v2-ledger/task-selector.test.ts` — 纯函数测试
- 新增 `src/ui/v2-today-task.tsx` — 任务卡组件
- 新增 `src/ui/v2-today-task.css` — 任务卡样式
- 新增 `tests/v2-ui/today-task.test.tsx` — 组件测试
- 修改 `src/ui/v2-surface.tsx` — today 页在 `V2Today` 上方插入任务卡
- 修改 `tests/v2-ui/v2-surface.test.tsx` — 更新 today 页断言（允许）

**不修改的文件（禁止触碰）：**
- `src/ui/v2-today.tsx`、`src/ui/v2-progress.tsx`、`src/ui/v2-quick-entry.tsx`
- `src/ui/V2HomeSurface.tsx`、`src/ui/v2-dashboard.tsx`、`src/ui/v2-trends.tsx`
- `src/model/` 下所有现有文件（本批次**新增** `v2-task-selector.ts` 是允许的）
- `src/application/` 与 `src/persistence/` 全部文件

---

## 二、纯函数：`src/model/v2-task-selector.ts`

```ts
export interface TaskContext {
  hasStructuralDeficit: boolean; // 结构性缺口
  cashFloorMet: boolean;         // 现金安全线是否达标
  hasMissingDebtFact: boolean;   // 债务本月事实缺失
  hasExpenseGap: boolean;        // 安全垫有缺口但无硬闸门
  monthExpenseCount: number;     // 本月记录笔数
}

export type TaskId =
  | "CLARIFY_GAP"
  | "SECURE_CASH"
  | "CONFIRM_DEBT"
  | "CHECK_SAFETY"
  | "RECORD_EXPENSE"
  | "DEFAULT_RECORD";

export function selectTodayTask(context: TaskContext): TaskId
```

**优先级（从高到低）：**

1. `hasStructuralDeficit` → `CLARIFY_GAP`
2. `!cashFloorMet` → `SECURE_CASH`
3. `hasMissingDebtFact` → `CONFIRM_DEBT`
4. `hasExpenseGap` → `CHECK_SAFETY`
5. `monthExpenseCount === 0` → `DEFAULT_RECORD`（记下第一笔）
6. 其余 → `RECORD_EXPENSE`（记下一笔今天的花销）

**要求：**
- 纯函数，无副作用，不导入任何 React / DOM / decimal.js 依赖
- 六个 TaskId 全部可达且有测试覆盖
- 同文件导出 `TASK_COPY: Record<TaskId, { title: string; reason: string; duration: string; action: string }>` 文案表：

| TaskId | title | reason | duration | action |
|---|---|---|---|---|
| CLARIFY_GAP | 把本月收支缺口理清 | 本月支出超过了收入，先看清现状 | 约 3 分钟 | 去记录 |
| SECURE_CASH | 先让手里的现金安心一点 | 现金低于安全线，先稳住手头 | 约 3 分钟 | 去记录 |
| CONFIRM_DEBT | 确认本月要还多少 | 本月债务事实还没确认 | 约 2 分钟 | 去记录 |
| CHECK_SAFETY | 看看安全垫离目标还有多远 | 安全垫还有缺口 | 约 2 分钟 | 去记录 |
| RECORD_EXPENSE | 记下一笔今天的花销 | 每一笔记录都让画面更完整 | 约 10 秒 | 去记录 |
| DEFAULT_RECORD | 记下第一笔花销 | 从第一笔开始，建立你的财务画面 | 约 10 秒 | 记一笔 |

---

## 三、纯函数测试：`tests/v2-ledger/task-selector.test.ts`

至少覆盖：

1. 六条优先级规则各一个用例（高优先级压制低优先级：例如同时 `hasStructuralDeficit` 与 `!cashFloorMet` 时返回 `CLARIFY_GAP`）
2. 全 false + `monthExpenseCount: 0` → `DEFAULT_RECORD`
3. 全 false + `monthExpenseCount: 3` → `RECORD_EXPENSE`
4. `TASK_COPY` 六个键齐全，每条文案非空

---

## 四、组件：`src/ui/v2-today-task.tsx`

```tsx
export function V2TodayTask({
  repositories,
  profileId,
  onGoRecord,
}: {
  repositories: Repositories;
  profileId: string;
  onGoRecord: () => void;
})
```

**context 构造（本批次）：**

```ts
const month = localDate(new Date()).slice(0, 7);
const expenses = await repositories.listV2Expenses(profileId, month);
const context: TaskContext = {
  hasStructuralDeficit: false,
  cashFloorMet: true,      // 注意：必须为 true（已达标），否则会命中规则 2
  hasMissingDebtFact: false,
  hasExpenseGap: false,
  monthExpenseCount: expenses.length,
};
```

> ⚠️ 批次方案原文写"四个标志全部硬编码 false"，但 `cashFloorMet: false` 会触发 `SECURE_CASH`，与"本批次只会选中记录类任务"矛盾。本指令已修正为 `cashFloorMet: true`。V1 模型接入留给后续批次。

**渲染：**
- 任务卡显示：`TASK_COPY[taskId]` 的 title、reason、duration、主按钮（action 文案）
- 主按钮点击：调用 `onGoRecord`，并把按钮切换为已完成态（文案「已完成」，`disabled`）；完成态为组件本地 state，无需持久化
- 加载中：「加载中…」；加载失败：「数据加载失败，请重试。」
- 当前真实数据下（0 笔记录）应显示 `DEFAULT_RECORD` 文案；有记录后显示 `RECORD_EXPENSE`

---

## 五、样式：`src/ui/v2-today-task.css`

- 复用 `v2-surface.css` 的 `--v2-*` 变量，卡片与 `v2-today__summary` 视觉一致
- 标题 `font-size: 18px; font-weight: 600;`；reason/duration `color: var(--v2-muted); font-size: 13px;`
- 主按钮沿用现有按钮样式惯例（参考 `v2-today.css` 中按钮）
- **不使用** `--v2-danger`；不显示任何分数
- 响应式：640px 以下全宽

---

## 六、组件测试：`tests/v2-ui/today-task.test.tsx`

mock `repositories.listV2Expenses`：

1. 0 笔记录 → 显示「记下第一笔花销」与「记一笔」按钮
2. ≥1 笔记录 → 显示「记下一笔今天的花销」
3. 点击主按钮调用 `onGoRecord` 且按钮变为「已完成」并禁用
4. 加载中 / 加载失败状态文案正确
5. 页面不出现红色或分数文案（同 U-04 断言方式）

---

## 七、接线：`src/ui/v2-surface.tsx`

today 页改为：

```tsx
{tab === "today" ? (
  <>
    <V2TodayTask repositories={repositories} profileId={profileId} onGoRecord={goRecord} />
    <V2Today
      expenseService={expenseService}
      repositories={repositories}
      profileId={profileId}
      onGoRecord={goRecord}
    />
  </>
) : null}
```

- 新增 `import { V2TodayTask } from "./v2-today-task.js";`
- record / progress / mine / 「记一笔」按钮逻辑不变
- `tests/v2-ui/v2-surface.test.tsx`：repositories mock 已有 `listV2Expenses`；today 断言可追加任务卡文案（如「记下第一笔花销」），现有「这个月」断言保留

---

## 八、提交前验证

```bash
cd "/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2"
npx tsc --noEmit
npm run build:web
NODE_ENV=test npx vitest run
```

要求：
- `tsc --noEmit`：零错误
- `build:web`：成功
- 全量测试：0 failed；基线 1506 passed（build-30）不减少，新增测试全部通过

---

## 九、提交

```bash
git add -A
git status --short   # 核对无意外文件
git commit -m "build-31: U-05 deterministic today task card wired into today page"
```

---

## 十、禁止

- 不修改第四节列出的禁止触碰文件
- 不接入 V1 模型数据（债务/现金/安全垫标志保持硬编码）
- 不引入新依赖、不引入状态机或存储
- 不触碰 Production App/DB
- 不使用红色（`--v2-danger`）、不显示 0-100 分
- 任务卡同一时间只显示 1 个任务，不得并列多个
- 不删除现有测试

---

## 十一、回执要求

1. 最终 commit hash（完整 40 位）
2. `git show --stat HEAD` 文件计数
3. 三项验证通过证据（测试总数/通过数，对比基线 1506）
4. 新增测试数量
5. 任何偏离本指令的操作及原因
</content>