# WP-RELEASE-REBIND-02 卷设备号重确认任务书（交执行者）

发布日期：2026-10-27 ｜ 授权：`owner-approval-ledger-payment-20261027-2` ｜ 性质：P0 恢复生产可用性 ｜ 零代码变更、零重建、零数据改动

---

## 0. 一句话

REBIND-01 已把候选可执行指纹绑到今天的包，启动前进了一步，但撞上**既存的第二个绑定**：数据卷的设备号在 10-24 之后变过（内容与 inode 都没变），门闸拿 `backupDevice` / `databaseDevice` 与终态比对失败。本批只把终态这两个设备号更新为当前实测值。

## 1. 现状（审核侧实测；执行方需复测）

| 事实 | 值 |
| --- | --- |
| 启动错误 | `PRODUCTION_TERMINAL_BACKUP_BINDING_MISMATCH`（exit 101） |
| 备份文件 | 路径、inode `31243956`、sha256 `ebdd7c2d…` 与终态**一致** |
| 生产库 | 路径、inode `30715175` 与终态**一致**；1,294,336 字节，mtime 10-24 12:03 |
| 设备号 | 终态记录 `16777232`，当前实测 `16777233`（备份与库同卷，两者都变） |
| 候选指纹 | 三件套均已为 `35c69ba50644920607b5b0b66393c7dcba718aca105c8906cdb83009a7217f92` |
| 三件套交叉哈希 | 自洽：terminal `f2c0fde8…` ↔ receipt `ebf02545…` ↔ ledger `04439bf4…` |

**这是既存漂移，不是本次重建造成的**：库最后一次写入是 10-24 12:03，说明当时设备号还是 `16777232`；卷重挂/重建发生在此后。旧包在同样条件下也无法启动。

判断依据：设备号是卷的身份，不是文件的身份；备份与库的**路径、inode、sha256 三者未变**，迁移事实仍可由它们与审计副本作证。全量校验在身份检查之后照常执行（schema 回读、完整性、sidecar），越界改动仍会被拒。

## 2. 授权范围与红线

**授权**：仅 `production-v8-cutover-terminal.json` 的 `backupDevice`、`databaseDevice` 两个字段。上一轮 `owner-approval-ledger-payment-20261027-1`。

**禁止**：不改代码/不重建；不动库、`backups/**`、`production_integrity_state`；不改备份与库的路径、inode、sha256 字段；不改 receipt / ledger 任何字段（它们不含设备号）；不创建迁移许可文件；不追加台账第 2 条；带完整性钥匙的副本不进 git / evidence。

## 3. 执行步骤

### 3.1 前置检查（只读）

```bash
cd "/Users/linte/Documents/ChatGPT/小钱家-新/个人财务模型app开发项目 2"
D="$HOME/Library/Application Support/com.personalfinance.console"
stat -f "%N dev=%d ino=%i" "$D/production-v8-backups/personal-finance-console.sqlite3" "$D/personal-finance-console.sqlite3"
shasum -a 256 "$D/production-v8-backups/personal-finance-console.sqlite3"
pgrep -fl personal-finance-console || echo "无进程"
```

期望：两个 `dev` 都是 `16777233`，ino 分别是 `31243956` / `30715175`；sha 以 `ebdd7c2d` 开头；无进程。任何不符 → 停手报告。

### 3.2 生成脚本

