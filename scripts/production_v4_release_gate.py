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
APP_NAME = "Personal Finance Console.app"
APP_PATH = Path("/Applications") / APP_NAME
APP_DATA = Path.home() / "Library/Application Support" / PRODUCTION_BUNDLE_ID
DATABASE_PATH = APP_DATA / DATABASE_NAME
GATE_AUTH_PATH = APP_DATA / "production-v4-migration-authorization.json"
LEGACY_EXECUTABLE_SHA256 = "0e6dcb261de20eb96fcb2f85eaa7fe78fc3cd8c72a96bee78856ac081153911f"
MANIFEST_RELATIVE_PATH = Path("Contents/Resources/runtime-compatibility.json")
MIGRATION_AUTH_ENV = "PF_V4_RELEASE_GATE_NONCE"


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
    info_path = app_path / "Contents/Info.plist"
    with info_path.open("rb") as stream:
        info = plistlib.load(stream)
    executable_name = info.get("CFBundleExecutable")
    if not isinstance(executable_name, str) or not executable_name or Path(executable_name).name != executable_name:
        raise ValueError(f"Invalid CFBundleExecutable in {info_path}")
    executable = app_path / "Contents/MacOS" / executable_name
    if not executable.is_file():
        raise ValueError(f"Bundle executable is missing: {executable}")
    manifest_path = app_path / MANIFEST_RELATIVE_PATH
    manifest: dict[str, Any] | None = None
    manifest_hash: str | None = None
    if manifest_path.is_file():
        with manifest_path.open("r", encoding="utf-8") as stream:
            manifest = json.load(stream)
        manifest_hash = sha256_file(manifest_path)
    return {
        "bundle_path": str(app_path.resolve()),
        "bundle_id": info.get("CFBundleIdentifier"),
        "version": info.get("CFBundleShortVersionString"),
        "executable_name": executable_name,
        "executable_path": str(executable.resolve()),
        "executable_sha256": sha256_file(executable),
        "executable_mode": stat.S_IMODE(executable.stat().st_mode),
        "manifest": manifest,
        "manifest_path": str(manifest_path),
        "manifest_sha256": manifest_hash,
    }


def inventory_production_apps(roots: list[Path]) -> list[dict[str, Any]]:
    apps: list[dict[str, Any]] = []
    visited: set[str] = set()
    for root in roots:
        if not root.exists():
            continue
        for current, dirs, _files in os.walk(root, followlinks=False):
            for name in list(dirs):
                if not name.endswith(".app"):
                    continue
                path = Path(current) / name
                dirs.remove(name)
                try:
                    info_path = path / "Contents/Info.plist"
                    if not info_path.is_file():
                        if name == APP_NAME:
                            apps.append({"bundle_path": str(path), "unreadable": True})
                        continue
                    with info_path.open("rb") as stream:
                        info = plistlib.load(stream)
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
                except (OSError, ValueError, plistlib.InvalidFileException, json.JSONDecodeError) as error:
                    apps.append({"bundle_path": str(path), "unreadable": str(error)})
    return apps


def inventory_production_processes() -> list[dict[str, Any]]:
    if sys.platform != "darwin":
        raise GateBlocked(["Process and bundle inventory is supported only on macOS."])
    result = subprocess.run(["/bin/ps", "-axo", "pid=,comm="], check=True, capture_output=True, text=True)
    matches: list[dict[str, Any]] = []
    for line in result.stdout.splitlines():
        parts = line.strip().split(None, 1)
        if not parts:
            continue
        pid = int(parts[0])
        comm = parts[1] if len(parts) > 1 else ""
        if "personal-finance-console" not in comm.lower():
            continue
        opened = subprocess.run(
            ["/usr/sbin/lsof", "-a", "-p", str(pid), "-d", "txt", "-Fn"],
            capture_output=True,
            text=True,
        )
        executable_paths = [Path(item[1:]) for item in opened.stdout.splitlines() if item.startswith("n")]
        for executable in executable_paths:
            if executable.name != "personal-finance-console" or not executable.exists():
                continue
            bundle_path: Path | None = None
            bundle_id: str | None = None
            parent = executable.parent
            while parent != parent.parent:
                if parent.suffix == ".app":
                    bundle_path = parent
                    try:
                        with (parent / "Contents/Info.plist").open("rb") as stream:
                            bundle_id = plistlib.load(stream).get("CFBundleIdentifier")
                    except (OSError, plistlib.InvalidFileException):
                        pass
                    break
                parent = parent.parent
            digest = sha256_file(executable)
            if bundle_id == PRODUCTION_BUNDLE_ID or digest == LEGACY_EXECUTABLE_SHA256 or bundle_path is None:
                matches.append(
                    {
                        "pid": pid,
                        "executable_path": str(executable),
                        "executable_sha256": digest,
                        "bundle_path": str(bundle_path) if bundle_path else None,
                        "bundle_id": bundle_id,
                        "ps_comm": comm,
                    }
                )
    return matches


