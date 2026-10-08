export interface ExecuteResult {
  rowsAffected: number;
  lastInsertId?: number;
}

export interface SqlDatabase {
  execute(sql: string, bindValues?: unknown[]): Promise<ExecuteResult>;
  select<T extends Record<string, unknown>>(sql: string, bindValues?: unknown[]): Promise<T[]>;
  transaction<T>(work: (transactionDb: SqlDatabase) => Promise<T>): Promise<T>;
}

export class ApplicationDataError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApplicationDataError";
    this.code = code;
  }
}

export function requireRow<T>(rows: T[], code: string, message: string): T {
  const row = rows[0];
  if (!row) throw new ApplicationDataError(code, message);
  return row;
}
