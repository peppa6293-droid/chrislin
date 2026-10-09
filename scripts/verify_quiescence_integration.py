"""Independent saved-evidence readback. Synthetic roots only, no DB writes.

Unresolved/crashed fixtures are not opened with SQLite. Successful and confirmed
rollback fixtures are read using immutable read-only connections after their
recorded app processes have exited. This is not the later independent re-audit.
"""
from __future__ import annotations
import argparse
from contextlib import closing
import datetime
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASELINE = "ed412cb4f14e6f1336b8e4ade27336897a55a9da"
DB = "personal-finance-console.sqlite3"


def digest(path):
    metadata = path.lstat()
    assert stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1, str(path)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def json_file(path):
    digest(path)
    return json.loads(path.read_bytes())


def synthetic_root(raw):
    root = Path(raw)
    temporary = Path(tempfile.gettempdir()).resolve()
    assert root == root.resolve(strict=True) and root != temporary and root.is_relative_to(temporary)
    assert "com.personalfinance.console" not in str(root)
    digest(root / "SYNTHETIC_ONLY")
    assert (root / "SYNTHETIC_ONLY").read_bytes() == b"PFC_QUIESCENCE_SYNTHETIC_V1\n"
    return root


def snapshot(path):
    before = digest(path)
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)) as connection:
        connection.execute("PRAGMA query_only=ON")
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        versions = [row[0] for row in connection.execute("SELECT version FROM schema_migrations ORDER BY version")]
        schema = [dict(zip(("type", "name", "tbl_name", "sql"), row)) for row in connection.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name")]
        assert connection.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        legacy = {}
        for table in json_file(ROOT / "migrations/v3-schema.json"):
            name = table["name"]
            if table["type"] != "table" or name in {"schema_migrations", "sqlite_sequence"}:
                continue
            rows = connection.execute('SELECT * FROM "' + name.replace('"', '""') + '"').fetchall()
            legacy[name] = sorted(repr(row) for row in rows)
    assert digest(path) == before, "read-only readback changed file"
    assert versions == list(range(1, version + 1))
    assert schema == json_file(ROOT / f"migrations/v{version}-schema.json")
    return {"version": version, "versions": versions, "sha256": before,
            "integrity": "ok", "foreign_key_violations": 0, "legacy_rows": legacy}


def load_logs(root):
    logs = []
    files = sorted(root.glob("ipc-*.jsonl"))
    assert files, "missing real IPC journal"
    for path in files:
        digest(path)
        events = [json.loads(line) for line in path.read_text().splitlines() if line]
        assert events and [e["sequence"] for e in events] == list(range(1, len(events) + 1))
        assert all(e["transport"] == "tauri-wry-ipc" for e in events)
        boot = next(e for e in events if e["event"] == "native_runtime_boot")
        assert boot["detail"]["app_identifier"] == "org.pfc.quiescence.integration"
        assert boot["detail"]["app_data_dir"] == str(root)
        try:
            os.kill(boot["pid"], 0)
        except ProcessLookupError:
            pass
        else:
            raise AssertionError("recorded isolated app PID still active; do not open DB")
        invocations = {(e["detail"]["command"], e["detail"]["request_id"])
                       for e in events if e["event"] == "ipc_invocation"}
        for event in events:
            if event["event"] != "frontend_evidence":
                continue
            value = event["detail"]["value"]
            assert value.get("kind") != "fatal_frontend_failure", value
            if value.get("kind") == "assertion":
                assert value["passed"] is True and value["source"] == "executing_bundled_typescript", value
            if value.get("kind") == "invoke_result":
                assert (value["command"], value["requestId"]) in invocations, value
        logs.extend(events)
    return files, logs


def verify_case(case):
    root = synthetic_root(case["root"])
    files, logs = load_logs(root)
    outcome = json_file(root / "outcome.json")
    consumed = json_file(root / "consumed.json")
    assert consumed == json_file(root / "permit.claimed.json")
    contract = json_file(root / "managed-contract.json")
    assert digest(root / "managed-contract.json") == consumed["managed_contract_sha256"]
    assert digest(root / "authorization.json") == consumed["authorization_sha256"]
    for key in ["session", "nonce", "authorization_id"]:
        assert outcome[key] == consumed[key] == contract[key]
    previous = None
    receipts = sorted(root.glob("native-state-*.json"))
    assert len(receipts) == outcome["sequence"] + 1
    for sequence, path in enumerate(receipts):
        record = json_file(path)
        assert record["sequence"] == sequence
        assert record["previous_record_sha256"] == previous
        previous = digest(path)
    assert json_file(receipts[-1]) == outcome
    enabled = [Path(o["path"]) for o in contract["objects"] if o["kind"] == "file" and Path(o["path"]).stat().st_mode & 0o111]
    assert enabled == [Path(consumed["executable_path"])], enabled
    assert digest(Path(consumed["executable_path"])) == consumed["executable_sha256"]
    for role in ["candidate", "staging", "archive"]:
        bundle = next(b for b in contract["bundles"] if b["role"] == role)
        assert not any(p.stat().st_mode & 0o111 for p in Path(bundle["path"]).rglob("*") if p.is_file())
    state = outcome["state"]
    db = {"opened": False, "reason": "unresolved state preserved; no schema-only inference", "raw_sha256": digest(root / DB)}
    if state in {"V4_VERIFIED", "FAILED_V3_CONFIRMED"}:
        assert not any((root / (DB + suffix)).exists() for suffix in ["-wal", "-shm", "-journal"])
        actual = snapshot(root / DB)
        backup = snapshot(root / "backup.sqlite3")
        assert actual["legacy_rows"] == backup["legacy_rows"], "legacy business rows changed"
        assert actual["version"] == (4 if state == "V4_VERIFIED" else 3)
        db = {"opened": True, "immutable_read_only": True, "unchanged_legacy_business_rows": True,
              **{key: value for key, value in actual.items() if key != "legacy_rows"}}
    if case["scenario"] == "normal":
        phases = [json_file(p)["phase"] for p in receipts]
        assert sorted(set(phases)) == list(range(11))
        assert all(next_phase in {phase, phase + 1} for phase, next_phase in zip(phases, phases[1:]))
        for event in ["real_window_close_requested", "real_app_exit_event"]:
            assert any(e["event"] == event and e["detail"]["prevented"] is True for e in logs)
        recovery = json_file(root / "recovery-result.json")
        assert recovery["state"] == "V4_VERIFIED" and recovery["handoff_authorized"] is True
        assert recovery["database_sha256"] == digest(root / DB)
        assert any(e["event"] == "business_connection_closed" for e in logs)
    return {"scenario": case["scenario"], "root": str(root), "outcome_state": state,
            "ipc_log_hashes": {p.name: digest(p) for p in files}, "native_receipts": len(receipts), "database": db}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ipc-report", required=True, type=Path)
    parser.add_argument("--regressions", required=True, type=Path)
    parser.add_argument("--blocked-delivery", action="store_true",
                        help="Verify and preserve failed runtime attempts without relabelling them PASS or opening their DBs.")
    args = parser.parse_args()
    ipc = json_file(args.ipc_report.resolve())
    regressions = json_file(args.regressions.resolve())
    assert regressions["completed_regressions_passed"] is True and not regressions["source_drift_during_run"]
    if not args.blocked_delivery:
        assert regressions["passed"] is True
    for name, expected in regressions["source_hashes_after"].items():
        assert digest(ROOT / name) == expected, "source changed after regressions: " + name
    protected = ["V012_V4_CUTOVER_QUIESCENCE_IMPLEMENTATION_REPORT.md", "V012_V4_CUTOVER_QUIESCENCE_SQLITE_EXPERIMENT_REPORT.md",
                 "src/persistence/migrations.ts", "migrations/004.sql"]
    for name in protected:
        original = subprocess.check_output(["git", "show", f"{BASELINE}:{name}"], cwd=ROOT)
        assert original == (ROOT / name).read_bytes(), "historical/source claim modified: " + name
    if args.blocked_delivery:
        assert ipc["status"] in {"FAIL", "FAILED", "BLOCKED"}
        cases = []
        for case in ipc["cases"]:
            root = synthetic_root(case["root"])
            permit = json_file(root / "permit.json")
            database_hash, backup_hash = digest(root / DB), digest(root / "backup.sqlite3")
            assert database_hash == backup_hash == permit["database_sha256"]
            assert not any((root / name).exists() for name in ["native-launch.json", "permit.claimed.json", "consumed.json", "outcome.json"])
            exit_path = root / "managed-state-S1_TARGET_EXIT_VERIFIED.json"
            observations = json_file(exit_path)["details"]["observations"] if exit_path.exists() else []
            cases.append({"scenario": case["scenario"], "root": str(root), "acceptance": "BLOCKED_NOT_VERIFIED",
                          "database": {"opened": False, "raw_sha256": database_hash, "equals_synthetic_backup_and_permit": True},
                          "native_claim_or_outcome_present": False, "old_process_exit_observations": observations,
                          "old_runtime_readiness_proven": False,
                          "ipc_log_hashes": {p.name: digest(p) for p in root.glob("ipc-*.log")}})
    else:
        expected_cases = {"normal", "disconnect", "crash_at_quiescence", "crash_before_commit", "guard_lost", "refresh", "disconnect_after_release", "disconnect_postcommit"}
        assert {case["scenario"] for case in ipc["cases"]} == expected_cases
        cases = [verify_case(case) for case in ipc["cases"]]
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output = ROOT / "evidence/quiescence-integration"
    archive = output / f"readback-fixtures-{stamp}.tar.gz"
    with tarfile.open(archive, "x:gz") as bundle:
        for case in cases:
            root = Path(case["root"])
            for path in sorted(root.rglob("*")):
                if path.is_file() and (path.suffix in {".json", ".jsonl", ".plist", ".sqlite3", ".log"}
                                      or path.name in {"SYNTHETIC_ONLY", DB + "-journal", DB + "-wal", DB + "-shm"}):
                    digest(path)
                    bundle.add(path, arcname=str(Path(case["scenario"]) / path.relative_to(root)), recursive=False)
    result = {"format_version": 1, "verification": "main-task independent saved-state readback, not future independent re-audit",
              "passed": not args.blocked_delivery, "delivery_status": "BLOCKED" if args.blocked_delivery else "PASS",
              "saved_state_readback_complete": True, "ipc_report_sha256": digest(args.ipc_report.resolve()),
              "regression_sha256": digest(args.regressions.resolve()), "historical_claims_unchanged": protected,
              "cases": cases, "archive": {"path": str(archive.relative_to(ROOT)), "sha256": digest(archive)}}
    target = output / f"main-readback-{stamp}.json"
    with target.open("x") as stream:
        json.dump(result, stream, indent=2); stream.write("\n"); stream.flush(); os.fsync(stream.fileno())
    print(json.dumps({"passed": result["passed"], "saved_state_readback_complete": True,
                      "evidence": str(target), "archive": str(archive)}))


if __name__ == "__main__":
    main()
