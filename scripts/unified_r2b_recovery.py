"""Read-only diagnostic for the unified R2B synthetic cutover chain.

This module never repairs a root, consumes a permit, reruns Migration 4, or
restores a backup. Production is deliberately not a supported execution domain.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import plistlib
import sqlite3
import stat
import time
from typing import Any
from urllib.parse import quote

from production_v4_release_gate import (
    DATABASE_NAME,
    GateBlocked,
    UNIFIED_SYNTHETIC_MARKER,
    _validate_synthetic_gate_root,
)


AUTH_DOMAIN = "UNIFIED_R2B_SYNTHETIC"
AUTH_SCOPE = "READ_ONLY_DIAGNOSTIC"
MAX_JSON_BYTES = 2 * 1024 * 1024
MAX_LINEAGE_BYTES = 8 * 1024 * 1024


def _identity(st: os.stat_result) -> dict[str, int]:
    return {"dev": int(st.st_dev), "inode": int(st.st_ino), "links": int(st.st_nlink), "size": int(st.st_size)}


def _read_exact(path: Path, label: str, *, limit: int = MAX_JSON_BYTES) -> tuple[bytes, str, dict[str, int]]:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    try:
        fd = os.open(path, flags)
        with os.fdopen(fd, "rb") as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
                raise GateBlocked([f"{label} is not a single-link regular file."])
            data = stream.read(limit + 1)
            after = os.fstat(stream.fileno())
        current = path.lstat()
        ident = lambda x: (x.st_dev, x.st_ino, x.st_size, x.st_nlink, x.st_mtime_ns, x.st_ctime_ns)
        if len(data) > limit or ident(before) != ident(after) or ident(before) != ident(current):
            raise GateBlocked([f"{label} changed during read or exceeds its size limit."])
        return data, hashlib.sha256(data).hexdigest(), _identity(before)
    except GateBlocked:
        raise
    except OSError as error:
        raise GateBlocked([f"{label} is missing or unreadable: {type(error).__name__}: {error}"]) from error


def _json_snapshot(path: Path, label: str) -> tuple[dict[str, Any], bytes, str, dict[str, int]]:
    raw, digest, identity = _read_exact(path, label)
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise GateBlocked([f"{label} is corrupt JSON: {error}"]) from error
    if not isinstance(value, dict):
        raise GateBlocked([f"{label} must be a JSON object."])
    return value, raw, digest, identity


def _jsonl_snapshot(path: Path, label: str) -> tuple[list[dict[str, Any]], str, dict[str, int]]:
    raw, digest, identity = _read_exact(path, label, limit=MAX_LINEAGE_BYTES)
    try:
        rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise GateBlocked([f"{label} is corrupt JSONL: {error}"]) from error
    if not rows or any(not isinstance(row, dict) for row in rows):
        raise GateBlocked([f"{label} is empty or contains non-object records."])
    return rows, digest, identity


def _hash_file(path: Path, label: str) -> tuple[str, dict[str, int]]:
    raw, digest, identity = _read_exact(path, label, limit=max(MAX_LINEAGE_BYTES, 64 * 1024 * 1024))
    return digest, identity


def _inside(root: Path, value: Any, label: str) -> Path:
    if not isinstance(value, str) or not value:
        raise GateBlocked([f"{label} path is missing."])
    path = Path(value)
    try:
        resolved = path.resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, ValueError) as error:
        raise GateBlocked([f"{label} must resolve inside the canonical synthetic root."]) from error
    if path != resolved:
        raise GateBlocked([f"{label} path must be canonical and must not use a symlink."])
    return resolved


def _db_facts(path: Path) -> dict[str, Any]:
    # The root has already been proven to be an explicitly marked synthetic
    # temporary namespace. immutable=1 avoids journal/WAL recovery side effects.
    uri = "file:" + quote(str(path), safe="/") + "?mode=ro&immutable=1"
    try:
        connection = sqlite3.connect(uri, uri=True)
        try:
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            migration_rows: list[int] | None = None
            if "schema_migrations" in tables:
                migration_rows = [int(row[0]) for row in connection.execute("SELECT version FROM schema_migrations ORDER BY version")]
            integrity = [row[0] for row in connection.execute("PRAGMA integrity_check")]
            return {"userVersion": int(version), "migrationRows": migration_rows, "integrity": integrity}
        finally:
            connection.close()
    except sqlite3.Error as error:
        raise GateBlocked([f"Synthetic database read-only inspection failed: {error}"]) from error


def _read_chain(root: Path) -> tuple[dict[str, Any], dict[str, tuple[str, dict[str, int]]]]:
    marker_raw, marker_sha, _ = _read_exact(root / "SYNTHETIC_ONLY", "Synthetic marker")
    if marker_raw != UNIFIED_SYNTHETIC_MARKER:
        raise GateBlocked(["Root is not marked for unified R2B synthetic operations."])

    receipt, _, receipt_sha, _ = _json_snapshot(root / "release-receipt.json", "Release receipt")
    permit, _, permit_sha, _ = _json_snapshot(root / "gate-permit.claimed/permit.json", "Consumed Gate permit")
    ledger, _, ledger_sha, _ = _json_snapshot(root / "consumed-ledger.json", "Consumed ledger")
    approval, _, approval_sha, _ = _json_snapshot(root / "gate-inputs/candidate-approval.json", "Candidate approval")
    migration_auth, _, migration_auth_sha, _ = _json_snapshot(root / "gate-inputs/migration-authorization.json", "Migration authorization")
    c3, _, c3_sha, _ = _json_snapshot(root / "SYNTHETIC_C3_MANAGED_ISOLATED.json", "C3 isolation receipt")
    managed_contract, _, managed_sha, _ = _json_snapshot(root / "managed-contract.json", "Managed contract")
    progress, _, progress_sha, _ = _json_snapshot(root / "managed-progress.json", "Managed progress")

    if receipt.get("syntheticOnly") is not True or receipt.get("status") != "PREFLIGHT_PASS_READY_FOR_SEPARATELY_AUTHORIZED_MIGRATION":
        raise GateBlocked(["Release receipt domain or status is invalid."])
    if receipt.get("releaseReceiptPath") != str(root / "release-receipt.json"):
        raise GateBlocked(["Release receipt path is not the fixed root path."])
    if approval.get("status") != "OWNER_APPROVED_SYNTHETIC_R2B_CANDIDATE" or approval.get("syntheticOnly") is not True:
        raise GateBlocked(["Candidate approval is not a unified synthetic R2B approval."])
    if migration_auth.get("status") != "OWNER_AUTHORIZED_SYNTHETIC_R2B_MIGRATION" or migration_auth.get("syntheticOnly") is not True:
        raise GateBlocked(["Migration authorization is not a unified synthetic R2B authorization."])
    if receipt.get("candidateApprovalSha256") != approval_sha or receipt.get("migrationAuthorizationSha256") != migration_auth_sha:
        raise GateBlocked(["Receipt authorization bytes do not match current exact authorization files."])
    if receipt.get("candidateApprovalId") != approval.get("authorizationId") or receipt.get("ownerAuthorizationId") != migration_auth.get("authorizationId"):
        raise GateBlocked(["Receipt authorization IDs do not match their source documents."])
    if (migration_auth.get("productionDbPreMigrationSha256") != receipt.get("productionDatabasePreMigrationSha256") or
            migration_auth.get("candidateExecutableSha256") != receipt.get("candidateExecutableSha256") or
            migration_auth.get("backupPath") != receipt.get("backupPath")):
        raise GateBlocked(["Migration authorization fields do not match receipt-bound database, candidate, or backup."])

    expected_paths = {
        "database": root / DATABASE_NAME,
        "backup": root / "backup.sqlite3",
        "installed_app": root / "managed/install/Installed.app",
        "candidate_app": root / "managed/candidate/Candidate.app",
    }
    db_path = _inside(root, receipt.get("productionDatabasePath"), "Database")
    backup_path = _inside(root, receipt.get("backupPath"), "Backup")
    installed_app = _inside(root, receipt.get("installedAppPath"), "Installed candidate")
    installed_exe = _inside(root, receipt.get("candidateExecutablePath"), "Installed executable")
    if db_path != expected_paths["database"] or backup_path != expected_paths["backup"] or installed_app != expected_paths["installed_app"]:
        raise GateBlocked(["Receipt paths do not match fixed unified synthetic root paths."])
    if installed_exe != installed_app / "Contents/MacOS/personal-finance-console":
        raise GateBlocked(["Receipt executable path is not the fixed candidate executable path."])

    candidate_exe = _inside(root, str(expected_paths["candidate_app"] / "Contents/MacOS/personal-finance-console"), "Frozen candidate executable")
    candidate_manifest = _inside(root, str(expected_paths["candidate_app"] / "Contents/Resources/runtime-compatibility.json"), "Frozen candidate manifest")
    installed_manifest = _inside(root, str(installed_app / "Contents/Resources/runtime-compatibility.json"), "Installed candidate manifest")
    current_exe_sha, current_exe_id = _hash_file(installed_exe, "Installed candidate executable")
    candidate_exe_sha, candidate_exe_id = _hash_file(candidate_exe, "Frozen candidate executable")
    manifest_raw, manifest_sha, manifest_id = _read_exact(installed_manifest, "Installed compatibility manifest")
    candidate_manifest_raw, candidate_manifest_sha, candidate_manifest_id = _read_exact(candidate_manifest, "Frozen compatibility manifest")
    if not (current_exe_sha == candidate_exe_sha == receipt.get("candidateExecutableSha256") == approval.get("candidateExecutableSha256")):
        raise GateBlocked(["Candidate executable identity/hash drifted from receipt or approval."])
    if not (manifest_sha == candidate_manifest_sha == receipt.get("compatibilityManifestSha256") == approval.get("compatibilityManifestSha256")):
        raise GateBlocked(["Candidate manifest exact-byte hash drifted from receipt or approval."])
    try:
        manifest_value = json.loads(manifest_raw)
        plist_raw, _, _ = _read_exact(installed_app / "Contents/Info.plist", "Installed candidate Info.plist")
        plist_value = plistlib.loads(plist_raw)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise GateBlocked([f"Candidate manifest or bundle identity is unreadable: {error}"]) from error
    if (manifest_value.get("bundleId") != "org.pfc.quiescence.integration" or
            manifest_value.get("executable") != "Contents/MacOS/personal-finance-console" or
            manifest_value.get("runtimeGeneration") != 4 or
            plist_value.get("CFBundleIdentifier") != "org.pfc.quiescence.integration" or
            plist_value.get("CFBundleExecutable") != "personal-finance-console"):
        raise GateBlocked(["Candidate bundle/manifest identity is not the frozen unified R2B identity."])

    db_sha, db_id = _hash_file(db_path, "Synthetic database")
    backup_sha, backup_id = _hash_file(backup_path, "Synthetic backup")
    if backup_sha != receipt.get("backupSha256") or db_id["dev"] != ledger.get("databaseIdentity", {}).get("dev") or db_id["inode"] != ledger.get("databaseIdentity", {}).get("inode"):
        raise GateBlocked(["Database or backup object identity drifted from the consumed ledger."])
    if backup_id != ledger.get("backupIdentity") or backup_sha != ledger.get("backupSha256"):
        raise GateBlocked(["Backup identity/hash drifted from the consumed ledger."])

    if permit.get("syntheticOnly") is not True or permit.get("status") != "ONE_TIME_PRODUCTION_V4_MIGRATION_AUTHORIZATION":
        raise GateBlocked(["Consumed Gate permit has invalid domain or status."])
    if permit.get("releaseReceiptSha256") != receipt_sha:
        raise GateBlocked(["Gate permit does not bind the current exact release-receipt bytes."])
    if (root / "gate-permit.json").exists() or (root / "gate-permit.json").is_symlink():
        raise GateBlocked(["Both unclaimed and claimed Gate permit paths exist; authority state is ambiguous."])
    for key in ("candidateApprovalSha256", "migrationAuthorizationSha256", "candidateExecutableSha256",
                "compatibilityManifestSha256", "productionDatabasePreMigrationSha256", "backupSha256",
                "productionDatabasePath", "backupPath", "releaseReceiptPath", "ownerAuthorizationId",
                "candidateApprovalId", "productionBundleId"):
        if permit.get(key) != receipt.get(key):
            raise GateBlocked([f"Gate permit field {key} differs from the exact release receipt."])
    if permit.get("migrationAuthorizationSha256") != migration_auth_sha or permit.get("candidateApprovalSha256") != approval_sha:
        raise GateBlocked(["Gate permit does not bind current exact authorization bytes."])
    if permit.get("ownerAuthorizationId") != migration_auth.get("authorizationId"):
        raise GateBlocked(["Gate permit migration authorization ID mismatch."])
    if ledger.get("domain") != "UNIFIED_R2B_GATE_OWNED" or ledger.get("syntheticOnly") is not True:
        raise GateBlocked(["Consumed ledger domain is invalid."])
    if ledger.get("permitSha256") != permit_sha or ledger.get("receiptSha256") != receipt_sha:
        raise GateBlocked(["Consumed ledger does not bind current exact permit and receipt bytes."])
    if ledger.get("authorizationSha256") != migration_auth_sha or ledger.get("authorizationId") != migration_auth.get("authorizationId"):
        raise GateBlocked(["Consumed ledger does not bind current exact migration authorization."])
    for key, expected in (("candidateSha256", current_exe_sha), ("manifestSha256", manifest_sha),
                          ("candidateApprovalSha256", approval_sha), ("backupSha256", backup_sha)):
        if ledger.get(key) != expected:
            raise GateBlocked([f"Consumed ledger field {key} does not match current bound object."])
    if ledger.get("nonce") != permit.get("nonce") or ledger.get("authorizationId") != permit.get("ownerAuthorizationId"):
        raise GateBlocked(["Consumed ledger nonce or authorization ID does not match permit."])
    if ledger.get("databaseSha256") != receipt.get("productionDatabasePreMigrationSha256") or ledger.get("candidateBundleId") != receipt.get("productionBundleId"):
        raise GateBlocked(["Consumed ledger database baseline or candidate bundle ID differs from the release receipt."])
    if ledger.get("consumerExecutableSha256") != current_exe_sha:
        raise GateBlocked(["Consumed ledger Rust consumer identity differs from the frozen candidate executable."])
    lock_sha, lock_identity = _hash_file(root / "maintenance.lock", "Native maintenance lease")
    if ledger.get("leasePath") != str(root / "maintenance.lock") or lock_identity != ledger.get("leaseIdentity"):
        raise GateBlocked(["Consumed ledger native lease identity/path does not match the current root object."])

    if c3.get("status") != "SYNTHETIC_C3_MANAGED_ISOLATED" or c3.get("mode") != "UNIFIED_R2B_GATE_OWNED" or c3.get("root") != str(root):
        raise GateBlocked(["C3 isolation receipt does not bind this unified root."])
    if not isinstance(ledger.get("session"), str) or not ledger["session"] or c3.get("lease", {}).get("session") != ledger.get("session"):
        raise GateBlocked(["Consumed ledger session does not match the C3 lease session."])
    if c3.get("managedContractSha256") != managed_sha or managed_contract.get("synthetic_only") is not True or managed_contract.get("root") != str(root):
        raise GateBlocked(["C3 managed contract binding is invalid."])
    if c3.get("rootMarkerSha256") != marker_sha or c3.get("databasePath") != str(db_path) or c3.get("candidate", {}).get("executableSha256") != current_exe_sha:
        raise GateBlocked(["C3 receipt does not bind the current root marker, database, and candidate."])
    state_s1 = root / "managed-state-S1_MANAGED_ISOLATED.json"
    _, _, state_s1_sha, _ = _json_snapshot(state_s1, "S1 managed isolation state")
    if c3.get("managedStateReceiptSha256") != state_s1_sha:
        raise GateBlocked(["C3 receipt does not bind exact S1 state bytes."])
    if progress.get("state") != "S1_MANAGED_ISOLATED" or progress.get("session") != ledger.get("session"):
        raise GateBlocked(["Managed progress does not match consumed session or S1."])

    state_files = sorted(root.glob("managed-state-*.json"))
    lineage: dict[str, tuple[str, dict[str, int]]] = {
        "SYNTHETIC_C3_MANAGED_ISOLATED.json": (c3_sha, _read_exact(root / "SYNTHETIC_C3_MANAGED_ISOLATED.json", "C3 lineage")[2]),
        "managed-contract.json": (managed_sha, _read_exact(root / "managed-contract.json", "Managed contract lineage")[2]),
        "managed-progress.json": (progress_sha, _read_exact(root / "managed-progress.json", "Managed progress lineage")[2]),
    }
    s0, _, s0_sha, s0_id = _json_snapshot(root / "managed-state-S0_VERIFIED_CANDIDATE.json", "S0 candidate state")
    if s0.get("state") != "S0_VERIFIED_CANDIDATE" or s0.get("synthetic_only") is not True:
        raise GateBlocked(["S0 candidate state is missing or invalid."])
    s0_candidate = s0.get("details", {}).get("candidate", {})
    if s0_candidate.get("executable_sha256") != current_exe_sha or s0_candidate.get("manifest_sha256") != manifest_sha:
        raise GateBlocked(["S0 state does not bind current candidate executable and manifest."])
    lineage["managed-state-S0_VERIFIED_CANDIDATE.json"] = (s0_sha, s0_id)
    for path in state_files:
        if path.name == "managed-state-S0_VERIFIED_CANDIDATE.json":
            continue
        value, _, digest, identity = _json_snapshot(path, "Native managed state " + path.name)
        if value.get("synthetic_only") is not True or value.get("session") != ledger.get("session"):
            raise GateBlocked([f"Native managed state {path.name} has wrong domain/session."])
        lineage[path.name] = (digest, identity)
    ordered_states = []
    for path in state_files:
        state_value, _, state_digest, _ = _json_snapshot(path, "Managed state chain " + path.name)
        ordered_states.append((state_value.get("sequence"), state_value.get("previous_evidence_sha256"), state_digest))
    ordered_states.sort(key=lambda item: item[0] if isinstance(item[0], int) else -1)
    if [item[0] for item in ordered_states] != list(range(1, 9)):
        raise GateBlocked(["Managed S0/S1 state sequence has a gap, duplicate, or invalid sequence."])
    if any(ordered_states[index][1] != ordered_states[index - 1][2] for index in range(1, len(ordered_states))):
        raise GateBlocked(["Managed S0/S1 state exact-byte hash chain is broken."])
    stage_rows, stage_sha, stage_id = _jsonl_snapshot(root / "r2b-s0-s10.jsonl", "Native S4-S9 event lineage")
    if any(row.get("permitSha256") != permit_sha or row.get("session") != ledger.get("session") for row in stage_rows):
        raise GateBlocked(["S-state event stream does not bind the consumed permit and session."])
    stage_names = [str(row.get("stage", "")) for row in stage_rows]
    allowed_stages = ["S4_CONNECTION_PREPARED", "S5_QUIESCENCE_ACQUIRED", "S6_V3_REVALIDATED",
                      "S7_M4_IN_TRANSACTION", "S8_COMMIT_OUTCOME_UNKNOWN", "S8_COMMIT_VERIFIED",
                      "S9_POST_READBACK_GUARDED"]
    stage_positions = [allowed_stages.index(name) if name in allowed_stages else -1 for name in stage_names]
    if any(position < 0 for position in stage_positions) or stage_positions != sorted(stage_positions) or len(set(stage_positions)) != len(stage_positions):
        raise GateBlocked(["S4-S9 state stream is unsupported, duplicated, or out of order."])
    lineage["r2b-s0-s10.jsonl"] = (stage_sha, stage_id)

    terminal_path = root / "verified-handoff.json"
    terminal: dict[str, Any] | None = None
    terminal_sha: str | None = None
    terminal_id: dict[str, int] | None = None
    if terminal_path.exists() or terminal_path.is_symlink():
        terminal, _, terminal_sha, terminal_id = _json_snapshot(terminal_path, "Durable verified handoff")
        lineage["verified-handoff.json"] = (terminal_sha, terminal_id)
    recovery_state_path = root / "unified-recovery-state.json"
    recovery_terminal_path = root / "unified-recovery-terminal.json"
    recovery_state = None
    recovery_terminal = None
    recovery_state_sha = recovery_terminal_sha = None
    if recovery_state_path.exists() or recovery_state_path.is_symlink():
        recovery_state, _, recovery_state_sha, recovery_state_id = _json_snapshot(recovery_state_path, "Unified recovery state")
        lineage["unified-recovery-state.json"] = (recovery_state_sha, recovery_state_id)
    if recovery_terminal_path.exists() or recovery_terminal_path.is_symlink():
        recovery_terminal, _, recovery_terminal_sha, recovery_terminal_id = _json_snapshot(recovery_terminal_path, "Unified recovery terminal")
        lineage["unified-recovery-terminal.json"] = (recovery_terminal_sha, recovery_terminal_id)
    recovery_bindings = {
        "domain": "UNIFIED_R2B_GATE_OWNED", "syntheticOnly": True,
        "receiptSha256": receipt_sha, "permitSha256": permit_sha,
        "consumedLedgerSha256": ledger_sha, "session": ledger.get("session"),
        "candidateSha256": current_exe_sha, "manifestSha256": manifest_sha,
        "databaseIdentity": {key: db_id[key] for key in ("dev", "inode", "links")},
        "databaseSha256": db_sha, "backupSha256": backup_sha,
    }
    for typed_state in (recovery_state, recovery_terminal):
        if typed_state is not None and any(typed_state.get(key) != value for key, value in recovery_bindings.items()):
            raise GateBlocked(["Unified recovery state/terminal does not bind the current exact authority chain."])
    active_path = root / "recovery-active.json"
    active = active_path.exists() or active_path.is_symlink()
    if active:
        _, _, active_sha, active_id = _json_snapshot(active_path, "Recovery ACTIVE state")
        lineage["recovery-active.json"] = (active_sha, active_id)
    lineage_payload = {name: {"sha256": value[0], "identity": value[1]} for name, value in sorted(lineage.items())}
    lineage_raw = json.dumps(lineage_payload, sort_keys=True, separators=(",", ":")).encode()
    lineage_sha = hashlib.sha256(lineage_raw).hexdigest()

    # Every chain object is sampled again after all parsing and identity checks.
    stable_paths = [root / "SYNTHETIC_ONLY", root / "release-receipt.json", root / "gate-permit.claimed/permit.json",
                    root / "consumed-ledger.json", root / "gate-inputs/candidate-approval.json",
                    root / "gate-inputs/migration-authorization.json", root / DATABASE_NAME,
                    root / "backup.sqlite3", installed_exe, candidate_exe, installed_manifest, candidate_manifest,
                    root / "SYNTHETIC_C3_MANAGED_ISOLATED.json", root / "managed-contract.json",
                    root / "managed-progress.json", root / "r2b-s0-s10.jsonl", *state_files]
    if terminal_path.exists():
        stable_paths.append(terminal_path)
    if recovery_state_path.exists():
        stable_paths.append(recovery_state_path)
    if recovery_terminal_path.exists():
        stable_paths.append(recovery_terminal_path)
    if active:
        stable_paths.append(active_path)
    object_map: dict[str, tuple[str, dict[str, int]]] = {}
    for path in stable_paths:
        digest, identity = _hash_file(path, "Stable readback " + path.name)
        object_map[str(path)] = (digest, identity)
    return ({"root": str(root), "receipt": receipt, "receiptSha256": receipt_sha,
             "permit": permit, "permitSha256": permit_sha, "ledger": ledger, "ledgerSha256": ledger_sha,
             "migrationAuthorization": migration_auth, "migrationAuthorizationSha256": migration_auth_sha,
             "candidateExecutableSha256": current_exe_sha, "candidateExecutableIdentity": current_exe_id,
             "manifestSha256": manifest_sha, "manifestIdentity": manifest_id,
             "candidateExecutableIdentityAtSource": candidate_exe_id, "candidateManifestIdentityAtSource": candidate_manifest_id,
             "databasePath": str(db_path), "databaseIdentity": db_id, "databaseSha256": db_sha,
             "backupIdentity": backup_id, "backupSha256": backup_sha,
             "leaseIdentity": lock_identity, "leaseSha256": lock_sha,
             "stageRows": stage_rows, "terminal": terminal, "terminalSha256": terminal_sha,
             "recoveryState": recovery_state, "recoveryTerminal": recovery_terminal,
             "active": active, "lineageSha256": lineage_sha, "lineage": lineage_payload,
             "dbFacts": _db_facts(db_path), "c3ReceiptSha256": c3_sha}, object_map)


def expected_authorization_bindings(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        "domain": AUTH_DOMAIN,
        "syntheticOnly": True,
        "recoveryScope": AUTH_SCOPE,
        "originalMigrationAuthorizationId": snapshot["migrationAuthorization"].get("authorizationId"),
        "originalMigrationAuthorizationSha256": snapshot["migrationAuthorizationSha256"],
        "releaseReceiptSha256": snapshot["receiptSha256"],
        "gatePermitSha256": snapshot["permitSha256"],
        "consumedLedgerSha256": snapshot["ledgerSha256"],
        "candidateExecutableSha256": snapshot["candidateExecutableSha256"],
        "manifestSha256": snapshot["manifestSha256"],
        "databaseIdentity": {key: snapshot["databaseIdentity"][key] for key in ("dev", "inode", "links")},
        "databaseSha256": snapshot["databaseSha256"],
        "backupIdentity": snapshot["backupIdentity"],
        "backupSha256": snapshot["backupSha256"],
        "terminalLineageSha256": snapshot["lineageSha256"],
    }


def _classify(snapshot: dict[str, Any]) -> dict[str, Any]:
    terminal = snapshot["terminal"]
    recovery_state = snapshot.get("recoveryState")
    recovery_terminal = snapshot.get("recoveryTerminal")
    events = [str(row.get("stage", "")) for row in snapshot["stageRows"]]
    db = snapshot["dbFacts"]
    active = snapshot["active"]
    current = "CORRUPT_STATE"
    if active:
        current = "ORPHAN_ACTIVE"
    elif recovery_terminal is not None:
        current = recovery_terminal.get("state")
        if current not in {"FAILED_V3_CONFIRMED", "COMMIT_OUTCOME_UNKNOWN", "GUARD_LOST_OR_UNPROVEN", "MISSING_TERMINAL", "CORRUPT_STATE"}:
            raise GateBlocked(["Unified recovery terminal has an unsupported state."])
    elif recovery_state is not None:
        current = recovery_state.get("state")
        if current not in {"FAILED_V3_CONFIRMED", "QUIESCENCE_ACQUIRED", "M4_IN_TRANSACTION", "COMMIT_OUTCOME_UNKNOWN", "V4_COMMITTED_BUT_REPLY_LOST", "GUARD_LOST_OR_UNPROVEN", "MISSING_TERMINAL", "CORRUPT_STATE"}:
            raise GateBlocked(["Unified recovery state has an unsupported state."])
    elif terminal is not None:
        if terminal.get("state") != "VERIFIED_HANDOFF":
            raise GateBlocked(["Durable terminal has an unknown or corrupt state."])
        for key, expected in (("permitSha256", snapshot["permitSha256"]),
                              ("receiptSha256", snapshot["receiptSha256"]),
                              ("authorizationSha256", snapshot["migrationAuthorizationSha256"]),
                              ("authorizationId", snapshot["migrationAuthorization"].get("authorizationId")),
                              ("candidateApprovalSha256", snapshot["receipt"].get("candidateApprovalSha256")),
                              ("candidateSha256", snapshot["candidateExecutableSha256"]),
                              ("manifestSha256", snapshot["manifestSha256"]),
                              ("session", snapshot["ledger"].get("session")),
                              ("backupSha256", snapshot["backupSha256"])):
            if terminal.get(key) != expected:
                raise GateBlocked([f"Durable terminal {key} binding mismatch."])
        terminal_db_identity = terminal.get("databaseIdentity", {})
        current_db_identity = snapshot["databaseIdentity"]
        if any(terminal_db_identity.get(key) != current_db_identity.get(key) for key in ("dev", "inode", "links")):
            raise GateBlocked(["Durable terminal database object identity mismatch."])
        if (terminal.get("databaseSha256Before") != snapshot["ledger"].get("databaseSha256") or
                terminal.get("migration4Executed") is not True or terminal.get("migration4ExecutionCount") != 1 or
                terminal.get("schema", {}).get("userVersion") != 4 or
                terminal.get("schema", {}).get("migrationRows") != [1, 2, 3, 4] or
                terminal.get("schema", {}).get("migration4Rows") != 1):
            raise GateBlocked(["Durable terminal does not prove the single approved Migration 4 lineage."])
        if terminal.get("databaseSha256After") != snapshot["databaseSha256"] or db["userVersion"] != 4 or db["migrationRows"] != [1, 2, 3, 4] or db["integrity"] != ["ok"]:
            raise GateBlocked(["V4 terminal is not confirmed by current exact synthetic DB bytes/schema."])
        current = "V4_VERIFIED"
    elif "S8_COMMIT_VERIFIED" in events:
        current = "V4_COMMITTED_BUT_REPLY_LOST"
    elif "S8_COMMIT_OUTCOME_UNKNOWN" in events:
        current = "COMMIT_OUTCOME_UNKNOWN"
    elif "S7_M4_IN_TRANSACTION" in events:
        current = "M4_IN_TRANSACTION"
    elif "S5_QUIESCENCE_ACQUIRED" in events:
        current = "QUIESCENCE_ACQUIRED"
    elif "S4_CONNECTION_PREPARED" in events:
        current = "PERMIT_CONSUMED"
    else:
        current = "MISSING_TERMINAL"

    policies = {
        "V4_VERIFIED": ("READONLY_CONFIRMATION_ONLY", False, False, False, True, False),
        "V4_COMMITTED_BUT_REPLY_LOST": ("READONLY_CONFIRMATION_ONLY", False, False, False, True, False),
        "FAILED_V3_CONFIRMED": ("MANUAL_DECISION_REQUIRED", False, True, False, True, "AUTHORIZATION_REQUIRED"),
        "QUIESCENCE_ACQUIRED": ("MANUAL_DECISION_REQUIRED", False, False, False, True, False),
        "M4_IN_TRANSACTION": ("MANUAL_DECISION_REQUIRED", False, False, False, True, False),
        "COMMIT_OUTCOME_UNKNOWN": ("MANUAL_DECISION_REQUIRED", False, False, False, True, False),
        "GUARD_LOST_OR_UNPROVEN": ("REFUSE", False, False, False, True, False),
        "ORPHAN_ACTIVE": ("REFUSE", False, False, False, True, False),
        "MISSING_TERMINAL": ("MANUAL_DECISION_REQUIRED", False, False, False, True, False),
        "CORRUPT_STATE": ("REFUSE", False, False, False, True, False),
        "PERMIT_CONSUMED": ("MANUAL_DECISION_REQUIRED", False, False, False, True, False),
    }
    if current not in policies:
        raise GateBlocked(["Unsupported native recovery state."])
    disposition, business, rerun, reusable, readonly, restore = policies[current]
    # FAILED_V3 is only asserted by a typed terminal bound to the same chain.
    if current == "FAILED_V3_CONFIRMED":
        if db["userVersion"] != 3 or db["migrationRows"] != [1, 2, 3]:
            raise GateBlocked(["FAILED_V3_CONFIRMED lacks a read-only V3 schema confirmation."])
        if recovery_terminal is None or recovery_terminal.get("rollbackConfirmed") is not True or recovery_terminal.get("guard") != "known-held":
            raise GateBlocked(["FAILED_V3_CONFIRMED lacks a durable guarded rollback terminal."])
    business_decision = disposition if disposition in {"ALLOW", "REFUSE", "READONLY_CONFIRMATION_ONLY", "MANUAL_DECISION_REQUIRED"} else "MANUAL_DECISION_REQUIRED"
    return {"currentState": current, "recoveryDisposition": disposition,
            "businessAccessDecision": business_decision,
            "businessAccessAllowed": business, "migrationMayRerun": rerun,
            "oldPermitReusable": reusable, "newAuthorizationRequired": True,
            "restoreAllowed": restore, "readonlyConfirmationAllowed": readonly,
            "action": "NONE", "automaticRecovery": False,
            "diagnosticMutationCount": 0}


def diagnose(root: Path, authorization_path: Path, expected_authorization_sha256: str,
             *, domain: str = AUTH_DOMAIN, now: int | None = None) -> dict[str, Any]:
    if domain != AUTH_DOMAIN:
        raise GateBlocked(["Production/synthetic domain mismatch: Production recovery diagnostic is not authorized."])
    canonical = _validate_synthetic_gate_root(root, unified_r2b=True)
    auth_path = authorization_path.resolve(strict=True)
    try:
        auth_path.relative_to(canonical)
    except ValueError:
        pass
    else:
        raise GateBlocked(["Recovery authorization must be external to the diagnostic root; the root is read-only."])

    snapshot, before = _read_chain(canonical)
    auth, _, auth_sha, auth_identity = _json_snapshot(auth_path, "Unified recovery authorization")
    if auth_sha != expected_authorization_sha256:
        raise GateBlocked(["Recovery authorization exact-byte SHA-256 pin mismatch."])
    required = {"formatVersion", "authorizationId", "expiresAtUnix"}
    if not required.issubset(auth) or not isinstance(auth.get("authorizationId"), str) or not auth["authorizationId"]:
        raise GateBlocked(["Recovery authorization is missing required identity/scope fields."])
    expected = expected_authorization_bindings(snapshot)
    for key, value in expected.items():
        if auth.get(key) != value:
            raise GateBlocked([f"Recovery authorization binding mismatch: {key}."])
    current_time = int(time.time()) if now is None else int(now)
    if not isinstance(auth.get("expiresAtUnix"), int) or auth["expiresAtUnix"] <= current_time:
        raise GateBlocked(["Recovery authorization is expired or has invalid expiry."])
    if auth.get("formatVersion") != 1 or not auth["authorizationId"]:
        raise GateBlocked(["Recovery authorization format or ID is invalid."])

    result = _classify(snapshot)
    if result["currentState"] == "V4_VERIFIED":
        result["newAuthorizationRequired"] = True  # separate compatible handoff/business entry remains required
    result.update({"status": "PASS", "domain": AUTH_DOMAIN, "authorizationId": auth["authorizationId"],
                   "recoveryAuthorizationSha256": auth_sha,
                   "currentStateEvidence": {"receiptSha256": snapshot["receiptSha256"],
                       "gatePermitSha256": snapshot["permitSha256"], "consumedLedgerSha256": snapshot["ledgerSha256"],
                       "candidateExecutableSha256": snapshot["candidateExecutableSha256"],
                       "manifestSha256": snapshot["manifestSha256"], "databaseIdentity": snapshot["databaseIdentity"],
                       "databaseSha256": snapshot["databaseSha256"], "backupSha256": snapshot["backupSha256"],
                       "terminalLineageSha256": snapshot["lineageSha256"]}})
    if result["oldPermitReusable"]:
        raise GateBlocked(["A consumed unified Gate permit can never be reusable."])

    # Prove every observed root object and the external authorization remained
    # byte/identity stable through parsing and disposition evaluation.
    for path, (digest, identity) in before.items():
        current_digest, current_identity = _hash_file(Path(path), "Diagnostic post-readback")
        if current_digest != digest or current_identity != identity:
            raise GateBlocked([f"Diagnostic observed object drift: {Path(path).name}."])
    auth_after, auth_after_sha, auth_after_id = _read_exact(auth_path, "Recovery authorization post-readback")
    if auth_after_sha != auth_sha or auth_after_id != auth_identity:
        raise GateBlocked(["Recovery authorization changed during diagnostic."])
    return result

