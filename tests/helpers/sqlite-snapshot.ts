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
