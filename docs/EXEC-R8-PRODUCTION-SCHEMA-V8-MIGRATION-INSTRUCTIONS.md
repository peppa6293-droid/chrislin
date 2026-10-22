# R8 执行任务书：Production Schema V8 权威升级

发布者：审核员  
执行者：按本任务书实施、测试并回执；审核员完成独立代码审核和证据复验后，才可讨论真实 Production 迁移。  
批准范围：户主已批准 R8。  
批准路线：Production 权威整体升至 V8；本任务只允许代码、测试和隔离候选包，不触碰真实 Production SQLite。  
日期：2026-10-22

## 0. 任务结论与不可越过的边界

本任务解决的是 TypeScript Schema V8 与 Rust Production Schema V4 权威分裂。当前 Production 数据仍按历史记录视为 V3；代码批验收通过不等于 Production 已迁移，也不等于正式 App 已恢复。

本任务完成后必须同时成立：

- Rust native migration、Production startup gate、runtime manifest、release gate、durable terminal 和 post-readback 的当前契约全部为 V8。
- TypeScript `migrateDatabase` 不再承担 Production 迁移权；它只服务于 Smoke、Acceptance 或其他明确隔离的非 Production fixture。
- V3→V8 的实际迁移逻辑只存在于受授权的 Rust native path，并在失败时 fail closed。
- 隔离 fixture 和候选包可证明 V3→V8 的代码链路，但不能被报告为真实 Production 已迁移或已恢复。
- 真实 Production V3→V8 迁移、正式 Production 启动、`/Applications` 替换、真实 permit/terminal/ledger 生成，全部留待代码批验收后另行审批。

### 0.1 红线

违反任一条直接 RETURN，不得自行补救后继续：

1. 禁止打开、写入、迁移、备份、替换或删除真实 Production SQLite。
2. 禁止启动 Production identity：`com.personalfinance.console` 对应正式路径 `/Applications/Personal Finance Console.app`。构建 Production 包可以，启动不可以。
3. 禁止修改真实 Production app-data 下的 permit、release receipt、consumed ledger、terminal 或任何旁车文件。
4. 禁止伪造 V8 terminal、降低 startup gate、删除 authorizer、绕过 hash/inode/path 绑定，或接受 V4 terminal 作为 V8 authority。
5. 禁止把 Smoke、Acceptance、fixture 或隔离候选包结果写成 Production 已迁移、已启动或已恢复。
6. 禁止改变 V2→V1 CASH_DEBIT 双写规则、财务模型、金额公式、UI 业务范围或已有数据语义。
7. 禁止新增依赖、网络请求、sudo、权限放宽或修改 macOS 安全策略。
8. 禁止删除或重写历史 V4 证据、`docs/CURRENT_PHASE.md` 的历史结论、现有 V4 gate 测试和与本任务无关的未跟踪文件。
9. 禁止 `git add -A`、自动 commit、push、merge 或替换正式包。任何提交动作需另行明确授权。
10. 不得用机械全局替换把所有 `4` 改成 `8`。每个 V4 名称、状态、路径和字段都必须判断是历史兼容记录还是当前 V8 contract。

### 0.2 允许范围

只允许改动与 R8 直接相关的源码、迁移 SQL、V8 gate、V8 测试、manifest、隔离构建脚本和本任务证据。预计范围如下，执行者必须在契约盘点中确认实际清单：

- `src/persistence/migrations.ts`
- `src/runtime/tauri-bootstrap.ts`
- `src/persistence/tauri-database.ts`、`src/persistence/database.ts`（仅在建立 Production/non-Production 边界确有必要时）
- `src-tauri/src/lib.rs`
- `src-tauri/src/cutover_startup.rs`
- `src-tauri/src/production_cutover_state.rs`
- `src-tauri/runtime-compatibility.json`
- `migrations/005.sql`、`migrations/006.sql`、`migrations/007.sql`、`migrations/008.sql`
- 新增 `scripts/production_v8_release_gate.py` 及对应测试；现有 V4 gate 仅在有明确依赖时做最小兼容修正
- 直接覆盖上述行为的 TS、Rust、Python 集成测试
- `evidence/r8-production-v8-20261022/` 下的执行证据

