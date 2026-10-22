#!/usr/bin/env python3
"""R9-02(a) synthetic-only driver. SYNTHETIC_ONLY.

Builds the fixture exactly as scripts/test_production_v8_release_gate.py::setUp
does, then runs the real V8 gate in synthetic mode. This driver never starts the
candidate executable and never touches the real Production app-data directory.

Usage:
  python3 -I driver_r9_gate_preflight.py <gate-module> <repo-root> <case>
  case: positive | tampered-executable | replaced-backup | added-wal
Exit: 0 = expected PASS (positive) ; 2 = expected BLOCKED (negative) ; 1 = unexpected
"""

from __future__ import annotations

import importlib.util
import json
import plistlib
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

SYNTHETIC_ONLY = True


def load_gate(module_path: Path):
    spec = importlib.util.spec_from_file_location("production_v8_release_gate", module_path)
    gate = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = gate
    spec.loader.exec_module(gate)
    return gate


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    path.chmod(0o600)


def build_fixture(gate, root: Path) -> dict[str, Path]:
    """Byte-for-byte equivalent construction to the release-gate test setUp."""
    (root / "SYNTHETIC_ONLY").write_bytes(gate.SYNTHETIC_GATE_MARKER)

    app = root / "Applications" / gate.APP_NAME
    executable = app / "Contents/MacOS" / gate.EXECUTABLE_NAME
    manifest_path = app / gate.MANIFEST_RELATIVE_PATH
    executable.parent.mkdir(parents=True, exist_ok=True)
    executable.write_bytes(b"fixture-v8-production-executable")
    executable.chmod(0o755)
    with (app / "Contents/Info.plist").open("wb") as stream:
        plistlib.dump(
            {
                "CFBundleIdentifier": gate.PRODUCTION_BUNDLE_ID,
                "CFBundleExecutable": gate.EXECUTABLE_NAME,
                "CFBundleShortVersionString": "8.0.0",
            },
            stream,
        )
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(manifest_path, gate.REQUIRED_MANIFEST)

    app_data = root / "Library/Application Support" / gate.PRODUCTION_BUNDLE_ID
    db = app_data / gate.DATABASE_NAME
    backup = app_data / gate.BACKUP_DIRECTORY / gate.DATABASE_NAME
    backup.parent.mkdir(parents=True)
    with sqlite3.connect(db) as connection:
        connection.executescript(
            "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);"
            "INSERT INTO schema_migrations VALUES(1),(2),(3);"
            "PRAGMA user_version=3;"
        )
    shutil.copyfile(db, backup)
    pre_database_sha256 = gate.sha256_file(db)

    approval_path = root / "authorization" / "candidate-approval.json"
    authorization_path = root / "authorization" / "migration-authorization.json"
    approval = {
        "status": gate.APPROVAL_STATUS,
        "syntheticOnly": True,
        "authorizationId": "owner-approval-v8-1",
        "candidateExecutableSha256": gate.sha256_file(executable),
        "candidateInfoPlistPath": str(app / "Contents/Info.plist"),
        "candidateInfoPlistSha256": gate.sha256_file(app / "Contents/Info.plist"),
        "compatibilityManifestSha256": gate.sha256_file(manifest_path),
        "bundleId": gate.PRODUCTION_BUNDLE_ID,
        "maxSupportedSchemaVersion": 8,
        "migrationSourceSchemaVersion": 3,
    }
    authorization = {
        "status": gate.AUTHORIZATION_STATUS,
        "syntheticOnly": True,
        "authorizationId": "owner-auth-request-v8-1",
        "ownerAuthorizationId": approval["authorizationId"],
        "candidateExecutableSha256": gate.sha256_file(executable),
        "candidateInfoPlistPath": str(app / "Contents/Info.plist"),
        "candidateInfoPlistSha256": gate.sha256_file(app / "Contents/Info.plist"),
        "compatibilityManifestSha256": gate.sha256_file(manifest_path),
        "productionDbPreMigrationSha256": pre_database_sha256,
        "backupPath": str(backup.resolve()),
        "productionBundleId": gate.PRODUCTION_BUNDLE_ID,
        "sourceSchemaVersion": 3,
        "targetSchemaVersion": 8,
    }
    write_json(approval_path, approval)
    write_json(authorization_path, authorization)
    return {
        "root": root,
        "app_data": app_data,
        "db": db,
        "backup": backup,
        "executable": executable,
        "approval": approval_path,
        "authorization": authorization_path,
    }


