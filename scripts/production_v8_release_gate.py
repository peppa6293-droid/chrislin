#!/usr/bin/env python3
"""Fail-closed Production V8 schema-authority release gate.

The historical V3 -> V4 gate remains in ``production_v4_release_gate.py``.
This module is the only gate that may prepare a Production V8 migration, and it
never treats an isolated rehearsal as Production authority.
"""

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
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

PRODUCTION_BUNDLE_ID = "com.personalfinance.console"
ACCEPTANCE_BUNDLE_ID = "com.personalfinance.console.v4acceptance"
SMOKE_BUNDLE_ID = "com.personalfinance.console.smoke"
DATABASE_NAME = "personal-finance-console.sqlite3"
APP_NAME = "Personal Finance Console.app"
EXECUTABLE_NAME = "personal-finance-console"
APP_PATH = Path("/Applications") / APP_NAME
APP_DATA = Path.home() / "Library/Application Support" / PRODUCTION_BUNDLE_ID
DATABASE_PATH = APP_DATA / DATABASE_NAME
AUTHORIZATION_NAME = "production-v8-migration-authorization.json"
RELEASE_RECEIPT_NAME = "production-v8-release-receipt.json"
CONSUMED_LEDGER_NAME = "production-v8-consumed-authorizations.json"
TERMINAL_NAME = "production-v8-cutover-terminal.json"
LEGACY_AUTHORIZATION_NAME = "production-v4-migration-authorization.json"
LEGACY_TERMINAL_NAME = "production-v4-cutover-terminal.json"
BACKUP_DIRECTORY = "production-v8-backups"
MANIFEST_RELATIVE_PATH = Path("Contents/Resources/runtime-compatibility.json")
SYNTHETIC_GATE_MARKER = b"PFC_WP04R2A_GATE_SYNTHETIC_V1\n"
SOURCE_SCHEMA_VERSION = 3
TARGET_SCHEMA_VERSION = 8
MAX_AUTHORIZATION_SECONDS = 120
MAX_JSON_BYTES = 1_048_576
MAX_EXECUTABLE_BYTES = 536_870_912
REQUIRED_MANIFEST = {
    "manifestFormatVersion": 2,
    "runtimeGeneration": 8,
    "minSupportedSchemaVersion": 8,
    "maxSupportedSchemaVersion": 8,
    "migrationSourceSchemaVersion": 3,
    "bundleId": PRODUCTION_BUNDLE_ID,
    "executable": f"Contents/MacOS/{EXECUTABLE_NAME}",
}
PREFLIGHT_STATUS = "PREFLIGHT_PASS_READY_FOR_SEPARATELY_AUTHORIZED_MIGRATION"
APPROVAL_STATUS = "OWNER_APPROVED_V8_PRODUCTION_CANDIDATE"
AUTHORIZATION_STATUS = "OWNER_AUTHORIZED_PRODUCTION_V8_MIGRATION"
PERMIT_STATUS = "ONE_TIME_PRODUCTION_V8_MIGRATION_AUTHORIZATION"
NATIVE_SUCCESS = "V8_MIGRATION_VERIFIED_NATIVE"
LEGACY_V4_EXECUTABLE_SHA256 = "0e6dcb261de20eb96fcb2f85eaa7fe78fc3cd8c72a96bee78856ac081153911f"


class GateBlocked(RuntimeError):
    """A refusal with every observed reason preserved."""

    def __init__(self, reasons: list[str]):
        self.reasons = reasons
        super().__init__("Production V8 release gate blocked: " + "; ".join(reasons))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _read_stable_regular_file(path: Path, label: str, limit: int) -> tuple[bytes, str, os.stat_result]:
    """Read a file through one no-follow descriptor and bind the read to the path.

    The regular-file and link-count checks, the bytes, the digest, and the caller's
    parse all derive from the same descriptor. After the read the descriptor identity
    is compared with the path identity, so replacing or aliasing the path cannot
    substitute different bytes for the facts that were just computed.
    """
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    try:
        descriptor = os.open(path, flags)
        with os.fdopen(descriptor, "rb") as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
                raise GateBlocked([f"{label} must be a single-link regular file, not a symlink or hard link."])
            data = stream.read(limit + 1)
            after = os.fstat(stream.fileno())
        current = path.lstat()
        key = lambda item: (item.st_dev, item.st_ino, item.st_size, item.st_nlink, item.st_mtime_ns)
        if (
            len(data) > limit
            or stat.S_ISLNK(current.st_mode)
            or key(before) != key(after)
            or key(before) != key(current)
        ):
            raise GateBlocked([f"{label} changed while being read or exceeds the size limit."])
        return data, hashlib.sha256(data).hexdigest(), before
    except GateBlocked:
        raise
    except OSError as error:
        raise GateBlocked([f"{label} is missing, redirected, or unreadable: {type(error).__name__}: {error}"]) from error


def _metadata_or_none(path: Path) -> os.stat_result | None:
    try:
        return path.lstat()
    except FileNotFoundError:
        return None
    except OSError as error:
        raise GateBlocked([f"Path metadata is unavailable for {path}: {type(error).__name__}: {error}"]) from error


def _require_regular_file(path: Path, label: str) -> os.stat_result:
    metadata = _metadata_or_none(path)
    if metadata is None or not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) or metadata.st_nlink != 1:
        raise GateBlocked([f"{label} is missing, redirected, linked, or not a regular file: {path}"])
    return metadata


def _canonical_path(path: Path, label: str) -> Path:
    try:
        resolved = path.resolve(strict=True)
    except OSError as error:
        raise GateBlocked([f"{label} cannot be resolved: {type(error).__name__}: {error}"]) from error
    if resolved != path:
        raise GateBlocked([f"{label} is a path alias rather than its canonical path: {path}"])
    return resolved


def fixed_receipt_path(expected_app_data: Path) -> Path:
    return Path(expected_app_data) / RELEASE_RECEIPT_NAME


def validate_receipt_path(
    raw_path: Any,
    expected_app_data: Path,
    *,
    synthetic_root: Path | None = None,
) -> list[str]:
    """Refuse every release-receipt location except the mode's one fixed file.

    The raw path is compared directly against the expected path; a custom --receipt
    is never accepted, never persisted, and never reaches permit creation or the
    native migration runner.
    """
    errors: list[str] = []
    if not isinstance(raw_path, (str, os.PathLike)) or not str(raw_path).strip():
        return ["Release receipt path is missing."]
    candidate = Path(raw_path)
    expected_data = Path(expected_app_data)
    expected = fixed_receipt_path(expected_data)
    if not candidate.is_absolute():
        errors.append("Release receipt path must be absolute.")
    if candidate != expected:
        errors.append(f"Release receipt path must be exactly the fixed canonical file {expected}; custom receipt paths are refused.")
    if candidate.parent != expected.parent:
        errors.append("Release receipt path parent must be the application-data root.")
    if synthetic_root is not None:
        root = Path(synthetic_root)
        try:
            canonical_candidate = candidate.resolve(strict=False)
            canonical_root = root.resolve(strict=True)
        except OSError as error:
            errors.append(f"Synthetic receipt path cannot be resolved: {type(error).__name__}: {error}")
        else:
            if canonical_candidate != candidate:
                errors.append("Synthetic receipt path is a path alias rather than its canonical path.")
            try:
                canonical_candidate.relative_to(canonical_root)
            except ValueError:
                errors.append("Synthetic receipt path must stay inside the marked root.")
    return errors


def fixed_backup_path(expected_app_data: Path) -> Path:
    return Path(expected_app_data) / BACKUP_DIRECTORY / DATABASE_NAME


def validate_fixed_backup_path(raw_path: Any, expected_app_data: Path) -> list[str]:
    """Refuse every backup location except the one canonical fixed file.

    The raw path is compared component-by-component before any resolution, so a
    symlink alias, a nested copy, a hard-link sibling, or a different basename is
    never normalized into the legal path.
    """
    errors: list[str] = []
    if not isinstance(raw_path, str) or not raw_path.strip():
        return ["Backup path is missing."]
    candidate = Path(raw_path)
    expected_data = Path(expected_app_data)
    expected = fixed_backup_path(expected_data)
    if not candidate.is_absolute():
        errors.append("Backup path must be absolute.")
    if candidate != expected:
        errors.append(f"Backup path must be exactly the fixed canonical file {expected}; nested, alternate, aliased, or escaped paths are refused.")
    if candidate.parent != expected.parent:
        errors.append("Backup path parent must be the fixed production-v8-backups directory.")
    try:
        if expected_data.resolve(strict=True) != expected_data:
            errors.append("Application-data root is a path alias rather than its canonical path.")
    except OSError as error:
        errors.append(f"Application-data root cannot be resolved: {type(error).__name__}: {error}")
    try:
        if expected.parent.resolve(strict=True) != expected.parent:
            errors.append("Production backup directory is a path alias rather than its canonical path.")
    except OSError as error:
        errors.append(f"Fixed production backup directory cannot be resolved: {type(error).__name__}: {error}")
    return errors


def _nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _valid_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(character in "0123456789abcdef" for character in value)