任何超出上述范围的修改先 RETURN 说明原因和影响，不得自行扩大任务。

## 1. 当前基线与权威规则

### 1.1 当前事实

- TypeScript `CURRENT_SCHEMA_VERSION = 8`，迁移入口为：

```ts
export async function migrateDatabase(
  db: SqlDatabase,
  now = new Date().toISOString(),
  targetVersion = CURRENT_SCHEMA_VERSION,
): Promise<void>
```

- `src/runtime/tauri-bootstrap.ts` 的 `bootstrapTauriApplication()` 和 `createTauriApplicationServices()` 当前直接调用 `migrateDatabase(db)`。这正是 Production TS 迁移越过 Rust authority 的入口，R8 必须拆除该路径。
- Rust 当前 `CURRENT_SCHEMA_VERSION = 4`，native path 只实现 V3→V4。
- Rust 当前使用 `production-v4-*` permit、receipt、ledger 和 terminal 名称，当前启动状态包含 `V4_VERIFIED`。
- `src-tauri/runtime-compatibility.json` 当前声明 runtime generation 4、max schema 4。
- `scripts/production_v4_release_gate.py` 和 `scripts/test_production_v4_release_gate.py` 当前验证 V4 contract。
- 既有 V4 文件和证据是历史记录，不是 R8 的当前 Production authority。

### 1.2 两个 schema authority 必须始终一致

继续以两个 SQLite authority 做双重检查：

- `PRAGMA user_version`
- `schema_migrations` 的最大 `version`

以下任一情况都必须拒绝：

- 任一 authority 高于当前 runtime V8。
- 两个 authority 不一致。
- `schema_migrations` 缺失、损坏、出现重复或非预期版本。
- V8 terminal/readback 声明的版本、migration rows、完整性结果与数据库实际读回不一致。

成功的当前 Production 终态必须是：

```text
user_version = 8
max(schema_migrations.version) = 8
schema_migrations.version rows = [1, 2, 3, 4, 5, 6, 7, 8]
integrity_check = ok
foreign_key_check = empty
SQLite sidecars = absent
```

## 2. 实施顺序

不得跳过顺序或先生成候选包再补契约。

### R8-01：提交契约盘点，先停在审核点

先不写生产运行代码。提交一份短表格或写入回执，逐项列出：

- TS migration authority 的入口、调用者和 runtime 身份判断。
- Rust `CURRENT_SCHEMA_VERSION`、native migration dispatch、schema readback 和 authorizer。
- `production-v4-*` 常量、文件名、状态值和错误码的所有引用。
- `cutover_startup.rs` 发现并阻断的历史/当前状态文件。
- manifest、permit、receipt、ledger、terminal、candidate executable、backup、database 的绑定字段。
- V4 Python gate 与测试是否保留为历史 gate，V8 gate 的新文件和调用关系。
- 所有受影响测试、fixture、构建配置和证据路径。

盘点必须说明每个 V4 名称属于以下哪一类：

1. 保留为历史记录，但不能授权 V8 启动；
2. 改成 V8 当前 contract；
3. 新增 V8 contract，旧文件继续作为 unresolved state 被阻断。

未得到盘点复核前，不得进入真实 Production 相关代码路径的实现。

### R8-02：建立 Rust native V5-V8 迁移链

1. 新增 `migrations/005.sql`、`006.sql`、`007.sql`、`008.sql`，SQL 语义必须与 `src/persistence/migrations.ts` 的 V5-V8 完全一致，包括：
   - 表、列、默认值、CHECK、外键、索引和唯一约束；
   - V7 `dedupe_key` 及其 partial unique index；
   - V8 `income_entries`、`cash_accounts.reserved_amount`、`fixed_expense_plans`；
   - 不新增 TS 没有的业务字段或默认数据。
