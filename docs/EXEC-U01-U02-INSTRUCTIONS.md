# EXEC-U-01 + EXEC-U-02 执行指令（build-28）

**角色：** 执行者
**基线：** `427078f`（build-27）
**目标：** 实现快速记账组件 + 导航重构
**日期：** 2026-10-20

---

## 一、EXEC-U-01：快速记账组件

### 新增文件

#### `src/ui/v2-quick-entry.tsx`

```tsx
// 组件签名
export function V2QuickEntry({
  expenseService,
  repositories,
  profileId,
  onRecorded,
}: {
  expenseService: V2ExpenseService;
  repositories: Repositories;
  profileId: string;
  onRecorded?: (record: ExpenseRecord) => void;
})
```

**交互流程：**

1. 组件挂载时加载类别和账户：
   - `repositories.listCategories(profileId)` → 过滤 `active === true`
   - `repositories.listAccounts(profileId)` → 过滤 `active === true && kind === "CASH"`
2. 金额输入框自动聚焦（`autoFocus`），`inputMode="decimal"`，`type="text"`
3. 类别为水平图标行，每个类别显示 `icon` + `name`，点击选中（单选）
4. 账户为下拉选择（如果只有一个账户则自动选中）
5. 备注为可选 `<input type="text" placeholder="备注（可选）">`
6. 日期默认 `getDefaultBusinessDate()`，`<input type="date">`
7. 保存按钮文字："记一笔"

**保存逻辑：**

```
点击保存 →
  validateQuickEntry({ amount, categoryId, accountId, occurredOn }) →
  不通过 → 显示错误（保留输入）→
  通过 →
  expenseService.recordCashDebitExpense({
    id: crypto.randomUUID(),
    profileId,
    kind: "CASH_DEBIT",
    amount: normalizedAmount,
    currency: "CNY",
    occurredOn: date,
    categoryId,
    description: note,
    accountId,
    countsAsDailyExpense: true,
    createdAt: new Date().toISOString(),
  }) →
  成功 → 清空表单 + onRecorded?.(record) + 显示成功消息 2 秒 →
  失败 → 显示错误消息（保留输入）
```

**错误消息映射（中文）：**

| reason | 显示 |
|---|---|
| AMOUNT_REQUIRED | 请输入金额 |
| AMOUNT_ZERO | 金额不能为零 |
| AMOUNT_NEGATIVE | 金额不能为负数 |
| AMOUNT_TOO_LARGE | 金额超出范围 |
| AMOUNT_INVALID | 金额格式不正确 |
| CATEGORY_REQUIRED | 请选择类别 |
| 其他 | 保存失败，请重试 |

**成功反馈：** 保存成功后在表单下方显示：`✓ 已记入本月消费`，2 秒后自动消失。

#### `src/ui/v2-quick-entry.css`

使用 `v2-surface.css` 已定义的 CSS 变量。关键样式：
- 金额输入：`font-size: 32px; font-weight: 600; font-variant-numeric: tabular-nums;`
- 类别图标行：`display: flex; gap: 12px; overflow-x: auto;`
- 保存按钮：`background: var(--teal); color: white; border-radius: 8px; padding: 12px 24px;`
- 错误文字：`color: var(--danger); font-size: 13px;`
- 成功反馈：`color: var(--teal); font-size: 14px;`

#### `tests/v2-ui/quick-entry-flow.test.tsx`

测试用例：
1. 渲染后金额输入框获得焦点
2. 类别列表从 repositories 加载（mock）
3. 空金额提交显示"请输入金额"
4. 零金额提交显示"金额不能为零"
5. 有效输入提交后调用 `recordCashDebitExpense`
6. 保存成功后表单清空
7. 保存失败后表单保留

---

## 二、EXEC-U-02：导航重构

### 修改文件

#### `src/ui/V2HomeSurface.tsx`

将 `Tab` 类型从 `"dashboard" | "trends" | "import"` 改为：

```ts
type Tab = "today" | "record" | "progress" | "mine";
```

**导航栏：**
```
[今天] [记录] [进展] [我的]          [+ 记一笔]
```

- "记一笔"按钮点击 → `setTab("record")` 并触发快速记账聚焦（通过 ref 或 state）
- 默认 tab 为 `"today"`

**页面映射：**
- `today` → `<V2Today />`（本批次为简单占位：显示 `<V2Dashboard>` 内容）
- `record` → `<V2QuickEntry>` + 最近记录（本批次只显示 `<V2QuickEntry>`）
- `progress` → `<V2Trends>`（本批次复用现有趋势组件）
- `mine` → 导入面板（将现有导入逻辑移入此处）

**保持：**
- `V2Dashboard` 和 `V2Trends` 组件不修改
- 导入功能完整保留（只是位置从顶级 tab 移入"我的"）
- `expenseService` 和 `importService` 的创建逻辑不变

#### `src/ui/v2-surface.css`

修改导航样式：
- 导航按钮从 3 个变为 4 个
- 新增"记一笔"按钮样式：`background: var(--teal); color: white; border-radius: 8px; margin-left: auto;`
- 新增 `@media (max-width: 640px)` 底部固定导航：
  ```css
  .v2-surface-nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    border-top: 1px solid var(--line);
    border-bottom: none;
  }
  .v2-surface-content {
    padding-bottom: 64px; /* 为底部导航留空间 */
  }
  ```

#### `tests/v2-ui/navigation.test.tsx`

测试用例：
1. 渲染 4 个导航按钮：今天、记录、进展、我的
2. 点击"记录"切换到快速记账
3. 点击"我的"显示导入面板
4. "记一笔"按钮存在且点击后切换到记录页
5. 现有 `v2-ui.test.tsx` 中的测试仍通过

---

## 三、提交前验证

```bash
cd "/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2"
npx tsc --noEmit
npm run build:web
NODE_ENV=test npx vitest run
```

要求：
- `tsc --noEmit`：零错误
- `build:web`：成功
- 全量测试：0 failed（现有 1480 passed 不减少，新增测试全部通过）

---

## 四、提交

```bash
git add -A
git status --short   # 核对无意外文件
git commit -m "build-28: U-01 quick entry component, U-02 navigation restructure"
```

---

## 五、禁止

- 不修改 `src/model/v2-*.ts` 任何文件
- 不修改 `src/application/v2-expense-service.ts` 或 `v2-import-service.ts`
- 不修改 `src/persistence/` 任何文件
- 不触碰 Production App/DB
- 不引入新依赖
- 不删除现有测试
- 不修改 `v2-dashboard.tsx` 或 `v2-trends.tsx`

---

## 六、回执要求

执行者提交后报告：

1. 最终 commit hash（完整 40 位）
2. `git show --stat HEAD` 文件计数
3. 三项验证的通过证据（测试总数/通过数）
4. 新增测试数量
5. 任何偏离本指令的操作及原因

</content>