```bash
mkdir -p scripts && cat > scripts/ledger-payment-rebind-volume-identity.mjs <<'VOLUME_REBIND_SCRIPT'
// WP-RELEASE-REBIND-02: re-affirm the volume identity fields of the production
// cutover terminal after the data volume's device id changed (inode and sha256
// of both files are unchanged). Only `backupDevice` / `databaseDevice` rotate.
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const AUTHORIZATION_ID = "owner-approval-ledger-payment-20261027-2";
const PREVIOUS_AUTHORIZATION_ID = "owner-approval-ledger-payment-20261027-1";
const TASK_BOOK = "docs/WP-RELEASE-REBIND-02-EXEC-INSTRUCTIONS.md";
const EXPECTED_CANDIDATE =
  "35c69ba50644920607b5b0b66393c7dcba718aca105c8906cdb83009a7217f92";
const TERMINAL = "production-v8-cutover-terminal.json";
const RECEIPT = "production-v8-release-receipt.json";
const LEDGER = "production-v8-consumed-authorizations.json";
const ROTATIONS = "production-v8-hotfix-rotations.json";
const AUTHORIZATION = "production-v8-hotfix-release-authorization.json";
const PERMITS = [
  "production-v8-migration-authorization.json",
  "production-v8-legacy-v4-migration-authorization.json",
];
const BACKUP_RELATIVE = join("production-v8-backups", "personal-finance-console.sqlite3");
const DATABASE = "personal-finance-console.sqlite3";

const mode = process.argv.includes("--apply")
  ? "apply"
  : process.argv.includes("--prepare")
    ? "prepare"
    : "dry-run";
const appData =
  process.env.R13B_APP_DATA ??
  join(homedir(), "Library/Application Support/com.personalfinance.console");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (name) => {
  const bytes = readFileSync(join(appData, name));
  return { bytes, hash: sha256(bytes), value: JSON.parse(bytes.toString("utf8")) };
};
const stable = (value) => `${JSON.stringify(value, null, 2)}\n`;
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

function atomicWrite(name, bytes, permissions) {
  const target = join(appData, name);
  const temp = join(appData, `.${name}.vol-${process.pid}-${randomBytes(6).toString("hex")}`);
  let fd;
  try {
    fd = openSync(temp, "wx", permissions);
    writeSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, target);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
}

function checkMode(name) {
  const info = statSync(join(appData, name));
  assert(info.nlink === 1, `${name}: expected nlink=1`);
  assert(info.uid === process.getuid(), `${name}: expected owner uid`);
  assert((info.mode & 0o077) === 0, `${name}: expected 0600-class permissions`);
  return info.mode & 0o777;
}

const auditDir = join(appData, "production-v8-hotfix-audit", "ledger-payment-20261027-volume");
const backupDir = join(appData, "backups", `pre-volume-rebind-gate-${stamp}`);

// --- preconditions -------------------------------------------------------
for (const permit of PERMITS) {
  assert(!existsSync(join(appData, permit)), `permit must be absent: ${permit}`);
}
const terminalFile = readJson(TERMINAL);
const receiptFile = readJson(RECEIPT);
const ledgerFile = readJson(LEDGER);
const terminal = terminalFile.value;

assert(terminal.candidateExecutableSha256 === EXPECTED_CANDIDATE, "candidate fingerprint is not the rebound one");
assert(receiptFile.value.candidateExecutableSha256 === EXPECTED_CANDIDATE, "receipt candidate mismatch");
assert(ledgerFile.value.length === 1, "ledger must contain exactly one entry");
assert(ledgerFile.value[0].candidateExecutableSha256 === EXPECTED_CANDIDATE, "ledger candidate mismatch");
assert(terminal.releaseReceiptSha256 === receiptFile.hash, "terminal receipt hash stale");
assert(terminal.consumedLedgerSha256 === ledgerFile.hash, "terminal ledger hash stale");

const backupPath = join(appData, BACKUP_RELATIVE);
const databasePath = join(appData, DATABASE);
const backupMeta = statSync(backupPath);
const databaseMeta = statSync(databasePath);

assert(backupMeta.isFile() && backupMeta.nlink === 1, "backup must be a regular file with nlink=1");
assert(databaseMeta.isFile() && databaseMeta.nlink === 1, "database must be a regular file with nlink=1");
assert(backupMeta.ino === terminal.backupInode, "backup inode changed — refuse (content identity lost)");
assert(databaseMeta.ino === terminal.databaseInode, "database inode changed — refuse");
assert(sha256(readFileSync(backupPath)) === terminal.backupSha256, "backup sha256 changed — refuse");
assert(terminal.backupSha256 === terminal.databasePreMigrationSha256, "backup is not the pre-migration snapshot");
assert(
  backupMeta.dev !== terminal.backupDevice && databaseMeta.dev !== terminal.databaseDevice,
  "devices already match; nothing to rotate",
);

const gateNames = [TERMINAL, RECEIPT, LEDGER, ROTATIONS, AUTHORIZATION];
const before = {
  terminal: terminalFile.hash,
  receipt: receiptFile.hash,
  ledger: ledgerFile.hash,
  rotations: readJson(ROTATIONS).hash,
  authorization: readJson(AUTHORIZATION).hash,
};

if (mode === "prepare") {
  assert(!existsSync(auditDir), `${auditDir} already exists; refusing to overwrite audit evidence`);
  assert(!existsSync(backupDir), `${backupDir} already exists; refusing to overwrite audit evidence`);
  for (const dir of [auditDir, backupDir]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const name of gateNames) copyFileSync(join(appData, name), join(dir, name));
  }
  const authorization = {
    formatVersion: 1,
    domain: "PRODUCTION",
    authorizationId: AUTHORIZATION_ID,
    nonce: randomBytes(32).toString("base64url"),
    issuedAtUtc: new Date().toISOString(),
    ownerApproval: "2026-10-27 户主授权（WP-RELEASE-REBIND-02 §2：卷设备号重确认）",
    taskBook: TASK_BOOK,
    scope:
      "仅限终态 backupDevice / databaseDevice 两个字段；备份与库的路径、inode、sha256、迁移历史字段一律原样；不含代码变更、数据变更、迁移操作",
    upgradeFromAuthorizationId: PREVIOUS_AUTHORIZATION_ID,
    previousBackupDevice: terminal.backupDevice,
    previousDatabaseDevice: terminal.databaseDevice,
    newBackupDevice: backupMeta.dev,
    newDatabaseDevice: databaseMeta.dev,
    unchangedBackupInode: terminal.backupInode,
    unchangedDatabaseInode: terminal.databaseInode,
  };
  atomicWrite(AUTHORIZATION, Buffer.from(stable(authorization), "utf8"), 0o600);
  const hash = sha256(readFileSync(join(appData, AUTHORIZATION)));
  console.log(JSON.stringify({ prepared: true, auditDir, backupDir, before, authorizationSha256: hash }, null, 2));
  process.exit(0);
}

// --- build rotated terminal ----------------------------------------------
const authorization = readJson(AUTHORIZATION);
assert(authorization.value.authorizationId === AUTHORIZATION_ID, "authorization id mismatch");
assert(authorization.value.newBackupDevice === backupMeta.dev, "authorization backup device mismatch");
assert(authorization.value.newDatabaseDevice === databaseMeta.dev, "authorization database device mismatch");

assert(existsSync(auditDir), `${auditDir} is missing; run --prepare first`);
const backupDirs = readdirSync(join(appData, "backups")).filter((name) =>
  name.startsWith("pre-volume-rebind-gate-"),
);
assert(backupDirs.length >= 1, "expected a pre-volume-rebind audit copy");
const backupCopyDir = join(appData, "backups", backupDirs.sort().at(-1));
const beforeByFile = { [TERMINAL]: before.terminal, [RECEIPT]: before.receipt, [LEDGER]: before.ledger };
for (const dir of [auditDir, backupCopyDir]) {
  for (const name of [TERMINAL, RECEIPT, LEDGER]) {
    assert(
      sha256(readFileSync(join(dir, name))) === beforeByFile[name],
      `audit copy mismatch: ${dir}/${name}`,
    );
  }
}

const rotatedAtUtc = new Date().toISOString();
const next = structuredClone(terminal);
next.backupDevice = backupMeta.dev;
next.databaseDevice = databaseMeta.dev;
const terminalBytes = Buffer.from(stable(next), "utf8");
const terminalHash = sha256(terminalBytes);

const changed = Object.keys(next).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(terminal[key]));
const allowed = new Set(["backupDevice", "databaseDevice"]);
assert(changed.every((key) => allowed.has(key)), `out-of-scope change: ${changed.join(", ")}`);

const report = {
  mode,
  rotatedAtUtc,
  authorizationSha256: authorization.hash,
  candidateExecutableSha256: EXPECTED_CANDIDATE,
  before: { terminal: before.terminal, receipt: before.receipt, ledger: before.ledger },
  after: { terminal: terminalHash, receipt: before.receipt, ledger: before.ledger },
  devices: {
    backup: { from: terminal.backupDevice, to: backupMeta.dev, inode: backupMeta.ino },
    database: { from: terminal.databaseDevice, to: databaseMeta.dev, inode: databaseMeta.ino },
  },
  changedFields: changed,
};
console.log(JSON.stringify(report, null, 2));

if (mode !== "apply") process.exit(0);

// --- write ---------------------------------------------------------------
const terminalMode = checkMode(TERMINAL);
atomicWrite(TERMINAL, terminalBytes, terminalMode);
const readback = readJson(TERMINAL);
assert(readback.hash === terminalHash, "terminal readback hash mismatch");
assert(readback.value.backupDevice === backupMeta.dev, "terminal backup device readback");
assert(readback.value.databaseDevice === databaseMeta.dev, "terminal database device readback");
assert(readback.value.backupInode === terminal.backupInode, "terminal backup inode readback");
assert(readback.value.releaseReceiptSha256 === before.receipt, "terminal receipt hash must not move");
assert(readback.value.consumedLedgerSha256 === before.ledger, "terminal ledger hash must not move");
checkMode(TERMINAL);

const rotationsFile = readJson(ROTATIONS);
const rotations = structuredClone(rotationsFile.value);
const record = {
  formatVersion: 1,
  domain: "PRODUCTION",
  kind: "AUTHORIZED_VOLUME_IDENTITY_REAFFIRMATION",
  semanticStatement:
    "备份与生产库的路径、inode、sha256 均未变，仅所在卷的设备号在迁移后被系统重挂/重建而改变；本次在户主授权下把终态的设备号更新为当前值，迁移事实由 inode、sha256 与审计副本继续作证。",
  authorizationId: AUTHORIZATION_ID,
  ownerApproval: "2026-10-27 WP-RELEASE-REBIND-02 任务书 §2",
  taskBook: TASK_BOOK,
  prerequisiteRelease: PREVIOUS_AUTHORIZATION_ID,
  authorizationFile: join(appData, AUTHORIZATION),
  authorizationSha256: authorization.hash,
  rotatedAtUtc,
  previousBackupDevice: terminal.backupDevice,
  newBackupDevice: backupMeta.dev,
  previousDatabaseDevice: terminal.databaseDevice,
  newDatabaseDevice: databaseMeta.dev,
  backupInode: backupMeta.ino,
  databaseInode: databaseMeta.ino,
  auditCopies: [auditDir, backupCopyDir].map((dir) => ({
    path: dir,
    files: gateNames.map((name) => ({ name, sha256: sha256(readFileSync(join(dir, name))) })),
  })),
  before: { terminal: before.terminal },
  after: { [TERMINAL]: terminalHash },
  gateReadsThisFile: false,
};
rotations.volumeRotations = [...(rotations.volumeRotations ?? []), record];
atomicWrite(ROTATIONS, Buffer.from(stable(rotations), "utf8"), checkMode(ROTATIONS));
const rotationHash = sha256(readFileSync(join(appData, ROTATIONS)));
console.log(JSON.stringify({ rotationsSha256: rotationHash, record }, null, 2));
console.log("VOLUME_IDENTITY_REBIND_APPLIED");
VOLUME_REBIND_SCRIPT
node --check scripts/ledger-payment-rebind-volume-identity.mjs && echo 语法OK
```