2. Rust native migrator 从一致的 V3 `[1,2,3]` 开始，按 `004.sql`、`005.sql`、`006.sql`、`007.sql`、`008.sql` 顺序在同一个受控迁移事务中执行。
3. 每个版本只写入一次 `schema_migrations`，并在每一步确认版本 authority；最终必须为 V8/V8 和 `[1..8]`。
4. 保留当前的数据库身份绑定：迁移前后检查 regular file、非 symlink、single link、device/inode、pre-migration SHA-256、无 `-wal`/`-shm`/`-journal`。
5. 保留 `foreign_keys=ON`、`DELETE` journal、`EXCLUSIVE` locking、`synchronous=FULL`、`fullfsync=ON`、关闭 checkpoint-on-close 等现有安全约束；只有有测试证明且经审核批准才可调整。
6. 任一 SQL、版本写入、commit、readback 或 sidecar 检查失败，必须 rollback 或进入不可普通启动状态，不能留下可被 TS 接管的半迁移数据库。
7. native migrator 的命名、状态和返回值统一改为 V8，例如 `native_migration8`、`read_production_v8_readback`、`V8_MIGRATION_VERIFIED_NATIVE`；不得保留会被当前调用者误读为 V4 成功的返回状态。

### R8-03：修复 TypeScript Production 边界

1. `migrateDatabase` 继续用于 Smoke、Acceptance 和隔离 fixture，但 Production composition root 不得直接调用它。
2. `bootstrapTauriApplication()` 与 `createTauriApplicationServices()` 必须通过明确的 runtime role/identity 边界区分 Production 与非 Production：
   - Production 由 Rust startup gate 先验证 V8 terminal 和数据库；
   - Production 不执行 TS DDL、不执行 TS `migrateDatabase`、不以“TS 迁移失败后再尝试启动”作为回退；
   - 非 Production 可以继续使用 TS migration，且现有 Smoke/Acceptance 隔离路径必须保持可用。
3. 不允许通过路径字符串猜测 Production 身份作为唯一防线。必须复用或扩展现有 Tauri runtime identity，并由 Rust 对 Production 数据库路径做最终拒绝。
4. `beginSchemaMigration()` / `endSchemaMigration()` 只能在明确的非 Production migration 或受控 V8 native boundary 中使用。Production ordinary startup 不得把这两个 IPC 当作自动迁移入口。
5. 补一个回归测试，证明 Production composition root 不会调用 `migrateDatabase`；同时证明 Smoke/isolated fixture 仍能完成 TS V1→V8 migration。
6. 若修复 `targetVersion` 边界，必须让 V1-V3 与 V4-V8 一样严格尊重 `targetVersion`，并添加低目标版本测试；不得借此改变默认 V8 行为。

### R8-04：统一 V8 runtime manifest

当前 manifest 必须改成一个可读、可验证的 V8 contract。建议采用 manifest format 2，显式区分 ordinary runtime 支持版本和受授权 migration source：

```json
{
  "manifestFormatVersion": 2,
  "runtimeGeneration": 8,
  "minSupportedSchemaVersion": 8,
  "maxSupportedSchemaVersion": 8,
  "migrationSourceSchemaVersion": 3,
  "bundleId": "com.personalfinance.console",
  "executable": "Contents/MacOS/personal-finance-console"
}
```

执行者如认为必须保留 format 1，必须在 R8-01 回执中说明字段语义和兼容风险，并先取得审核确认；不得静默采用另一种解释。

无论采用哪种 format，必须满足：

- Rust validator、V8 Python gate、候选包 Resources manifest、测试 fixture 的字段和值完全一致。
- `runtimeGeneration` 的含义是当前 Production runtime generation 8，不是“迁移脚本最高版本”或旧 V4 兼容标记。
- ordinary runtime 只接受 schema V8；V3 只作为一次性、显式授权的 migration source。
- `bundleId`、executable 相对路径、manifest SHA-256 和候选 executable SHA-256 继续绑定。
- V4 manifest、V4 terminal 或旧 receipt 不得被解释成 V8 manifest。

