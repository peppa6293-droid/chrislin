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


def rows(path: Path):
    if not path.exists():
        return []
    raw = path.read_bytes()
    return [json.loads(line) for line in raw[:raw.rfind(b"\n") + 1].splitlines()]


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
        while time.monotonic() < deadline:
            runtime_rows = rows(runtime_log)
            if any(row.get("event") == "frontend_evidence" and row.get("detail", {}).get("value", {}).get("kind") == "frontend_loaded" for row in runtime_rows):
                break
            if process.poll() is not None:
                break
            time.sleep(0.05)
        readiness = next((row for row in runtime_rows if row.get("event") == "frontend_evidence" and
                          row.get("detail", {}).get("value", {}).get("kind") == "frontend_loaded"), None)
        boot = next((row for row in runtime_rows if row.get("event") == "native_runtime_boot"), None)
        pid = boot.get("pid") if boot else None
        process_command = None
        raw_lsof = None
        if pid:
            ps = subprocess.run(["/bin/ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True)
            process_command = ps.stdout.strip()
            raw_lsof = subprocess.run(["/usr/sbin/lsof", "-nP", "-p", str(pid)], capture_output=True, text=True).stdout
        try:
            launcher_exit = process.wait(timeout=max(1, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            if pid:
                subprocess.run(["/bin/kill", "-TERM", str(pid)], capture_output=True, text=True)
            try:
                launcher_exit = process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                launcher_exit = process.wait(timeout=5)
    runtime_rows = rows(runtime_log)
    after = app_data_facts()
    failure_logs = None
    if not readiness or not boot:
        logs = subprocess.run(["/usr/bin/log", "show", "--last", "5m", "--style", "compact",
                              "--predicate", 'process == "syspolicyd" OR process == "amfid"'],
                             capture_output=True, text=True, timeout=20)
        failure_logs = {"exit_code": logs.returncode, "stdout": logs.stdout[-60000:], "stderr": logs.stderr[-10000:]}
    receipt = {
        "format_version": 1, "synthetic_only": True, "launch_path": "macOS LaunchServices via /usr/bin/open -n -W -a <.app>",
        "started_at": started, "finished_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "command": command, "launcher_pid": process.pid, "launcher_exit_code": launcher_exit,
        "bundle_path": str(bundle), "fixture_bundle_path": str(app), "bundle_id": plist["CFBundleIdentifier"],
        "cf_bundle_executable": plist["CFBundleExecutable"], "executable_path": str(installed_executable),
        "executable_sha256": expected_executable_hash, "team_identifier": "SSRKA7A4TN",
        "signing_identity": EXPECTED_IDENTITY, "manifest_bundle_id": manifest.get("bundleId"),
        "manifest_executable": manifest.get("executable"), "session": session, "pid": pid,
        "process_command": process_command, "native_runtime_boot": boot, "readiness_handshake": readiness,
        "app_data_before": before, "app_data_after": after, "app_data_unchanged": before == after,
        "raw_lsof": raw_lsof, "synthetic_database_created": (root / "personal-finance-console.sqlite3").exists(),
        "runtime_events": runtime_rows, "runtime_log": str(runtime_log), "stdout_path": str(stdout_path),
        "stderr_path": str(stderr_path), "launchservices_stdout": launcher_stdout.read_text(),
        "launchservices_stderr": launcher_stderr.read_text(), "quarantine": False,
        "gatekeeper_assessment_is_diagnostic_only_for_approved_profile": True,
        "system_launch_logs_on_failure": failure_logs,
        "status": "PASS" if boot and readiness and boot.get("pid") == readiness.get("pid") and
                  boot.get("detail", {}).get("session") == session and
                  Path(process_command or "").name == plist["CFBundleExecutable"] and launcher_exit == 0 and before == after
                  and not (root / "personal-finance-console.sqlite3").exists()
                  else "BLOCKED_LOCAL_APP_LAUNCH",
    }
    output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": receipt["status"], "pid": pid, "session": session,
                      "evidence": str(output), "runtime_log": str(runtime_log)}, ensure_ascii=False))
    return 0 if receipt["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
