/**
 * Transaction phase contract (C6) — the single evidence source for
 * "did this transfer commit, fail, or is the outcome unknown?".
 *
 * The phase is written by the throw site only (driver layer for
 * callback/commit, service layer for post_commit). Callers must never
 * re-label a phase, and must never parse error messages to guess one.
 */
export type TransactionPhase = "callback" | "commit" | "post_commit";

/**
 * Connection state after a failed transaction control command (C10).
 *
 * `faulted` is latched in Rust only; the TypeScript side copies the value
 * reported in the IPC payload and never sets it on its own.
 */
export type ConnectionState = "unmodified" | "clean" | "recovered" | "faulted";

export interface TransactionErrorOptions {
  rollbackCause?: unknown;
  connectionState?: ConnectionState;
}

export class TransactionError extends Error {
  readonly phase: TransactionPhase;
  readonly cause: unknown;
  readonly rollbackFailed: boolean;
  readonly rollbackCause?: unknown;
  readonly connectionState: ConnectionState;

  constructor(
    phase: TransactionPhase,
    cause: unknown,
    rollbackFailed: boolean,
    message: string,
    options: TransactionErrorOptions = {},
  ) {
    super(message);
    this.name = "TransactionError";
    this.phase = phase;
    this.cause = cause;
    this.rollbackFailed = rollbackFailed;
    if (options.rollbackCause !== undefined) this.rollbackCause = options.rollbackCause;
    this.connectionState = options.connectionState ?? "unmodified";
  }
}

const PHASES: readonly TransactionPhase[] = ["callback", "commit", "post_commit"];
const CONNECTION_STATES: readonly ConnectionState[] = [
  "unmodified",
  "clean",
  "recovered",
  "faulted",
];

export function isTransactionPhase(value: unknown): value is TransactionPhase {
  return typeof value === "string" && (PHASES as readonly string[]).includes(value);
}

export function isConnectionState(value: unknown): value is ConnectionState {
  return typeof value === "string" && (CONNECTION_STATES as readonly string[]).includes(value);
}

/** Phase of a failure, or `null` when the error never entered a transaction. */
export function phaseOf(error: unknown): TransactionPhase | null {
  return error instanceof TransactionError ? error.phase : null;
}

/**
 * The only classifier. A failure is DETERMINISTIC only when we know the
 * business writes were rolled back; everything else is UNKNOWN and must be
 * locked, surfaced for review, and never auto-retried.
 */
export function outcomeOf(error: unknown): "DETERMINISTIC" | "UNKNOWN" {
  const phase = phaseOf(error);
  if (phase === null) return "DETERMINISTIC";
  if (phase === "callback" && !(error as TransactionError).rollbackFailed) return "DETERMINISTIC";
  return "UNKNOWN";
}