### R8-05：升级 V8 permit、release gate、ledger 和 terminal

为避免旧 V4 authority 被误用，当前 Production contract 使用清晰的 V8 名称：

```text
production-v8-migration-authorization.json
production-v8-release-receipt.json
production-v8-consumed-authorizations.json
production-v8-cutover-terminal.json
.production-v8-migration-authorization.json.claimed-*
```

具体要求：

1. Rust、Python gate、测试和证据中的当前名称统一为 V8。旧 V4 文件不得作为当前 permit、receipt、ledger 或 terminal 接受。
2. `src-tauri/src/production_cutover_state.rs` 的 durable write 机制必须保留：owner directory、非 symlink、single-link、owner-only mode、`O_NOFOLLOW`、`O_CLOEXEC`、create-only、临时文件 fsync、目录 fsync、exact-byte readback、失败清理。
3. terminal 当前状态改为 `V8_VERIFIED`，并明确写入：
   - source schema 3/3；
   - target schema 8/8；
   - migration rows `[1,2,3,4,5,6,7,8]`；
   - integrity、foreign-key、sidecar 结果；
   - permit、receipt、ledger、candidate、manifest、backup、database 的路径/hash/device/inode 绑定；
   - pre/post database SHA-256。
4. `cutover_startup.rs` 必须同时识别 V4 历史残留和 V8 当前状态：
   - 旧 V4 terminal、claimed permit、pending state 或 V4 `outcome` 只能导致阻断，不得授权 ordinary startup；
   - V8 terminal 只有完整校验通过才允许 ordinary startup；
   - permit 已消费但 terminal 缺失、ledger 缺失、permit 复活、binding 不一致、任何 pending/claimed 文件存在，全部 fail closed；
   - 没有 terminal 的 V8 数据库不能因为 schema 数字正确而直接启动。
5. 更新所有错误码和状态说明为 V8 语义。历史错误码可保留用于识别旧状态，但不能继续声称“V4 terminal required”是当前 contract。
6. 内部命令只接受固定 V8 native role，例如：

```text
--pfc-internal-v8-migrate
```

它必须继续要求从精确候选 executable、精确 Production app path 和受授权数据库路径运行。隔离 fixture 只能在明确的 synthetic marker 和临时命名空间中启用。

### R8-06：新增独立 V8 release gate

建议新增：

```text
scripts/production_v8_release_gate.py
scripts/test_production_v8_release_gate.py
```

现有 `production_v4_release_gate.py` 和测试作为历史 V4 gate 保留，不得被悄悄改写成“V8 gate”。如构建流程引用旧 gate，改引用必须在回执中列出。

V8 gate 至少必须验证：

- Production bundle id、固定 app path、固定 executable path。
- candidate executable、manifest、bundle Info.plist 和其 SHA-256。
- manifest format、runtime generation、ordinary schema range、migration source schema。
- Production database 的预迁移 schema 必须是 `[1,2,3]` / V3，且两个 authority 一致。
- backup 存在、为 regular file、路径在固定 backup root、非数据库本体、SHA-256 与 pre-migration database 一致。
- database 无 sidecar，process inventory 完整且无旧/并行 Production process。
- owner candidate approval 和 one-time migration authorization 的状态、有效期、nonce、authorization id。
- authorization、receipt、candidate、manifest、database、backup、expected paths 和 hashes 全绑定。
- native result 必须为 `V8_MIGRATION_VERIFIED_NATIVE`，post-readback 必须为 V8、rows `[1..8]`、integrity `ok`、foreign-key empty、sidecars absent。
- consumed ledger 防重复 authorization id 和 nonce，且 permit 在消费后不存在。
- terminal 存在、exact readback 成功、绑定到本次 receipt/ledger/database/candidate，并在重启 readback 后仍可验证。

V8 gate 必须有拒绝测试覆盖：未来 schema、authority 不一致、V4 manifest、错误 bundle、旧 executable、缺 manifest、备份 hash/path/inode 不一致、sidecar、旧 permit、过期 permit、重复 nonce、terminal 缺失/篡改、ledger 缺失/篡改、permit resurrect、路径 alias、process inventory 不完整和 synthetic root 越界。

