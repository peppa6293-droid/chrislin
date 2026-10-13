# WP04R2C Renderer-Only Closure Report

Date: 2026-10-13 (Asia/Shanghai)
Status: `WP04R2C_BLOCKED_NEEDS_RENDERER_TESTABILITY`

## Scope and result

WP04R2B acceptance is reused as Planning-reported and preserved. This run addressed only Q11 renderer-only termination. R01 idle renderer termination passed on the exact frozen synthetic candidate. The S5 and commit-boundary tests remain blocked because the current formal Gate→native migration path is a CLI branch that returns before Tauri/Wry creates a WebView, while the ordinary UI has no Gate handoff IPC command. A renderer killed in the ordinary UI during a separate CLI migration would not test the same runtime.

This is an instrumentation/integration testability gap. No runtime source was edited, the frozen candidate was not rebuilt or resigned, and no claim is made that the renderer subfinding or WP04R2C is closed. `RB-V4-CUTOVER-QUIESCENCE-01` remains OPEN.

## Architecture and R01 evidence

- macOS 26.6.2 (25G83); Tauri 2.12.1; Wry 0.57.0; system WKWebView/WebKit 625.1.29. WebContent runtime version: 21624.5.1.11.3.
- Candidate native PID 89125 and attributed WebContent PID 89133 both had PPID 1. Attribution used launchd resource/jetsam coalition bundle ID `org.pfc.quiescence.integration`, exact candidate executable/bundle identity from LaunchServices, and `lsappinfo`’s “小钱家 Networking” parent ASN—not PPID alone.
- R01: SIGTERM was sent only to attributed WebContent PID 89133 while idle. It exited; native PID 89125 remained alive. WebKit then started PID 89807 under the same synthetic bundle coalition. The app was later quit normally. The candidate opened SQLite only at the isolated temporary path recorded in the evidence.
- WebKit process respawn is verified. UI contents after respawn, frontend rebootstrap, and safe business IPC were not instrumented; they remain UNKNOWN.

Full source and process readback: `evidence/wp04-release-cutover-readiness/49-r2c-renderer-only-closure/01-architecture/RENDERER_ARCHITECTURE_READBACK.md` and sibling process evidence.

## Native ownership and testability boundary

The frozen `main.rs` routes `--pfc-r2b1-unified-synthetic <root>` directly to `quiescence::run_unified_gate_handoff` and returns before `personal_finance_console_lib::run()`. The formal native consumer owns permit claim/validation, consumed ledger, lease, SQLite connection and exclusive transaction, M4, COMMIT/readback, and durable S10 terminal. The Tauri handler set does not register that Gate handoff. Thus the formal Gate path has no renderer process to terminate at S5, and the UI path has no current IPC to place the same app session at that barrier.

The ordinary UI does expose generic native database IPC. For Production, source initializes migration permission false, refuses a V3 UI startup before normal renderer readiness, and the SQLite authorizer denies schema mutation outside the native gate window. The synthetic UI run used a different, temporary app-data root. These facts establish native ownership of the formal gate authority; they do not establish a renderer kill during the formal transaction.

## Outcomes

| Check | Result | Evidence / limit |
|---|---|---|
| Architecture and native authority | VERIFIED | Frozen source readback and current runtime process evidence |
| R01 idle renderer kill | PASS_CURRENT | Renderer PID 89133 terminated; native PID 89125 remained alive |
| R02 S5 renderer kill | BLOCKED | No current UI→Gate handoff entrypoint; not run |
| R03 post-COMMIT renderer kill | BLOCKED | Same current-candidate testability gap; not run |
| R04 S10 / reply loss | PASS_REUSED for native portion | Current-source R2B S10 terminal/recovery evidence; no direct renderer contrast |
| R05 respawn / reconnect | PARTIAL | New WebContent PID 89807 verified; UI/IPC rebootstrap UNKNOWN |
| Business IPC in unsafe/safe state | UNKNOWN for R2C renderer boundary | Prior native Q11 checks reused only for native fail-closed behavior |
| Q11 native portion | PASS_REUSED | WP04R2B accepted evidence |
| Q11 renderer subfinding | NOT CLOSED | S5 and commit-boundary renderer checks unavailable |

## Regressions run

