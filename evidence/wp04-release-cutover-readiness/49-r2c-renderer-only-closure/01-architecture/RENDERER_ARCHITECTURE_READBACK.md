# Renderer Architecture Readback — WP-04R2C

## Runtime identity

- Frozen source: `c3da2f73c03b681957b4334751b7933d102caad1`; source archive SHA-256 `e2f06d023eca661079406821cac23373b874a81867c95dccb6f1e503ecef6ce3`.
- Candidate: `/Users/linte/Library/Caches/pfc-wp04r2b3c2-c3da2f7/candidate-build-02/cargo-target/release/bundle/macos/小钱家.app`, bundle ID `org.pfc.quiescence.integration`. Executable SHA-256 `e4097fc566bbe9d3e0a6eafb7044b283dae37504427a25ca08917c2b046ae1bf`; compatibility manifest SHA-256 `cdb8f040b9250a23ba0df0f89a0c91313ba881cdd715bed8945201e1f51b7ecc`. Strict codesign verification passed before and after the run.
- macOS 26.6.2 (build 25G83); Tauri 2.12.1; `tauri-runtime-wry` 2.12.1; Wry 0.57.0. The executable links the system WebKit framework (`WebKit.framework` 625.1.29). WebKit WebContent reported runtime version 21624.5.1.11.3. This is WKWebView with a separately launched Apple WebKit WebContent XPC process.

## Process topology and attribution

- Candidate native process: PID 89125. WebContent process before termination: PID 89133. Both reported PPID 1.
- `lsappinfo` mapped PID 89125 to the exact candidate bundle and executable. It identified the WebContent process as `com.apple.WebKit.WebContent`, with a parent ASN named “小钱家 Networking”. `launchctl print pid/89133` reported the WebContent XPC originator and resource/jetsam coalition bundle ID `org.pfc.quiescence.integration`. The same coalition binding was observed for replacement WebContent PID 89807. See `02-process-attribution/ATTRIBUTION_METHOD.md` and the process snapshots.
- WebContent is separately killable. PPID alone is not used for ownership. Reparenting to PID 1 was observed. Several unrelated, long-running WebContent PIDs were present before launch, so process name or timing alone would not be a safe target selector.
- Native PID 89125 held the SQLite file under the isolated temporary HOME at `/tmp/pfc-wp04r2c-home.8Daz3g/Library/Application Support/org.pfc.quiescence.integration/personal-finance-console.sqlite3`. The renderer’s open-file snapshot showed the Apple WebKit executable and system resources, not the SQLite file. No Production app-data path was opened.

## Native authority and migration boundary

- `src-tauri/src/main.rs` checks `--pfc-r2b1-unified-synthetic <root>` before entering `personal_finance_console_lib::run()`. That branch calls `quiescence::run_unified_gate_handoff` and returns without creating a Tauri Builder or WebView. The formal Gate consumer therefore runs as a native CLI process with no renderer in that process.
- `src-tauri/src/quiescence.rs` owns the unified permit validation/claim, consumed ledger, lease checks, SQLite connection, `BEGIN EXCLUSIVE`, M4 transaction, COMMIT, verified readback, and durable S10 terminal. The `generate_handler!` list in `src-tauri/src/lib.rs` does not expose this Gate handoff command to the renderer.
- The ordinary UI does expose generic `database_execute` and migration begin/end commands. On a Production runtime, the native SQLite authorizer rejects schema mutation outside the authorized native migration window; startup initializes `migration_permitted=false`, and the Production V3 UI is stopped by schema checks before normal renderer startup. This statement is limited to the formal Production gate path. The synthetic UI launched for R01 used a separate, temporary app-data directory.
- Thus permit, consumed ledger, formal lease, Gate transaction, commit decision, and durable terminal are native-owned. The renderer does not own the formal Gate SQLite connection or provide an alternate Gate authority path.

## Runtime observation

- R01 idle renderer termination: launchd coalition and LaunchServices metadata matched PID 89133 to the exact synthetic candidate. SIGTERM was sent only to PID 89133. The native process PID 89125 remained alive after termination. A new WebContent PID 89807 appeared with the same synthetic candidate coalition.
- R05: WebKit process respawn is verified. Frontend rebootstrap, business IPC recovery, and a renderer-to-Gate reconnect were not instrumented in this ordinary UI candidate and remain unverified. The app was quit normally after collection.
- R02/R03: the frozen candidate has no Tauri IPC command that starts the formal Gate handoff. The only existing Gate entrypoint is the CLI branch that returns before WebView creation. Therefore this source/candidate cannot produce a same-session Tauri renderer at S5 or at the post-COMMIT barrier. No renderer was killed during a gate transaction, and no S5 or commit-boundary PASS is claimed.

## Classification

Renderer identity is reliably attributable on this macOS run using launchd coalition metadata, despite PPID 1 reparenting. The idle renderer-only kill passed. The critical-section renderer scenario is blocked by missing current-candidate testability/integration, not by an ambiguous PID and not by a proven migration safety defect. `RB-V4-CUTOVER-QUIESCENCE-01` remains OPEN.