## 3. 测试与验收门

### 3.1 必须通过的自动测试

执行者必须提供完整命令和原始日志，不得只回报“通过”：

```bash
env NODE_ENV=test npx vitest run --reporter=dot
npm run typecheck
npm run lint
cargo test --manifest-path src-tauri/Cargo.toml
python3 -I scripts/test_production_v8_release_gate.py -v
```

若仓库已有 gate/recovery/terminal 测试，必须保留并运行；新增测试数量只能增加，不能通过删除或跳过测试降低基线。

### 3.2 Native migration contract tests

至少覆盖：

1. 一致 V3 fixture 成功迁移到 V8，最终 rows `[1..8]`。
2. 已是 V8/V8 的数据库不会重复迁移或生成重复 rows。
3. V4、V5、V6、V7 中任一中间 fixture 按任务边界处理明确：要么只允许从 V3 的 native cutover 进入，要么明确拒绝，不能隐式拼接状态。
4. V3/V3 的每个 V5-V8 DDL 与 TS fixture schema 等价。
5. 任一 DDL、schema row、commit 或 readback 注入失败后，数据库不可被 ordinary Production startup 接受。
6. `PRAGMA user_version` 与 `schema_migrations` 不一致时 fail closed。
7. `integrity_check` 非 `ok`、foreign-key check 非空、sidecar 出现、database identity 改变时 fail closed。
8. 成功迁移后关闭并重新打开隔离候选 runtime，V8 terminal 仍能通过 readback，且不会重复写库。

### 3.3 TypeScript/Rust boundary tests

至少覆盖：

- Production composition root 不调用 TS `migrateDatabase`。
- Production V3 无 V8 terminal 时不进入业务读写。
- Production V8 无 terminal、旧 V4 terminal、terminal 与数据库不匹配时不进入业务读写。
- V8 terminal 完整且验证通过后，业务 read/select/transaction 才解除 `schema_ready` gate。
- Smoke/Acceptance 使用独立 identifier、独立 app-data 和独立数据库，仍可运行 TS migration。
- Smoke/Acceptance 不能打开或重定向到 Production data directory。

### 3.4 Durable terminal 和授权失败注入

沿用现有 failure injection 模式，至少覆盖：

- terminal 写入前；
- terminal 文件 fsync 前后；
- terminal 目录 fsync 前后；
- exact durable readback 后；
- authorization claim 后但 native migration 前；
- post-readback 后但 terminal publish 前；
- ledger 写入失败、receipt 读回失败、backup/hash 绑定失败。

每个失败点都必须证明：

- 不会产生可被误认为成功的 V8 terminal；
- 不会把 permit 留在可重复消费的状态；
- startup 会进入明确的 recovery/diagnostic blocked 状态；
- 不会自动回退到 TS migration 或普通业务读写。

## 4. 隔离候选包与证据

### 4.1 候选包限制

1. 可以构建 Production identity 候选包，但不得启动正式 Production identity。
2. 运行验证必须使用 synthetic fixture、`quiescence-fixture`、Smoke 或新的 V8 Acceptance identity，并使用临时 app-data 根。
3. 隔离路径必须有明确 marker，且不能位于真实 Production app-data、真实 `/Applications` 或真实 Production bundle 的可写路径。
4. 不得复制真实 Owner 数据作为 fixture；使用最小合成 V3 schema fixture。
5. 任何截图、日志和 hash 必须标记 `SYNTHETIC_ONLY` 或 `ISOLATED_CANDIDATE`。

### 4.2 必须提交的证据

目录建议：

```text
evidence/r8-production-v8-20261022/
```

至少包含：

- `contract-inventory.md`；
- TS preflight 日志；
- Rust test 日志；
- V8 gate test 日志；
- native V3→V8 fixture migration 日志；
- manifest JSON 和 SHA-256；
- candidate executable/app/DMG SHA-256；
- pre/post fixture database SHA-256；
- schema readback：user_version、migration rows、integrity、foreign-key、sidecars；
- terminal exact readback 和 restart readback；
- failure injection 结果；
- `git status --short`；
- `RECEIPT.md`。