def inspect_database(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ValueError(f"Production database is missing: {path}")
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
    minimum = manifest.get("minSupportedSchemaVersion")
    if not isinstance(minimum, int) or minimum < 1 or minimum > 3:
        errors.append("Candidate compatibility manifest must declare support for schema V3 and migration from an earlier version.")
    return errors


def validate_preflight(facts: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if facts.get("platform") != "darwin":
        errors.append("Production release gate requires macOS.")
    processes = facts.get("running_production_processes")
    if not isinstance(processes, list):
        errors.append("Production process inventory is unknown.")
    elif processes:
        errors.append("A Production-identity process or unknown matching executable is still running.")

    expected_app = Path(str(facts.get("expected_installed_app", "")))
    apps = facts.get("production_apps")
    if not isinstance(apps, list):
        errors.append("Installed Production bundle inventory is unknown.")
        apps = []
    if len(apps) != 1:
        errors.append("Normal launch locations must contain exactly one Production-identity app bundle.")
    candidate = facts.get("candidate")
    if not isinstance(candidate, dict):
        errors.append("Installed candidate facts are unknown.")
        candidate = {}
    else:
        errors.extend(validate_manifest(candidate))
        if not (int(candidate.get("executable_mode", 0)) & 0o111):
            errors.append("Candidate executable has no execute permission.")
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

    approval = facts.get("candidate_approval")
    migration_authorization = facts.get("migration_authorization")
    if not isinstance(approval, dict):
        errors.append("Approved candidate record is missing or unreadable.")
    else:
        if approval.get("status") != "OWNER_APPROVED_V4_PRODUCTION_CANDIDATE":
            errors.append("Candidate approval status is not Owner-approved for Production V4.")
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
    if database.get("user_version") != 3 or database.get("migration_version") != 3:
        errors.append("Production migration source must be consistent Schema V3.")
    if database.get("integrity") != ["ok"] or database.get("foreign_key_violations") != []:
        errors.append("Production database integrity or foreign-key preflight failed.")

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
    return errors


def make_release_receipt(facts: dict[str, Any]) -> dict[str, Any]:
    errors = validate_preflight(facts)
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
        "productionDatabasePath": database["path"],
        "productionDatabasePreMigrationSha256": database["sha256"],
        "productionSchema": {
            "userVersion": database["user_version"],
            "migrationVersion": database["migration_version"],
        },
        "backupPath": str(Path(str(backup["path"])).resolve()),
        "backupSha256": backup["sha256"],
        "ownerAuthorizationId": facts["migration_authorization"].get("authorizationId"),
        "processInventory": [],
        "productionAppInventory": [item["bundle_path"] for item in facts["production_apps"]],
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
    return {
        "platform": sys.platform,
        "expected_installed_app": str(APP_PATH),
        "expected_database_path": str(DATABASE_PATH),
        "running_production_processes": inventory_production_processes(),
        "production_apps": apps,
        "candidate": candidate,
        "candidate_approval": candidate_approval,
        "migration_authorization": migration_authorization,
        "production_database": database,
        "backup": backup,
    }


def write_migration_permit(receipt: dict[str, Any], approval: dict[str, Any]) -> tuple[Path, str]:
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
    APP_DATA.mkdir(parents=True, exist_ok=True)
    temporary = GATE_AUTH_PATH.with_suffix(".tmp")
    with temporary.open("x", encoding="utf-8") as stream:
        json.dump(permit, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, GATE_AUTH_PATH)
    return GATE_AUTH_PATH, nonce


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
    receipt = make_release_receipt(facts)
    if mode == "preflight":
        _persist_receipt(receipt_path, receipt, create=True)
        return receipt
    if mode != "migrate":
        raise ValueError(f"Unsupported gate mode: {mode}")
    receipt["status"] = "GATE_PASSED_MIGRATION_PERMITTED"
    _persist_receipt(receipt_path, receipt, create=True)
    permit_path, nonce = write_migration_permit(receipt, migration_authorization)
    executable = Path(receipt["candidateExecutablePath"])
    env = dict(os.environ)
    env[MIGRATION_AUTH_ENV] = nonce
    try:
        process = subprocess.Popen([str(executable)], cwd=str(executable.parent), env=env, start_new_session=True)
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
    if not str(authorization.get("authorizationId", "")).strip():
        raise GateBlocked(["Runtime replacement authorization ID is missing."])
    if authorization.get("oldExecutableSha256") != expected_old_sha256:
        raise GateBlocked(["Replacement authorization does not match the installed legacy executable hash."])
    if Path(str(authorization.get("candidateAppPath", ""))).resolve() != candidate_source.resolve():
        raise GateBlocked(["Replacement authorization does not name this exact candidate app path."])
    if Path(str(authorization.get("targetAppPath", ""))).resolve() != normal_app_path.resolve():
        raise GateBlocked(["Replacement authorization does not name this exact Production install path."])
    if Path(str(authorization.get("oldAppPath", ""))).resolve() != old_app.resolve():
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
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
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
        "originalBundlePath": str(old_app),
        "archivePath": str(archive_app),
        "legacyExecutableSha256": old["executable_sha256"],
        "archiveExecutableOriginalMode": original_mode,
        "archiveFileInventory": original_files,
        "candidateExecutableSha256": candidate["executable_sha256"],
    }
    with (archive_dir / "retirement-receipt.json").open("x", encoding="utf-8") as stream:
        json.dump(receipt, stream, ensure_ascii=False, indent=2)
        stream.write("\n")

    try:
        shutil.rmtree(old_app)
        shutil.copytree(candidate_source, candidate_stage, symlinks=True)
        if read_bundle(candidate_stage)["executable_sha256"] != candidate["executable_sha256"]:
            raise GateBlocked(["Installed staging candidate does not match its approved executable hash."])
        os.replace(candidate_stage, normal_app_path)
        installed = read_bundle(normal_app_path)
        errors = validate_manifest(installed)
        if errors or installed["executable_sha256"] != candidate["executable_sha256"]:
            raise GateBlocked(errors or ["Installed Production candidate differs from the approved candidate."])
        receipt["status"] = "LEGACY_ARCHIVED_CANDIDATE_INSTALLED"
        return receipt
    except Exception:
        if candidate_stage.exists():
            shutil.rmtree(candidate_stage, ignore_errors=True)
        if normal_app_path.exists() and normal_app_path != old_app:
            shutil.rmtree(normal_app_path, ignore_errors=True)
        if not old_app.exists() and archive_app.exists():
            shutil.copytree(archive_app, old_app)
            restored_executable = old_app / "Contents/MacOS" / old["executable_name"]
            restored_executable.chmod(original_mode)
        raise


def run_retirement(candidate_path: Path, authorization_path: Path) -> dict[str, Any]:
    if sys.platform != "darwin":
        raise GateBlocked(["Production runtime retirement is supported only on macOS."])
    authorization = _load_json(authorization_path, "Runtime replacement authorization")
    installed_apps = inventory_production_apps([Path("/Applications"), Path.home() / "Applications"])
    processes = inventory_production_processes()
    archive_root = APP_DATA / "retired-production-runtimes"
    return retirement_replace(
        APP_PATH,
        candidate_path,
        APP_PATH,
        archive_root,
        authorization,
        processes,
        installed_apps,
    )


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
    args = parser.parse_args()
    try:
        if args.command == "retire":
            result = run_retirement(args.candidate_app, args.replacement_authorization)
        else:
            result = run_gate(args.command, args.candidate_approval, args.migration_authorization, args.receipt)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (GateBlocked, OSError, ValueError, sqlite3.Error, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        if isinstance(error, GateBlocked):
            print(json.dumps({"status": "BLOCKED", "reasons": error.reasons}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
