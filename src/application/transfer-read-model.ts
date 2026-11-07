import { ApplicationDataError, type SqlDatabase } from "../persistence/database.js";
import type { TransferLegSide, TransferLegState } from "../persistence/repositories.js";

/**
 * Read model for transfers (design §6.4, C9): the single place that decides whether a transfer
 * row is complete. B-records consumes this result and never assembles leg queries itself.
 *
 * Read-only by contract: only `db.select`, no transaction, no lock write, no repair. A probe
 * failure is raised as TRANSFER_INTEGRITY_PROBE_FAILED — never silently degraded to "complete".
 */

export interface TransferIntegrityIssue {
  code: "MISSING_LEG";
  reason: string;
}

export interface TransferListItem {
  id: string;
  type: "TRANSFER";
  occurredOn: string;
  recordedAt: string;
  amount: number;
  deleted: boolean;
  incomplete?: TransferIntegrityIssue;
  editable: boolean;
  deletable: boolean;
  restorable: boolean;
  affectsNet: boolean;
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

interface TransferRow {
  id: string;
  occurredOn: string;
  createdAt: string;
  amount: string;
  deletedAt: string | null;
}

interface LegRow {
  transferId: string;
  profileId: string;
  side: TransferLegSide;
  state: TransferLegState;
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string")
    throw new ApplicationDataError(
      "TRANSFER_INTEGRITY_PROBE_FAILED",
      `Transfer probe column ${key} is invalid.`,
    );
  return value;
}

function nullableText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string")
    throw new ApplicationDataError(
      "TRANSFER_INTEGRITY_PROBE_FAILED",
      `Transfer probe column ${key} is invalid.`,
    );
  return value;
}

function probeFailure(error: unknown): ApplicationDataError {
  return error instanceof ApplicationDataError && error.code === "TRANSFER_INTEGRITY_PROBE_FAILED"
    ? error
    : new ApplicationDataError(
        "TRANSFER_INTEGRITY_PROBE_FAILED",
        "The transfer integrity probe failed; the page cannot be shown.",
        { cause: error },
      );
}

/**
 * Fixed decision order (§6.4), first match wins. Sides are compared after sorting, so a single
 * OUT leg reads `sides=[OUT]` and a transfer with no current leg reads `sides=[]`.
 */
function integrityOf(
  profileId: string,
  row: TransferRow,
  legs: LegRow[],
): TransferIntegrityIssue | undefined {
  const sides = legs.map((leg) => leg.side).sort();
  const expected: TransferLegSide[] = ["IN", "OUT"];
  if (sides.length !== 2 || sides[0] !== expected[0] || sides[1] !== expected[1])
    return { code: "MISSING_LEG", reason: `sides=[${sides.join(",")}]` };
  if (legs.some((leg) => leg.profileId !== profileId))
    return { code: "MISSING_LEG", reason: "profile-mismatch" };
  if (row.deletedAt === null && legs.some((leg) => leg.state === "REVERSED"))
    return { code: "MISSING_LEG", reason: "state-reversed-but-alive" };
  if (row.deletedAt !== null && legs.some((leg) => leg.state === "APPLIED"))
    return { code: "MISSING_LEG", reason: "state-applied-but-deleted" };
  return undefined;
}

/**
 * One page of transfers with their integrity verdict. Rows come from S10, the current legs of
 * the whole page from a single S11 batch (no N+1, no aggregation in SQL).
 */
export async function listTransfersWithIntegrity(
  db: SqlDatabase,
  profileId: string,
  month: string,
  includeDeleted: boolean,
): Promise<TransferListItem[]> {
  if (!MONTH_PATTERN.test(month))
    throw new ApplicationDataError("INVALID_DATE", "month must use YYYY-MM format.");
  try {
    const rows = await db.select(
      `SELECT id,occurred_on,created_at,amount,deleted_at FROM transfer_records
         WHERE profile_id=? AND substr(occurred_on,1,7)=?${includeDeleted ? "" : " AND deleted_at IS NULL"}`,
      [profileId, month],
    );
    const transfers: TransferRow[] = rows.map((row) => ({
      id: text(row, "id"),
      occurredOn: text(row, "occurred_on"),
      createdAt: text(row, "created_at"),
      amount: text(row, "amount"),
      deletedAt: nullableText(row, "deleted_at"),
    }));
    const legsByTransfer = new Map<string, LegRow[]>();
    if (transfers.length > 0) {
      const placeholders = transfers.map(() => "?").join(",");
      const legRows = await db.select(
        `SELECT transfer_id,profile_id,side,state FROM transfer_legs
           WHERE profile_id=? AND transfer_id IN (${placeholders}) AND ended_on IS NULL
           ORDER BY transfer_id,side`,
        [profileId, ...transfers.map((transfer) => transfer.id)],
      );
      for (const row of legRows) {
        const transferId = text(row, "transfer_id");
        const legs = legsByTransfer.get(transferId) ?? [];
        legs.push({
          transferId,
          profileId: text(row, "profile_id"),
          side: text(row, "side") as TransferLegSide,
          state: text(row, "state") as TransferLegState,
        });
        legsByTransfer.set(transferId, legs);
      }
    }
    return transfers.map((transfer) => {
      const deleted = transfer.deletedAt !== null;
      const incomplete = integrityOf(profileId, transfer, legsByTransfer.get(transfer.id) ?? []);
      return {
        id: transfer.id,
        type: "TRANSFER",
        occurredOn: transfer.occurredOn,
        recordedAt: transfer.createdAt,
        amount: Number(transfer.amount),
        deleted,
        ...(incomplete === undefined ? {} : { incomplete }),
        editable: !deleted && incomplete === undefined,
        deletable: !deleted && incomplete === undefined,
        restorable: deleted && incomplete === undefined,
        affectsNet: !deleted && incomplete === undefined,
      };
    });
  } catch (error) {
    throw probeFailure(error);
  }
}

/** S12: legs whose transfer row is gone. Read-only, used by the manual review entry only. */
export async function listOrphanLegs(
  db: SqlDatabase,
  profileId: string,
): Promise<Array<{ transferId: string; side: TransferLegSide; accountId: string }>> {
  try {
    const rows = await db.select(
      `SELECT transfer_id,side,account_id FROM transfer_legs
         WHERE profile_id=? AND transfer_id NOT IN (SELECT id FROM transfer_records WHERE profile_id=?)
         AND ended_on IS NULL ORDER BY transfer_id,side`,
      [profileId, profileId],
    );
    return rows.map((row) => ({
      transferId: text(row, "transfer_id"),
      side: text(row, "side") as TransferLegSide,
      accountId: text(row, "account_id"),
    }));
  } catch (error) {
    throw probeFailure(error);
  }
}
