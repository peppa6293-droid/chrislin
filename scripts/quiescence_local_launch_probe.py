#!/usr/bin/env python3
"""Launch the verified isolated Q11 app once through macOS LaunchServices."""
from __future__ import annotations

import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
import time
import uuid

REPO = Path(__file__).resolve().parents[1]
EXPECTED_IDENTITY = "Apple Development: 8619814730147 (FW5KHTFNZ6)"


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def rows(path: Path, *, final=False):
    if not path.exists():
        return []
    raw = path.read_bytes()
    if final and raw and not raw.endswith(b"\n"):
        raise ValueError("RUNTIME_LOG_TRUNCATED")
    parsed = [json.loads(line) for line in raw[:raw.rfind(b"\n") + 1].splitlines()]
    if any(not isinstance(row, dict) or not isinstance(row.get("event"), str)
           or not isinstance(row.get("detail"), dict) for row in parsed):
        raise ValueError("RUNTIME_LOG_RECORD_INVALID")
    if any(row["event"] in ("frontend_evidence", "frontend_complete")
           and not isinstance(row["detail"].get("value"), dict) for row in parsed):
        raise ValueError("RUNTIME_LOG_VALUE_INVALID")
    return parsed


def validate_readiness(events, *, root, session, executable, launcher_exit,
                       timed_out, controller_terminated, process_command,
                       app_data_before, app_data_after, synthetic_database_created,
                       journal_error=None):
    """Validate the complete journal, not merely the frontend-loaded milestone.

    Session/root are present in native entry/boot records. Other events bind via
    one PID and contiguous journal sequence; IPC records attest authenticated
    session/token checks, but do not contain the credentials themselves.
    """
    def need(condition, reason):
        if not condition:
            raise ValueError(reason)

    try:
        need(not journal_error, "RUNTIME_LOG_CORRUPT")
        need(timed_out is False and controller_terminated is False, "CONTROLLER_TIMEOUT_OR_TERMINATION")
        need(type(launcher_exit) is int and launcher_exit == 0, "LAUNCHER_NOT_SUCCESSFUL")
        need(process_command == str(executable), "PROCESS_EXECUTABLE_MISMATCH")
        need(app_data_before == app_data_after, "APP_DATA_BEFORE_AFTER_CHANGED")
        need(synthetic_database_created is False, "SYNTHETIC_DATABASE_PRESENT")
        need(isinstance(events, list) and bool(events), "RUNTIME_LOG_MISSING")
        expected = ["native_entry_validated", "native_runtime_boot", "frontend_bootstrap",
                    "ipc_invocation", "frontend_evidence", "ipc_invocation",
                    "frontend_complete", "real_app_exit_event"]
        # Readiness has no migration, assertion loop, or other IPC traffic.
        # Any added/replayed/failed/unrecognised event requires explicit review.
        need([row.get("event") for row in events] == expected, "READINESS_EVENT_ORDER_OR_SET_INVALID")
        pid = events[0]["pid"]
        need(type(pid) is int and pid > 0, "PID_INVALID")
        last_time = -1
        for index, row in enumerate(events, 1):
            need(row.get("format_version") == 1 and row.get("transport") == "tauri-wry-ipc", "JOURNAL_FORMAT_INVALID")
            need(type(row.get("sequence")) is int and row["sequence"] == index, "JOURNAL_SEQUENCE_INVALID")
            need(type(row.get("pid")) is int and row["pid"] == pid, "JOURNAL_PID_MISMATCH")
            need(type(row.get("at_unix_ms")) is int and row["at_unix_ms"] >= last_time, "JOURNAL_TIME_INVALID")
            last_time = row["at_unix_ms"]
            need(isinstance(row.get("detail"), dict), "JOURNAL_DETAIL_INVALID")
        entry, boot, bootstrap, invoke_loaded, loaded, invoke_finish, complete, exit_event = [row["detail"] for row in events]
        need(entry.get("session") == session and entry.get("root") == str(root)
             and entry.get("actual_executable") == str(executable)
             and entry.get("before_diagnostic") is True and entry.get("before_tauri_builder") is True, "ENTRY_BINDING_MISMATCH")
        need(boot.get("session") == session and boot.get("app_data_dir") == str(root)
             and boot.get("actual_executable") == str(executable)
             and boot.get("production_setup_called") is False, "BOOT_BINDING_MISMATCH")
        app_id = "org.pfc.quiescence.integration"
        need(boot.get("app_identifier") == app_id and boot.get("actual_bundle_identifier") == app_id
             and bootstrap.get("app_identifier") == app_id, "APP_IDENTIFIER_MISMATCH")
        for detail in (boot, bootstrap, loaded, complete, complete.get("value", {})):
            need(detail.get("scenario") == "readiness" and detail.get("phase") == "initial", "SCENARIO_PHASE_MISMATCH")
        requests = set()
        for invocation, command in ((invoke_loaded, "record_frontend_evidence"), (invoke_finish, "finish_frontend")):
            request = invocation.get("request_id")
            need(invocation.get("command") == command and invocation.get("authenticated") is True
                 and "rejected_code" in invocation and invocation["rejected_code"] is None
                 and isinstance(request, str) and request.startswith("initial-") and 0 < len(request) <= 160
                 and request not in requests, "IPC_AUTHENTICATION_OR_REQUEST_INVALID")
            requests.add(request)
        value = loaded["value"]
        need(value.get("kind") == "frontend_loaded" and value.get("source") == "bundled_typescript"
             and value.get("app_identifier") == app_id, "FRONTEND_LOADED_INVALID")
        value = complete["value"]
        need(value.get("passed") is True and value.get("readiness_only") is True
             and value.get("actual_transport") == "@tauri-apps/api/core.invoke"
             and type(value.get("assertions")) is int and value["assertions"] == 0, "FRONTEND_COMPLETION_FAILED")
        native = complete["native"]
        need(native.get("started") is False and native.get("running") is False
             and native.get("disconnected") is False and "error" in native and native["error"] is None,
             "NATIVE_COMPLETION_FAILED")
        need(type(exit_event.get("code")) is int and exit_event["code"] == 0
             and exit_event.get("prevented") is False
             and exit_event.get("source") == "Tauri.RunEvent.ExitRequested", "APP_EXIT_NOT_NORMAL")
        return {"passed": True, "reason": "COMPLETE_BOUND_READINESS", "pid": pid}
    except (ValueError, KeyError, TypeError, AttributeError) as error:
        return {"passed": False, "reason": str(error)}


