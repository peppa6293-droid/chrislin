import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

type Json = Record<string, unknown>;
interface Bootstrap {
  session: string;
  token: string;
  scenario: string;
  phase: "initial" | "restart";
  app_identifier: string;
  app_data_dir: string;
  startup: Json;
}
interface Status {
  started: boolean;
  running: boolean;
  disconnected: boolean;
  barrier: { id: number; event: string; details: Json } | null;
  result: Json | null;
  error: { code: string; detail: string } | null;
  window_close_prevented: number;
  app_exit_prevented: number;
  startup: Json;
}

let boot: Bootstrap;
let sequence = 0;
let assertions = 0;
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const nextId = () => `${boot.phase}-${location.pathname}-${++sequence}`;
const credentials = (requestId = nextId()) => ({ session: boot.session, token: boot.token, requestId });

function show(value: unknown): void {
  const status = document.getElementById("status");
  if (status) status.textContent = JSON.stringify(value, null, 2);
}

async function evidence(value: unknown): Promise<void> {
  await invoke("record_frontend_evidence", { ...credentials(), value });
}

async function call<T = Json>(command: string, extra: Json = {}): Promise<T> {
  const request = { ...credentials(), ...extra };
  try {
    const result = await invoke<T>(command, request);
    await evidence({ kind: "invoke_result", command, requestId: request.requestId, resolved: true, result });
    return result;
  } catch (error) {
    await evidence({ kind: "invoke_result", command, requestId: request.requestId, resolved: false, error });
    throw error;
  }
}

async function check(name: string, passed: boolean, details: unknown = null): Promise<void> {
  await evidence({ kind: "assertion", name, passed, details, source: "executing_bundled_typescript" });
  if (!passed) throw new Error(`${name}: ${JSON.stringify(details)}`);
  assertions += 1;
}

async function rejects(command: string, code: string, extra: Json = {}): Promise<void> {
  let observed: unknown;
  try { await call(command, extra); } catch (error) { observed = error; }
  await check(`${command}:${code}`, typeof observed === "object" && observed !== null && "code" in observed && observed.code === code, observed);
}

async function status(): Promise<Status> {
  // Each response crosses the actual WebKit -> Tauri invoke handler. The
  // controller does not send IPC, advance barriers, or fabricate these rows.
  return await call<Status>("native_status");
}

async function until(predicate: (value: Status) => boolean, name: string): Promise<Status> {
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    const value = await status();
    if (predicate(value)) return value;
    if (!value.running && value.error) throw new Error(`${name}: ${JSON.stringify(value.error)}`);
    await wait(65);
  }
  throw new Error(`Timeout: ${name}`);
}

async function finish(extra: Json = {}): Promise<void> {
  const value = { passed: true, assertions, actual_transport: "@tauri-apps/api/core.invoke", scenario: boot.scenario, phase: boot.phase, ...extra };
  show(value);
  await invoke("finish_frontend", { ...credentials(), value });
}

async function restart(): Promise<void> {
  const diagnostic = await call("diagnostic_recovery");
  await check("restart-startup-blocked-without-separate-handoff", diagnostic.startupBlocked === true, diagnostic);
  await rejects("ordinary_business_read", "BUSINESS_IPC_RECOVERY_REQUIRED");
  await rejects("ordinary_business_write", "BUSINESS_IPC_RECOVERY_REQUIRED");
  await rejects("start_native_cutover", "DURABLE_CUTOVER_REQUIRES_RECOVERY");
  if (boot.scenario === "normal") {
    await check("V4_VERIFIED-alone-does-not-authorize-startup", diagnostic.state === "V4_VERIFIED", diagnostic);
    const verified = await call("authorized_recovery_handoff");
    await check("separate-authorization-and-native-readback-enable-handoff", verified.handoff_authorized === true && verified.startupBlocked === false, verified);
    const read = await call("ordinary_business_read");
    await check("ordinary-read-only-after-authorized-handoff", typeof read.metadata_count === "number", read);
    await finish({ diagnostic, handoff: verified });
  } else {
    const expected: Record<string, string> = {
      disconnect: "FAILED_V3_CONFIRMED",
      crash_at_quiescence: "QUIESCENCE_ACQUIRED",
      crash_before_commit: "COMMIT_OUTCOME_UNKNOWN",
      guard_lost: "GUARD_LOST_OR_UNPROVEN",
    };
    await check("restart-preserves-exact-durable-classification", diagnostic.state === expected[boot.scenario], diagnostic);
    await finish({ diagnostic });
  }
}

async function disconnectedDocument(): Promise<void> {
  await evidence({ kind: "real_replacement_document_loaded", href: location.href });
  let current = await status();
  const deadline = performance.now() + 10_000;
  while (current.running && performance.now() < deadline) { await wait(65); current = await status(); }
  await check("navigation-loss-cancels-native-owned-cutover", !current.running && current.disconnected && current.error?.code === "FRONTEND_DISCONNECTED", current);
  const diagnostic = await call("diagnostic_recovery");
  await check("disconnect-retains-fail-closed-durable-state", diagnostic.startupBlocked === true && diagnostic.state === "FAILED_V3_CONFIRMED", diagnostic);
  await rejects("ordinary_business_read", "BUSINESS_IPC_BLOCKED_DURING_CUTOVER");
  await finish({ diagnostic, real_document_replacement: true });
}