### 3.3 三连：prepare → dry-run → apply

```bash
node scripts/ledger-payment-rebind-volume-identity.mjs --prepare
node scripts/ledger-payment-rebind-volume-identity.mjs --dry-run
node scripts/ledger-payment-rebind-volume-identity.mjs --apply
```

`--prepare` 期望：`prepared: true`，生成 `production-v8-hotfix-audit/ledger-payment-20261027-volume/` 与 `backups/pre-volume-rebind-gate-<时间戳>/`，各 5 份 0600。
`--dry-run` 期望：`changedFields` 恰好 `["databaseDevice","backupDevice"]`，`devices` 两行均为 `16777232 → 16777233`，`after.receipt` / `after.ledger` 与 `before` 相同。**多一个字段即停手**。
`--apply` 期望：最后一行 `VOLUME_IDENTITY_REBIND_APPLIED`；脚本内已断言回读（设备号已更新、inode 与两个交叉哈希未动）。

### 3.4 启动验收

```bash
open "/Applications/Personal Finance Console.app"
sleep 6
pgrep -fl personal-finance-console
```

期望：进程在、窗口进首页、无 panic。若出现在前两类之外的错误码，**留原文、停手**。

## 4. 回滚

`--prepare` 生成的两份副本拷回即可还原终态（服务端只读校验，原子写）。脚本与授权文件、审计副本不进 git。

## 5. 回执要求

报告：§3.1 实测四行、prepare 的 `before` 五哈希、dry-run 的 `changedFields`、apply 回读三个哈希、启动结果。不贴整份 JSON。
