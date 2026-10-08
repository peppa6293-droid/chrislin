#!/usr/bin/env python3
"""Fail-closed V3 to V4 Production runtime gate. Never run in fixture mode."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import plistlib
import secrets
import shutil
import sqlite3
import stat
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PRODUCTION_BUNDLE_ID = "com.personalfinance.console"
ACCEPTANCE_BUNDLE_ID = "com.personalfinance.console.v4acceptance"
DATABASE_NAME = "personal-finance-console.sqlite3"
PRODUCTION_MIGRATION_AUTHORIZATION = "production-v4-migration-authorization.json"
APP_NAME = "Personal Finance Console.app"
EXECUTABLE_NAME = "personal-finance-console"
APP_PATH = Path("/Applications") / APP_NAME
APP_DATA = Path.home() / "Library/Application Support" / PRODUCTION_BUNDLE_ID
DATABASE_PATH = APP_DATA / DATABASE_NAME
GATE_AUTH_PATH = APP_DATA / PRODUCTION_MIGRATION_AUTHORIZATION
LEGACY_EXECUTABLE_SHA256 = "0e6dcb261de20eb96fcb2f85eaa7fe78fc3cd8c72a96bee78856ac081153911f"
MANIFEST_RELATIVE_PATH = Path("Contents/Resources/runtime-compatibility.json")


class GateBlocked(RuntimeError):
    def __init__(self, reasons: list[str]):
        self.reasons = reasons
        super().__init__("Production V4 release gate blocked: " + "; ".join(reasons))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _nonempty_json_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def file_inventory(root: Path) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for path in sorted(root.rglob("*")):
        if path.is_file():
            info = path.stat()
            output[str(path.relative_to(root))] = {
                "sha256": sha256_file(path),
                "mode": stat.S_IMODE(info.st_mode),
                "size": info.st_size,
            }
    return output


def read_bundle(app_path: Path) -> dict[str, Any]:
    if app_path.is_symlink():
        raise ValueError(f"App bundle path is a symbolic link: {app_path}")
    if not app_path.is_dir():
        raise ValueError(f"App bundle path is missing or not a directory: {app_path}")
    bundle_root = app_path.resolve(strict=True)
    info_path = app_path / "Contents/Info.plist"
    if info_path.is_symlink() or not info_path.is_file():
        raise ValueError(f"Bundle Info.plist is missing or redirected: {info_path}")
    with info_path.open("rb") as stream:
        info = plistlib.load(stream)
    if not isinstance(info, dict):
        raise ValueError(f"Bundle Info.plist must contain a dictionary: {info_path}")
    bundle_id = info.get("CFBundleIdentifier")
    if not _nonempty_json_string(bundle_id):
        raise ValueError(f"CFBundleIdentifier must be a non-empty string: {info_path}")
    executable_name = info.get("CFBundleExecutable")
    if executable_name != EXECUTABLE_NAME:
        raise ValueError(f"CFBundleExecutable must be the supported executable {EXECUTABLE_NAME!r} in {info_path}")
    executable = app_path / "Contents/MacOS" / executable_name
    if executable.is_symlink() or not executable.is_file():
        raise ValueError(f"Bundle executable is missing, redirected, or not a file: {executable}")
    resolved_executable = executable.resolve(strict=True)
    expected_executable = bundle_root / "Contents/MacOS" / EXECUTABLE_NAME
    try:
        resolved_executable.relative_to(bundle_root)
    except ValueError as error:
        raise ValueError(f"Bundle executable resolves outside its app bundle: {resolved_executable}") from error
    if resolved_executable != expected_executable:
        raise ValueError(f"Bundle executable resolved path is not canonical: {resolved_executable}")
    manifest_path = app_path / MANIFEST_RELATIVE_PATH
    manifest: dict[str, Any] | None = None
    manifest_hash: str | None = None
    if manifest_path.is_symlink():
        raise ValueError(f"Runtime compatibility manifest is a symbolic link: {manifest_path}")
    if manifest_path.is_file():
        resolved_manifest = manifest_path.resolve(strict=True)
        try:
            resolved_manifest.relative_to(bundle_root)
        except ValueError as error:
            raise ValueError(f"Runtime compatibility manifest resolves outside its app bundle: {resolved_manifest}") from error
        with manifest_path.open("r", encoding="utf-8") as stream:
            manifest = json.load(stream)
        manifest_hash = sha256_file(manifest_path)
    elif manifest_path.exists():
        raise ValueError(f"Runtime compatibility manifest is not a regular file: {manifest_path}")
    return {
        "bundle_path": str(bundle_root),
        "bundle_id": bundle_id,
        "version": info.get("CFBundleShortVersionString"),
        "executable_name": executable_name,
        "executable_path": str(resolved_executable),
        "executable_sha256": sha256_file(executable),
        "executable_mode": stat.S_IMODE(executable.stat().st_mode),
        "manifest": manifest,
        "manifest_path": str(manifest_path.resolve()) if manifest_path.exists() else str(manifest_path),
        "manifest_sha256": manifest_hash,
    }


def inventory_production_apps(roots: list[Path], walk: Any = os.walk) -> list[dict[str, Any]]:
    apps: list[dict[str, Any]] = []
    visited: set[str] = set()
    errors: list[dict[str, str]] = []
    for root in roots:
        if root.is_symlink():
            errors.append({"path": str(root), "error": "scan root is a symbolic link; inventory target is unknown"})
            continue
        if not root.exists() and root == Path.home() / "Applications":
            continue
        if not root.exists():
            errors.append({"path": str(root), "error": "required scan root is missing"})
            continue

        def onerror(error: OSError) -> None:
            errors.append({"path": str(getattr(error, "filename", root)), "error": f"{type(error).__name__}: {error}"})

        try:
            yielded_root = False
            for current, dirs, _files in walk(root, followlinks=False, onerror=onerror):
                yielded_root = True
                for name in list(dirs):
                    child = Path(current) / name
                    if child.is_symlink():
                        errors.append({"path": str(child), "error": "symbolic directory was not traversed; contained app identities are unknown"})
                        dirs.remove(name)
                for name in list(dirs):
                    if not name.endswith(".app"):
                        continue
                    path = Path(current) / name
                    info_path = path / "Contents/Info.plist"
                    try:
                        if not info_path.is_file():
                            raise ValueError("app bundle Info.plist is missing; identity is unknown")
                        with info_path.open("rb") as stream:
                            info = plistlib.load(stream)
                        if not isinstance(info, dict) or not isinstance(info.get("CFBundleIdentifier"), str):
                            raise ValueError("app bundle identity metadata is malformed")
                        if info.get("CFBundleIdentifier") != PRODUCTION_BUNDLE_ID:
                            continue
                        canonical = str(path.resolve())
                        if canonical in visited:
                            apps.append({"bundle_path": str(path), "canonical_path": canonical, "duplicate_alias": True})
                        else:
                            visited.add(canonical)
                            item = read_bundle(path)
                            item["symlink"] = path.is_symlink()
                            apps.append(item)
                    except Exception as error:  # malformed/read failures make identity unknown
                        errors.append({"path": str(info_path), "error": f"{type(error).__name__}: {error}"})
            if not yielded_root:
                errors.append({"path": str(root), "error": "directory walker returned no root entry; inventory completeness is unknown"})
        except Exception as error:
            errors.append({"path": str(root), "error": f"{type(error).__name__}: {error}"})
    if errors:
        raise GateBlocked([f"App inventory incomplete at {item['path']}: {item['error']}" for item in errors])
    return apps


def _collect_production_processes(runner: Any = subprocess.run, known_apps: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    if sys.platform != "darwin":
        raise GateBlocked(["Process and bundle inventory is supported only on macOS."])
    try:
        result = runner(["/bin/ps", "-axo", "pid=,comm=,args="], capture_output=True, text=True)
    except Exception as error:
        raise GateBlocked([f"Process snapshot is unknown: {type(error).__name__}: {error}"]) from error
    if result.returncode != 0:
        raise GateBlocked([f"Process snapshot failed (exit {result.returncode}): {result.stderr.strip()}"])
    if not result.stdout.strip():
        raise GateBlocked(["Process snapshot is empty; completeness is unknown."])
    matches: list[dict[str, Any]] = []
    seen_pids: set[int] = set()
    expected_executables = {str(Path(item["executable_path"]).resolve()) for item in (known_apps or []) if item.get("executable_path")}
    expected_db_names = {DATABASE_NAME, DATABASE_NAME + "-wal", DATABASE_NAME + "-shm", DATABASE_NAME + "-journal"}
    for line in result.stdout.splitlines():
        parts = line.strip().split(None, 2)
        if not parts:
            raise GateBlocked(["Process snapshot contains an empty row; completeness is unknown."])
        try:
            pid = int(parts[0])
        except ValueError as error:
            raise GateBlocked([f"Process snapshot contains an invalid PID row: {line!r}"]) from error
        if pid <= 0 or pid in seen_pids or len(parts) != 3 or not parts[1].strip() or not parts[2].strip():
            raise GateBlocked([f"Process snapshot row is incomplete or duplicated: {line!r}"])
        seen_pids.add(pid)
        comm, args = parts[1], parts[2]
        try:
            text_opened = runner(["/usr/sbin/lsof", "-a", "-p", str(pid), "-d", "txt", "-Fpn"], capture_output=True, text=True)
        except Exception as error:
            raise GateBlocked([f"Process {pid} inspection is unknown: {type(error).__name__}: {error}"]) from error
        if text_opened.returncode != 0:
            raise GateBlocked([f"Process {pid} executable inspection failed (exit {text_opened.returncode}): {text_opened.stderr.strip()}"])
        executable_paths = _parse_lsof_paths(text_opened.stdout, pid, "executable")
        distinct_executable_paths = {str(path.resolve()) for path in executable_paths}
        if len(distinct_executable_paths) != 1:
            raise GateBlocked([f"Process {pid} executable path is ambiguous."])
        if not executable_paths:
            raise GateBlocked([f"Process {pid} executable identity is unknown; no text executable path was returned."])
        executable = executable_paths[0]
        try:
            opened = runner(["/usr/sbin/lsof", "-a", "-p", str(pid), "-Fpn"], capture_output=True, text=True)
        except Exception as error:
            raise GateBlocked([f"Process {pid} open-file inspection is unknown: {type(error).__name__}: {error}"]) from error
        if opened.returncode != 0:
            raise GateBlocked([f"Process {pid} open-file inspection failed (exit {opened.returncode}): {opened.stderr.strip()}"])
        paths = _parse_lsof_paths(opened.stdout, pid, "open-file")
        has_db_handle = any(path.name in expected_db_names and path.parent == DATABASE_PATH.parent for path in paths)
        bundle_path: Path | None = None
        bundle_id: str | None = None
        parent = executable.parent
        while parent != parent.parent:
            if parent.suffix == ".app":
                bundle_path = parent
                try:
                    with (parent / "Contents/Info.plist").open("rb") as stream:
                        bundle_info = plistlib.load(stream)
                    if not isinstance(bundle_info, dict) or not isinstance(bundle_info.get("CFBundleIdentifier"), str) or not bundle_info["CFBundleIdentifier"].strip():
                        raise ValueError("app bundle CFBundleIdentifier is missing or not a non-empty string")
                    bundle_id = bundle_info["CFBundleIdentifier"]
                except Exception as error:
                    raise GateBlocked([f"Process {pid} executable bundle metadata is unknown: {type(error).__name__}: {error}"]) from error
                break
            parent = parent.parent
        if not executable.is_file():
            raise GateBlocked([f"Process {pid} executable path does not exist or is not a file: {executable}"])
        try:
            digest = sha256_file(executable)
        except OSError as error:
            raise GateBlocked([f"Process {pid} executable cannot be hashed: {type(error).__name__}: {error}"]) from error
        if bundle_id == PRODUCTION_BUNDLE_ID or str(executable.resolve()) in expected_executables or has_db_handle or digest == LEGACY_EXECUTABLE_SHA256:
            matches.append({"pid": pid,"executable_path": str(executable),"executable_sha256": digest,"bundle_path": str(bundle_path) if bundle_path else None,"bundle_id": bundle_id,"ps_comm": comm,"database_handle": has_db_handle})
    return matches


def _parse_lsof_paths(output: str, pid: int, label: str) -> list[Path]:
    lines = [line for line in output.splitlines() if line]
    if not lines:
        raise GateBlocked([f"Process {pid} {label} lsof result is empty."])
    pid_fields: list[int] = []
    paths: list[Path] = []
    for line in lines:
        if line.startswith("p") and line[1:].isdigit():
            pid_fields.append(int(line[1:]))
        elif line.startswith("n") and line[1:].strip():
            paths.append(Path(line[1:]))
        else:
            raise GateBlocked([f"Process {pid} {label} lsof field is malformed: {line!r}"])
    if pid_fields != [pid] or not paths:
        raise GateBlocked([f"Process {pid} {label} lsof result lacks complete PID/path fields."])
    return paths


def inventory_production_processes(runner: Any = subprocess.run, known_apps: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    try:
        processes = _collect_production_processes(runner, known_apps)
        return {"complete": True, "processes": processes, "diagnostics": []}
    except Exception as error:
        diagnostic = f"{type(error).__name__}: {error}"
        return {"complete": False, "processes": None, "diagnostics": [diagnostic]}


def inspect_database(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ValueError(f"Production database is missing: {path}")
    sidecars = [str(Path(str(path) + suffix)) for suffix in ("-wal", "-shm", "-journal") if Path(str(path) + suffix).exists()]
    uri = f"file:{path.resolve()}?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    try:
        user_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
        has_migrations = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
        ).fetchone() is not None
        migration_version = (
            int(connection.execute("SELECT COALESCE(MAX(version),0) FROM schema_migrations").fetchone()[0])
            if has_migrations
            else 0
        )
        integrity = [row[0] for row in connection.execute("PRAGMA integrity_check")]
        foreign_keys = [list(row) for row in connection.execute("PRAGMA foreign_key_check")]
        return {
            "path": str(path.resolve()),
            "sha256": sha256_file(path),
            "user_version": user_version,
            "migration_version": migration_version,
            "integrity": integrity,
            "foreign_key_violations": foreign_keys,
            "sidecars": sidecars,
        }
    finally:
        connection.close()


def validate_manifest(bundle: dict[str, Any]) -> list[str]:
    manifest = bundle.get("manifest")
    if not isinstance(manifest, dict):
        return ["Candidate has no embedded runtime compatibility manifest."]
    errors: list[str] = []
    expected = {
        "manifestFormatVersion": 1,
        "runtimeGeneration": 4,
        "maxSupportedSchemaVersion": 4,
        "bundleId": PRODUCTION_BUNDLE_ID,
        "executable": f"Contents/MacOS/{bundle.get('executable_name')}",
    }
    for key, value in expected.items():
        if manifest.get(key) != value:
            errors.append(f"Candidate compatibility manifest field {key} must be {value!r}.")
    if bundle.get("executable_name") != EXECUTABLE_NAME or manifest.get("executable") != f"Contents/MacOS/{EXECUTABLE_NAME}":
        errors.append("Candidate executable identity/path is not the fixed Production executable.")
    minimum = manifest.get("minSupportedSchemaVersion")
    if not isinstance(minimum, int) or minimum < 1 or minimum > 3:
        errors.append("Candidate compatibility manifest must declare support for schema V3 and migration from an earlier version.")
    return errors


def validate_preflight(facts: dict[str, Any], *, synthetic_fixture_root: Path | None = None) -> list[str]:
    errors: list[str] = []
    if facts.get("platform") != "darwin":
        errors.append("Production release gate requires macOS.")
    processes = facts.get("running_production_processes")
    if not isinstance(processes, list):
        errors.append("Production process inventory is unknown.")
    elif processes:
        errors.append("A Production-identity process or unknown matching executable is still running.")

    expected_app = Path(str(facts.get("expected_installed_app", "")))
    if synthetic_fixture_root is None:
        required_app_path = APP_PATH.resolve()
        required_database_path = DATABASE_PATH.resolve()
    else:
        fixture_root = synthetic_fixture_root.resolve()
        protected_paths = [Path("/Applications").resolve(), APP_DATA.resolve()]
        if any(fixture_root == protected or protected in fixture_root.parents or fixture_root in protected.parents for protected in protected_paths):
            errors.append("Synthetic fixture root overlaps a protected Production path.")
        required_app_path = (fixture_root / "Applications" / APP_NAME).resolve()
        required_database_path = (fixture_root / "Library/Application Support" / PRODUCTION_BUNDLE_ID / DATABASE_NAME).resolve()
    if expected_app.resolve() != required_app_path:
        errors.append("Production candidate app path does not match the fixed or synthetic-contract location.")
    apps = facts.get("production_apps")
    if not isinstance(apps, list):
        errors.append("Installed Production bundle inventory is unknown.")
        apps = []
    if facts.get("app_inventory_complete") is not True:
        errors.append("Installed Production bundle inventory is incomplete or unknown.")
    if facts.get("process_inventory_complete") is not True:
        errors.append("Production process inventory is incomplete or unknown.")
    process_inventory = facts.get("process_inventory")
    if not isinstance(process_inventory, dict) or process_inventory.get("complete") is not True or not isinstance(process_inventory.get("processes"), list):
        errors.append("Production process inventory completeness facts are missing or unknown.")
    elif process_inventory.get("processes") != processes:
        errors.append("Production process inventory facts do not match the process list being evaluated.")
    if len(apps) != 1:
        errors.append("Normal launch locations must contain exactly one Production-identity app bundle.")
    candidate = facts.get("candidate")
    if not isinstance(candidate, dict):
        errors.append("Installed candidate facts are unknown.")
        candidate = {}
    else:
        errors.extend(validate_manifest(candidate))
        executable_mode = candidate.get("executable_mode")
        if not isinstance(executable_mode, int) or isinstance(executable_mode, bool):
            errors.append("Candidate executable mode is missing or invalid.")
        elif not (executable_mode & 0o111):
            errors.append("Candidate executable has no execute permission.")
        try:
            candidate_bundle = Path(candidate["bundle_path"]).resolve(strict=True)
            candidate_executable = Path(candidate["executable_path"]).resolve(strict=True)
            expected_executable = candidate_bundle / "Contents/MacOS" / EXECUTABLE_NAME
            candidate_executable.relative_to(candidate_bundle)
            if candidate_executable != expected_executable or not candidate_executable.is_file():
                errors.append("Candidate executable canonical path does not match the executable inside its bundle.")
        except (KeyError, OSError, TypeError, ValueError) as error:
            errors.append(f"Candidate executable path is missing, invalid, or outside its bundle: {type(error).__name__}: {error}")
    if len(apps) == 1:
        installed = apps[0]
        if installed.get("unreadable") or installed.get("duplicate_alias") or installed.get("symlink"):
            errors.append("Installed Production bundle has unknown metadata or a path alias.")
        if Path(str(installed.get("bundle_path", ""))) != expected_app.resolve():
            errors.append("A Production-identity app exists outside the approved /Applications installation path.")
        if installed.get("bundle_id") != PRODUCTION_BUNDLE_ID:
            errors.append("Installed bundle ID is not the Production identity.")
        if installed.get("executable_sha256") == LEGACY_EXECUTABLE_SHA256:
            errors.append("Known legacy V3 Production runtime is still installed.")
        if candidate and installed.get("executable_sha256") != candidate.get("executable_sha256"):
            errors.append("Installed Production executable does not match the inspected candidate.")
    if candidate:
        if candidate.get("bundle_id") != PRODUCTION_BUNDLE_ID:
            errors.append("Candidate bundle ID must be com.personalfinance.console.")
        if candidate.get("bundle_id") == ACCEPTANCE_BUNDLE_ID:
            errors.append("Acceptance bundle ID cannot be used as a Production candidate.")
        if Path(str(candidate.get("bundle_path", ""))) != expected_app.resolve():
            errors.append("Candidate must be installed at /Applications/Personal Finance Console.app.")
        if Path(str(candidate.get("bundle_path", ""))).resolve() != required_app_path:
            errors.append("Candidate bundle path does not match the fixed or synthetic-contract location.")

    approval = facts.get("candidate_approval")
    migration_authorization = facts.get("migration_authorization")
    if not isinstance(approval, dict):
        errors.append("Approved candidate record is missing or unreadable.")
    else:
        if approval.get("status") != "OWNER_APPROVED_V4_PRODUCTION_CANDIDATE":
            errors.append("Candidate approval status is not Owner-approved for Production V4.")
        if not _nonempty_json_string(approval.get("authorizationId")):
            errors.append("Candidate approval ID is missing.")
        if candidate and approval.get("candidateExecutableSha256") != candidate.get("executable_sha256"):
            errors.append("Candidate executable hash does not match the Owner-approved hash.")
        if candidate and approval.get("compatibilityManifestSha256") != candidate.get("manifest_sha256"):
            errors.append("Candidate compatibility manifest hash does not match the Owner-approved hash.")
        if approval.get("bundleId") != PRODUCTION_BUNDLE_ID or approval.get("maxSupportedSchemaVersion") != 4:
            errors.append("Candidate approval must name the Production bundle and Schema V4.")

    database = facts.get("production_database")
    if not isinstance(database, dict):
        errors.append("Production database facts are unknown.")
        database = {}
    if Path(str(database.get("path", ""))) != Path(str(facts.get("expected_database_path", ""))).resolve():
        errors.append("Production database path does not match the authorized identity and basename.")
    if Path(str(database.get("path", ""))).resolve() != required_database_path:
        errors.append("Production database path does not match the fixed or synthetic-contract location.")
    if Path(str(database.get("path", ""))).name != DATABASE_NAME:
        errors.append("Production database basename does not match the fixed Production SQLite identity.")
    if database.get("user_version") != 3 or database.get("migration_version") != 3:
        errors.append("Production migration source must be consistent Schema V3.")
    if database.get("integrity") != ["ok"] or database.get("foreign_key_violations") != []:
        errors.append("Production database integrity or foreign-key preflight failed.")
    if database.get("sidecars") != []:
        errors.append("Production SQLite state is not quiescent; WAL/SHM/journal sidecars must be absent.")
    if facts.get("sidecars_absent") is not True:
        errors.append("Production sidecar absence was not established.")

    backup = facts.get("backup")
    if not isinstance(backup, dict) or not backup.get("exists"):
        errors.append("Byte-for-byte pre-migration Production backup is missing.")
    elif database and backup.get("sha256") != database.get("sha256"):
        errors.append("Production backup hash does not match the pre-migration database hash.")
    if not isinstance(migration_authorization, dict):
        errors.append("Separate Production V4 migration authorization is missing or unreadable.")
    else:
        if migration_authorization.get("status") != "OWNER_AUTHORIZED_PRODUCTION_V4_MIGRATION":
            errors.append("A separate explicit Owner Production V4 migration authorization is required.")
    if migration_authorization and backup and migration_authorization.get("productionDbPreMigrationSha256") != database.get("sha256"):
        errors.append("Migration approval is not bound to the verified Production pre-migration hash.")
    if migration_authorization and backup and Path(str(migration_authorization.get("backupPath", ""))).resolve() != Path(str(backup.get("path", ""))).resolve():
        errors.append("Verified backup path does not match the migration approval.")
    if migration_authorization and candidate and migration_authorization.get("candidateExecutableSha256") != candidate.get("executable_sha256"):
        errors.append("Migration approval candidate hash does not match the installed candidate.")
    if not isinstance(migration_authorization, dict) or not _nonempty_json_string(migration_authorization.get("authorizationId")):
        errors.append("Production migration authorization ID is missing.")
    if backup and Path(str(backup.get("path", ""))).resolve() == Path(str(database.get("path", ""))).resolve():
        errors.append("Production byte-for-byte backup path must differ from the source database path.")
    if backup and database:
        backup_path = Path(str(backup.get("path", ""))).resolve()
        required_backup_root = Path(str(database.get("path", ""))).resolve().parent / "production-v4-backups"
        try:
            backup_path.relative_to(required_backup_root)
        except ValueError:
            errors.append("Production backup path must be inside the native-approved production-v4-backups directory.")
    if candidate and (candidate.get("executable_name") != EXECUTABLE_NAME or Path(str(candidate.get("executable_path", ""))).name != EXECUTABLE_NAME):
        errors.append("Candidate executable name/path is not the fixed Production executable.")
    return errors


def make_release_receipt(facts: dict[str, Any], *, synthetic_fixture_root: Path | None = None) -> dict[str, Any]:
    errors = validate_preflight(facts, synthetic_fixture_root=synthetic_fixture_root)
    if errors:
        raise GateBlocked(errors)
    candidate = facts["candidate"]
    database = facts["production_database"]
    backup = facts["backup"]
    return {
        "receiptFormatVersion": 1,
        "status": "PREFLIGHT_PASS_READY_FOR_SEPARATELY_AUTHORIZED_MIGRATION",
        "observedAtUtc": datetime.now(timezone.utc).isoformat(),
        "productionBundleId": PRODUCTION_BUNDLE_ID,
        "installedAppPath": str(Path(str(facts["expected_installed_app"])).resolve()),
        "candidateExecutablePath": candidate["executable_path"],
        "candidateExecutableSha256": candidate["executable_sha256"],
        "compatibilityManifestSha256": candidate["manifest_sha256"],
        "maxSupportedSchemaVersion": candidate["manifest"]["maxSupportedSchemaVersion"],
        "sidecarsAbsent": database.get("sidecars") == [] and facts.get("sidecars_absent") is True,
        "productionDatabasePath": database["path"],
        "productionDatabasePreMigrationSha256": database["sha256"],
        "productionSchema": {
            "userVersion": database["user_version"],
            "migrationVersion": database["migration_version"],
        },
        "backupPath": str(Path(str(backup["path"])).resolve()),
        "backupSha256": backup["sha256"],
        "ownerAuthorizationId": facts["migration_authorization"].get("authorizationId"),
        "candidateApprovalId": facts["candidate_approval"].get("authorizationId"),
        "processInventory": facts.get("process_inventory"),
        "productionAppInventory": facts["production_apps"],
    }


def _load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as stream:
            value = json.load(stream)
        if not isinstance(value, dict):
            raise ValueError(f"{label} must be a JSON object.")
        return value
    except (OSError, json.JSONDecodeError) as error:
        raise GateBlocked([f"{label} is missing or unreadable: {error}"]) from error


def _persist_receipt(path: Path, receipt: dict[str, Any], *, create: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if create:
        with path.open("x", encoding="utf-8") as stream:
            json.dump(receipt, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        return
    temporary = path.with_name(path.name + f".tmp-{os.getpid()}")
    with temporary.open("x", encoding="utf-8") as stream:
        json.dump(receipt, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def collect_real_facts(candidate_approval_path: Path, migration_authorization_path: Path) -> dict[str, Any]:
    candidate_approval = _load_json(candidate_approval_path, "Candidate approval")
    migration_authorization = _load_json(migration_authorization_path, "Production migration authorization")
    roots = [Path("/Applications"), Path.home() / "Applications"]
    apps = inventory_production_apps(roots)
    if not APP_PATH.exists():
        candidate: dict[str, Any] = {}
    else:
        candidate = read_bundle(APP_PATH)
    database = inspect_database(DATABASE_PATH)
    approval_backup_path = Path(str(migration_authorization.get("backupPath", "")))
    backup = {
        "path": str(approval_backup_path.resolve()) if approval_backup_path.exists() else str(approval_backup_path),
        "exists": approval_backup_path.is_file(),
        "sha256": sha256_file(approval_backup_path) if approval_backup_path.is_file() else None,
    }
    process_inventory = inventory_production_processes(known_apps=apps)
    processes = process_inventory["processes"] if process_inventory["complete"] else None
    database_sidecars_absent = database.get("sidecars") == []
    return {
        "platform": sys.platform,
        "expected_installed_app": str(APP_PATH),
        "expected_database_path": str(DATABASE_PATH),
        "running_production_processes": processes,
        "process_inventory": process_inventory,
        "process_inventory_complete": process_inventory["complete"],
        "app_inventory_complete": True,
        "sidecars_absent": database_sidecars_absent,
        "production_apps": apps,
        "candidate": candidate,
        "candidate_approval": candidate_approval,
        "migration_authorization": migration_authorization,
        "production_database": database,
        "backup": backup,
    }


def write_migration_permit(receipt: dict[str, Any], approval: dict[str, Any], permit_path: Path = GATE_AUTH_PATH) -> tuple[Path, str]:
    if receipt.get("sidecarsAbsent") is not True:
        raise GateBlocked(["SQLite sidecar absence was not bound into the release receipt."])
    nonce = secrets.token_urlsafe(32)
    permit = {
        **receipt,
        "receiptFormatVersion": 1,
        "status": "ONE_TIME_PRODUCTION_V4_MIGRATION_AUTHORIZATION",
        "nonce": nonce,
        "issuedAtUnix": int(time.time()),
        "expiresAtUnix": int(time.time()) + 120,
        "ownerAuthorizationId": approval.get("authorizationId"),
    }
    permit_path.parent.mkdir(parents=True, exist_ok=True)
    if permit_path.exists():
        raise GateBlocked(["An unconsumed Production migration authorization already exists."])
    temporary = permit_path.with_suffix(".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(permit, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, permit_path)
    directory_fd = os.open(permit_path.parent, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
    return permit_path, nonce


def run_gate(
    mode: str,
    candidate_approval_path: Path,
    migration_authorization_path: Path,
    receipt_path: Path | None = None,
) -> dict[str, Any]:
    if sys.platform != "darwin":
        raise GateBlocked(["Production release gate requires macOS."])
    if receipt_path is None:
        raise GateBlocked(["A persistent release receipt path is required."])
    migration_authorization = _load_json(migration_authorization_path, "Production migration authorization")
    if migration_authorization.get("status") != "OWNER_AUTHORIZED_PRODUCTION_V4_MIGRATION":
        raise GateBlocked(["A separate explicit Owner Production V4 migration authorization is required."])
    facts = collect_real_facts(candidate_approval_path, migration_authorization_path)
    receipt = make_release_receipt(facts, synthetic_fixture_root=root)
    if mode == "preflight":
        _persist_receipt(receipt_path, receipt, create=True)
        return receipt
    if mode != "migrate":
        raise ValueError(f"Unsupported gate mode: {mode}")
    receipt["status"] = "GATE_PASSED_MIGRATION_PERMITTED"
    _persist_receipt(receipt_path, receipt, create=True)
    try:
        permit_path, _nonce = write_migration_permit(receipt, migration_authorization)
    except Exception as error:
        receipt["status"] = "GATE_PASSED_PERMIT_ISSUANCE_FAILED"
        receipt["permitIssuanceError"] = f"{type(error).__name__}: {error}"
        _persist_receipt(receipt_path, receipt, create=False)
        raise
    executable = Path(receipt["candidateExecutablePath"])
    try:
        process = subprocess.Popen([str(executable)], cwd=str(executable.parent), start_new_session=True)
    except OSError:
        permit_path.unlink(missing_ok=True)
        receipt["status"] = "GATE_PASSED_CANDIDATE_LAUNCH_FAILED"
        _persist_receipt(receipt_path, receipt, create=False)
        raise
    receipt["launchPid"] = process.pid
    receipt["status"] = "GATE_PASSED_CANDIDATE_LAUNCHED_MIGRATION_PENDING"
    _persist_receipt(receipt_path, receipt, create=False)
    return receipt


def retirement_replace(
    old_app: Path,
    candidate_source: Path,
    normal_app_path: Path,
    archive_root: Path,
    authorization: dict[str, Any],
    running_processes: list[dict[str, Any]],
    production_app_inventory: list[dict[str, Any]],
    expected_old_sha256: str = LEGACY_EXECUTABLE_SHA256,
) -> dict[str, Any]:
    if authorization.get("status") != "OWNER_AUTHORIZED_RUNTIME_REPLACEMENT":
        raise GateBlocked(["A separate Owner authorization for runtime replacement is required."])
    required_string_fields = (
        "authorizationId", "oldAppPath", "candidateAppPath", "targetAppPath",
        "oldExecutableSha256", "candidateExecutableSha256", "candidateManifestSha256",
    )
    invalid_fields = [key for key in required_string_fields if not _nonempty_json_string(authorization.get(key))]
    if invalid_fields:
        raise GateBlocked([f"Runtime replacement authorization fields must be non-empty JSON strings: {', '.join(invalid_fields)}"])
    if not _nonempty_json_string(authorization.get("authorizationId")):
        raise GateBlocked(["Runtime replacement authorization ID is missing."])
    if authorization.get("oldExecutableSha256") != expected_old_sha256:
        raise GateBlocked(["Replacement authorization does not match the installed legacy executable hash."])
    if Path(authorization["candidateAppPath"]).resolve(strict=True) != candidate_source.resolve(strict=True):
        raise GateBlocked(["Replacement authorization does not name this exact candidate app path."])
    if Path(authorization["targetAppPath"]).resolve(strict=False) != normal_app_path.resolve(strict=False):
        raise GateBlocked(["Replacement authorization does not name this exact Production install path."])
    if Path(authorization["oldAppPath"]).resolve(strict=True) != old_app.resolve(strict=True):
        raise GateBlocked(["Replacement authorization does not name this exact installed legacy app path."])
    if running_processes:
        raise GateBlocked(["A Production runtime process is still running; retirement cannot start."])
    old = read_bundle(old_app)
    if old["bundle_id"] != PRODUCTION_BUNDLE_ID or old["executable_sha256"] != expected_old_sha256:
        raise GateBlocked(["Installed app does not match the recorded legacy Production runtime."])
    if normal_app_path.resolve() != old_app.resolve() or not old_app.exists():
        raise GateBlocked(["Legacy runtime path is not the expected Production install path."])
    if len(production_app_inventory) != 1 or production_app_inventory[0].get("bundle_path") != str(old_app.resolve()):
        raise GateBlocked(["Normal app locations contain unknown or duplicate Production app copies."])
    candidate = read_bundle(candidate_source)
    candidate_errors = validate_manifest(candidate)
    if candidate_errors:
        raise GateBlocked(candidate_errors)
    if candidate["bundle_id"] != PRODUCTION_BUNDLE_ID:
        raise GateBlocked(["Candidate bundle ID is not the Production identity."])
    if candidate["executable_sha256"] != authorization.get("candidateExecutableSha256"):
        raise GateBlocked(["Candidate hash does not match the replacement authorization."])
    approved_manifest_hash = authorization.get("candidateManifestSha256")
    if not approved_manifest_hash or candidate.get("manifest_sha256") != approved_manifest_hash:
        raise GateBlocked(["Candidate manifest bytes do not match the replacement authorization."])
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(4)
    archive_dir = archive_root / f"legacy-v3-{timestamp}"
    archive_app = archive_dir / (APP_NAME + ".retired")
    candidate_stage = normal_app_path.with_name(normal_app_path.name + ".v4-staging")
    archive_dir.mkdir(parents=True, exist_ok=False)
    original_files = file_inventory(old_app)
    shutil.copytree(old_app, archive_app, symlinks=True)
    if file_inventory(archive_app) != original_files:
        shutil.rmtree(archive_dir, ignore_errors=True)
        raise GateBlocked(["Archived legacy app does not byte-match the installed source."])
    archive_executable = archive_app / "Contents/MacOS" / old["executable_name"]
    original_mode = stat.S_IMODE(archive_executable.stat().st_mode)
    archive_executable.chmod(original_mode & ~0o111)
    if archive_executable.stat().st_mode & 0o111:
        raise GateBlocked(["Archived legacy executable remains launchable."])
    receipt = {
        "status": "LEGACY_RUNTIME_ARCHIVED_AND_DISABLED",
        "observedAtUtc": datetime.now(timezone.utc).isoformat(),
        "authorizationId": authorization["authorizationId"],
        "originalBundlePath": str(old_app),
        "archivePath": str(archive_app),
        "legacyExecutableSha256": old["executable_sha256"],
        "archiveExecutableOriginalMode": original_mode,
        "archiveFileInventory": original_files,
        "candidateExecutableSha256": candidate["executable_sha256"],
        "candidateManifestSha256": candidate["manifest_sha256"],
        "productionAppInventory": production_app_inventory,
        "processInventory": {"complete": True, "processes": running_processes},
    }
    receipt_path = archive_dir / "retirement-receipt.json"
    _persist_receipt(receipt_path, receipt, create=True)

    try:
        shutil.rmtree(old_app)
        shutil.copytree(candidate_source, candidate_stage, symlinks=True)
        staged = read_bundle(candidate_stage)
        if staged["executable_sha256"] != candidate["executable_sha256"] or staged["manifest_sha256"] != approved_manifest_hash:
            raise GateBlocked(["Staged candidate executable or manifest bytes differ from the approved source."])
        os.replace(candidate_stage, normal_app_path)
        installed = read_bundle(normal_app_path)
        errors = validate_manifest(installed)
        expected_installed_executable = normal_app_path.resolve(strict=True) / "Contents/MacOS" / EXECUTABLE_NAME
        installed_executable = Path(installed["executable_path"]).resolve(strict=True)
        if errors or installed["bundle_id"] != PRODUCTION_BUNDLE_ID or installed["executable_name"] != EXECUTABLE_NAME or installed_executable != expected_installed_executable or installed["executable_sha256"] != candidate["executable_sha256"] or installed["manifest_sha256"] != approved_manifest_hash:
            raise GateBlocked(errors or ["Installed Production candidate executable or manifest bytes differ from the approved candidate."])
        receipt["status"] = "CANDIDATE_INSTALLED_AND_VERIFIED"
        receipt["installedBundleId"] = installed["bundle_id"]
        receipt["installedExecutablePath"] = installed["executable_path"]
        receipt["installedExecutableSha256"] = installed["executable_sha256"]
        receipt["installedManifestSha256"] = installed["manifest_sha256"]
        _persist_receipt(receipt_path, receipt, create=False)
        return receipt
    except Exception as failure:
        rollback_errors: list[str] = []
        try:
            if candidate_stage.exists():
                shutil.rmtree(candidate_stage)
            if normal_app_path.exists():
                shutil.rmtree(normal_app_path)
            shutil.copytree(archive_app, normal_app_path, symlinks=True)
            restored_executable = normal_app_path / "Contents/MacOS" / old["executable_name"]
            restored_executable.chmod(original_mode)
            restored = read_bundle(normal_app_path)
            if restored["executable_sha256"] != old["executable_sha256"] or restored["bundle_id"] != PRODUCTION_BUNDLE_ID or restored["executable_name"] != old["executable_name"]:
                raise ValueError("restored old app identity/hash verification failed")
            if stat.S_IMODE(restored_executable.stat().st_mode) != original_mode:
                raise ValueError("restored old app executable mode verification failed")
            receipt["status"] = "ROLLBACK_COMPLETED"
            receipt["rollbackExecutableSha256"] = restored["executable_sha256"]
            receipt["rollbackExecutableMode"] = stat.S_IMODE(restored_executable.stat().st_mode)
        except Exception as rollback_error:
            rollback_errors.append(f"{type(rollback_error).__name__}: {rollback_error}")
            receipt["status"] = "ROLLBACK_FAILED"
            receipt["rollbackErrors"] = rollback_errors
        receipt["failure"] = f"{type(failure).__name__}: {failure}"
        receipt["recoveryArchivePath"] = str(archive_app)
        _persist_receipt(receipt_path, receipt, create=False)
        if receipt["status"] == "ROLLBACK_FAILED":
            raise GateBlocked(["Runtime replacement failed and rollback failed; archived recovery evidence remains at " + str(archive_app), *rollback_errors]) from failure
        raise GateBlocked([f"Runtime replacement failed; old app was restored from {archive_app}: {failure}"]) from failure


def run_retirement(candidate_path: Path, authorization_path: Path) -> dict[str, Any]:
    if sys.platform != "darwin":
        raise GateBlocked(["Production runtime retirement is supported only on macOS."])
    observed: dict[str, Any] = {
        "status": "PRECHECK_BLOCKED",
        "observedAtUtc": datetime.now(timezone.utc).isoformat(),
        "candidatePath": str(candidate_path),
        "oldAppPath": str(APP_PATH),
        "destructiveActionPerformed": False,
        "appInventoryComplete": False,
        "productionAppInventory": None,
        "processInventory": {"complete": False, "processes": None},
    }
    try:
        authorization = _load_json(authorization_path, "Runtime replacement authorization")
        installed_apps = inventory_production_apps([Path("/Applications"), Path.home() / "Applications"])
        observed["appInventoryComplete"] = True
        observed["productionAppInventory"] = installed_apps
        process_inventory = inventory_production_processes(known_apps=installed_apps)
        observed["processInventory"] = process_inventory
        if process_inventory.get("complete") is not True or not isinstance(process_inventory.get("processes"), list):
            raise GateBlocked(process_inventory.get("diagnostics") or ["Process inventory is incomplete or unknown."])
        processes = process_inventory["processes"]
    except Exception as error:
        observed["exceptionCategory"] = type(error).__name__
        observed["exceptionMessage"] = str(error)
        observed["destructiveActionPerformed"] = False
        receipt_path = APP_DATA / "runtime-replacement-receipts" / f"precheck-blocked-{int(time.time())}-{secrets.token_hex(4)}.json"
        try:
            _persist_receipt(receipt_path, observed, create=True)
        except Exception as persist_error:
            raise GateBlocked([f"Precheck failed: {type(error).__name__}: {error}", f"PRECHECK_BLOCKED receipt could not be persisted: {type(persist_error).__name__}: {persist_error}"]) from error
        reasons = error.reasons if isinstance(error, GateBlocked) else [f"{type(error).__name__}: {error}"]
        raise GateBlocked([*reasons, f"Precheck receipt: {receipt_path}"]) from error
    archive_root = APP_DATA / "retired-production-runtimes"
    receipts_before = set(archive_root.glob("*/retirement-receipt.json")) if archive_root.exists() else set()
    try:
        return retirement_replace(
            APP_PATH,
            candidate_path,
            APP_PATH,
            archive_root,
            authorization,
            processes,
            installed_apps,
        )
    except Exception as error:
        existing_receipts = [item for item in (archive_root.glob("*/retirement-receipt.json") if archive_root.exists() else []) if item not in receipts_before]
        prior_receipts: list[tuple[Path, dict[str, Any]]] = []
        for item in existing_receipts:
            try:
                prior_receipts.append((item, json.loads(item.read_text(encoding="utf-8"))))
            except (OSError, json.JSONDecodeError):
                continue
        final_receipts = [(path, receipt) for path, receipt in prior_receipts if receipt.get("status") in {"CANDIDATE_INSTALLED_AND_VERIFIED", "ROLLBACK_COMPLETED", "ROLLBACK_FAILED"}]
        if final_receipts:
            if isinstance(error, GateBlocked):
                raise
            raise GateBlocked([f"Runtime replacement failed: {type(error).__name__}: {error}"]) from error
        if prior_receipts:
            path, receipt = max(prior_receipts, key=lambda item: item[0].stat().st_mtime)
            raise GateBlocked([f"Runtime replacement outcome is incomplete; inspect persisted receipt {path} (status={receipt.get('status')})."]) from error
        if not prior_receipts:
            observed["status"] = "PRECHECK_BLOCKED"
            observed["exceptionCategory"] = type(error).__name__
            observed["exceptionMessage"] = str(error)
            observed["destructiveActionPerformed"] = False
            receipt_path = APP_DATA / "runtime-replacement-receipts" / f"precheck-blocked-{int(time.time())}-{secrets.token_hex(4)}.json"
            try:
                _persist_receipt(receipt_path, observed, create=True)
            except Exception as persist_error:
                raise GateBlocked([f"Precheck failed: {type(error).__name__}: {error}", f"PRECHECK_BLOCKED receipt could not be persisted: {type(persist_error).__name__}: {persist_error}"]) from error
            reasons = error.reasons if isinstance(error, GateBlocked) else [f"{type(error).__name__}: {error}"]
            raise GateBlocked([*reasons, f"Precheck receipt: {receipt_path}"]) from error


def create_synthetic_rehearsal(fixture_root: Path) -> dict[str, Any]:
    root = fixture_root.resolve()
    protected = [Path("/Applications").resolve(), APP_DATA.resolve()]
    if any(root == item or item in root.parents or root in item.parents for item in protected):
        raise GateBlocked(["Synthetic rehearsal root overlaps a protected real Production path."])
    if root.exists() and any(root.iterdir()):
        raise GateBlocked(["Synthetic rehearsal requires an empty isolated fixture directory."])
    app_data = root / "Library/Application Support" / PRODUCTION_BUNDLE_ID
    app_path = root / "Applications" / APP_NAME
    executable = app_path / "Contents/MacOS" / EXECUTABLE_NAME
    executable.parent.mkdir(parents=True, exist_ok=True)
    executable.write_bytes(b"synthetic-approved-v4-runtime")
    executable.chmod(0o755)
    with (app_path / "Contents/Info.plist").open("wb") as stream:
        plistlib.dump({"CFBundleIdentifier": PRODUCTION_BUNDLE_ID, "CFBundleExecutable": EXECUTABLE_NAME, "CFBundleShortVersionString": "fixture"}, stream)
    manifest = {
        "manifestFormatVersion": 1,
        "runtimeGeneration": 4,
        "minSupportedSchemaVersion": 1,
        "maxSupportedSchemaVersion": 4,
        "bundleId": PRODUCTION_BUNDLE_ID,
        "executable": f"Contents/MacOS/{EXECUTABLE_NAME}",
    }
    manifest_path = app_path / MANIFEST_RELATIVE_PATH
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    database_path = app_data / DATABASE_NAME
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(database_path) as connection:
        connection.executescript(
            "CREATE TABLE profiles(id TEXT PRIMARY KEY);"
            "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);"
            "INSERT INTO schema_migrations VALUES(1,'fixture'),(2,'fixture'),(3,'fixture');"
            "PRAGMA user_version=3;"
        )
    backup_path = app_data / "production-v4-backups" / DATABASE_NAME
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(database_path, backup_path)
    candidate = read_bundle(app_path)
    database = inspect_database(database_path)
    backup = {"path": str(backup_path.resolve()), "exists": True, "sha256": sha256_file(backup_path)}
    migration_authorization = {
        "status": "OWNER_AUTHORIZED_PRODUCTION_V4_MIGRATION",
        "authorizationId": "synthetic-chain-authorization-1",
        "productionDbPreMigrationSha256": database["sha256"],
        "candidateExecutableSha256": candidate["executable_sha256"],
        "backupPath": str(backup_path.resolve()),
    }
    facts = {
        "platform": "darwin",
        "expected_installed_app": str(app_path.resolve()),
        "expected_database_path": str(database_path.resolve()),
        "running_production_processes": [],
        "process_inventory": {"complete": True, "processes": []},
        "process_inventory_complete": True,
        "app_inventory_complete": True,
        "sidecars_absent": True,
        "production_apps": [candidate],
        "candidate": candidate,
        "candidate_approval": {
            "status": "OWNER_APPROVED_V4_PRODUCTION_CANDIDATE",
            "authorizationId": "synthetic-candidate-approval-1",
            "candidateExecutableSha256": candidate["executable_sha256"],
            "compatibilityManifestSha256": candidate["manifest_sha256"],
            "bundleId": PRODUCTION_BUNDLE_ID,
            "maxSupportedSchemaVersion": 4,
        },
        "migration_authorization": migration_authorization,
        "production_database": database,
        "backup": backup,
    }
    receipt = make_release_receipt(facts, synthetic_fixture_root=root)
    receipt_path = root / "evidence" / "preflight-receipt.json"
    _persist_receipt(receipt_path, receipt, create=True)
    permit_path = app_data / PRODUCTION_MIGRATION_AUTHORIZATION
    write_migration_permit(receipt, migration_authorization, permit_path)
    return {
        "status": "SYNTHETIC_PREFLIGHT_AND_PERMIT_CREATED",
        "fixtureRoot": str(root),
        "appData": str(app_data),
        "appPath": str(app_path),
        "executablePath": str(executable),
        "databasePath": str(database_path),
        "backupPath": str(backup_path),
        "receiptPath": str(receipt_path),
        "permitPath": str(permit_path),
        "candidateExecutableSha256": candidate["executable_sha256"],
        "manifestSha256": candidate["manifest_sha256"],
        "databaseSha256": database["sha256"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in ("preflight", "migrate"):
        subparser = subparsers.add_parser(name)
        subparser.add_argument("--candidate-approval", type=Path, required=True)
        subparser.add_argument("--migration-authorization", type=Path, required=True)
        subparser.add_argument("--receipt", type=Path, required=True)
    retire = subparsers.add_parser("retire")
    retire.add_argument("--candidate-app", type=Path, required=True)
    retire.add_argument("--replacement-authorization", type=Path, required=True)
    rehearse = subparsers.add_parser("rehearse-synthetic", help="test-only gate fixture creation; never touches Production")
    rehearse.add_argument("--fixture-root", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "retire":
            result = run_retirement(args.candidate_app, args.replacement_authorization)
        elif args.command == "rehearse-synthetic":
            result = create_synthetic_rehearsal(args.fixture_root)
        else:
            result = run_gate(args.command, args.candidate_approval, args.migration_authorization, args.receipt)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        reasons = error.reasons if isinstance(error, GateBlocked) else [f"{type(error).__name__}: {error}"]
        print(json.dumps({"status": "BLOCKED", "errorType": type(error).__name__, "reasons": reasons}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