- Product automated regression: 17 files, 300/300 passed; includes `quiescence-ipc-contract.test.ts`.
- Current-source Rust recovery/quiescence regression with recovery hooks: 33/33 passed.
- Recovery diagnostic suite: 9/9 passed; it was invoked once with an incorrect Python module path, then passed using the script entrypoint.
- Forward synthetic Formal Gate→Rust→S10 smoke: passed; `migration4ExecutionCount=1`, verified terminal S10, exact synthetic ledger/permit continuity. Its temporary fixture was separate from the launched UI app. No 17-scenario recovery matrix was rerun.
- Renderer-specific native IPC at S5 and commit boundary: NOT RUN because the current candidate exposes no path to create that shared UI/native state.

## Freeze and preservation

- Frozen source commit: `c3da2f73c03b681957b4334751b7933d102caad1`; source archive SHA-256: `e2f06d023eca661079406821cac23373b874a81867c95dccb6f1e503ecef6ce3`. Runtime source diff from frozen commit: none.
- Candidate executable SHA-256: `e4097fc566bbe9d3e0a6eafb7044b283dae37504427a25ca08917c2b046ae1bf`; manifest SHA-256: `cdb8f040b9250a23ba0df0f89a0c91313ba881cdd715bed8945201e1f51b7ecc`; strict codesign: PASS. Candidate changed/rebuilt/resigned: NO.
- Production app/database touched: NO. Real Production authorization/backup/permit created: NO. Financial Model changed: NO. WP-02 touched: NO. WP-03 acceptance preserved: YES.
- Synthetic regression generated temporary gate authorization, backup, permit, ledger, and terminal only inside its marked disposable fixture; those are not Production objects. The UI candidate used `/tmp/pfc-wp04r2c-home.8Daz3g` and bundle ID `org.pfc.quiescence.integration`.

## Next responsibility

Planning/Owner must decide whether to issue a synthetic-only testability work order that binds the formal Gate handoff to a renderer-bearing Tauri session, or to revise the acceptance design for the separate native CLI architecture. Until then, Q11 renderer remains open and no Production pre-candidate freeze should proceed from this R2C result.

## Final fields

- Final Status: `WP04R2C_BLOCKED_NEEDS_RENDERER_TESTABILITY`
- Frozen Source Commit: `c3da2f73c03b681957b4334751b7933d102caad1`
- Candidate Executable SHA: `e4097fc566bbe9d3e0a6eafb7044b283dae37504427a25ca08917c2b046ae1bf`
- Source Changed: NO; Candidate Changed: NO
- Tauri: 2.12.1; Wry: 0.57.0; WebKit: system WKWebView, 625.1.29
- Native PID: 89125; Renderer Attribution: launchd coalition + LaunchServices + WebKit Networking parent ASN; Renderer Reparenting: YES, PPID 1
- Renderer Owns SQLite / Permit / Ledger / Migration Transaction: NO / NO / NO / NO (formal Gate scope)
- Idle Kill: PASS_CURRENT; S5 Kill: BLOCKED; Commit-Boundary Kill: BLOCKED; S10/Reply Loss: PASS_REUSED native only; Respawn/Reconnect: process respawn PASS, UI/IPC UNKNOWN
- Native Stayed Alive: YES after R01; M4 Duplicate Possible: NO under the current native one-time authority/ledger contract; Permit Resurrection: NO; Automatic Restore: NO
- Business IPC Unsafe / Safe: UNKNOWN for renderer boundary; native fail-closed portion reused
- Q11 Native: PASS_REUSED; Q11 Renderer: OPEN; Q11 Overall: BLOCKED
- Product Regression: 300/300; Native IPC/Rust Regression: 33/33 plus S10 smoke; Forward M4 Smoke: PASS, count 1
- Runtime Dirty Source: NO; WP03 Acceptance Preserved: YES; Financial Model Changed: NO; WP02 Touched: NO
- Production App/DB Touched: NO / NO; Real Authorization/Permit Created: NO / NO
- Report: `WP04R2C_RENDERER_ONLY_CLOSURE_REPORT.md`
- Evidence Root: `evidence/wp04-release-cutover-readiness/49-r2c-renderer-only-closure/`
- Ready for Final Production Pre-Candidate Freeze: NO