证据必须明确写出：

```text
REAL_PRODUCTION_DATABASE_TOUCHED = false
REAL_PRODUCTION_IDENTITY_LAUNCHED = false
REAL_PRODUCTION_PERMIT_CREATED_OR_CONSUMED = false
REAL_PRODUCTION_TERMINAL_CREATED = false
```

如果这些值无法证明为 false，任务立即 RETURN，不能继续报告通过。

## 5. 完成标准

R8 代码批只有在以下条件全部满足时才可提交审核：

- R8-01 契约盘点完成，且没有未解释的 V4 current reference。
- Native V3→V8 在隔离 fixture 上完成并通过 readback。
- TypeScript Production migration boundary 已拆除并有回归测试。
- Rust V8 startup、authorizer、terminal、ledger、receipt 和 readback contract 一致。
- V8 manifest 与 Rust/Python/test/candidate 全部一致。
- V8 gate 的拒绝矩阵通过；旧 V4 authority 不能放行。
- TypeScript、Rust、Python、typecheck、lint 全部通过，测试数量未减少。
- 隔离候选包已构建，未启动真实 Production identity。
- 证据目录和回执完整，明确没有触碰真实 Production。
- 未修改 V2/V1 双写规则、财务模型、真实数据库、正式包或历史 V4 证据。

以下任一项存在时，状态只能是 `R8_CODE_BATCH_BLOCKED`：

- 任意 V4 gate/terminal 能被当前 runtime 当成 V8 authority；
- TS Production composition root 仍可能自动执行 V1→V8 DDL；
- native migration 只实现到 V4 或没有逐版本 readback；
- V8 schema rows、manifest、receipt、terminal、gate 之间存在数字或字段语义不一致；
- 测试只验证 happy path，没有失败注入和重启验证；
- 任何 Production 实际读写、启动或 permit/terminal 操作发生。

## 6. 真实 Production 迁移的后续审批门

本任务书不授权真实迁移。代码批验收后，必须另发一份独立审批请求，至少附：

- 独立代码审核结论；
- V8 candidate executable 和 manifest hash；
- V8 gate 完整通过证据；
- 隔离 fixture V3→V8 readback；
- 真实 Production V3 的只读 preflight 和 hash；
- 备份路径、hash、inode/device 和恢复方案；
- 明确的 downtime、operator、终止条件和回滚条件；
- Owner 对真实 V3→V8 migration、Production replacement、launch 和 terminal publication 的单独授权。

在该审批明确通过前，任何“生产已升级到 V8”“正式包已恢复”“可启动 Production”的表述均不允许写入回执。

## 7. 执行回执格式

回执按以下顺序返回：

1. `R8-01` 契约盘点：PASS/BLOCKED，未解释引用清单。
2. `R8-02` Native V5-V8 migration：PASS/BLOCKED，实际 SQL、readback 和 failure injection。
3. `R8-03` TS/Rust boundary：PASS/BLOCKED，Production 不调用 TS migration 的证据。
4. `R8-04` Manifest：PASS/BLOCKED，format、generation、min/max、source schema、SHA-256。
5. `R8-05` V8 permit/terminal/startup：PASS/BLOCKED，拒绝矩阵和 restart readback。
6. `R8-06` V8 release gate：PASS/BLOCKED，测试文件和结果。
7. 测试数量旧→新、完整命令和失败项。
8. 隔离候选包路径和 SHA-256；明确未启动 Production identity。
9. 证据目录和文件清单。
10. 改动文件清单，逐项说明为何属于 R8。
11. `git status --short`。
12. 真实 Production 触碰声明，四项必须为 `false`。
13. 剩余风险、RETURN 项和下一步独立审批需求。

回执不得包含“真实生产迁移完成”“Production 已恢复”或等价结论，除非后续独立 Owner 审批和执行证据已经单独完成。
