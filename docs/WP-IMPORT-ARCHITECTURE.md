# 小钱家官方账单文件导入架构（EXEC-I-02-FILE-IMPORT）

**状态：** SUBMITTED_FOR_REVIEW  
**范围：** 仅本地官方导出文件；优先 CSV；PDF 延后评估。  
**时效性：** I-01 外部平台政策结论仅为当前管理依据，正式发布前重新核验；不得将 API 不可行写死为永久架构假设。

## 11 步流程

```mermaid
flowchart LR
A[授权：用户选择本地文件] --> B[获取：读取文件]
B --> C[解析]
C --> D[预览]
D --> E[去重]
E --> F[用户修改]
F --> G[确认]
G --> H[写入]
H --> I[回读]
I --> J[金额/日期校验]
J --> K[反馈：成功、部分成功、失败与审计记录]
```

| 步骤 | 处理 | 用户确认 | 约束 |
|---|---|---|---|
| 1 授权 | 本地文件选择器授予单次读取范围 | 是 | 不登录平台、不上传 |
| 2 获取 | 读取用户选定文件并记录文件摘要 | 否 | 原文件留在本机 |
| 3 解析 | 识别 CSV provider、字段、金额和日期 | 否 | 未知列保留诊断 |
| 4 预览 | 展示候选记录、错误、字段映射 | 是 | 写入前必须看见 |
| 5 去重 | 基于 provider+外部行键+金额日期摘要产生候选去重 | 否 | 不自动删除用户记录 |
| 6 用户修改 | 允许编辑分类、账户、日期、备注 | 是 | 修改留审计痕迹 |
| 7 确认 | 确认将要写入的记录和跳过项 | 是 | 可取消 |
| 8 写入 | 在本地事务中写入确认记录 | 否 | 失败可回滚 |
| 9 回读 | 重新读取写入结果 | 否 | 不以写入调用成功代替回读 |
| 10 校验 | 校验金额精度、日期、数量、去重结果 | 否 | 不通过则标记异常 |
| 11 反馈 | 报告成功/部分成功/失败、异常与审计记录 | 否 | 不隐藏部分失败 |

## 数据契约

```ts
export type ImportProvider = "ALIPAY_CSV" | "WECHAT_CSV" | "FUTURE_PROVIDER";
export type ImportReviewStatus = "PENDING" | "EDITED" | "CONFIRMED" | "SKIPPED" | "ERROR";

export interface ImportedExpenseCandidate {
  importBatchId: string;
  provider: ImportProvider;
  sourceRowKey: string;
  occurredAt: string;
  businessDate: string;
  amount: string;
  direction: "EXPENSE" | "INCOME" | "UNKNOWN";
  merchant: string | null;
  category: string | null;
  accountId: string | null;
  note: string | null;
  dedupeKey: string;
  reviewStatus: ImportReviewStatus;
  validationErrors: string[];
}

export interface ImportBatchResult {
  batchId: string;
  provider: ImportProvider;
  sourceFileSha256: string;
  totalRows: number;
  validRows: number;
  writtenRows: number;
  skippedRows: number;
  errorRows: number;
  auditEvents: string[];
}
```

## PDF 延后评估

PDF 不进入本阶段实现。只有在解析可靠性、人工校验、表格版式变化和部分成功标准明确后，才提交单独评审；本阶段不包含 PDF 解析代码。

## 安全与扩展边界

- 不实现 API/OAuth、平台登录、真实账号授权、真实账单读取或账单上传。
- `FUTURE_PROVIDER` 只用于保留扩展点，不表达任何永久政策结论。
- 生产 App、生产 DB、V4 migration 均不触碰。
