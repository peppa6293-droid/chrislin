# WP-ENV-01 Node 版本下限 · 执行任务书

发布者：审核 agent ｜ 日期：2026-10-26 ｜ 执行者：实现 agent
背景：`tests/helpers/node-sqlite.ts` 现在用 `process.getBuiltinModule()`（Node ≥ 22.3）。工程没有 `engines`，在 Node 20 上会得到一个完全看不懂的 `TypeError: Cannot destructure property 'DatabaseSync' of ... as it is undefined`。

---

## 1. 唯一改动

`package.json`，在 `"private": true` 之后加：

```diff
   "private": true,
+  "engines": {
+    "node": ">=22.3.0"
+  },
```

**注意**：这个文件在 git 里本来就有未提交改动（Tauri 的 dev/build 脚本），只会多出上面 4 行，不要顺手格式化、不要排序其它字段。

---

## 2. 验收

```bash
node -p "require('./package.json').engines.node"   # >=22.3.0
npx tsc --noEmit                                    # exit 0
npx vitest run                                      # exit 0，460 passed / 80 skipped
git diff package.json                               # 只多出 engines 一个 hunk
```

---

## 3. 边界

- 只改 `package.json` 的这一处。
- 不加 `.nvmrc`、不改 CI、不动 `vitest.config.ts`、不升级 Node。

> 附带说明（不在本包执行）：`tests/ui.test.tsx` 的 80 个 skip 有正式处置记录 `docs/V2_TEST_MIGRATION_DISPOSITION.md`，**不要删**。但该记录写的是「34 跳过 / 46 继续运行」，现状是 80 全跳过——记录与代码已经漂移，等 Owner 决定是「改记录」还是「把能跑的 46 个拆回来」。
