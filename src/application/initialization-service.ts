import type { SqlDatabase } from "../persistence/database.js";
import { Repositories } from "../persistence/repositories.js";

export type ApplicationInitializationState =
  | { status: "INITIALIZATION_REQUIRED" }
  | { status: "READY" };

export async function getApplicationInitializationState(
  db: SqlDatabase,
): Promise<ApplicationInitializationState> {
  const repositories = new Repositories(db);
  const [profile, settings] = await Promise.all([
    repositories.getProfile(),
    repositories.getSettings(),
  ]);
  return profile && settings ? { status: "READY" } : { status: "INITIALIZATION_REQUIRED" };
}
