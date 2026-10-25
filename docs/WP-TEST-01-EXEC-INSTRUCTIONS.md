# WP-TEST-01 测试环境修复 · 执行任务书

发布者：审核 agent ｜ 日期：2026-10-26 ｜ 执行者：实现 agent（非审核者）
背景：全仓 `vitest run` 长期是红的——**9 个套件失败**（7 个根本加载不了 + 2 个断言失败），导致回归门禁只能靠定向跑。本包把这两个原因都拆掉，**不动任何 src/ 生产代码**。

---

## 0. 现状（审核员实测）

```
npx vitest run
Test Files  9 failed | 40 passed (49)
Tests       2 failed | 409 passed (411)
```

两个根因，彼此独立：

| # | 现象 | 根因 |
|---|---|---|
| A | 7 个 `// @vitest-environment happy-dom` 套件加载失败：`Cannot bundle Node.js built-in "node:sqlite"` | `tests/helpers/node-sqlite.ts` 顶层 `import { DatabaseSync } from "node:sqlite"`，被 happy-dom（client 环境）的转换图当成可打包模块 |
| B | 2 个测试 `db.connection.serialize is not a function` | 本机 Node **v22.22.0** 的 `DatabaseSync` 没有 `serialize()`（该 API 在更新的 Node 才有） |

审核员已实测：只做 A，套件数从 `9 failed | 40 passed` 变为 `2 failed | 46 passed | 1 skipped`，测试从 `409 passed` 变为 `458 passed`；做完 A+B 应全绿。

---

## 1. T1（A）：让 happy-dom 不再打包 node:sqlite

`tests/helpers/node-sqlite.ts` 顶部：

```diff
-import { DatabaseSync } from "node:sqlite";
 import type { ExecuteResult, SqlDatabase } from "../../src/persistence/database.js";
+
+// node:sqlite is a Node built-in: load it without a static specifier so the
+// happy-dom (client) transform graph never tries to bundle it.
+const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
```

为什么是这个写法：

- `process.getBuiltinModule()` 是 Node 22+ 的运行时取内置模块接口，**不产生静态说明符**，Vite 不会去 resolve，happy-dom 套件就不会再在转换阶段炸掉；
- 比 `createRequire` 更干净，也不需要动 `vitest.config.ts`（试过 `test.server.deps.external` / 根级 `ssr.external`，对 client 环境都无效）；
- 已实测 `tsc --noEmit` exit 0、`biome check` clean。

不要改 `vitest.config.ts`，也不要给单个测试加 `@vitest-environment node`（UI 测试需要 DOM）。

---

## 2. T2（B）：用 `VACUUM INTO` 取代 `serialize()`

新建 `tests/helpers/sqlite-snapshot.ts`：

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodeSqliteDatabase } from "./node-sqlite.js";

/** Byte image of a (possibly in-memory) database, for "nothing was written" assertions. */
export function snapshotDatabase(db: NodeSqliteDatabase): Buffer {
  const directory = mkdtempSync(join(tmpdir(), "sqlite-snapshot-"));
  const file = join(directory, "snapshot.sqlite3");
  try {
    db.connection.exec(`VACUUM INTO '${file}'`);
    return readFileSync(file);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
```

审核员已验证：`VACUUM INTO` 在同一内容上两次导出**字节完全一致**（8192 bytes，`Buffer.compare === 0`），写入一张表后立刻不同——用它做「迁移没有写入」的断言是可靠的；`VACUUM INTO` 也不会修改源库（内存库同样适用）。

替换点只有两处：

`tests/future-schema-guard.test.ts`

```diff
-    const before = db.connection.serialize();
+    const before = snapshotDatabase(db);
...
-    expect(Buffer.compare(db.connection.serialize(), before)).toBe(0);
+    expect(Buffer.compare(snapshotDatabase(db), before)).toBe(0);
```

`tests/r8-production-schema-authority.test.ts`

```diff
-    const before = Buffer.from(db.connection.serialize());
+    const before = snapshotDatabase(db);
...
-    expect(Buffer.compare(db.connection.serialize(), before)).toBe(0);
+    expect(Buffer.compare(snapshotDatabase(db), before)).toBe(0);
```

两个文件补上 `import { snapshotDatabase } from "./helpers/sqlite-snapshot.js";`（r8 的相对路径同样是 `./helpers/…`）。

**不要**升级 Node、不要改 `package.json`、不要加依赖、不要动 `src/`。

---

## 3. 验收（必须贴原始输出）

```bash
npx tsc --noEmit
npx biome check tests/helpers/node-sqlite.ts tests/helpers/sqlite-snapshot.ts \
  tests/future-schema-guard.test.ts tests/r8-production-schema-authority.test.ts
npx vitest run
```

期望：

| 指标 | 现在 | 修完应达 |
|---|---|---|
| 失败套件 | 9 | **0** |
| 通过套件 | 40 | 48（另 1 个 skip） |
| passed | 409 | **460** |
| failed | 2 | **0** |
| skipped | 0 | 80 |

`exit 0` 是硬指标。若 T1 后仍有套件加载失败，把完整错误贴出来，不要自行扩围改配置。

---

## 4. 白名单与红线

允许：`tests/helpers/node-sqlite.ts`、新增 `tests/helpers/sqlite-snapshot.ts`、上面两个测试文件。
禁止：`vitest.config.ts`、`vite.config.ts`、`package.json`、任何 `src/**`、任何 `docs/`、`git add|commit`。

红线：为了让测试变绿而 `describe.skip` / 删断言 / 放宽比较（例如把 `Buffer.compare` 改成只比较表名）——直接退回。
