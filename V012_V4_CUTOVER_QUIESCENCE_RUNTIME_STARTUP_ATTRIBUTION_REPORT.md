# V0.1.2 Quiescence Local Runtime Startup Attribution Report

Date: 2026-10-09 (Asia/Shanghai)
Baseline: 72ef067435ceba241db55ed0c2ddee17b39713e8
Scope: read-only runtime attribution. Production remains untouched; RB-V4-CUTOVER-QUIESCENCE-01 remains OPEN; Production V4 migration remains NOT AUTHORIZED.

## Result

**PF_V012_V4_CUTOVER_QUIESCENCE_RUNTIME_STARTUP_BLOCKED**

The source call graph is established. The isolated binary does not call the normal Production run() and its reachable startup diagnostics do not open the normal app-support database. However, saved launch observations say the isolated executable process opened that app-support SQLite path, and the available source does not explain the observation. The startup failure root cause and process-to-database access attribution are therefore **UNKNOWN_WITH_SPECIFIC_MISSING_EVIDENCE**. The saved evidence explicitly leaves database preexistence unknown.

No correction, regression tests, build, or new launch was performed: the authorization permits correction only after a source-level cause is proven. The required single post-correction LaunchServices validation was therefore not eligible. No Production data or app was accessed.

## Evidence and limits

The existing receipt is evidence/quiescence-integration/local-launch-20261009T032820546142Z/launch-receipt.json; the saved follow-up observation is evidence/quiescence-integration/local-launch-20261009T032820546142Z/process-observation.txt.

- The receipt identifies the launched bundle ID org.pfc.quiescence.integration, executable quiescence-tauri, executable SHA-256, LaunchServices command, and runtime journal path. It records native_runtime_boot as null, no readiness handshake, and no runtime events.
- The follow-up observation records PID 36057 alive during a 45-second window, the synthetic PFC_IPC_ROOT environment, no ipc-initial.jsonl, and empty app stdout/stderr. It reports that lsof showed the process opening /Users/linte/Library/Application Support/org.pfc.quiescence.integration/personal-finance-console.sqlite3, which was 0 bytes when inspected.
- The original lsof, ps, and stat outputs were not retained. Thus the process/open-file details are preserved as an observation note, not independently reviewable raw command output.
- No prelaunch fingerprint was saved. **PREEXISTENCE_UNKNOWN**: the app-support directory and DB may or may not have existed before launch. Inode, prelaunch size, mtime, ctime, and whether launch created or truncated the file are unknown. The current app-support file was not opened or changed during this attribution task.
- The saved system-log excerpt does not establish a process-specific AMFI rejection. Signing/Gatekeeper diagnosis was not reopened.

## Exact isolated startup call graph

Source references below are relative to the repository root and refer to the baseline above.

1. src-tauri/Cargo.toml:15-18 declares the separate quiescence-tauri binary at src/bin/quiescence_tauri.rs; src-tauri/src/main.rs:3-5 is the ordinary executable entry and calls personal_finance_console_lib::run().
2. Isolated main() first checks the hash-only entry (src-tauri/src/bin/quiescence_tauri.rs:330-335; implementation src-tauri/src/quiescence.rs:409-415). On the normal path it creates and validates the quiescence Tauri context and then calls checked_state() (quiescence_tauri.rs:336-345). The config is isolated: ID org.pfc.quiescence.integration, empty configured windows, no devUrl, and bundled frontend directory (src-tauri/tauri.quiescence.conf.json:3-19).
3. checked_state() validates the explicit synthetic root, marker, scenario, phase, permit/consumed record, executable location, and real Info.plist identity (quiescence_tauri.rs:287-317). It creates ipc-{phase}.jsonl with create_new, then calls diagnostic_integrated(root), creates in-memory RuntimeState, and appends native_runtime_boot (quiescence_tauri.rs:318-327). The diagnostic precedes the boot event, but both are before Builder::default().
4. The separate Builder manages only RuntimeState, registers the explicit isolated IPC handler set, and in setup builds the one quiescence webview from bundled index.html (quiescence_tauri.rs:347-364). It then builds the Tauri app and enters app.run(...) (quiescence_tauri.rs:373-382). No .plugin(...) call or normal database state management is present in this builder.
5. The bundled page loads quiescence-web/main.ts (quiescence-web/index.html:1-3). Its main() first invokes ipc_bootstrap; only after that resolves does it send frontend_loaded through record_frontend_evidence (quiescence-web/main.ts:187-194,38-40). Native handlers are at quiescence_tauri.rs:135-140,272-276; all IPC registrations are at :349-351.
6. Initial synthetic DB work is not startup setup: the frontend first issues a test command; start_native_cutover validates and spawns a worker (quiescence_tauri.rs:148-175), which reaches quiescence::run_integrated() (quiescence.rs:358-406). Ordinary business SQLite commands are gated on the explicit authorized handoff (quiescence_tauri.rs:189-213,245-270).

### Failure ordering and readiness

- native_runtime_boot is appended before Tauri Builder creation, app setup, WebView construction, and frontend loading. It is after root/permit/identity checks, journal creation, and synchronous diagnostic_integrated().
- Before that event, failures can occur in the hash-entry branch, context generation/identity checks, checked_state() validation, create_new journal open, the diagnostic call, or the journal append/sync itself. checked_state() errors are printed to stderr and exit (quiescence_tauri.rs:344); the saved stderr is empty. The diagnostic call is synchronous and before boot, but there is no evidence it hung or failed in this run.
- After a boot record, Tauri build/setup/WebView or frontend/IPC failures can prevent frontend_loaded. ipc_bootstrap must resolve before the TypeScript event is journaled. The Tauri app event loop has no startup readiness deadline/watchdog (quiescence_tauri.rs:373-382), so a process can remain alive while a page or IPC readiness condition is not met.
- A later WebView/frontend failure alone cannot account for the missing earlier native boot record. The saved observations do not show whether Rust main() reached checked_state(), whether a diagnostic blocked, or whether the journal path/result was otherwise unavailable.