def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _load_json_exact(path: Path, label: str) -> tuple[dict[str, Any], str, bytes]:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    try:
        fd = os.open(path, flags)
        with os.fdopen(fd, "rb") as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
                raise GateBlocked([f"{label} must be a single-link regular file."])
            data = stream.read(MAX_JSON_BYTES + 1)
            after = os.fstat(stream.fileno())
        current = path.lstat()
        key = lambda item: (item.st_dev, item.st_ino, item.st_size, item.st_nlink, item.st_mtime_ns)
        if len(data) > MAX_JSON_BYTES or key(before) != key(after) or key(before) != key(current):
            raise GateBlocked([f"{label} changed while being read or exceeds the size limit."])
        value = json.loads(data)
        if not isinstance(value, dict):
            raise ValueError("expected a JSON object")
        return value, hashlib.sha256(data).hexdigest(), data
    except GateBlocked:
        raise
    except (OSError, json.JSONDecodeError, ValueError) as error:
        raise GateBlocked([f"{label} is missing, unsafe, or unreadable: {type(error).__name__}: {error}"]) from error


def _persist_json_create(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(
        path,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    directory_fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def read_bundle(app_path: Path) -> dict[str, Any]:
    _canonical_path(app_path, "Candidate app bundle")
    metadata = _metadata_or_none(app_path)
    if metadata is None or not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise GateBlocked([f"Candidate app bundle is missing or redirected: {app_path}"])
    info_path = app_path / "Contents/Info.plist"
    info_bytes, info_sha256, _ = _read_stable_regular_file(info_path, "Candidate Info.plist", MAX_JSON_BYTES)
    try:
        info = plistlib.loads(info_bytes)
    except Exception as error:
        raise GateBlocked([f"Candidate Info.plist is not a valid property list: {type(error).__name__}: {error}"]) from error
    if not isinstance(info, dict):
        raise GateBlocked(["Candidate Info.plist is not a dictionary."])
    bundle_id = info.get("CFBundleIdentifier")
    executable_name = info.get("CFBundleExecutable")
    if bundle_id != PRODUCTION_BUNDLE_ID:
        raise GateBlocked([f"Candidate bundle ID is not {PRODUCTION_BUNDLE_ID}: {bundle_id!r}"])
    if executable_name != EXECUTABLE_NAME:
        raise GateBlocked([f"Candidate CFBundleExecutable is not {EXECUTABLE_NAME}: {executable_name!r}"])
    executable_path = app_path / "Contents/MacOS" / EXECUTABLE_NAME
    _, executable_sha256, executable_metadata = _read_stable_regular_file(
        executable_path, "Candidate executable", MAX_EXECUTABLE_BYTES,
    )
    if not executable_metadata.st_mode & 0o111:
        raise GateBlocked(["Candidate executable has no execute permission."])
    resolved_executable = _canonical_path(executable_path, "Candidate executable")
    expected_executable = app_path / "Contents/MacOS" / EXECUTABLE_NAME
    if resolved_executable != expected_executable:
        raise GateBlocked(["Candidate executable resolves outside its bundle."])
    manifest_path = app_path / MANIFEST_RELATIVE_PATH
    if _metadata_or_none(manifest_path) is None:
        raise GateBlocked(["Candidate compatibility manifest is missing."])
    _require_regular_file(manifest_path, "Candidate compatibility manifest")
    _canonical_path(manifest_path, "Candidate compatibility manifest")
    manifest, manifest_sha256, _ = _load_json_exact(manifest_path, "Candidate compatibility manifest")
    return {
        "bundle_path": str(app_path),
        "bundle_id": bundle_id,
        "executable_name": executable_name,
        "executable_path": str(executable_path),
        "executable_sha256": executable_sha256,
        "executable_mode": stat.S_IMODE(executable_metadata.st_mode),
        "info_plist_path": str(info_path),
        "info_plist_sha256": info_sha256,
        "manifest_path": str(manifest_path),
        "manifest": manifest,
        "manifest_sha256": manifest_sha256,
    }


def inspect_database(path: Path) -> dict[str, Any]:
    _require_regular_file(path, "Production database")
    _canonical_path(path, "Production database")
    before = path.lstat()
    sidecars = [str(Path(str(path) + suffix)) for suffix in ("-wal", "-shm", "-journal") if _metadata_or_none(Path(str(path) + suffix)) is not None]
    if sidecars:
        raise GateBlocked(["SQLite sidecar exists; a quiescent database is required.", *sidecars])
    uri = f"file:{path.resolve()}?mode=ro"
    try:
        connection = sqlite3.connect(uri, uri=True)
    except sqlite3.Error as error:
        raise GateBlocked([f"Production database cannot be opened read-only: {error}"]) from error
    try:
        user_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
        has_migrations = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
        ).fetchone() is not None
        rows = (
            [int(row[0]) for row in connection.execute("SELECT version FROM schema_migrations ORDER BY version")]
            if has_migrations
            else []
        )
        count = int(connection.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0]) if has_migrations else 0
        migration_version = max(rows) if rows else 0
        integrity = [row[0] for row in connection.execute("PRAGMA integrity_check")]
        foreign_keys = [list(row) for row in connection.execute("PRAGMA foreign_key_check")]
    except sqlite3.Error as error:
        raise GateBlocked([f"Production database readback failed: {error}"]) from error
    finally:
        connection.close()
    if [str(Path(str(path) + suffix)) for suffix in ("-wal", "-shm", "-journal") if _metadata_or_none(Path(str(path) + suffix)) is not None]:
        raise GateBlocked(["SQLite sidecar appeared during production database readback."])
    after = path.lstat()
    if (before.st_dev, before.st_ino, before.st_nlink) != (after.st_dev, after.st_ino, after.st_nlink):
        raise GateBlocked(["Production database identity changed during readback."])
    return {
        "path": str(path.resolve()),
        "sha256": sha256_file(path),
        "device": after.st_dev,
        "inode": after.st_ino,
        "nlink": after.st_nlink,
        "user_version": user_version,
        "migration_version": migration_version,
        "migration_rows": rows,
        "migration_row_count": count,
        "integrity": integrity,
        "foreign_key_violations": foreign_keys,
        "sidecars": sidecars,
    }


def validate_manifest(bundle: dict[str, Any], *, expected_bundle_id: str = PRODUCTION_BUNDLE_ID) -> list[str]:
    errors: list[str] = []
    manifest = bundle.get("manifest")
    if not isinstance(manifest, dict):
        return ["Candidate has no embedded runtime compatibility manifest."]
    expected = dict(REQUIRED_MANIFEST)
    expected["bundleId"] = expected_bundle_id
    for key, value in expected.items():
        if manifest.get(key) != value:
            errors.append(f"Candidate compatibility manifest field {key} must be {value!r} (V8 contract).")
    return errors


