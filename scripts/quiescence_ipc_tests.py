#!/usr/bin/env python3
"""Q11: real bundled TypeScript -> Tauri/Wry -> native-owned cutover.

The controller creates only marked synthetic fixtures, starts the exact managed
candidate, observes append-only evidence, and kills/restarts the two crash cases.
It never substitutes pipes, a CLI migration, mock IPC, or direct Rust calls for
frontend invoke. All roots are retained for independent persisted DB readback.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

from quiescence_gate import MaintenanceLease
from quiescence_integration import create_fixture, handoff_native, prepare_managed

REPO = Path(__file__).resolve().parents[1]
CASES = ("normal", "disconnect", "crash_at_quiescence", "crash_before_commit", "guard_lost")
EXPECTED = {
    "normal": "V4_VERIFIED", "disconnect": "FAILED_V3_CONFIRMED",
    "crash_at_quiescence": "QUIESCENCE_ACQUIRED",
    "crash_before_commit": "COMMIT_OUTCOME_UNKNOWN", "guard_lost": "GUARD_LOST_OR_UNPROVEN",
}
SOURCES = (
    "scripts/quiescence_ipc_tests.py", "scripts/quiescence_integration.py", "scripts/quiescence_gate.py",
    "scripts/package_quiescence_runtime.py",
    "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/src/quiescence.rs",
    "src-tauri/src/quiescence_contract.rs", "src-tauri/src/quiescence_recovery.rs",
    "src-tauri/src/bin/quiescence_tauri.rs", "src-tauri/src/bin/quiescence_old_runtime.rs",
    "src-tauri/tauri.quiescence.conf.json", "src-tauri/tauri.quiescence.package.conf.json",
    "src-tauri/quiescence-runtime-compatibility.json",
    "src-tauri/capabilities/quiescence-ipc.json", "quiescence-web/main.ts",
    "quiescence-web/index.html", "quiescence-web/disconnected.html",
    "vite.quiescence.config.ts", "tsconfig.quiescence.json", "tests/quiescence-ipc-contract.test.ts",
)


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_suffix(path.suffix + ".pending")
    with pending.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(pending, path)
    assert json.loads(path.read_text()) == value


def rows(path):
    if not path.exists():
        return []
    raw = path.read_bytes()
    # A concurrently appended final line is not an event until newline+fsync.
    complete = raw[:raw.rfind(b"\n") + 1]
    return [json.loads(line) for line in complete.splitlines()]


def frontend(rows_, kind):
    return [row["detail"]["value"] for row in rows_
            if row["event"] == "frontend_evidence" and row["detail"]["value"].get("kind") == kind]


def require(condition, reason):
    if not condition:
        raise AssertionError(reason)


def release_gate_after_native_proof(lease, context, process, entries):
    if lease is None or lease.fd < 0:
        return None
    owned = [row for row in entries if row["event"] == "native_event"
             and row["detail"]["event"] == "lease_native_owned"]
    if not owned:
        return None
    root = Path(context["root"])
    claim = json.loads((root / "native-launch.json").read_text())
    lock = (root / "maintenance.lock").stat()
    require(claim["pid"] == process.pid and claim["session"] == context["session"], "native lease owner binding")
    require((claim["lease_dev"], claim["lease_inode"]) == (lock.st_dev, lock.st_ino), "native lease inode binding")
    require(owned[-1]["detail"]["details"] == claim, "native event and persisted launch claim differ")
    # The managed helper also independently binds parent pid, nonce,
    # authorization, exact contract hash, and durably saves gate-handoff.json.
    receipt = handoff_native(lease, process, context)
    return {"native_pid": process.pid, "session": context["session"], "dev": lock.st_dev,
            "inode": lock.st_ino, "gate_closed_after_native_proof": True,
            "operation": "close-parent-copy-only; no LOCK_UN", "receipt": receipt}


def launch(context, scenario, phase, lease=None):
    root = Path(context["root"])
    executable = Path(context["installed_executable"])
    require(sha(executable) == context["native_sha256"], "installed binary changed")
    extra = {"PFC_IPC_ROOT": str(root), "PFC_IPC_SCENARIO": scenario, "PFC_IPC_PHASE": phase}
    if scenario == "guard_lost" and phase == "initial":
        extra["PFC_Q_FAIL"] = "rollback_failure"
    log = root / f"ipc-{phase}.jsonl"
    lifecycle_path = root / f"ipc-{phase}-controller.json"
    handoff = None
    killed = False
    with (root / f"ipc-{phase}.stdout.log").open("x") as output, (root / f"ipc-{phase}.stderr.log").open("x") as error:
        if lease is not None:
            process = lease.launch_native(executable, context["native_sha256"], arguments=[], extra_env=extra,
                                          stdin=subprocess.DEVNULL, stdout=output, stderr=error)
        else:
            env = {key: value for key, value in os.environ.items()
                   if not key.startswith("PFC_QUIESCENCE_") and key not in {"PFC_Q_FAIL", "PFC_IPC_ROOT", "PFC_IPC_SCENARIO", "PFC_IPC_PHASE"}}
            env.update(extra)
            process = subprocess.Popen([str(executable)], env=env, stdin=subprocess.DEVNULL,
                                       stdout=output, stderr=error, text=True, close_fds=True)
        lifecycle = {"format_version": 1, "provenance": "external_process_controller_not_IPC",
                     "root": str(root), "scenario": scenario, "phase": phase,
                     "pid": process.pid, "executable": str(executable), "executable_sha256": context["native_sha256"],
                     "stdout_log": output.name, "stderr_log": error.name,
                     "started_at_unix_ns": time.time_ns(), "exit_code": None}
        deadline = time.monotonic() + 60
        try:
            # Persist process identity before looking for any frontend evidence.
            # Even an OS rejection before main() must retain its exact PID.
            save_json(lifecycle_path, lifecycle)
            while process.poll() is None and time.monotonic() < deadline:
                entries = rows(log)
                release = release_gate_after_native_proof(lease, context, process, entries)
                if release:
                    handoff = release
                fatal = frontend(entries, "fatal_frontend_failure")
                if fatal:
                    raise AssertionError(f"actual frontend failed: {fatal[-1]}")
                if scenario.startswith("crash_") and phase == "initial" and frontend(entries, "controller_checkpoint"):
                    require(handoff is not None, "crash checkpoint without native lease handoff")
                    process.kill()
                    process.wait(timeout=5)
                    killed = True
                    break
                time.sleep(0.08)
            if process.poll() is None:
                raise TimeoutError(f"real Tauri frontend did not finish: {scenario}/{phase}")
            entries = rows(log)
            require(entries, f"no actual native/webview evidence; subprocess_exit={process.returncode}")
            require(all(row["transport"] == "tauri-wry-ipc" and row["pid"] == process.pid for row in entries), "runtime event identity mismatch")
            require([row["sequence"] for row in entries] == list(range(1, len(entries) + 1)), "event sequence missing or duplicated")
            require(frontend(entries, "frontend_loaded"), "bundled TypeScript was never observed")
            if not killed:
                require(process.returncode == 0, f"Tauri exit={process.returncode}")
                complete = [row for row in entries if row["event"] == "frontend_complete"]
                require(complete and complete[-1]["detail"]["value"].get("passed") is True, "missing passing persisted frontend result")
            require(not [row for row in frontend(entries, "assertion") if not row["passed"]], "frontend assertion failed")
            return {"pid": process.pid, "exit_code": process.returncode, "controller_killed": killed,
                    "log": str(log), "log_sha256": sha(log), "events": len(entries),
                    "frontend_assertions": len(frontend(entries, "assertion")), "lease_handoff": handoff,
                    "controller_lifecycle": str(lifecycle_path),
                    "frontend_results": [row["detail"]["value"] for row in entries if row["event"] == "frontend_complete"]}
        except Exception as failure:
            lifecycle["failure"] = f"{type(failure).__name__}: {failure}"
            raise
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
                lifecycle["controller_killed_on_failure"] = True
            output.flush()
            error.flush()
            os.fsync(output.fileno())
            os.fsync(error.fileno())
            lifecycle.update({"exit_code": process.returncode, "finished_at_unix_ns": time.time_ns(),
                              "stdout_sha256": sha(output.name), "stderr_sha256": sha(error.name),
                              "stdout_bytes": Path(output.name).stat().st_size,
                              "stderr_bytes": Path(error.name).stat().st_size,
                              "native_journal_exists": log.exists(),
                              "native_journal_sha256": sha(log) if log.exists() else None})
            save_json(lifecycle_path, lifecycle)


def recovery_authorization(context):
    root = Path(context["root"])
    consumed = json.loads((root / "consumed.json").read_text())
    value = {
        "format_version": 2, "synthetic_only": True, "scope": "synthetic-recovery-handoff-only",
        "authorization_id": "synthetic-separate-handoff-" + uuid.uuid4().hex,
        "session": context["session"], "nonce": uuid.uuid4().hex,
        "managed_contract_sha256": consumed["managed_contract_sha256"],
        "consumed_sha256": sha(root / "consumed.json"), "outcome_sha256": sha(root / "outcome.json"),
        "action": "verify-v4-handoff", "expected_database_sha256": sha(root / "personal-finance-console.sqlite3"),
    }
    target = root / "recovery-authorization.json"
    require(not target.exists(), "do not replace an existing recovery authorization")
    save_json(target, value)
    return str(target)


def verify_native_cross_checks(case):
    entries = rows(Path(case["initial"]["log"]))
    assertions = frontend(entries, "assertion")
    require(frontend(entries, "invoke_result"), "frontend IPC responses absent")
    if case["scenario"].startswith("crash_"):
        require(frontend(entries, "controller_checkpoint"), "real frontend crash checkpoint missing")
    else:
        require(any(row["event"] == "real_window_close_requested" and row["detail"]["prevented"] for row in entries), "real CloseRequested prevention absent")
        require(any(row["event"] == "real_app_exit_event" and row["detail"]["prevented"] for row in entries), "real ExitRequested prevention absent")
        require(any(row["name"] == "frontend-paused-while-native-retained-C" for row in assertions), "native-owner pause assertion absent")
        enter = next(row["sequence"] for row in entries if row["event"] == "native_barrier_entered")
        release = next((row["sequence"] for row in entries if row["event"] == "native_barrier_released"), len(entries) + 1)
        require(not [row for row in entries if enter < row["sequence"] < release and row["event"] == "business_connection_closed"], "business connection entered protected window")
        blocked = {row["detail"]["command"] for row in entries if row["event"] == "ipc_rejected"
                   and row["detail"]["code"] == "BUSINESS_IPC_BLOCKED_DURING_CUTOVER"}
        require({"ordinary_business_read", "ordinary_business_write"} <= blocked, "real business IPC refusals missing")
    if case["scenario"] == "disconnect":
        require(any(row["event"] == "frontend_document_disconnected" for row in entries), "real navigation disconnect hook absent")
        require(frontend(entries, "real_replacement_document_loaded"), "replacement real document did not load")
    restart = rows(Path(case["restart"]["log"]))
    require(not any(row["event"] == "native_worker_started" for row in restart), "restart reran migration")
    if case["scenario"] == "normal":
        require(any(row["event"] == "business_connection_closed" and row["detail"]["command"] == "ordinary_business_read" for row in restart), "authorized handoff positive business query missing")
    return {"native_and_frontend_cross_checked": True, "no_cli_or_pipe_ipc_substitute": True,
            "restart_did_not_reconsume_or_rerun_m4": True}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", type=Path, help="exact executable inside the signed synthetic candidate bundle")
    parser.add_argument("--bundle", type=Path, help="signed isolated Tauri app bundle built with the package profile")
    parser.add_argument("--signing-identity", default="Apple Development: 8619814730147 (FW5KHTFNZ6)")
    parser.add_argument("--output", type=Path, default=REPO / "evidence/quiescence-integration/ipc-report.json")
    parser.add_argument("--case", choices=CASES, action="append")
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--build-only", action="store_true", help="compile the isolated context without creating any fixture or launching an app")
    args = parser.parse_args()
    bundle = args.bundle
    if args.build or args.build_only:
        result = subprocess.run([sys.executable, "scripts/package_quiescence_runtime.py",
                                 "--signing-identity", args.signing_identity], cwd=REPO, capture_output=True, text=True)
        print(result.stdout, end="")
        if result.stderr:
            print(result.stderr, file=sys.stderr, end="")
        if result.returncode:
            return result.returncode
        summary = json.loads(result.stdout.splitlines()[-1])
        bundle = Path(summary["bundle"])
    if bundle is None:
        bundle = REPO / "src-tauri/target/release/bundle/macos/PFC Isolated Quiescence IPC.app"
    bundle = bundle.resolve(strict=True)
    binary = (args.binary.resolve(strict=True) if args.binary else bundle / "Contents/MacOS/personal-finance-console")
    binary = binary.resolve(strict=True)
    if not binary.is_relative_to(bundle):
        raise SystemExit("candidate executable must be inside the signed synthetic app bundle")
    if args.build_only:
        print(json.dumps({"built_only": True, "app_launched": False, "bundle": str(bundle),
                          "binary": str(binary), "sha256": sha(binary)}))
        return 0
    base = Path(tempfile.mkdtemp(prefix="pfc-q11-real-ipc-")).resolve()
    selected = args.case or list(CASES)
    report = {"format_version": 1, "scope": "synthetic-only", "transport": "real-Tauri-Wry-bundled-TypeScript-invoke",
              "status": "RUNNING", "root": str(base), "binary": str(binary), "binary_sha256": sha(binary),
              "source_sha256": {name: sha(REPO / name) for name in SOURCES}, "cases": [],
              "production_preservation": {
                  "intended_scope": "canonical marked temporary fixtures only; installed Production must not be launched",
                  "source_guards": "pre-Builder exact isolated context and empty configured windows; actual isolated bundle plist; fixed synthetic DB path; no Production command registration",
                  "os_profile_side_effects": "NOT_INDEPENDENTLY_AUDITED",
                  "acceptance_limit": "These source constraints are not a measured zero-side-effect attestation. Preserve raw before/after evidence separately. Attempt01 created a default-store webview before the setup guard and is explicitly disclosed in its diagnostic."
              }}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    run_id = uuid.uuid4().hex[:10]
    try:
        for scenario in selected:
            print(f"Q11 real IPC: {scenario}", flush=True)
            definition = create_fixture(base, binary, scenario, candidate_bundle=bundle,
                                        signing_identity=args.signing_identity)
            root = Path(definition["root"])
            case = {"scenario": scenario, "root": str(root), "expected_durable_state": EXPECTED[scenario]}
            report["cases"].append(case)
            with MaintenanceLease(root, definition["session"]) as lease:
                context = prepare_managed(root, lease)
                case["initial"] = launch(context, scenario, "initial", lease)
            outcome = json.loads((root / "outcome.json").read_text())
            require(outcome["state"] == EXPECTED[scenario], f"wrong persisted state for {scenario}: {outcome}")
            consumed_hash = sha(root / "consumed.json")
            outcome_hash = sha(root / "outcome.json")
            if scenario == "normal":
                case["recovery_authorization"] = recovery_authorization(context)
            case["restart"] = launch(context, scenario, "restart")
            require(sha(root / "consumed.json") == consumed_hash, "restart altered consumed permit")
            require(sha(root / "outcome.json") == outcome_hash, "restart overwrote original outcome")
            case["outcome"] = outcome
            case["database_sha256"] = sha(root / "personal-finance-console.sqlite3")
            case["checks"] = verify_native_cross_checks(case)
            for phase in ("initial", "restart"):
                copied = args.output.parent / f"ipc-{run_id}-{scenario}-{phase}.jsonl"
                shutil.copyfile(case[phase]["log"], copied)
                require(sha(copied) == case[phase]["log_sha256"], "evidence copy readback mismatch")
                case[phase]["preserved_log"] = str(copied)
            case["passed"] = True
            save_json(args.output, report)
        after = {name: sha(REPO / name) for name in SOURCES}
        require(after == report["source_sha256"], "source changed during IPC experiment; rerun on fixed sources")
        require(sha(binary) == report["binary_sha256"], "source binary replaced during IPC experiment")
        report["status"] = "PASS"
    except Exception as error:
        report["status"] = "FAIL"
        report["error"] = f"{type(error).__name__}: {error}"
        save_json(args.output, report)
        print(report["error"], file=sys.stderr, flush=True)
        return 1
    save_json(args.output, report)
    print(json.dumps({"status": report["status"], "cases": len(report["cases"]), "evidence": str(args.output), "retained_root": str(base)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