def app_data_facts():
    directory = Path.home() / "Library/Application Support/org.pfc.quiescence.integration"
    facts = {}
    for path in (directory, directory / "personal-finance-console.sqlite3"):
        if path.exists():
            meta = path.stat()
            facts[str(path)] = {"exists": True, "inode": meta.st_ino, "dev": meta.st_dev,
                               "size": meta.st_size, "mtime_ns": meta.st_mtime_ns, "ctime_ns": meta.st_ctime_ns,
                               "sha256": sha(path) if path.is_file() else None}
        else:
            facts[str(path)] = {"exists": False}
    return facts


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    bundle = args.bundle.resolve(strict=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    evidence_dir = REPO / "evidence/quiescence-integration" / f"local-launch-{stamp}"
    evidence_dir.mkdir(parents=True, exist_ok=False)
    output = args.output or evidence_dir / "launch-receipt.json"
    info_path = bundle / "Contents/Info.plist"
    plist = plistlib.loads(info_path.read_bytes())
    executable = bundle / "Contents/MacOS" / plist["CFBundleExecutable"]
    expected_executable_hash = sha(executable)
    manifest_path = bundle / "Contents/Resources/runtime-compatibility.json"
    manifest = json.loads(manifest_path.read_text())
    identity = subprocess.run(["codesign", "-dv", "--verbose=4", str(bundle)], capture_output=True, text=True)
    details = identity.stderr
    if identity.returncode or EXPECTED_IDENTITY not in details or "TeamIdentifier=SSRKA7A4TN" not in details:
        raise RuntimeError("verified development signing identity no longer matches the approved profile")
    attrs = subprocess.run(["xattr", "-lr", str(bundle)], capture_output=True, text=True)
    if "com.apple.quarantine:" in attrs.stdout:
        raise RuntimeError("UNEXPECTED_LOCAL_BUILD_QUARANTINE")

    root = Path(tempfile.mkdtemp(prefix="pfc-qic-local-launch-")).resolve()
    app = root / "managed/install/Isolated Quiescence.app"
    app.parent.mkdir(parents=True)
    shutil.copytree(bundle, app, copy_function=shutil.copy2)
    installed_executable = app / "Contents/MacOS" / plist["CFBundleExecutable"]
    if sha(installed_executable) != expected_executable_hash:
        raise RuntimeError("copied isolated app executable hash changed")
    if "com.apple.quarantine:" in subprocess.run(["xattr", "-lr", str(app)], capture_output=True, text=True).stdout:
        raise RuntimeError("UNEXPECTED_LOCAL_BUILD_QUARANTINE on local fixture copy")

    session = "local-launch-" + uuid.uuid4().hex
    (root / "SYNTHETIC_ONLY").write_text("PFC_QUIESCENCE_SYNTHETIC_V1\n")
    (root / "permit.json").write_text(json.dumps({"session": session, "executable_path": str(installed_executable)}) + "\n")
    runtime_log = root / "ipc-initial.jsonl"
    stdout_path = evidence_dir / "app.stdout.log"
    stderr_path = evidence_dir / "app.stderr.log"
    launcher_stdout = evidence_dir / "launchservices.stdout.log"
    launcher_stderr = evidence_dir / "launchservices.stderr.log"
    command = ["/usr/bin/open", "-n", "-W", "-a", str(app),
               "--env", f"PFC_IPC_ROOT={root}", "--env", "PFC_IPC_SCENARIO=readiness",
               "--env", "PFC_IPC_PHASE=initial", "--stdout", str(stdout_path),
               "--stderr", str(stderr_path)]
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    before = app_data_facts()
    (evidence_dir / "prelaunch.json").write_text(json.dumps({"app_data": before, "root": str(root),
        "root_entries": sorted(p.name for p in root.iterdir()), "executable_sha256": expected_executable_hash}, indent=2))
    with launcher_stdout.open("w") as out, launcher_stderr.open("w") as err:
        process = subprocess.Popen(command, cwd=REPO, stdout=out, stderr=err, text=True)
        deadline = time.monotonic() + 45
        runtime_rows = []
        journal_error = None
        timed_out = False
        controller_terminated = False
        while time.monotonic() < deadline:
            try:
                runtime_rows = rows(runtime_log)
            except (ValueError, OSError) as error:
                journal_error = str(error)
                break
            if any(row.get("event") == "frontend_evidence" and row.get("detail", {}).get("value", {}).get("kind") == "frontend_loaded" for row in runtime_rows):
                break
            if process.poll() is not None:
                break
            time.sleep(0.05)
        if time.monotonic() >= deadline:
            timed_out = True
        readiness = next((row for row in runtime_rows if row.get("event") == "frontend_evidence" and
                          row.get("detail", {}).get("value", {}).get("kind") == "frontend_loaded"), None)
        boot = next((row for row in runtime_rows if row.get("event") == "native_runtime_boot"), None)
        pid = boot.get("pid") if boot else None
        if type(pid) is not int or pid <= 0:
            pid = None
        process_command = None
        raw_lsof = None
        if pid:
            ps = subprocess.run(["/bin/ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True)
            process_command = ps.stdout.strip()
            raw_lsof = subprocess.run(["/usr/sbin/lsof", "-nP", "-p", str(pid)], capture_output=True, text=True).stdout
        try:
            launcher_exit = process.wait(timeout=max(1, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            timed_out = True
            controller_terminated = True
            if pid and process_command == str(installed_executable):
                subprocess.run(["/bin/kill", "-TERM", str(pid)], capture_output=True, text=True)
            try:
                launcher_exit = process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                launcher_exit = process.wait(timeout=5)
    try:
        runtime_rows = rows(runtime_log, final=True)
    except (ValueError, OSError) as error:
        journal_error = str(error)
    after = app_data_facts()
    verdict = validate_readiness(runtime_rows, root=root, session=session, executable=installed_executable,
        launcher_exit=launcher_exit, timed_out=timed_out, controller_terminated=controller_terminated,
        process_command=process_command, app_data_before=before, app_data_after=after,
        synthetic_database_created=(root / "personal-finance-console.sqlite3").exists(), journal_error=journal_error)
    failure_logs = None
    if not verdict["passed"]:
        logs = subprocess.run(["/usr/bin/log", "show", "--last", "5m", "--style", "compact",
                              "--predicate", 'process == "syspolicyd" OR process == "amfid"'],
                             capture_output=True, text=True, timeout=20)
        failure_logs = {"exit_code": logs.returncode, "stdout": logs.stdout[-60000:], "stderr": logs.stderr[-10000:]}
    receipt = {
        "format_version": 1, "synthetic_only": True, "launch_path": "macOS LaunchServices via /usr/bin/open -n -W -a <.app>",
        "started_at": started, "finished_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "command": command, "launcher_pid": process.pid, "launcher_exit_code": launcher_exit,
        "timed_out": timed_out, "controller_terminated": controller_terminated,
        "readiness_validation": verdict, "journal_error": journal_error,
        "bundle_path": str(bundle), "fixture_bundle_path": str(app), "bundle_id": plist["CFBundleIdentifier"],
        "cf_bundle_executable": plist["CFBundleExecutable"], "executable_path": str(installed_executable),
        "executable_sha256": expected_executable_hash, "team_identifier": "SSRKA7A4TN",
        "signing_identity": EXPECTED_IDENTITY, "manifest_bundle_id": manifest.get("bundleId"),
        "manifest_executable": manifest.get("executable"), "session": session, "pid": pid,
        "process_command": process_command, "native_runtime_boot": boot, "readiness_handshake": readiness,
        "app_data_before": before, "app_data_after": after, "app_data_unchanged": before == after,
        "app_data_observation_scope": "before/after persisted-state comparison only; not continuous zero-I/O evidence",
        "raw_lsof": raw_lsof, "synthetic_database_created": (root / "personal-finance-console.sqlite3").exists(),
        "runtime_events": runtime_rows, "runtime_log": str(runtime_log), "stdout_path": str(stdout_path),
        "stderr_path": str(stderr_path), "launchservices_stdout": launcher_stdout.read_text(),
        "launchservices_stderr": launcher_stderr.read_text(), "quarantine": False,
        "gatekeeper_assessment_is_diagnostic_only_for_approved_profile": True,
        "system_launch_logs_on_failure": failure_logs,
        "status": "PASS" if verdict["passed"] else "BLOCKED_LOCAL_APP_LAUNCH",
    }
    output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": receipt["status"], "pid": pid, "session": session,
                      "evidence": str(output), "runtime_log": str(runtime_log)}, ensure_ascii=False))
    return 0 if receipt["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
