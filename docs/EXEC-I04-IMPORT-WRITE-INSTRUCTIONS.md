# EXEC-I-04 执行指令（build-26）

## 架构决定

- Schema V7 为 `expenses` 增加 `dedupe_key` 列与 `(profile_id, dedupe_key)` 部分唯一索引。
- 只有 `direction === "EXPENSE"` 的候选允许写入。
- 导入写入必须通过 `Repositories.writeImportBatchAtomically` 单事务完成。
- 文件哈希使用 `globalThis.crypto.subtle.digest("SHA-256")`，不引入 `node:crypto`。

## 处理优先级

1. `reviewStatus === "SKIPPED"` → skipped。
2. `reviewStatus === "ERROR"` → error。
3. `dedupeKey` 命中既有键 → skipped：duplicate。
4. `direction !== "EXPENSE"` → skipped：direction。
5. category 不存在或不 active → error。
6. accountId 不属于 profile → error。
7. businessDate 非法 → error。
8. 其余 validRows 并进入事务写入。

## 事务与回读

- 先插入 `import_batches`，再插入 `expenses`，任一失败自动回滚。
- 提交后逐条回读 `amount / occurredOn / categoryId / accountId`。
- 回读失败抛 `ApplicationDataError("IMPORT_READBACK_FAILED")`。
- 审计事件包含逐行原因、逐条回读、批次提交结果。

## 禁止

- 网络请求、PDF、平台 API。
- 修改只读模型文件与 UI。
- 删除或覆盖用户既有记录。
