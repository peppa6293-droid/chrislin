"""Source-bound isolated regressions; never overwrites historical evidence.

The real Wry/TS IPC suite is a separate executable test and is not substituted
by these unit tests. No command here launches the installed Production app.
"""
from __future__ import annotations

import datetime
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "evidence/quiescence-integration"
COMMANDS = [
    ["npm", "run", "typecheck"],
    ["npx", "tsc", "--noEmit", "-p", "tsconfig.quiescence.json"],
    ["npm", "test"],
    [sys.executable, "-m", "unittest", "scripts/test_production_v4_release_gate.py", "scripts/test_quiescence_entry_boundary.py", "-v"],
    [sys.executable, "-m", "unittest", "discover", "-s", "scripts", "-p", "test_quiescence_gate.py", "-v"],
    ["env", f"PYTHONPATH={ROOT / 'scripts'}", sys.executable, "-m", "unittest", "-v",
     "test_quiescence_integration.OldFixtureExitProofTests",
     "test_quiescence_integration.ManagedIntegrationTests.test_pending_and_corrupt_attempt_diagnostic_fail_closed",
     "test_quiescence_integration.ManagedIntegrationTests.test_plain_permit_without_managed_receipt_is_never_not_started",
     "test_quiescence_integration.ManagedIntegrationTests.test_partial_state_without_progress_blocks_reexecution",
     "test_quiescence_integration.ManagedIntegrationTests.test_stale_lease_record_never_rebound",
     "test_quiescence_integration.ManagedIntegrationTests.test_corrupt_stale_lease_record_is_not_replaced",
     "test_quiescence_integration.ManagedIntegrationTests.test_recreated_lease_file_never_accepted_by_original_owner"],
    [sys.executable, "-m", "unittest", "discover", "-s", "scripts", "-p", "test_quiescence_integration.py", "-v"],
    ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--lib"],
    ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--features", "quiescence-fixture", "--bin", "quiescence-fixture"],
    ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--features", "quiescence-tauri", "--bin", "quiescence-tauri"],
]


def source_hashes():
    paths = []
    for folder in ["src", "src-tauri/src", "migrations", "scripts", "tests", "quiescence-web", "src-tauri/capabilities"]:
        paths.extend(path for path in (ROOT / folder).rglob("*")
                     if path.is_file() and path.suffix in {".py", ".ts", ".tsx", ".rs", ".sql", ".json", ".html"}
                     and "__pycache__" not in path.parts)
    paths.extend(ROOT / name for name in ["src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/build.rs", "package.json"])
    paths.extend((ROOT / "src-tauri").glob("tauri*.json"))
    paths.extend(ROOT.glob("*quiescence*.ts"))
    paths.extend(ROOT.glob("*quiescence*.json"))
    paths.extend(ROOT.glob("*quiescence*.html"))
    return {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(set(paths))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--launch-boundary-blocked", action="store_true",
                        help="Preserve the known OS launch stop: do not rerun managed runtime fixtures; mark required coverage BLOCKED, not PASS.")
    args = parser.parse_args()
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    before = source_hashes()
    results = []
    for command in COMMANDS:
        if args.launch_boundary_blocked and "test_quiescence_integration.py" in command:
            item = {"command": command, "exit_code": None, "status": "BLOCKED_NOT_RUN",
                    "reason": "AMFI/Gatekeeper launch refusal; evidence-based corrected launch also failed; no further runtime retry authorized by this run mode.",
                    "stdout": "", "stderr": ""}
            results.append(item)
            print(json.dumps({"command": command, "status": item["status"]}), flush=True)
            continue
        try:
            result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=300)
            item = {"command": command, "exit_code": result.returncode, "stdout": result.stdout, "stderr": result.stderr}
        except subprocess.TimeoutExpired as error:
            item = {"command": command, "exit_code": None, "timed_out": True,
                    "stdout": str(error.stdout), "stderr": str(error.stderr)}
        results.append(item)
        print(json.dumps({"command": command, "exit_code": item["exit_code"]}), flush=True)
    after = source_hashes()
    drift = sorted(name for name in before.keys() | after.keys() if before.get(name) != after.get(name))
    blocked = [item for item in results if item.get("status") == "BLOCKED_NOT_RUN"]
    failed = [item for item in results if item.get("status") != "BLOCKED_NOT_RUN" and item["exit_code"] != 0]
    evidence = {"format_version": 1, "synthetic_only": True, "started_at": started,
                "finished_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "production_launched": False, "real_ipc_test_included": False,
                "source_hashes_before": before, "source_hashes_after": after,
                "source_drift_during_run": drift, "results": results,
                "completed_regressions_passed": not drift and not failed,
                "all_required_suites_executed": not blocked,
                "status": "FAILED" if drift or failed else "BLOCKED" if blocked else "PASS",
                "passed": not drift and not failed and not blocked}
    OUTPUT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    target = OUTPUT / f"regressions-{stamp}.json"
    with target.open("x") as stream:
        json.dump(evidence, stream, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    print(json.dumps({"evidence": str(target), "passed": evidence["passed"], "source_drift": drift}), flush=True)
    return 0 if evidence["passed"] else 2 if evidence["status"] == "BLOCKED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