def assert_isolated(gate, root: Path, repo_root: Path) -> list[str]:
    problems: list[str] = []
    resolved = root.resolve()
    temp_root = Path(tempfile.gettempdir()).resolve()
    if not resolved.is_relative_to(temp_root):
        problems.append("synthetic root is not under the OS temporary directory")
    forbidden = [Path("/Applications").resolve(), gate.APP_DATA.resolve(), (repo_root / "src-tauri/target").resolve()]
    for path in forbidden:
        if resolved == path or resolved.is_relative_to(path):
            problems.append(f"synthetic root is inside protected path {path}")
    return problems


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: driver_r9_gate_preflight.py <gate-module> <repo-root> <case>")
        return 1
    gate_module = Path(sys.argv[1]).resolve(strict=True)
    repo_root = Path(sys.argv[2]).resolve(strict=True)
    case = sys.argv[3]
    gate = load_gate(gate_module)

    root = Path(tempfile.mkdtemp(prefix="pfc-r9-synthetic-")).resolve()
    fixture = build_fixture(gate, root)
    print("SYNTHETIC_ONLY")
    print(f"case={case}")
    print(f"syntheticRoot={root}")
    print(f"markerBytes={len((root / 'SYNTHETIC_ONLY').read_bytes())}")

    if case == "tampered-executable":
        data = bytearray(fixture["executable"].read_bytes())
        data[0] ^= 0x01
        fixture["executable"].write_bytes(bytes(data))
        print("mutation=executable flipped one byte")
    elif case == "replaced-backup":
        fixture["backup"].write_bytes(b"SYNTHETIC_ONLY replaced backup bytes\n")
        print("mutation=backup file replaced")
    elif case == "added-wal":
        Path(str(fixture["db"]) + "-wal").write_bytes(b"SYNTHETIC_ONLY fake wal\n")
        print("mutation=sidecar -wal added next to synthetic database")
    elif case != "positive":
        print(f"unknown case: {case}")
        return 1

    isolation = assert_isolated(gate, root, repo_root)
    print(f"isolationProblems={json.dumps(isolation, ensure_ascii=False)}")

    try:
        if case == "positive":
            if isolation:
                raise AssertionError(f"synthetic root isolation failed: {isolation}")
            result = gate.run_gate(
                "preflight",
                fixture["approval"],
                fixture["authorization"],
                synthetic_fixture_root=root,
            )
            receipt = result["receipt"]
            print(f"status={result['status']}")
            print(f"receiptStatus={receipt.get('status')}")
            print(f"syntheticOnly={str(receipt.get('syntheticOnly')).lower()}")
            print(f"sidecarsAbsent={str(receipt.get('sidecarsAbsent')).lower()}")
            print(f"productionSchema={json.dumps(receipt.get('productionSchema'), sort_keys=True)}")
            print(f"receiptPath={result['receiptPath']}")
            print("RESULT=PASS")
            return 0
        facts = gate.collect_synthetic_facts(root, fixture["approval"], fixture["authorization"])
        errors = gate.validate_preflight(facts, synthetic_fixture_root=root)
        if not errors:
            print("RESULT=UNEXPECTED_PASS")
            return 1
        print("RESULT=BLOCKED")
        for error in errors:
            print(f"reason={error}")
        return 2
    except gate.GateBlocked as error:
        print("RESULT=BLOCKED")
        for reason in error.reasons:
            print(f"reason={reason}")
        return 2
    except Exception as error:  # noqa: BLE001 - driver must surface unexpected states
        print(f"RESULT=UNEXPECTED_ERROR {type(error).__name__}: {error}")
        return 1
    finally:
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
