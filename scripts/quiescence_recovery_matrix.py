#!/usr/bin/env python3
"""Retained, signed synthetic native recovery E2E. CLI evidence, never Q11."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import time
import uuid

from quiescence_gate import MaintenanceLease
from quiescence_integration import create_fixture, prepare_managed, handoff_native

REPO = Path(__file__).resolve().parents[1]
DB = "personal-finance-console.sqlite3"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(value, indent=2, ensure_ascii=False) + "\n"
    with path.open("w") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def protected(root):
    names = ["consumed.json", "permit.claimed.json", "outcome.json", DB, "backup.sqlite3"]
    names += [p.name for p in root.glob("native-state-*.json")]
    return {name: sha(root / name) for name in sorted(names)}


def record_facts(root):
    return {str(p.relative_to(root)): sha(p) for p in sorted(root.iterdir())
            if p.is_file() and (p.name.startswith("recovery-") or p.name in {DB, "outcome.json", "consumed.json"})}


def authorize(context, action="verify-v4-handoff", authorization_id=None, nonce=None):
    root = Path(context["root"])
    p = json.loads((root / "consumed.json").read_text())
    value = {"format_version": 2, "synthetic_only": True, "scope": "synthetic-recovery-handoff-only",
        "authorization_id": authorization_id or "synthetic-recovery-" + uuid.uuid4().hex,
        "session": p["session"], "nonce": nonce or uuid.uuid4().hex,
        "managed_contract_sha256": p["managed_contract_sha256"],
        "consumed_sha256": sha(root / "consumed.json"), "outcome_sha256": sha(root / "outcome.json"),
        "action": action, "expected_database_sha256": sha(root / DB)}
    target = root / "recovery-authorization.json"
    if target.exists():
        previous = root / ("retained-authorization-" + uuid.uuid4().hex + ".json")
        previous.write_bytes(target.read_bytes())
    save(target, value)
    return value


def invoke(context, name, failpoint="", expect=None):
    root = Path(context["root"])
    before = protected(root)
    env = os.environ.copy()
    env["PFC_Q_FAIL"] = failpoint
    command = [context["installed_executable"], "recover-integrated", str(root)]
    result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=45)
    rows = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    last = rows[-1] if rows else None
    entry = {"name": name, "command": command, "returncode": result.returncode,
        "stdout": result.stdout, "stderr": result.stderr, "rows": rows,
        "protected_before": before, "protected_after": protected(root), "saved_records": record_facts(root)}
    save(root / ("matrix-" + name + ".json"), entry)
    require(entry["protected_before"] == entry["protected_after"], name + ": recovery mutated DB/permit/original native receipts")
    if expect:
        observed = (last or {}).get("error", {}).get("code")
        require(result.returncode != 0 and observed in expect, f"{name}: expected {expect}; observed {last}")
    else:
        require(result.returncode == 0 and last and last.get("state") in {"V4_VERIFIED", "FAILED_V3_CONFIRMED"}, f"{name}: {last}; {result.stderr}")
        require(json.loads((root / "recovery-result.json").read_text()) == last, "returned terminal differs from persisted bytes")
    return entry


def setup(base, native, signing, name, v3=False):
    fixture = create_fixture(base, native, "recovery-" + name, signing_identity=signing)
    root = Path(fixture["root"])
    with MaintenanceLease(root, fixture["session"]) as lease:
        context = prepare_managed(root, lease)
        with (root / "matrix-migration.stdout").open("w") as output, (root / "matrix-migration.stderr").open("w") as error:
            child = lease.launch_native(Path(context["installed_executable"]), context["native_sha256"],
                arguments=["run-integrated", str(root)], extra_env={"PFC_Q_FAIL": "constraint" if v3 else ""},
                stdin=subprocess.DEVNULL, stdout=output, stderr=error)
            try:
                handoff = handoff_native(lease, child, context)
                child.wait(timeout=60)
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=5)
        outcome = json.loads((root / "outcome.json").read_text())
        require(outcome["state"] == ("FAILED_V3_CONFIRMED" if v3 else "V4_VERIFIED"), str(outcome))
        require((child.returncode != 0) == v3, "migration returncode inconsistent")
        save(root / "matrix-setup.json", {"context": context, "handoff": handoff, "outcome": outcome, "returncode": child.returncode})
    authorize(context, "verify-v3-terminal" if v3 else "verify-v4-handoff")
    return context


def case(base, native, signing, name):
    context = setup(base, native, signing, name, v3=name == "v3-terminal")
    root = Path(context["root"])
    evidence = []
    if name in {"v4-success-confirm", "v3-terminal"}:
        evidence.append(invoke(context, "initial"))
        before = record_facts(root)
        evidence.append(invoke(context, "readonly-confirm"))
        require(record_facts(root) == before, "confirmation wrote recovery evidence")
    elif name == "busy-new-authorization":
        authority = json.loads((root / "recovery-authorization.json").read_text())
        c = sqlite3.connect(root / DB, timeout=0)
        c.execute("BEGIN EXCLUSIVE")
        try:
            evidence.append(invoke(context, "sqlite-busy", expect={"SQLITE_ERROR"}))
            require(evidence[-1]["rows"][-1]["error"]["sqlite_primary"] == 5, "failure was not SQLITE_BUSY")
        finally:
            c.rollback()
            c.close()
        evidence.append(invoke(context, "same-authority-replay", expect={"RECOVERY_AUTHORIZATION_REPLAY"}))
        authorize(context, authorization_id=authority["authorization_id"])
        evidence.append(invoke(context, "same-id-replay", expect={"RECOVERY_AUTHORIZATION_REPLAY"}))
        authorize(context, nonce=authority["nonce"])
        evidence.append(invoke(context, "same-nonce-replay", expect={"RECOVERY_AUTHORIZATION_REPLAY"}))
        authorize(context)
        fd = os.open(root / "maintenance.lock", os.O_RDWR)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            evidence.append(invoke(context, "real-lease-contention", expect={"RECOVERY_LEASE_BUSY"}))
        finally:
            os.close(fd)
        authorize(context)
        evidence.append(invoke(context, "distinct-authority-succeeds"))
        history = [json.loads(line) for line in (root / "recovery-history.jsonl").read_text().splitlines()]
        require(sum(r["record_type"] == "FAILED" for r in history) == 2, "failed authorizations lost")
    elif name == "before-terminal":
        evidence.append(invoke(context, "before-terminal-fault", "recovery_before_terminal", {"INJECTED_RECOVERY_FAILURE"}))
        require(not (root / "recovery-result.json").exists() and not (root / "recovery-active.json").exists(), "failed terminal retained active owner")
        evidence.append(invoke(context, "consumed-replay", expect={"RECOVERY_AUTHORIZATION_REPLAY"}))
        authorize(context)
        evidence.append(invoke(context, "new-authority-succeeds"))
    elif name == "after-terminal":
        evidence.append(invoke(context, "after-terminal-fault", "recovery_after_terminal", {"INJECTED_RECOVERY_OUTCOME_UNKNOWN"}))
        require((root / "recovery-result.json").exists() and (root / "recovery-active.json").exists(), "unknown terminal evidence absent")
        before = record_facts(root)
        evidence.append(invoke(context, "same-authority-readonly-confirm"))
        require(record_facts(root) == before, "lost-reply confirmation wrote records")
    else:
        evidence.append(invoke(context, "initial"))
        if name == "ledger-missing":
            (root / "recovery-history.jsonl").rename(root / "retained-original-history.jsonl")
            codes = {"RECOVERY_TERMINAL_BINDING_MISMATCH"}
        elif name == "ledger-corrupt":
            (root / "recovery-history.jsonl").rename(root / "retained-original-history.jsonl")
            (root / "recovery-history.jsonl").write_text("{broken}\n")
            codes = {"RECOVERY_HISTORY_CORRUPT"}
        elif name == "pending":
            (root / "recovery-result.json.pending").write_text("{}\n")
            codes = {"RECOVERY_HISTORY_PENDING"}
        elif name == "candidate-changed":
            contract = json.loads((root / "managed-contract.json").read_text())
            candidate = Path(next(b["executable"] for b in contract["bundles"] if b["role"] == "candidate"))
            with candidate.open("ab") as stream:
                stream.write(b"SYNTHETIC-CANDIDATE-DRIFT")
            codes = {"MANAGED_OBJECT_DRIFT"}
        elif name == "database-changed":
            with sqlite3.connect(root / DB) as c:
                c.execute("INSERT OR REPLACE INTO app_metadata(key,value) VALUES('matrix-change','synthetic')")
            codes = {"RECOVERY_DATABASE_HASH_MISMATCH"}
        else:
            raise AssertionError(name)
        evidence.append(invoke(context, "confirmation-rejected", expect=codes))
    return {"name": name, "root": str(root), "passed": True, "invocations": evidence,
            "final_records": record_facts(root)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--native", type=Path, default=REPO / "src-tauri/target/debug/quiescence-fixture")
    parser.add_argument("--signing-identity", default=os.environ.get("APPLE_SIGNING_IDENTITY"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    require(not args.output.exists(), "refuse to overwrite an existing matrix report")
    native = args.native.resolve(strict=True)
    base = Path(tempfile.mkdtemp(prefix="pfc-takeover-recovery-")).resolve()
    sources = [Path(__file__), REPO / "src-tauri/src/quiescence_recovery.rs", REPO / "src-tauri/src/cutover_startup.rs"]
    report = {"format_version": 1, "synthetic_only": True, "transport": "native-cli-NOT-Q11",
        "retained_root": str(base), "native": str(native), "native_sha256": sha(native),
        "sources_before": {str(path): sha(path) for path in sources}, "cases": [], "status": "RUNNING"}
    save(args.output, report)
    cases = ["v4-success-confirm", "v3-terminal", "busy-new-authorization", "before-terminal", "after-terminal",
             "ledger-missing", "ledger-corrupt", "pending", "candidate-changed", "database-changed"]
    for name in cases:
        try:
            report["cases"].append(case(base, native, args.signing_identity, name))
        except Exception as error:
            report["cases"].append({"name": name, "passed": False, "error": repr(error)})
            report["status"] = "FAILED"
            report["sources_after"] = {str(path): sha(path) for path in sources}
            save(args.output, report)
            print(json.dumps({"status": "FAILED", "case": name, "error": repr(error), "report": str(args.output), "retained_root": str(base)}), flush=True)
            return 2
        save(args.output, report)
        print(json.dumps({"case": name, "passed": True, "root": report["cases"][-1]["root"]}), flush=True)
    report["sources_after"] = {str(path): sha(path) for path in sources}
    report["source_drift"] = report["sources_before"] != report["sources_after"]
    report["status"] = "PASS" if not report["source_drift"] else "FAILED_SOURCE_DRIFT"
    save(args.output, report)
    print(json.dumps({"status": report["status"], "report": str(args.output), "cases": len(cases)}))
    return 0 if report["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