def inventory_production_processes(
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    known_apps: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Return a fail-closed process inventory with no guessed absences."""
    diagnostics: list[str] = []
    complete = True
    processes: dict[int, dict[str, Any]] = {}
    try:
        ps = runner(
            ["/bin/ps", "-axo", "pid=,comm="],
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"complete": False, "processes": [], "diagnostics": [f"ps unavailable: {error}"]}
    if ps.returncode != 0:
        return {"complete": False, "processes": [], "diagnostics": [f"ps failed: {ps.returncode}"]}
    for line in ps.stdout.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        parts = stripped.split(maxsplit=1)
        if len(parts) != 2:
            complete = False
            diagnostics.append("ps emitted an unparseable process row")
            continue
        try:
            pid = int(parts[0])
        except ValueError:
            complete = False
            diagnostics.append("ps emitted a non-numeric pid")
            continue
        command = parts[1]
        if "Personal Finance Console" in command or command.endswith(EXECUTABLE_NAME) or PRODUCTION_BUNDLE_ID in command:
            processes[pid] = {"pid": pid, "command": command, "matched": "ps"}
    try:
        lsof = runner(
            ["/usr/sbin/lsof", "-n", "-P", "-F", "pn"],
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"complete": False, "processes": list(processes.values()), "diagnostics": [*diagnostics, f"lsof unavailable: {error}"]}
    if lsof.returncode not in (0, 1):
        complete = False
        diagnostics.append(f"lsof failed: {lsof.returncode}")
    else:
        current_pid: int | None = None
        for line in lsof.stdout.splitlines():
            if line.startswith("p"):
                try:
                    current_pid = int(line[1:])
                except ValueError:
                    complete = False
                    diagnostics.append("lsof emitted a non-numeric pid")
            elif line.startswith("n") and current_pid is not None:
                path = Path(line[1:])
                protected = (APP_PATH, APP_DATA, DATABASE_PATH)
                if any(path == item or item in path.parents for item in protected):
                    processes.setdefault(current_pid, {"pid": current_pid, "command": "", "matched": "lsof"})
    for app in known_apps or []:
        for process in processes.values():
            if app.get("bundle_path") and app.get("executable_path") and app["executable_path"] in str(process.get("command", "")):
                process["matched"] = "bundle"
    return {"complete": complete, "processes": sorted(processes.values(), key=lambda item: item["pid"]), "diagnostics": diagnostics}


def _validate_synthetic_gate_root(root: Path) -> Path:
    try:
        raw = root
        resolved = raw.resolve(strict=True)
        temporary = Path(tempfile.gettempdir()).resolve(strict=True)
        if raw != resolved or resolved == temporary or not resolved.is_relative_to(temporary):
            raise GateBlocked(["Synthetic gate root must be a canonical child of the OS temporary directory."])
        protected = [Path("/Applications").resolve(), APP_DATA.resolve()]
        if any(resolved == item or resolved in item.parents or item in resolved.parents for item in protected):
            raise GateBlocked(["Synthetic gate root overlaps a Production-protected path."])
        marker = resolved / "SYNTHETIC_ONLY"
        _require_regular_file(marker, "Synthetic gate marker")
        if marker.read_bytes() != SYNTHETIC_GATE_MARKER:
            raise GateBlocked(["Synthetic gate marker is missing or invalid."])
        if PRODUCTION_BUNDLE_ID in resolved.name:
            raise GateBlocked(["Synthetic gate root name must not identify Production."])
        return resolved
    except GateBlocked:
        raise
    except OSError as error:
        raise GateBlocked([f"Synthetic gate root is unavailable: {error}"]) from error


def _schema_facts(database: dict[str, Any]) -> tuple[int, int]:
    return int(database.get("user_version", -1)), int(database.get("migration_version", -1))


def validate_preflight(
    facts: dict[str, Any],
    *,
    synthetic_fixture_root: Path | None = None,
) -> list[str]:
    errors: list[str] = []
    synthetic = synthetic_fixture_root is not None
    if facts.get("platform") != "darwin":
        errors.append("Production V8 release gate requires macOS.")
    if facts.get("synthetic_only") is not synthetic:
        errors.append("Authorization domain does not match the selected gate mode.")

    expected_app = (synthetic_fixture_root.resolve() / "Applications" / APP_NAME) if synthetic else APP_PATH
    expected_data = (synthetic_fixture_root.resolve() / "Library" / "Application Support" / PRODUCTION_BUNDLE_ID) if synthetic else APP_DATA
    expected_database = expected_data / DATABASE_NAME
    if Path(str(facts.get("expected_installed_app", ""))).resolve(strict=False) != expected_app.resolve(strict=False):
        errors.append("Candidate app path does not match the fixed Production install path.")
    if Path(str(facts.get("expected_database_path", ""))).resolve(strict=False) != expected_database.resolve(strict=False):
        errors.append("Production database path does not match the fixed Production app-data path.")
    if Path(str(facts.get("app_data", expected_data))).resolve(strict=False) != expected_data.resolve(strict=False):
        errors.append("Production app-data path is not the fixed identity.")

    packages = facts.get("production_apps")
    if not isinstance(packages, list) or len(packages) != 1:
        errors.append("Normal launch locations must contain exactly one Production-identity app bundle.")
    if facts.get("app_inventory_complete") is not True:
        errors.append("Installed Production bundle inventory is incomplete or unknown.")

    candidate = facts.get("candidate")
    if not isinstance(candidate, dict):
        errors.append("Candidate facts are unknown.")
        candidate = {}
    else:
        errors.extend(validate_manifest(candidate))
        if candidate.get("bundle_id") != PRODUCTION_BUNDLE_ID:
            errors.append("Candidate bundle ID must be the Production identifier.")
        if Path(str(candidate.get("bundle_path", ""))).resolve(strict=False) != expected_app.resolve(strict=False):
            errors.append("Candidate bundle path is not the fixed Production app path.")
        executable = Path(str(candidate.get("executable_path", "")))
        expected_executable = expected_app / "Contents/MacOS" / EXECUTABLE_NAME
        if executable != expected_executable:
            errors.append("Candidate executable path is not the fixed Production executable path.")
        if candidate.get("executable_name") != EXECUTABLE_NAME:
            errors.append("Candidate executable name is not the fixed Production executable.")
        if candidate.get("executable_sha256") == LEGACY_V4_EXECUTABLE_SHA256:
            errors.append("Known legacy V4 Production runtime is not a V8 candidate.")
        if not _nonempty_string(candidate.get("executable_sha256")):
            errors.append("Candidate executable hash is missing.")
        if not _nonempty_string(candidate.get("manifest_sha256")):
            errors.append("Candidate compatibility manifest hash is missing.")
        if candidate.get("manifest") is None:
            errors.append("Candidate compatibility manifest is missing.")
        expected_info_plist = expected_app / "Contents" / "Info.plist"
        if Path(str(candidate.get("info_plist_path", ""))) != expected_info_plist:
            errors.append("Candidate Info.plist path is not the fixed bundle path.")
        if not _valid_sha256(candidate.get("info_plist_sha256")):
            errors.append("Candidate Info.plist SHA-256 is missing or malformed.")

    inventory = facts.get("process_inventory")
    processes = facts.get("running_production_processes")
    if not isinstance(inventory, dict) or inventory.get("complete") is not True or not isinstance(inventory.get("processes"), list):
        errors.append("Production process inventory is incomplete or unknown.")
    elif not isinstance(processes, list) or inventory.get("processes") != processes:
        errors.append("Production process inventory facts do not match the evaluated process list.")
    if facts.get("process_inventory_complete") is not True:
        errors.append("Production process inventory completeness was not established.")
    if isinstance(processes, list) and processes:
        errors.append("A Production-identity process or unknown matching executable is still running.")

    database = facts.get("production_database")
    if not isinstance(database, dict):
        errors.append("Production database facts are unknown.")
        database = {}
    else:
        db_path = Path(str(database.get("path", "")))
        if db_path.resolve(strict=False) != expected_database.resolve(strict=False):
            errors.append("Production database path does not match the authorized identity and basename.")
        if db_path.name != DATABASE_NAME:
            errors.append("Production database basename is not the fixed SQLite identity.")
        if _schema_facts(database) != (SOURCE_SCHEMA_VERSION, SOURCE_SCHEMA_VERSION):
            errors.append("Production migration source must be consistent Schema V3.")
        if database.get("migration_rows") != [1, 2, 3] or database.get("migration_row_count") != 3:
            errors.append("Production migration source must contain exactly migration rows [1,2,3].")
        if database.get("integrity") != ["ok"] or database.get("foreign_key_violations") != []:
            errors.append("Production database integrity or foreign-key preflight failed.")
        if database.get("sidecars") != []:
            errors.append("Production SQLite state is not quiescent; sidecars must be absent.")
    if facts.get("sidecars_absent") is not True:
        errors.append("Production sidecar absence was not established.")
    try:
        observed_database = inspect_database(expected_database)
        for field in ("path", "sha256", "device", "inode", "user_version", "migration_version", "migration_rows", "migration_row_count", "integrity", "foreign_key_violations", "sidecars"):
            if database.get(field) != observed_database.get(field):
                errors.append(f"Production database facts disagree with the on-disk file: {field}.")
    except GateBlocked as error:
        errors.extend(error.reasons)
    try:
        observed_bundle = read_bundle(expected_app)
        for field in ("bundle_id", "executable_path", "executable_sha256", "info_plist_path", "info_plist_sha256", "manifest_path", "manifest_sha256", "manifest"):
            if candidate.get(field) != observed_bundle.get(field):
                errors.append(f"Candidate facts disagree with the on-disk bundle: {field}.")
    except GateBlocked as error:
        errors.extend(error.reasons)

    expected_data_root = Path(str(facts.get("expected_database_path", ""))).parent
    expected_backup = fixed_backup_path(expected_data_root)
    backup = facts.get("backup")
    if not isinstance(backup, dict) or backup.get("exists") is not True:
        errors.append("Byte-for-byte pre-migration Production backup is missing.")
        backup = {}
    else:
        errors.extend(validate_fixed_backup_path(backup.get("path"), expected_data_root))
        if not _nonempty_string(backup.get("sha256")):
            errors.append("Production backup hash is missing.")
        elif isinstance(database, dict) and backup.get("sha256") != database.get("sha256"):
            errors.append("Production backup hash does not match the pre-migration database hash.")
        if backup.get("device") is None or backup.get("inode") is None or backup.get("nlink") != 1 or backup.get("regular") is not True:
            errors.append("Production backup is not a single-link regular file with bound device/inode.")
    if database and backup and backup.get("sha256") != database.get("sha256"):
        errors.append("Production backup is not byte-identical to the pre-migration database.")
    if backup.get("path"):
        try:
            observed_backup = _require_regular_file(expected_backup, "Production backup")
            _canonical_path(expected_backup, "Production backup")
            if Path(str(backup["path"])) != expected_backup:
                errors.append("Production backup facts do not name the exact fixed canonical backup path.")
            if (backup.get("device"), backup.get("inode"), backup.get("nlink")) != (
                observed_backup.st_dev, observed_backup.st_ino, observed_backup.st_nlink,
            ):
                errors.append("Production backup device/inode facts do not match the on-disk file.")
            if backup.get("sha256") != sha256_file(expected_backup):
                errors.append("Production backup hash facts do not match the on-disk file.")
        except GateBlocked as error:
            errors.extend(error.reasons)

    approval = facts.get("candidate_approval")
    if not isinstance(approval, dict):
        errors.append("Owner candidate approval is missing or unreadable.")
        approval = {}
    else:
        if approval.get("status") != APPROVAL_STATUS:
            errors.append("Candidate approval is not an Owner V8 candidate approval.")
        if not _nonempty_string(approval.get("authorizationId")):
            errors.append("Candidate approval authorization ID is missing.")
        if candidate and approval.get("candidateExecutableSha256") != candidate.get("executable_sha256"):
            errors.append("Candidate executable hash does not match the Owner-approved hash.")
        if candidate and approval.get("candidateInfoPlistPath") != candidate.get("info_plist_path"):
            errors.append("Candidate Info.plist path does not match the Owner-approved path.")
        if not _valid_sha256(approval.get("candidateInfoPlistSha256")):
            errors.append("Owner candidate approval must bind a valid Info.plist SHA-256.")
        elif candidate and approval.get("candidateInfoPlistSha256") != candidate.get("info_plist_sha256"):
            errors.append("Candidate Info.plist hash does not match the Owner-approved hash.")
        if candidate and approval.get("compatibilityManifestSha256") != candidate.get("manifest_sha256"):
            errors.append("Candidate compatibility manifest hash does not match the Owner-approved hash.")
        if approval.get("bundleId") != PRODUCTION_BUNDLE_ID:
            errors.append("Candidate approval does not name the Production bundle.")
        if approval.get("maxSupportedSchemaVersion") != TARGET_SCHEMA_VERSION or approval.get("migrationSourceSchemaVersion") != SOURCE_SCHEMA_VERSION:
            errors.append("Candidate approval must declare V8 target and V3 migration source.")

    authorization = facts.get("migration_authorization")
    if not isinstance(authorization, dict):
        errors.append("Separate Owner Production V8 migration authorization is missing or unreadable.")
        authorization = {}
    else:
        if authorization.get("status") != AUTHORIZATION_STATUS:
            errors.append("A separate explicit Owner Production V8 migration authorization is required.")
        if not _nonempty_string(authorization.get("authorizationId")):
            errors.append("Owner Production V8 migration authorization ID is missing.")
        if not _nonempty_string(authorization.get("nonce", "")) and authorization.get("nonce") is not None:
            errors.append("Owner authorization nonce is invalid.")
        if candidate and authorization.get("candidateExecutableSha256") != candidate.get("executable_sha256"):
            errors.append("Migration authorization candidate hash does not match the installed candidate.")
        if Path(str(authorization.get("candidateInfoPlistPath", ""))) != expected_app / "Contents" / "Info.plist":
            errors.append("Migration authorization Info.plist path is not the fixed bundle path.")
        if not _valid_sha256(authorization.get("candidateInfoPlistSha256")):
            errors.append("Migration authorization must bind a valid Info.plist SHA-256.")
        elif candidate and authorization.get("candidateInfoPlistSha256") != candidate.get("info_plist_sha256"):
            errors.append("Migration authorization Info.plist hash does not match the installed candidate.")
        if candidate and authorization.get("compatibilityManifestSha256") != candidate.get("manifest_sha256"):
            errors.append("Migration authorization manifest hash does not match the installed candidate.")
        if database and authorization.get("productionDbPreMigrationSha256") != database.get("sha256"):
            errors.append("Migration authorization is not bound to the verified pre-migration hash.")
        errors.extend(validate_fixed_backup_path(authorization.get("backupPath"), expected_data_root))
        if backup and Path(str(authorization.get("backupPath", ""))) != Path(str(backup.get("path", ""))):
            errors.append("Verified backup path does not match the migration authorization.")
        if authorization.get("productionBundleId") != PRODUCTION_BUNDLE_ID:
            errors.append("Migration authorization does not name the Production bundle.")
        if authorization.get("sourceSchemaVersion") not in (None, SOURCE_SCHEMA_VERSION) or authorization.get("targetSchemaVersion") not in (None, TARGET_SCHEMA_VERSION):
            errors.append("Migration authorization declares an unsupported schema transition.")
        if authorization.get("authorizationId") is not None and approval and authorization.get("ownerAuthorizationId") not in (None, approval.get("authorizationId")):
            errors.append("Migration authorization and candidate approval identify different Owners.")
    if facts.get("candidate_approval_sha256") is not None and not _nonempty_string(facts.get("candidate_approval_sha256")):
        errors.append("Exact candidate approval byte hash is missing.")
    if facts.get("migration_authorization_sha256") is not None and not _nonempty_string(facts.get("migration_authorization_sha256")):
        errors.append("Exact migration authorization byte hash is missing.")

    terminal = facts.get("legacy_terminal")
    if terminal:
        errors.append("A historical V4 terminal is block-only and cannot authorize V8.")
    if facts.get("legacy_authorization_present"):
        errors.append("A historical V4 permit is block-only and cannot authorize V8.")
    if facts.get("v8_permit_present"):
        errors.append("An unconsumed V8 permit exists; one-time authorization already started.")
    if facts.get("pending_durable_write"):
        errors.append("A pending durable-write file blocks ordinary startup.")
    return errors


def make_release_receipt(
    facts: dict[str, Any],
    *,
    receipt_path: Path,
    synthetic_fixture_root: Path | None = None,
) -> dict[str, Any]:
    errors = validate_preflight(facts, synthetic_fixture_root=synthetic_fixture_root)
    if errors:
        raise GateBlocked(errors)
    if not _nonempty_string(facts.get("candidate_approval_sha256")) or not _nonempty_string(facts.get("migration_authorization_sha256")):
        raise GateBlocked(["Exact candidate-approval and migration-authorization byte hashes are required for a release receipt."])
    candidate = facts["candidate"]
    database = facts["production_database"]
    backup = facts["backup"]
    approval = facts["candidate_approval"]
    authorization = facts["migration_authorization"]
    receipt = {
        "receiptFormatVersion": 2,
        "status": PREFLIGHT_STATUS,
        "observedAtUtc": datetime.now(timezone.utc).isoformat(),
        "syntheticOnly": facts.get("synthetic_only") is True,
        "candidateApprovalSha256": facts["candidate_approval_sha256"],
        "migrationAuthorizationSha256": facts["migration_authorization_sha256"],
        "productionBundleId": PRODUCTION_BUNDLE_ID,
        "installedAppPath": str(Path(facts["expected_installed_app"]).resolve()),
        "releaseReceiptPath": str(receipt_path.resolve(strict=False)),
        "candidateExecutablePath": candidate["executable_path"],
        "candidateExecutableSha256": candidate["executable_sha256"],
        "candidateInfoPlistPath": candidate["info_plist_path"],
        "candidateInfoPlistSha256": candidate["info_plist_sha256"],
        "compatibilityManifestPath": candidate["manifest_path"],
        "compatibilityManifestSha256": candidate["manifest_sha256"],
        "maxSupportedSchemaVersion": TARGET_SCHEMA_VERSION,
        "migrationSourceSchemaVersion": SOURCE_SCHEMA_VERSION,
        "sidecarsAbsent": database.get("sidecars") == [] and facts.get("sidecars_absent") is True,
        "productionDatabasePath": database["path"],
        "productionDatabasePreMigrationSha256": database["sha256"],
        "productionSchema": {
            "userVersion": database["user_version"],
            "migrationVersion": database["migration_version"],
        },
        "backupPath": backup["path"],
        "backupSha256": backup["sha256"],
        "ownerAuthorizationId": approval.get("authorizationId") or authorization.get("authorizationId"),
        "candidateApprovalId": approval.get("authorizationId"),
        "processInventory": facts.get("process_inventory"),
        "productionAppInventory": facts.get("production_apps"),
    }
    return receipt


def validate_permit(permit: dict[str, Any], *, now: int | None = None) -> list[str]:
    errors: list[str] = []
    current = int(time.time()) if now is None else now
    if permit.get("receiptFormatVersion") != 2:
        errors.append("Permit receiptFormatVersion must be 2.")
    if permit.get("status") != PERMIT_STATUS:
        errors.append("Permit status is not the one-time Production V8 authorization status.")
    if not isinstance(permit.get("syntheticOnly"), bool):
        errors.append("Permit must declare its synthetic/Production domain.")
    if not _nonempty_string(permit.get("nonce")):
        errors.append("Permit nonce is missing.")
    issued = permit.get("issuedAtUnix")
    expires = permit.get("expiresAtUnix")
    if not _is_int(issued) or not _is_int(expires) or issued > current or expires < current or expires - issued > MAX_AUTHORIZATION_SECONDS or expires <= issued:
        errors.append("Permit validity window is missing, expired, future-dated, or longer than the one-time window.")
    if not _nonempty_string(permit.get("ownerAuthorizationId")):
        errors.append("Permit Owner authorization ID is missing.")
    required_strings = (
        "productionBundleId", "installedAppPath", "candidateExecutablePath", "candidateExecutableSha256",
        "candidateInfoPlistPath", "candidateInfoPlistSha256",
        "compatibilityManifestSha256", "productionDatabasePath", "productionDatabasePreMigrationSha256",
        "backupPath", "backupSha256", "releaseReceiptPath", "releaseReceiptSha256",
        "candidateApprovalSha256", "migrationAuthorizationSha256",
    )
    for field in required_strings:
        if not _nonempty_string(permit.get(field)):
            errors.append(f"Permit field {field} must be a non-empty string.")
    if permit.get("productionBundleId") != PRODUCTION_BUNDLE_ID:
        errors.append("Permit productionBundleId is not the Production identity.")
    permit_executable = Path(str(permit.get("candidateExecutablePath", "")))
    if Path(str(permit.get("candidateInfoPlistPath", ""))) != permit_executable.parent.parent / "Info.plist":
        errors.append("Permit Info.plist path is not the fixed file inside the authorized bundle.")
    if not _valid_sha256(permit.get("candidateInfoPlistSha256")):
        errors.append("Permit candidateInfoPlistSha256 must be a valid SHA-256.")
    if permit.get("maxSupportedSchemaVersion") != TARGET_SCHEMA_VERSION:
        errors.append("Permit maxSupportedSchemaVersion must be 8.")
    if permit.get("sidecarsAbsent") is not True:
        errors.append("Permit must assert sidecar absence.")
    schema = permit.get("productionSchema")
    if not isinstance(schema, dict) or schema.get("userVersion") != SOURCE_SCHEMA_VERSION or schema.get("migrationVersion") != SOURCE_SCHEMA_VERSION:
        errors.append("Permit productionSchema must be consistent V3.")
    return errors


def write_migration_permit(
    receipt: dict[str, Any],
    approval: dict[str, Any],
    authorization: dict[str, Any],
    permit_path: Path,
    *,
    synthetic_fixture_root: Path | None = None,
    now: int | None = None,
) -> tuple[Path, str]:
    synthetic = receipt.get("syntheticOnly") is True
    if synthetic:
        if synthetic_fixture_root is None:
            raise GateBlocked(["Synthetic permit requires an explicitly marked synthetic root."])
        root = _validate_synthetic_gate_root(synthetic_fixture_root)
        expected = root / "Library" / "Application Support" / PRODUCTION_BUNDLE_ID / AUTHORIZATION_NAME
        if permit_path.resolve(strict=False) != expected.resolve(strict=False):
            raise GateBlocked(["Synthetic permit path does not match the fixed synthetic namespace path."])
    elif permit_path.resolve(strict=False) != (APP_DATA / AUTHORIZATION_NAME).resolve(strict=False):
        raise GateBlocked(["Production permit path must be the fixed native-approved application-data path."])
    if receipt.get("sidecarsAbsent") is not True:
        raise GateBlocked(["SQLite sidecar absence was not bound into the release receipt."])
    if not _nonempty_string(receipt.get("releaseReceiptPath")) or not _nonempty_string(receipt.get("migrationAuthorizationSha256")):
        raise GateBlocked(["Permit requires persisted release-receipt and exact authorization byte hashes."])
    if _metadata_or_none(permit_path) is not None:
        raise GateBlocked(["An unconsumed Production migration authorization already exists."])
    app_data = permit_path.parent
    if _metadata_or_none(app_data / LEGACY_AUTHORIZATION_NAME) is not None:
        raise GateBlocked(["A historical V4 permit is block-only and cannot coexist with a V8 permit."])
    if _metadata_or_none(app_data / LEGACY_TERMINAL_NAME) is not None:
        raise GateBlocked(["A historical V4 terminal is block-only and cannot authorize V8."])
    if _metadata_or_none(app_data / TERMINAL_NAME) is not None:
        raise GateBlocked(["A V8 terminal already exists; this database is not eligible for a new permit."])
    for entry in app_data.iterdir() if app_data.exists() else []:
        name = entry.name
        if name.startswith(f".{AUTHORIZATION_NAME}.claimed-") or name.startswith(f".{TERMINAL_NAME}.tmp-"):
            raise GateBlocked(["A pending durable write or unresolved authorization claim blocks a new permit."])
    nonce = secrets.token_urlsafe(32)
    clock = int(time.time()) if now is None else now
    permit = {
        **receipt,
        "receiptFormatVersion": 2,
        "status": PERMIT_STATUS,
        "nonce": nonce,
        "issuedAtUnix": clock,
        "expiresAtUnix": clock + MAX_AUTHORIZATION_SECONDS,
        "ownerAuthorizationId": approval.get("authorizationId") or authorization.get("authorizationId"),
    }
    errors = validate_permit(permit, now=clock)
    if errors:
        raise GateBlocked(errors)
    if not _nonempty_string(permit.get("releaseReceiptSha256")):
        raise GateBlocked(["Permit releaseReceiptSha256 is missing."])
    _persist_json_create(permit_path, permit)
    return permit_path, nonce


def _backup_facts(path: Path) -> dict[str, Any]:
    metadata = _metadata_or_none(path)
    if metadata is None:
        return {"path": str(path), "exists": False, "sha256": None, "regular": False, "nlink": 0, "device": None, "inode": None}
    regular = stat.S_ISREG(metadata.st_mode) and not stat.S_ISLNK(metadata.st_mode) and metadata.st_nlink == 1
    return {
        "path": str(path),
        "exists": True,
        "sha256": sha256_file(path) if regular else None,
        "regular": regular,
        "nlink": metadata.st_nlink,
        "device": metadata.st_dev,
        "inode": metadata.st_ino,
    }


def collect_synthetic_facts(
    root: Path,
    candidate_approval_path: Path,
    migration_authorization_path: Path,
) -> dict[str, Any]:
    root = _validate_synthetic_gate_root(root)
    approval_path = candidate_approval_path.resolve(strict=True)
    authorization_path = migration_authorization_path.resolve(strict=True)
    for label, path in (("Candidate approval", approval_path), ("Migration authorization", authorization_path)):
        try:
            path.relative_to(root)
        except ValueError as error:
            raise GateBlocked([f"Synthetic {label.lower()} must be inside the marked synthetic root."]) from error
    candidate_approval, candidate_approval_sha256, _ = _load_json_exact(approval_path, "Synthetic candidate approval")
    migration_authorization, migration_authorization_sha256, _ = _load_json_exact(authorization_path, "Synthetic migration authorization")
    if candidate_approval.get("syntheticOnly") is not True or migration_authorization.get("syntheticOnly") is not True:
        raise GateBlocked(["Synthetic authorization artifacts must carry syntheticOnly=true."])
    app_path = root / "Applications" / APP_NAME
    app_data = root / "Library" / "Application Support" / PRODUCTION_BUNDLE_ID
    database_path = app_data / DATABASE_NAME
    candidate = read_bundle(app_path)
    database = inspect_database(database_path)
    backup_path = Path(str(migration_authorization.get("backupPath", "")))
    expected_backup_path = fixed_backup_path(app_data)
    if backup_path != expected_backup_path:
        raise GateBlocked([
            f"Synthetic backup path must be exactly the fixed canonical file {expected_backup_path}; nested, alternate, aliased, or escaped paths are refused."
        ])
    backup = _backup_facts(backup_path)
    if not backup["regular"]:
        raise GateBlocked(["Synthetic backup must be a single-link regular file."])
    process_inventory = {"complete": True, "processes": [], "diagnostics": ["synthetic fixture"]}
    return {
        "platform": "darwin",
        "expected_installed_app": str(app_path.resolve()),
        "expected_database_path": str(database_path.resolve()),
        "app_data": str(app_data.resolve()),
        "running_production_processes": [],
        "process_inventory": process_inventory,
        "process_inventory_complete": True,
        "app_inventory_complete": True,
        "sidecars_absent": database.get("sidecars") == [],
        "production_apps": [candidate],
        "candidate": candidate,
        "candidate_approval": candidate_approval,
        "migration_authorization": migration_authorization,
        "candidate_approval_sha256": candidate_approval_sha256,
        "migration_authorization_sha256": migration_authorization_sha256,
        "synthetic_only": True,
        "production_database": database,
        "backup": backup,
        "synthetic_root": str(root),
    }


def collect_real_facts(candidate_approval_path: Path, migration_authorization_path: Path) -> dict[str, Any]:
    candidate_approval, candidate_approval_sha256, _ = _load_json_exact(candidate_approval_path, "Candidate approval")
    migration_authorization, migration_authorization_sha256, _ = _load_json_exact(migration_authorization_path, "Production migration authorization")
    if candidate_approval.get("syntheticOnly") is True or migration_authorization.get("syntheticOnly") is True:
        raise GateBlocked(["Synthetic authorization artifacts are not valid in Production mode."])
    apps = []
    if _metadata_or_none(APP_PATH) is not None:
        apps = [read_bundle(APP_PATH)]
    database = inspect_database(DATABASE_PATH)
    backup_path = Path(str(migration_authorization.get("backupPath", "")))
    expected_backup_path = fixed_backup_path(APP_DATA)
    if backup_path != expected_backup_path:
        raise GateBlocked([
            f"Production backup path must be exactly the fixed canonical file {expected_backup_path}; nested, alternate, aliased, or escaped paths are refused."
        ])
    backup = _backup_facts(backup_path)
    process_inventory = inventory_production_processes(known_apps=apps)
    processes = process_inventory["processes"] if process_inventory["complete"] else None
    return {
        "platform": sys.platform,
        "expected_installed_app": str(APP_PATH),
        "expected_database_path": str(DATABASE_PATH),
        "app_data": str(APP_DATA),
        "running_production_processes": processes,
        "process_inventory": process_inventory,
        "process_inventory_complete": process_inventory["complete"],
        "app_inventory_complete": True,
        "sidecars_absent": database.get("sidecars") == [],
        "production_apps": apps,
        "candidate": apps[0] if apps else {},
        "candidate_approval": candidate_approval,
        "migration_authorization": migration_authorization,
        "candidate_approval_sha256": candidate_approval_sha256,
        "migration_authorization_sha256": migration_authorization_sha256,
        "synthetic_only": False,
        "production_database": database,
        "backup": backup,
    }


def _read_ledger(path: Path) -> tuple[list[dict[str, Any]], str, bytes]:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    try:
        fd = os.open(path, flags)
        with os.fdopen(fd, "rb") as stream:
            metadata = os.fstat(stream.fileno())
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
                raise GateBlocked(["Consumed-authorization ledger must be a single-link regular file."])
            data = stream.read(MAX_JSON_BYTES + 1)
        if len(data) > MAX_JSON_BYTES:
            raise GateBlocked(["Consumed-authorization ledger exceeds the size limit."])
        value = json.loads(data)
        if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
            raise ValueError("expected a JSON array of objects")
        return value, hashlib.sha256(data).hexdigest(), data
    except GateBlocked:
        raise
    except (OSError, json.JSONDecodeError, ValueError) as error:
        raise GateBlocked([f"Consumed-authorization ledger is missing, unsafe, or unreadable: {type(error).__name__}: {error}"]) from error


def validate_terminal(
    facts: dict[str, Any],
    terminal: dict[str, Any],
    *,
    terminal_bytes: bytes,
    ledger: list[dict[str, Any]],
    ledger_bytes: bytes,
    receipt_bytes: bytes,
    permit_present: bool,
    synthetic: bool,
) -> list[str]:
    errors: list[str] = []
    app_data = Path(facts["app_data"]).resolve()
    database = facts["production_database"]
    candidate = facts["candidate"]
    backup = facts["backup"]
    authorization = facts["migration_authorization"]
    receipt_path = app_data / RELEASE_RECEIPT_NAME
    ledger_path = app_data / CONSUMED_LEDGER_NAME
    backup_path = app_data / BACKUP_DIRECTORY / DATABASE_NAME
    expected_rows = list(range(1, TARGET_SCHEMA_VERSION + 1))
    if terminal.get("formatVersion") != 2 or terminal.get("domain") != "PRODUCTION" or terminal.get("syntheticOnly") is not synthetic:
        errors.append("Terminal format/domain/scope is not the V8 Production contract.")
    if terminal.get("state") != "V8_VERIFIED":
        errors.append("Terminal state must be V8_VERIFIED.")
    if not _nonempty_string(terminal.get("authorizationId")) or not _nonempty_string(terminal.get("nonce")):
        errors.append("Terminal authorization ID/nonce is missing.")
    if (terminal.get("sourceUserVersion"), terminal.get("sourceMigrationVersion")) != (SOURCE_SCHEMA_VERSION, SOURCE_SCHEMA_VERSION):
        errors.append("Terminal source schema must be V3/V3.")
    if (terminal.get("targetUserVersion"), terminal.get("targetMigrationVersion")) != (TARGET_SCHEMA_VERSION, TARGET_SCHEMA_VERSION):
        errors.append("Terminal target schema must be V8/V8.")
    if terminal.get("migrationRows") != expected_rows or terminal.get("migrationRowCount") != TARGET_SCHEMA_VERSION:
        errors.append("Terminal migration rows must be exactly [1..8] with no duplicates.")
    if terminal.get("integrityCheck") != "ok":
        errors.append("Terminal integrity_check must be ok.")
    if terminal.get("foreignKeyViolationCount") != 0:
        errors.append("Terminal foreign_key_check must be empty.")
    if terminal.get("sidecarsAbsent") is not True:
        errors.append("Terminal must assert sidecar absence.")
    if Path(str(terminal.get("databasePath", ""))).resolve(strict=False) != Path(str(database.get("path", ""))).resolve(strict=False):
        errors.append("Terminal database path does not match the Production database.")
    if database.get("path") is not None and Path(str(database["path"])).parent != app_data:
        errors.append("Production database is not directly inside the fixed app-data directory.")
    if terminal.get("databaseDevice") != database.get("device") or terminal.get("databaseInode") != database.get("inode"):
        errors.append("Terminal database device/inode does not match the database identity.")
    if terminal.get("databasePreMigrationSha256") != database.get("sha256") and terminal.get("databasePreMigrationSha256") != backup.get("sha256"):
        errors.append("Terminal pre-migration database hash does not match the backup/source hash.")
    if terminal.get("databasePostMigrationSha256") != database.get("sha256"):
        errors.append("Terminal post-migration database hash does not match the current database.")
    if Path(str(terminal.get("candidateExecutablePath", ""))) != Path(str(candidate.get("executable_path", ""))):
        errors.append("Terminal candidate executable path does not match the fixed candidate.")
    if terminal.get("candidateExecutableSha256") != candidate.get("executable_sha256"):
        errors.append("Terminal candidate executable hash does not match the candidate.")
    if Path(str(terminal.get("candidateInfoPlistPath", ""))) != Path(str(candidate.get("info_plist_path", ""))):
        errors.append("Terminal candidate Info.plist path does not match the fixed candidate.")
    if terminal.get("candidateInfoPlistSha256") != candidate.get("info_plist_sha256"):
        errors.append("Terminal candidate Info.plist hash does not match the candidate.")
    if Path(str(terminal.get("compatibilityManifestPath", ""))) != Path(str(candidate.get("manifest_path", ""))):
        errors.append("Terminal compatibility manifest path mismatch.")
    if terminal.get("compatibilityManifestSha256") != candidate.get("manifest_sha256"):
        errors.append("Terminal compatibility manifest hash mismatch.")
    if Path(str(terminal.get("releaseReceiptPath", ""))) != receipt_path:
        errors.append("Terminal release receipt path mismatch.")
    if terminal.get("releaseReceiptSha256") != hashlib.sha256(receipt_bytes).hexdigest():
        errors.append("Terminal release receipt bytes are stale or mismatched.")
    try:
        receipt = json.loads(receipt_bytes)
    except json.JSONDecodeError:
        receipt = {}
        errors.append("Persisted release receipt is corrupt.")
    if isinstance(receipt, dict):
        for field, expected in (
            ("productionBundleId", PRODUCTION_BUNDLE_ID),
            ("installedAppPath", facts["expected_installed_app"]),
            ("candidateExecutablePath", candidate.get("executable_path")),
            ("productionDatabasePath", database.get("path")),
            ("releaseReceiptPath", str(receipt_path)),
            ("backupPath", str(backup_path)),
            ("candidateExecutableSha256", candidate.get("executable_sha256")),
            ("candidateInfoPlistPath", candidate.get("info_plist_path")),
            ("candidateInfoPlistSha256", candidate.get("info_plist_sha256")),
            ("compatibilityManifestSha256", candidate.get("manifest_sha256")),
            ("productionDatabasePreMigrationSha256", backup.get("sha256")),
            ("backupSha256", backup.get("sha256")),
            ("migrationAuthorizationSha256", terminal.get("migrationAuthorizationContractSha256")),
            ("ownerAuthorizationId", terminal.get("authorizationId")),
        ):
            if receipt.get(field) != expected:
                errors.append(f"Release receipt binding mismatch: {field}.")
        if receipt.get("syntheticOnly") is not synthetic or receipt.get("sidecarsAbsent") is not True:
            errors.append("Release receipt scope/sidecar binding mismatch.")
        schema = receipt.get("productionSchema")
        if not isinstance(schema, dict) or (schema.get("userVersion"), schema.get("migrationVersion")) != (SOURCE_SCHEMA_VERSION, SOURCE_SCHEMA_VERSION):
            errors.append("Release receipt does not bind the V3 pre-migration schema.")
    if Path(str(terminal.get("consumedLedgerPath", ""))) != ledger_path:
        errors.append("Terminal consumed-ledger path mismatch.")
    if terminal.get("consumedLedgerSha256") != hashlib.sha256(ledger_bytes).hexdigest():
        errors.append("Terminal consumed-ledger bytes are stale or mismatched.")
    matching = [
        entry for entry in ledger
        if entry.get("authorizationId") == terminal.get("authorizationId")
        and entry.get("nonce") == terminal.get("nonce")
        and entry.get("consumedAtUnix") == terminal.get("consumedAtUnix")
        and entry.get("candidateExecutableSha256") == terminal.get("candidateExecutableSha256")
        and entry.get("compatibilityManifestSha256") == terminal.get("compatibilityManifestSha256")
    ]
    if len(matching) != 1 or len(ledger) != 1:
        errors.append("Consumed ledger must contain exactly one terminal-matching authorization record.")
    auth_ids = [entry.get("authorizationId") for entry in ledger]
    nonces = [entry.get("nonce") for entry in ledger]
    if len(auth_ids) != len(set(auth_ids)):
        errors.append("Consumed ledger contains a duplicate authorization ID.")
    if len(nonces) != len(set(nonces)):
        errors.append("Consumed ledger contains a duplicate nonce.")
    if terminal.get("migrationAuthorizationContractSha256") != authorization.get("migrationAuthorizationSha256") and \
            terminal.get("migrationAuthorizationContractSha256") != facts.get("migration_authorization_sha256"):
        errors.append("Terminal migration authorization contract hash mismatch.")
    if permit_present:
        errors.append("The one-time permit was resurrected after consumption.")
    if Path(str(terminal.get("backupPath", ""))) != backup_path:
        errors.append("Terminal backup path is not the fixed canonical backup path.")
    if backup.get("exists") is not True or backup.get("regular") is not True or backup.get("nlink") != 1:
        errors.append("Terminal backup is not a single-link regular file.")
    if terminal.get("backupDevice") != backup.get("device") or terminal.get("backupInode") != backup.get("inode"):
        errors.append("Terminal backup device/inode mismatch.")
    if terminal.get("backupSha256") != backup.get("sha256") or terminal.get("backupSha256") != terminal.get("databasePreMigrationSha256"):
        errors.append("Terminal backup hash is not the pre-migration database hash.")
    if not terminal_bytes:
        errors.append("Terminal exact readback is empty.")
    return errors


def verify_completed_migration(
    facts: dict[str, Any],
    native_result: dict[str, Any],
    *,
    synthetic_fixture_root: Path | None = None,
) -> dict[str, Any]:
    errors: list[str] = []
    synthetic = synthetic_fixture_root is not None
    if facts.get("synthetic_only") is not synthetic:
        errors.append("Post-migration facts do not match the selected gate mode.")
    preflight_candidate = facts.get("candidate") if isinstance(facts.get("candidate"), dict) else {}
    preflight_backup = facts.get("backup") if isinstance(facts.get("backup"), dict) else {}
    preflight_database = facts.get("production_database") if isinstance(facts.get("production_database"), dict) else {}
    preflight_database_sha256 = preflight_database.get("sha256")
    authorization = facts.get("migration_authorization") if isinstance(facts.get("migration_authorization"), dict) else {}
    if native_result.get("event") != "gate_permit_consumed" or native_result.get("status") != NATIVE_SUCCESS or native_result.get("syntheticOnly") is not synthetic:
        errors.append("Native result is not the V8 migration verification result.")
    schema = native_result.get("schema")
    if not isinstance(schema, dict):
        errors.append("Native result schema is unknown.")
        schema = {}
    if (schema.get("userVersion"), schema.get("migrationVersion")) != (TARGET_SCHEMA_VERSION, TARGET_SCHEMA_VERSION):
        errors.append("Native result did not report consistent V8/V8 schema authorities.")
    if schema.get("migrationRows") != list(range(1, TARGET_SCHEMA_VERSION + 1)) or schema.get("migrationRowCount") != TARGET_SCHEMA_VERSION:
        errors.append("Native result did not report exactly migration rows [1..8].")
    app_data = Path(facts["app_data"]).resolve()
    terminal_path = app_data / TERMINAL_NAME
    ledger_path = app_data / CONSUMED_LEDGER_NAME
    receipt_path = app_data / RELEASE_RECEIPT_NAME
    permit_path = app_data / AUTHORIZATION_NAME
    if _metadata_or_none(permit_path) is not None:
        errors.append("The one-time permit is still present after native migration.")
    terminal_bytes = b""
    terminal: dict[str, Any] = {}
    if _metadata_or_none(terminal_path) is None:
        errors.append("V8 terminal is missing after native migration.")
    else:
        try:
            terminal, _, terminal_bytes = _load_json_exact(terminal_path, "V8 terminal")
        except GateBlocked as error:
            errors.extend(error.reasons)
    terminal_sha256 = hashlib.sha256(terminal_bytes).hexdigest() if terminal_bytes else ""
    native_terminal_sha256 = native_result.get("terminalSha256")
    if not _valid_sha256(native_terminal_sha256):
        errors.append("Native result terminalSha256 is missing or malformed.")
    elif not terminal_sha256:
        errors.append("Native result terminalSha256 cannot be verified without terminal exact readback bytes.")
    elif native_terminal_sha256 != terminal_sha256:
        errors.append("Native result terminalSha256 does not match the terminal exact readback.")
    if _metadata_or_none(ledger_path) is None:
        errors.append("Consumed-authorization ledger is missing after native migration.")
        ledger, ledger_bytes = [], b""
    else:
        try:
            ledger, _, ledger_bytes = _read_ledger(ledger_path)
        except GateBlocked as error:
            errors.extend(error.reasons)
            ledger, ledger_bytes = [], b""
    if _metadata_or_none(receipt_path) is None:
        errors.append("Persisted release receipt is missing after native migration.")
        receipt_bytes = b""
    else:
        try:
            _, _, receipt_bytes = _load_json_exact(receipt_path, "Persisted release receipt")
        except GateBlocked as error:
            errors.extend(error.reasons)
            receipt_bytes = b""
    post_database: dict[str, Any] = {}
    try:
        post_database = inspect_database(Path(str(facts["expected_database_path"])))
    except GateBlocked as error:
        errors.extend(error.reasons)
    facts = {**facts, "production_database": post_database or facts.get("production_database", {})}
    if post_database:
        if (post_database.get("user_version"), post_database.get("migration_version")) != (TARGET_SCHEMA_VERSION, TARGET_SCHEMA_VERSION):
            errors.append("Post-migration database must be consistent V8/V8.")
        if post_database.get("migration_rows") != list(range(1, TARGET_SCHEMA_VERSION + 1)) or post_database.get("migration_row_count") != TARGET_SCHEMA_VERSION:
            errors.append("Post-migration database must contain exactly rows [1..8].")
        if post_database.get("integrity") != ["ok"]:
            errors.append("Post-migration integrity_check is not ok.")
        if post_database.get("foreign_key_violations") != []:
            errors.append("Post-migration foreign_key_check is not empty.")
        if post_database.get("sidecars") != []:
            errors.append("Post-migration SQLite sidecars are present.")
    native_database_sha256 = native_result.get("databaseSha256")
    if not _valid_sha256(native_database_sha256):
        errors.append("Native result databaseSha256 is missing or malformed.")
    elif post_database and native_database_sha256 != post_database.get("sha256"):
        errors.append("Native result database hash does not match post-migration readback.")
    if post_database and terminal and terminal.get("databasePostMigrationSha256") != post_database.get("sha256"):
        errors.append("Terminal post-migration database hash does not match the post-migration readback.")
    if post_database and terminal and native_database_sha256 and terminal.get("databasePostMigrationSha256") != native_database_sha256:
        errors.append("Terminal post-migration database hash does not match native result databaseSha256.")
    # Candidate and backup facts must be re-read from their fixed paths after native
    # migration; the preflight cache is not evidence for the post-migration binding.
    expected_app = (
        Path(str(synthetic_fixture_root)).resolve() / "Applications" / APP_NAME
        if synthetic
        else APP_PATH
    )
    expected_app_data = Path(str(facts["app_data"]))
    fresh_bundle: dict[str, Any] = {}
    try:
        fresh_bundle = read_bundle(expected_app)
    except GateBlocked as error:
        errors.extend(error.reasons)
    if not preflight_candidate:
        errors.append("Preflight candidate facts are unavailable for the post-migration binding.")
    if fresh_bundle:
        for field in (
            "bundle_path", "bundle_id", "executable_name", "executable_path", "executable_sha256",
            "executable_mode", "info_plist_path", "info_plist_sha256", "manifest_path",
            "manifest_sha256", "manifest",
        ):
            if preflight_candidate.get(field) != fresh_bundle.get(field):
                errors.append(f"Post-migration candidate facts disagree with the on-disk bundle: {field}.")
        for authorization_field, fresh_field in (
            ("candidateExecutableSha256", "executable_sha256"),
            ("candidateInfoPlistPath", "info_plist_path"),
            ("candidateInfoPlistSha256", "info_plist_sha256"),
            ("compatibilityManifestSha256", "manifest_sha256"),
        ):
            if authorization.get(authorization_field) != fresh_bundle.get(fresh_field):
                errors.append(f"Post-migration candidate facts disagree with the migration authorization: {authorization_field}.")
        try:
            receipt = json.loads(receipt_bytes) if receipt_bytes else {}
        except (json.JSONDecodeError, UnicodeDecodeError):
            receipt = {}
        if isinstance(receipt, dict):
            for receipt_field, fresh_field in (
                ("installedAppPath", "bundle_path"),
                ("candidateExecutablePath", "executable_path"),
                ("candidateExecutableSha256", "executable_sha256"),
                ("candidateInfoPlistPath", "info_plist_path"),
                ("candidateInfoPlistSha256", "info_plist_sha256"),
                ("compatibilityManifestPath", "manifest_path"),
                ("compatibilityManifestSha256", "manifest_sha256"),
            ):
                if receipt.get(receipt_field) != fresh_bundle.get(fresh_field):
                    errors.append(f"Post-migration candidate facts disagree with the release receipt: {receipt_field}.")
    expected_backup: Path | None = None
    fresh_backup: dict[str, Any] = {}
    try:
        expected_backup = fixed_backup_path(expected_app_data)
        # The fixed-path and parent-canonicality rules must be re-established after
        # native returns. A preflight validation cannot cover a directory that was
        # replaced while the native migration was running, so revalidate the raw
        # fixed path before any byte is read from it.
        path_errors = validate_fixed_backup_path(str(expected_backup), expected_app_data)
        if path_errors:
            errors.extend(path_errors)
        else:
            fresh_backup = _backup_facts(expected_backup)
    except GateBlocked as error:
        errors.extend(error.reasons)
    except OSError as error:
        errors.append(f"Post-migration backup cannot be re-read: {error}")
    if fresh_backup:
        if not fresh_backup.get("exists") or not fresh_backup.get("regular") or fresh_backup.get("nlink") != 1:
            errors.append("Post-migration backup is not a single-link regular file at the fixed path.")
        if expected_backup is not None and Path(str(fresh_backup.get("path", ""))) != expected_backup:
            errors.append("Post-migration backup readback is not from the fixed backup path.")
        for field in ("path", "sha256", "device", "inode", "nlink", "regular", "exists"):
            if fresh_backup.get(field) != preflight_backup.get(field):
                errors.append(f"Post-migration backup facts disagree with preflight: {field}.")
        if not preflight_database_sha256 or fresh_backup.get("sha256") != preflight_database_sha256:
            errors.append("Post-migration backup hash does not match the authorized pre-migration database hash.")
        if authorization.get("productionDbPreMigrationSha256") != fresh_backup.get("sha256"):
            errors.append("Post-migration backup hash does not match the migration authorization.")
        if expected_backup is not None and Path(str(authorization.get("backupPath", ""))) != expected_backup:
            errors.append("Post-migration backup path does not match the migration authorization.")
        try:
            receipt = json.loads(receipt_bytes) if receipt_bytes else {}
        except (json.JSONDecodeError, UnicodeDecodeError):
            receipt = {}
        if isinstance(receipt, dict):
            if expected_backup is not None and Path(str(receipt.get("backupPath", ""))) != expected_backup:
                errors.append("Post-migration backup path does not match the release receipt.")
            if receipt.get("backupSha256") != fresh_backup.get("sha256"):
                errors.append("Post-migration backup hash does not match the release receipt.")
            if receipt.get("productionDatabasePreMigrationSha256") != fresh_backup.get("sha256"):
                errors.append("Post-migration backup hash does not match the release receipt source database.")
    fresh_facts = {**facts, "candidate": fresh_bundle, "backup": fresh_backup}
    if terminal:
        errors.extend(validate_terminal(
            fresh_facts, terminal, terminal_bytes=terminal_bytes, ledger=ledger, ledger_bytes=ledger_bytes,
            receipt_bytes=receipt_bytes, permit_present=_metadata_or_none(permit_path) is not None, synthetic=synthetic,
        ))
        # Exact readback and a second independent restart readback are both required.
        try:
            restart, _, restart_bytes = _load_json_exact(terminal_path, "V8 terminal restart readback")
            if restart_bytes != terminal_bytes or restart != terminal:
                errors.append("Terminal restart readback differs from the durable exact readback.")
            if not restart_bytes or hashlib.sha256(restart_bytes).hexdigest() != native_terminal_sha256:
                errors.append("Terminal restart readback SHA-256 does not match native result terminalSha256.")
        except GateBlocked as error:
            errors.extend(error.reasons)
    if errors:
        raise GateBlocked(errors)
    return {
        "status": "V8_RELEASE_GATE_VERIFIED",
        "syntheticOnly": synthetic,
        "nativeResult": native_result,
        "terminalPath": str(terminal_path),
        "terminalSha256": hashlib.sha256(terminal_bytes).hexdigest(),
        "ledgerPath": str(ledger_path),
        "ledgerSha256": hashlib.sha256(ledger_bytes).hexdigest(),
        "databaseSha256": post_database.get("sha256"),
        "schema": {
            "userVersion": post_database.get("user_version"),
            "migrationVersion": post_database.get("migration_version"),
            "migrationRows": post_database.get("migration_rows"),
        },
    }


def run_gate(
    mode: str,
    candidate_approval_path: Path,
    migration_authorization_path: Path,
    receipt_path: Path | None = None,
    *,
    synthetic_fixture_root: Path | None = None,
    native_runner: Callable[[list[str]], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if mode not in {"preflight", "migrate"}:
        raise ValueError(f"Unsupported gate mode: {mode}")
    if sys.platform != "darwin":
        raise GateBlocked(["Production V8 release gate requires macOS."])
    synthetic = synthetic_fixture_root is not None
    facts = (
        collect_synthetic_facts(synthetic_fixture_root, candidate_approval_path, migration_authorization_path)
        if synthetic else collect_real_facts(candidate_approval_path, migration_authorization_path)
    )
    expected_app_data = Path(str(facts["app_data"]))
    expected_receipt_path = fixed_receipt_path(expected_app_data)
    receipt_path = expected_receipt_path if receipt_path is None else Path(receipt_path)
    receipt_errors = validate_receipt_path(
        receipt_path,
        expected_app_data,
        synthetic_root=synthetic_fixture_root if synthetic else None,
    )
    if receipt_errors:
        raise GateBlocked(receipt_errors)
    receipt = make_release_receipt(facts, receipt_path=receipt_path, synthetic_fixture_root=synthetic_fixture_root)
    if mode == "preflight":
        _persist_json_create(receipt_path, receipt)
        return {"status": "PREFLIGHT_PASS", "receiptPath": str(receipt_path), "receipt": receipt}
    persisted, persisted_sha256, _ = _load_json_exact(receipt_path, "Persisted release receipt")
    if persisted.get("status") != PREFLIGHT_STATUS:
        raise GateBlocked(["Migrate requires a persisted successful preflight receipt."])
    compare_fields = (
        "syntheticOnly", "candidateApprovalSha256", "migrationAuthorizationSha256", "productionBundleId",
        "installedAppPath", "candidateExecutablePath", "candidateExecutableSha256", "compatibilityManifestSha256",
        "productionDatabasePath", "productionDatabasePreMigrationSha256", "productionSchema", "backupPath",
        "backupSha256", "sidecarsAbsent", "ownerAuthorizationId", "candidateApprovalId", "releaseReceiptPath",
    )
    if any(persisted.get(field) != receipt.get(field) for field in compare_fields):
        raise GateBlocked(["Persisted preflight receipt no longer matches current authorization, candidate, database, or backup facts."])
    receipt["releaseReceiptSha256"] = persisted_sha256
    permit_path, nonce = write_migration_permit(
        receipt, facts["candidate_approval"], facts["migration_authorization"],
        Path(facts["app_data"]) / AUTHORIZATION_NAME,
        synthetic_fixture_root=synthetic_fixture_root,
    )
    command = [str(Path(facts["candidate"]["executable_path"])), "--pfc-internal-v8-migrate"]
    if native_runner is None:
        if synthetic:
            raise GateBlocked(["Synthetic migrate mode requires an explicit native verification runner; no Production executable is launched."])
        try:
            completed = subprocess.run(command, cwd=str(Path(command[0]).parent), capture_output=True, text=True, timeout=120)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise GateBlocked([f"Native V8 migration consumer did not complete: {type(error).__name__}: {error}"]) from error
        if completed.returncode != 0:
            raise GateBlocked([f"Native V8 migration consumer refused or failed (exit={completed.returncode}): {completed.stderr.strip() or completed.stdout.strip()}"])
        try:
            native_result = json.loads(completed.stdout.strip().splitlines()[-1])
        except (IndexError, json.JSONDecodeError) as error:
            raise GateBlocked(["Native V8 migration consumer returned no valid terminal JSON result."]) from error
    else:
        native_result = native_runner(command)
    verified = verify_completed_migration(facts, native_result, synthetic_fixture_root=synthetic_fixture_root)
    receipt["status"] = "V8_RELEASE_GATE_COMPLETED"
    receipt["nativeStatus"] = native_result.get("status")
    receipt["nativeNonce"] = nonce
    return {"status": "V8_RELEASE_GATE_COMPLETED", "receiptPath": str(receipt_path), "receipt": receipt, "verification": verified}


def main() -> int:
    parser = argparse.ArgumentParser(description="Fail-closed Production V8 release gate")
    parser.add_argument("mode", choices=("preflight", "migrate"))
    parser.add_argument("candidate_approval", type=Path)
    parser.add_argument("migration_authorization", type=Path)
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--synthetic-root", type=Path)
    arguments = parser.parse_args()
    try:
        result = run_gate(
            arguments.mode, arguments.candidate_approval, arguments.migration_authorization,
            arguments.receipt, synthetic_fixture_root=arguments.synthetic_root,
        )
    except GateBlocked as error:
        print(json.dumps({"status": "BLOCKED", "reasons": error.reasons}, indent=2), file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