async function initial(): Promise<void> {
  await check("distinct-isolated-Tauri-identity", boot.app_identifier === "org.pfc.quiescence.integration", boot.app_identifier);
  await rejects("ordinary_business_read", "BUSINESS_IPC_RECOVERY_REQUIRED");
  await rejects("ordinary_business_write", "BUSINESS_IPC_RECOVERY_REQUIRED");
  await rejects("start_native_cutover", "SESSION_MISMATCH", { session: "wrong-session" });
  await rejects("start_native_cutover", "TOKEN_MISMATCH", { token: "wrong-token" });
  const startRequest = "frontend-cutover-primary";
  const accepted = await call("start_native_cutover", { requestId: startRequest });
  await check("frontend-request-started-native-cutover", accepted.accepted === true && accepted.native_owns_cutover === true, accepted);
  await rejects("start_native_cutover", "REQUEST_REPLAY", { requestId: startRequest });
  await rejects("start_native_cutover", "CUTOVER_ALREADY_STARTED");
  const paused = await until((value) => value.barrier !== null, "native-owned C barrier");
  const barrier = paused.barrier;
  if (!barrier) throw new Error("Native barrier absent");
  if (boot.scenario.startsWith("crash_")) {
    await check("crash-checkpoint-is-a-real-native-owned-barrier", paused.running, paused);
    await evidence({ kind: "controller_checkpoint", action: "kill-isolated-process", native_barrier: barrier });
    show({ waiting_for_controller_crash: true, barrier });
    return;
  }
  await check("native-C-owned-with-exclusive-lock", barrier.event === "quiescence_acquired" && barrier.details.lockstate === 4, barrier);
  const pauseStart = performance.now();
  await wait(450);
  const stillPaused = await status();
  await check("frontend-paused-while-native-retained-C", stillPaused.running && stillPaused.barrier?.id === barrier.id && performance.now() - pauseStart >= 400, stillPaused);
  await rejects("ordinary_business_read", "BUSINESS_IPC_BLOCKED_DURING_CUTOVER");
  await rejects("ordinary_business_write", "BUSINESS_IPC_BLOCKED_DURING_CUTOVER");
  await rejects("diagnostic_advance_barrier", "SESSION_MISMATCH", { session: "wrong-session", barrierId: barrier.id });
  await rejects("diagnostic_advance_barrier", "TOKEN_MISMATCH", { token: "wrong-token", barrierId: barrier.id });
  await rejects("diagnostic_advance_barrier", "BARRIER_MISMATCH", { barrierId: barrier.id + 99 });
  await rejects("native_commit_cutover", "EARLY_COMMIT_FORBIDDEN_NATIVE_ONLY");
  await rejects("native_end_cutover", "EARLY_END_FORBIDDEN_NATIVE_ONLY");
  await evidence({ kind: "real_window_close_invoke", source: "@tauri-apps/api/window.getCurrentWindow().close" });
  await getCurrentWindow().close();
  await until((value) => value.window_close_prevented >= 1, "real close-request interception");
  await call("request_app_close");
  const closeChecked = await until((value) => value.app_exit_prevented >= 1, "real app-exit interception");
  await check("real-window-and-app-close-kept-native-C", closeChecked.running && closeChecked.barrier?.id === barrier.id, closeChecked);
  if (boot.scenario === "disconnect") {
    await evidence({ kind: "frontend_disconnect_requested", method: "window.location.replace", target: "disconnected.html" });
    window.location.replace(new URL("disconnected.html", window.location.href).href);
    return;
  }
  const advanced = await call("diagnostic_advance_barrier", { barrierId: barrier.id });
  await check("frontend-releases-only-barrier-never-commit", advanced.commit_control === "native_state_machine_only", advanced);
  await rejects("diagnostic_advance_barrier", "BARRIER_REPLAY", { barrierId: barrier.id });
  let done = await status();
  const deadline = performance.now() + 30_000;
  while (done.running && performance.now() < deadline) { await wait(70); done = await status(); }
  const diagnostic = await call("diagnostic_recovery");
  if (boot.scenario === "guard_lost") {
    await check("guard-lost-is-native-persisted-not-schema-inferred", !done.running && done.error !== null && diagnostic.state === "GUARD_LOST_OR_UNPROVEN", { done, diagnostic });
    await finish({ diagnostic, fault_kind: "synthetic-native-rollback_failure-control-not-real-IO-fault" });
  } else {
    await check("native-only-commit-readback-reaches-V4_VERIFIED", !done.running && done.error === null && diagnostic.state === "V4_VERIFIED", { done, diagnostic });
    await rejects("ordinary_business_read", "BUSINESS_IPC_BLOCKED_DURING_CUTOVER");
    await check("terminal-state-still-requires-separate-handoff", diagnostic.startupBlocked === true, diagnostic);
    await finish({ diagnostic });
  }
}

async function main(): Promise<void> {
  boot = await invoke<Bootstrap>("ipc_bootstrap");
  await evidence({ kind: "frontend_loaded", source: "bundled_typescript", href: window.location.href, userAgent: navigator.userAgent, app_identifier: boot.app_identifier });
  show({ scenario: boot.scenario, phase: boot.phase, transport: "real Tauri invoke" });
  if (boot.scenario === "readiness") await finish({ readiness_only: true });
  else if (location.pathname.endsWith("disconnected.html")) await disconnectedDocument();
  else if (boot.phase === "restart") await restart();
  else await initial();
}

void main().catch(async (error: unknown) => {
  show({ failed: true, error: String(error) });
  if (boot) {
    await evidence({ kind: "fatal_frontend_failure", passed: false, error: String(error), assertions });
    const current = await status();
    if (!current.running) await invoke("finish_frontend", { ...credentials(), value: { passed: false, error: String(error), assertions } });
  }
});