## SQLite access attribution

| Path | Source and timing | Open behavior | Classification |
|---|---|---|---|
| Normal Production run() | src-tauri/src/main.rs:3-5 → src-tauri/src/lib.rs:992-1049. In setup it resolves app_data_dir and chooses personal-finance-console.sqlite3 (:995-1015), performs Production schema checks (:1016-1032), then opens with Connection::open (:1042) and manages DatabaseState (:1043-1045). | Connection::open uses rusqlite default read/write/create behavior. It can create an empty file when opened for a missing path; a later failure before any page write can leave a 0-byte file. This is a general mechanism, not evidence it occurred here. | PRODUCTION_ONLY for the exact Production identity; SHARED run helper for non-isolated normal builds. |
| DatabaseState::open helper | src-tauri/src/lib.rs:327-339; its Connection::open is at :338. Direct access to the exact Production path is refused first. | Default open flags include CREATE. | UNREACHABLE_FROM_QUIESCENCE_TAURI; not called by the isolated binary. |
| Isolated startup diagnostic | checked_state() → quiescence::diagnostic_integrated(root) (quiescence_tauri.rs:322; quiescence.rs:416; quiescence_recovery.rs:21-37). | Reads/checks synthetic-root files and durable JSON/hash chains. Its reachable diagnostic body contains no SQLite connection open. | ISOLATED_ONLY; before native_runtime_boot; no DB open found in this call path. |
| Synthetic migration worker | Explicit start_native_cutover IPC → run_integrated → run_consumed (quiescence_tauri.rs:148-175; quiescence.rs:358-406,264-286). It verifies the DB exists as a regular file before opening (:364, then quiescence.rs:253,268-270). | Opens root/personal-finance-console.sqlite3 read/write with NO_MUTEX, PRIVATE_CACHE, and NOFOLLOW; no CREATE flag. The supplied/validated synthetic root is required. | ISOLATED_ONLY; after native boot and explicit frontend IPC. |
| Isolated business IPC | quiescence_tauri.rs:189-213; only after handoff_authorized (:194-201). | Opens state.root/DB read-only or read/write, with NOFOLLOW and PRIVATE_CACHE; no CREATE flag. | ISOLATED_ONLY; after explicit IPC/handoff. |
| Recovery | quiescence_recovery.rs:48-53,150-179; called only from authorized recovery IPC (quiescence_tauri.rs:250-270). | Backup is read-only; main synthetic DB recovery is read-only and requires an existing validated file. No CREATE flag. | ISOLATED_ONLY; after native boot and explicit authorization. |
| Production migrations/services | The normal application composition and Production database state; the isolated Tauri binary does not construct it. | No pre-readiness migration path is reachable from isolated main(). | UNREACHABLE_FROM_QUIESCENCE_TAURI before explicit synthetic worker calls. |

There are no Tauri plugins registered in the isolated Builder, and the isolated config declares no plugin initialization that opens an app-data database. The Tauri config declares no auto-created window; Rust explicitly builds the window in setup. The isolated frontend imports only Tauri core/window APIs and calls only the isolated commands in this harness. It does not invoke the normal database_open command or compose normal application services.

## Root cause and correction decision

**Root cause classification: UNKNOWN_WITH_SPECIFIC_MISSING_EVIDENCE.**

Verified source fact: the current isolated executable source does not call Production run() and has no reachable pre-readiness code that resolves app.path().app_data_dir() or opens ~/Library/Application Support/org.pfc.quiescence.integration/personal-finance-console.sqlite3. Its diagnostic reads only the explicit synthetic root. The reported app-support open by the isolated PID therefore remains unexplained by this source call graph.

The 0-byte outcome is compatible in principle with a CREATE-capable open followed by no page write, but the isolated source's startup diagnostic does not use CREATE and the actual prelaunch file state is unknown. Neither file creation nor truncation is attributed. A source correction cannot be selected from the evidence without guessing whether the observed open came from a different code path, runtime component, or incomplete/mismatched observation.

No correction was made. Moving the existing boot event earlier than its synthetic-root diagnostic might improve observability, but does not explain the app-support SQLite open and is not a proven root-cause correction. No tests were run because no correction was supported by attribution. No new bundle was built and no new launch was performed.

## Required follow-up evidence to reopen correction

A future authorized attribution run needs a preserved prelaunch inventory for the exact isolated app-support directory and DB (existence, inode, size, mtime, ctime); raw lsof/process records bound to the executable hash and PID; the exact app executable hash and corresponding build/source receipt; and startup trace evidence that distinguishes entry into main(), completion of checked_state()/diagnostic, Builder setup, WebView creation, and the first frontend IPC. Do not infer file preexistence or process causality from the current receipt narrative.

## Preservation and task boundary

- No Production app, Production database, backup, permission, signing identity, or host security setting was changed or opened.
- The current isolated app-support DB was not opened, deleted, or modified by this task.
- No S1, lease/recovery matrix, Q11, or S0-S10 formal continuation was performed.
- RB-V4-CUTOVER-QUIESCENCE-01 remains OPEN. Production V4 migration remains NOT AUTHORIZED.
