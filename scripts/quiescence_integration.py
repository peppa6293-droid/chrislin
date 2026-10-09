#!/usr/bin/env python3
"""One synthetic-only managed gate for the versioned native cutover protocol.

Nothing here opens a Production database, scans the host, restores an old runtime,
or supplies Production authorization. The only writable roots accepted are new
canonical temporary fixtures bearing the exact synthetic marker. All managed
objects are a finite, closed tree. A partial attempt is diagnostic-only on restart.
Q11 is exercised by the separate real Tauri frontend harness, never by CLI mode.
"""
from __future__ import annotations

import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import plistlib
import selectors
import signal
import shutil
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import uuid

from quiescence_gate import (
    Blocked, EXECUTABLE_NAME, MARKER, PRODUCTION_BUNDLE_ID, MaintenanceLease,
    bundle_identity, collect_spawned_fixture_targets, copy_disabled,
    disable_known_entries, discover, fixture_root, identity, scoped,
    validate_inventory,
)

REPO = Path(__file__).resolve().parents[1]
DATABASE = "personal-finance-console.sqlite3"
CONTRACT_VERSION = 2
ISOLATED_BUNDLE_ID = "org.pfc.quiescence.integration"
OLD_RUNTIME_BUNDLE_ID = "org.pfc.quiescence.oldruntime"
EXE_REL = Path("Contents/MacOS") / EXECUTABLE_NAME
MANIFEST_REL = Path("Contents/Resources/runtime-compatibility.json")


def _configured_signing_identity(explicit=None):
    value = explicit or os.environ.get("APPLE_SIGNING_IDENTITY")
    if sys.platform == "darwin" and (not value or value == "-"):
        raise Blocked("MACOS_SIGNING_PREREQUISITE_REQUIRED", "Apple Development identity was not configured")
    return value


def _codesign(path, signing_identity, *, identifier=None):
    command = ["codesign", "--force", "--timestamp=none", "--sign", signing_identity]
    if identifier:
        command += ["--identifier", identifier]
    command.append(str(path))
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise Blocked("BLOCKED_CODESIGN_FAILED", f"{path}: {result.stderr.strip() or result.stdout.strip()}")


def _code_signature(path, *, assess_gatekeeper=False, allow_local_development=False):
    if sys.platform != "darwin":
        return {"signature_verified": None, "gatekeeper": "not-applicable"}
    verify = subprocess.run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", str(path)],
                            capture_output=True, text=True)
    if verify.returncode:
        raise Blocked("BLOCKED_CODE_SIGNATURE_INVALID", f"{path}: {verify.stderr.strip() or verify.stdout.strip()}")
    display = subprocess.run(["codesign", "-dv", "--verbose=4", str(path)], capture_output=True, text=True)
    requirement = subprocess.run(["codesign", "-dr", "-", str(path)], capture_output=True, text=True)
    if display.returncode or requirement.returncode:
        raise Blocked("BLOCKED_CODE_SIGNATURE_IDENTITY_UNKNOWN", str(path))
    facts = {"signature_verified": True, "signature_details": display.stderr.strip(),
             "designated_requirement": requirement.stderr.strip()}
    if assess_gatekeeper:
        assessment = subprocess.run(["spctl", "--assess", "--type", "execute", "--verbose=4", str(path)],
                                    capture_output=True, text=True)
        facts["gatekeeper_assessment"] = {"exit_code": assessment.returncode,
                                           "stdout": assessment.stdout, "stderr": assessment.stderr}
        if assessment.returncode and not allow_local_development:
            raise Blocked("BLOCKED_GATEKEEPER_ASSESSMENT",
                          assessment.stderr.strip() or assessment.stdout.strip())
        facts["gatekeeper_interpretation"] = (
            "diagnostic_only_apple_development_local_test_path" if assessment.returncode
            else "accepted_by_gatekeeper"
        )
    return facts


def _build_old_runtime():
    executable = REPO / "src-tauri/target/debug/quiescence-old-runtime"
    if not executable.is_file():
        subprocess.run(["cargo", "build", "--manifest-path", str(REPO / "src-tauri/Cargo.toml"),
                        "--features", "quiescence-fixture", "--bin", "quiescence-old-runtime"],
                       cwd=REPO, check=True)
    return executable.resolve(strict=True)

# These contracts describe restart behavior as well as happy-path edges. Native
# owns S3-S10; a missing receipt cannot be repaired from a SQLite version number.
MANAGED_STATE_CONTRACT = {
    "S0_VERIFIED_CANDIDATE": {
        "entry": "new fixture, immutable bootstrap/readback and exact closed inventory",
        "next": "S1_OLD_RUNTIME_RETAINED", "failure": "MANAGED_BLOCKED",
        "restart": "diagnose only; no reissue, no restore, no implicit resume",
    },
    "S1_OLD_RUNTIME_RETAINED": {
        "entry": "retained child handle associated with executable dev/inode/hash",
        "next": "S1_ENTRIES_DISABLED", "failure": "MANAGED_BLOCKED",
        "restart": "retained process proof unavailable means blocked",
    },
    "S1_ENTRIES_DISABLED": {
        "entry": "every known managed route loses all execute bits before any move",
        "next": "S1_TARGET_EXIT_VERIFIED", "failure": "MANAGED_BLOCKED",
        "restart": "do not restore entrypoints or infer process exit from absence",
    },
    "S1_TARGET_EXIT_VERIFIED": {
        "entry": "waitpid on exact retained children confirms exit",
        "next": "S1_ARCHIVE_VERIFIED", "failure": "MANAGED_BLOCKED",
        "restart": "diagnose only; no automatic old-runtime restoration",
    },
    "S1_ARCHIVE_VERIFIED": {
        "entry": "disabled source renamed; retained old executable inode preserved",
        "next": "S1_STAGING_VERIFIED", "failure": "MANAGED_BLOCKED",
        "restart": "archive remains disabled; actual rollback is out of scope",
    },
    "S1_STAGING_VERIFIED": {
        "entry": "staging files born without execute bits; exact candidate bytes",
        "next": "S1_INSTALLED_DISABLED", "failure": "MANAGED_BLOCKED",
        "restart": "staging remains disabled; do not auto-promote",
    },
    "S1_INSTALLED_DISABLED": {
        "entry": "installed copy born disabled; no executable managed route",
        "next": "S1_MANAGED_ISOLATED", "failure": "MANAGED_BLOCKED",
        "restart": "do not auto-enable installed or old executable",
    },
    "S1_MANAGED_ISOLATED": {
        "entry": "only installed primary executable enabled; full identity readback",
        "next": "S2_OWNER_AUTHORIZED", "failure": "MANAGED_BLOCKED",
        "restart": "unresolved attempt requires structured diagnostic recovery",
    },
    "S2_OWNER_AUTHORIZED": {
        "entry": "exact synthetic authorization and inode/session lease binding",
        "next": "native S3 PERMIT_CONSUMED", "failure": "MANAGED_BLOCKED",
        "restart": "never revive or replace any existing permit/attempt record",
    },
}


def _bytes(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _sync_dir(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _new_bytes(path, content, mode=0o600):
    """Create, flush and read back exact bytes; no overwrite and no exec gap."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, "wb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    _sync_dir(path.parent)
    if path.read_bytes() != content:
        raise Blocked("BLOCKED_PERSISTED_READBACK", str(path))


def _new_json(path, value):
    _new_bytes(path, _bytes(value))


def _durable_json(root, name, value):
    target = scoped(root, root / name, exists=False)
    pending = scoped(root, root / (name + ".pending"), exists=False)
    if target.exists():
        identity(target)
    _new_json(pending, value)
    os.rename(pending, target)
    _sync_dir(root)
    if json.loads(target.read_bytes()) != value:
        raise Blocked("BLOCKED_PERSISTED_READBACK", name)


def _copy_file(source, destination):
    source = Path(source)
    before = identity(source)
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as output, source.open("rb") as incoming:
        for block in iter(lambda: incoming.read(1024 * 1024), b""):
            output.write(block)
        output.flush()
        os.fsync(output.fileno())
    if identity(source) != before or identity(destination)["sha256"] != before["sha256"]:
        raise Blocked("BLOCKED_COPY_DRIFT", str(source))
    _sync_dir(destination.parent)


def _bundle(path, executable_source, version, *, enabled=False, bundle_id=PRODUCTION_BUNDLE_ID):
    (path / "Contents/MacOS").mkdir(parents=True, mode=0o700)
    (path / "Contents/Resources").mkdir(mode=0o700)
    _new_bytes(path / "Contents/Info.plist", plistlib.dumps({
        "CFBundleIdentifier": bundle_id,
        "CFBundleExecutable": EXECUTABLE_NAME,
        "CFBundlePackageType": "APPL",
        "CFBundleSignature": "????",
        "CFBundleShortVersionString": f"0.1.2-synthetic-v{version}",
        "LSMinimumSystemVersion": "11.0",
        "NSHighResolutionCapable": True,
    }))
    _new_json(path / MANIFEST_REL, {
        "manifestFormatVersion": 1, "runtimeGeneration": version,
        "minSupportedSchemaVersion": 3, "maxSupportedSchemaVersion": version,
        "bundleId": bundle_id, "executable": str(EXE_REL),
    })
    _copy_file(executable_source, path / EXE_REL)
    if enabled:
        (path / EXE_REL).chmod(0o700)
    _sync_dir(path / "Contents/MacOS")
    return path


def _copy_bundle_disabled(source, target):
    source, target = Path(source).resolve(strict=True), Path(target)
    if not source.is_dir() or target.exists():
        raise Blocked("BLOCKED_CANDIDATE_BUNDLE_PATH", str(source))
    for item in [source, *source.rglob("*")]:
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
            raise Blocked("BLOCKED_CANDIDATE_BUNDLE_OBJECT", str(item))
        if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise Blocked("BLOCKED_CANDIDATE_BUNDLE_HARDLINK", str(item))
    target.mkdir(mode=0o700, parents=True)
    for current, dirs, files in os.walk(source, followlinks=False):
        rel = Path(current).relative_to(source)
        for name in dirs:
            (target / rel / name).mkdir(mode=0o700)
        for name in files:
            original, destination = Path(current) / name, target / rel / name
            before = identity(original)
            fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as out, original.open("rb") as inp:
                shutil.copyfileobj(inp, out, 1024 * 1024)
                out.flush()
                os.fsync(out.fileno())
            if identity(original) != before or identity(destination)["sha256"] != before["sha256"]:
                raise Blocked("BLOCKED_CANDIDATE_COPY_DRIFT", str(original))
    return target


def _paths(root):
    return {
        "installed": root / "managed/install/Installed.app",
        "candidate": root / "managed/candidate/Candidate.app",
        "staging": root / "managed/staging/Staged.app",
        "archive": root / "managed/archive/Archived.app",
    }


def _bundle_exe_rel(path):
    info = plistlib.loads((Path(path) / "Contents/Info.plist").read_bytes())
    name = info.get("CFBundleExecutable") if isinstance(info, dict) else None
    if not isinstance(name, str) or not name or Path(name).name != name or "/" in name:
        raise Blocked("BLOCKED_BUNDLE_EXECUTABLE_UNKNOWN", str(path))
    return Path("Contents/MacOS") / name


def _role(path, paths):
    # Nested objects retain the enclosing role; bundles have a separate nested
    # role. No role is an exception to the disabled-execution invariant.
    for name, base in paths.items():
        if path == base or path.is_relative_to(base):
            return name
    return "managed_container"


def tree_facts(root):
    """Closed managed-root inventory, including all directories and bare files."""
    root = fixture_root(root)
    managed = scoped(root, root / "managed")
    paths = _paths(root)
    facts = []
    for path in sorted([managed, *managed.rglob("*")], key=str):
        path = scoped(root, path)
        info = path.lstat()
        if stat.S_ISREG(info.st_mode):
            fact = identity(path)
            kind, digest = "file", fact["sha256"]
        elif stat.S_ISDIR(info.st_mode):
            kind, digest = "directory", None
        else:
            raise Blocked("BLOCKED_MANAGED_FILE_TYPE", str(path))
        if path.name.endswith((".alias", ".bookmark")):
            raise Blocked("BLOCKED_LAUNCH_ALIAS_UNKNOWN", str(path))
        facts.append({"role": _role(path, paths), "path": str(path), "kind": kind,
                      "dev": info.st_dev, "inode": info.st_ino, "size": info.st_size,
                      "links": info.st_nlink, "mode": stat.S_IMODE(info.st_mode),
                      "sha256": digest})
    return facts


def _bootstrap(root):
    """Only a newly created synthetic DB is writable; subsequent proof immutable."""
    fixture_root(root)
    database = root / DATABASE
    if database.exists():
        raise Blocked("BLOCKED_BOOTSTRAP_EXISTS")
    source = (REPO / "migrations/003-bootstrap.sql").read_text()
    with closing(sqlite3.connect(database)) as connection, connection:
        connection.executescript(source)
        connection.execute("INSERT INTO profiles(id,display_name,created_at) VALUES('fixture','Synthetic','2000-01-01')")
        connection.execute("INSERT INTO app_metadata(key,value) VALUES('quiescence-sentinel','unchanged')")
    database.chmod(0o600)
    with database.open("rb") as stream:
        os.fsync(stream.fileno())
    _sync_dir(root)
    _verify_v3(root)
    _copy_file(database, root / "backup.sqlite3")
    return {"database_sha256": identity(database)["sha256"],
            "backup_sha256": identity(root / "backup.sqlite3")["sha256"],
            "bootstrap_source_sha256": _sha(source.encode())}


def _verify_v3(root):
    root = fixture_root(root)
    database = scoped(root, root / DATABASE)
    before = identity(database)
    if any((root / (DATABASE + suffix)).exists() for suffix in ("-wal", "-shm", "-journal")):
        raise Blocked("BLOCKED_PREMIGRATION_SIDECAR")
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro&immutable=1", uri=True)) as connection:
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        versions = [row[0] for row in connection.execute("SELECT version FROM schema_migrations ORDER BY version")]
        actual = [dict(zip(("type", "name", "tbl_name", "sql"), row)) for row in connection.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name")]
        expected = json.loads((REPO / "migrations/v3-schema.json").read_text())
        integrity = connection.execute("PRAGMA integrity_check").fetchall()
        foreign = connection.execute("PRAGMA foreign_key_check").fetchall()
    if version != 3 or versions != [1, 2, 3] or actual != expected or integrity != [("ok",)] or foreign:
        raise Blocked("BLOCKED_PREMIGRATION_V3_UNPROVEN")
    if identity(database) != before:
        raise Blocked("BLOCKED_PREMIGRATION_DB_DRIFT")
    return {"exact_schema": True, "integrity": "ok", "foreign_keys": "ok", **before}


def create_fixture(parent, native_executable, scenario="formal", runtime_bundle_id=ISOLATED_BUNDLE_ID,
                   *, candidate_bundle=None, signing_identity=None):
    """Return a fresh fixture definition; no permit or lease is created here.

    Controllers must call prepare_managed while retaining their own lease, then
    launch the installed executable with that same inherited open description.
    """
    parent = Path(parent).absolute()
    resolved = parent.resolve(strict=True)
    temp = Path(tempfile.gettempdir()).resolve()
    if parent != resolved or not (resolved == temp or resolved.is_relative_to(temp)):
        raise Blocked("BLOCKED_NOT_ISOLATED_FIXTURE", str(parent))
    native_executable = Path(native_executable).resolve(strict=True)
    native_identity = identity(native_executable)
    if not isinstance(runtime_bundle_id, str) or not runtime_bundle_id or runtime_bundle_id == PRODUCTION_BUNDLE_ID:
        raise Blocked("BLOCKED_RUNTIME_NOT_ISOLATED", "candidate runtime identity must be explicitly isolated")
    scenario = str(scenario)
    if not scenario or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for c in scenario):
        raise Blocked("BLOCKED_SCENARIO")
    root = Path(tempfile.mkdtemp(prefix=f"pfc-qic-{scenario}-", dir=parent)).resolve()
    _new_bytes(root / "SYNTHETIC_ONLY", MARKER.encode())
    paths = _paths(root)
    for path in paths.values():
        path.parent.mkdir(parents=True, mode=0o700)
    signing_identity = _configured_signing_identity(signing_identity)
    old_source = _build_old_runtime()
    _bundle(paths["installed"], old_source, 3, enabled=True, bundle_id=OLD_RUNTIME_BUNDLE_ID)
    nested = paths["installed"] / "Contents/Resources/Outer/Contents/Resources/Nested.app"
    _bundle(nested, old_source, 3, enabled=True, bundle_id=OLD_RUNTIME_BUNDLE_ID)
    helper = paths["installed"] / "Contents/Resources/legacy-helper"
    _copy_file(old_source, helper)
    helper.chmod(0o700)
    _codesign(helper, signing_identity, identifier=OLD_RUNTIME_BUNDLE_ID + ".helper")
    _codesign(nested, signing_identity)
    _codesign(paths["installed"], signing_identity)
    old_signature = _code_signature(paths["installed"])
    if candidate_bundle:
        candidate_bundle = Path(candidate_bundle).resolve(strict=True)
        local_development = signing_identity.startswith("Apple Development:")
        source_signature = _code_signature(candidate_bundle, assess_gatekeeper=True,
                                           allow_local_development=local_development)
        _copy_bundle_disabled(candidate_bundle, paths["candidate"])
        candidate_signature = _code_signature(paths["candidate"], assess_gatekeeper=True,
                                              allow_local_development=local_development)
        candidate_signature["source_signature"] = source_signature
    else:
        _bundle(paths["candidate"], native_executable, 4, bundle_id=runtime_bundle_id)
        _codesign(paths["candidate"], signing_identity)
        candidate_signature = _code_signature(paths["candidate"], assess_gatekeeper=True,
                                              allow_local_development=signing_identity.startswith("Apple Development:"))
        runtime_bundle_id = bundle_identity(root, paths["candidate"], expected_bundle_id=runtime_bundle_id)["bundle_id"]
    _copy_file(paths["candidate"] / MANIFEST_REL, root / "manifest.json")
    bootstrap = _bootstrap(root)
    definition = {
        "format_version": 2, "synthetic_only": True, "root": str(root),
        "scenario": scenario, "session": "session-" + uuid.uuid4().hex,
        "authorization_id": "synthetic-integration-" + uuid.uuid4().hex,
        "nonce": uuid.uuid4().hex, "candidate_executable_rel": str(_bundle_exe_rel(paths["candidate"])),
        "native_sha256": identity(paths["candidate"] / _bundle_exe_rel(paths["candidate"]))["sha256"],
        "build_executable_sha256": native_identity["sha256"],
        "signing_identity": signing_identity,
        "signing_facts": {"old_runtime": old_signature, "candidate_runtime": candidate_signature},
        "runtime_bundle_id": runtime_bundle_id,
        "paths": {key: str(value) for key, value in paths.items()},
        "known_nested": [str(nested)], "known_helpers": [str(helper)],
        "initial_inventory": tree_facts(root), "bootstrap": bootstrap,
    }
    _new_json(root / "fixture-definition.json", definition)
    return {**definition, "fixture_definition_path": str(root / "fixture-definition.json")}


class Recorder:
    def __init__(self, root, definition):
        self.root, self.definition = root, definition
        self.receipts = []

    def record(self, state, details):
        value = {
            "format_version": 2, "synthetic_only": True, "state": state,
            "session": self.definition["session"], "authorization_id": self.definition["authorization_id"],
            "nonce": self.definition["nonce"], "sequence": len(self.receipts) + 1,
            "previous_evidence_sha256": self.receipts[-1]["evidence_sha256"] if self.receipts else None,
            "details": details,
        }
        if state in MANAGED_STATE_CONTRACT:
            value["state_contract"] = MANAGED_STATE_CONTRACT[state]
        path = self.root / f"managed-state-{state}.json"
        _new_json(path, value)
        receipt = {"state": state, "path": str(path), "evidence_sha256": identity(path)["sha256"]}
        self.receipts.append(receipt)
        _durable_json(self.root, "managed-progress.json", {
            "format_version": 2, "synthetic_only": True, "session": value["session"],
            "authorization_id": value["authorization_id"], "nonce": value["nonce"],
            "state": state, "receipts": self.receipts,
        })
        return receipt


def _all_disabled(root):
    routes = [item for item in tree_facts(root) if item["kind"] == "file" and item["mode"] & 0o111]
    if routes:
        raise Blocked("BLOCKED_EXTRA_EXECUTABLE_ROUTE", str([item["path"] for item in routes]))


def _same_tree_bytes(source, target):
    def content(path):
        return {str(p.relative_to(path)): (identity(p)["sha256"], identity(p)["size"])
                for p in path.rglob("*") if p.is_file()}
    if content(source) != content(target):
        raise Blocked("BLOCKED_COPY_DRIFT", str(target))


def _frozen_bundle(root, definition, original_role, current, *, same_inode, enabled=False):
    """Recheck S0 bytes/set after permitted rename/copy/chmod transformations."""
    original = Path(definition["paths"][original_role])
    expected = {str(Path(item["path"]).relative_to(original)): item
                for item in definition["initial_inventory"]
                if Path(item["path"]) == original or Path(item["path"]).is_relative_to(original)}
    current = scoped(root, current)
    actual = {str(path.relative_to(current)): path for path in [current, *current.rglob("*")]}
    if set(actual) != set(expected):
        raise Blocked("BLOCKED_FROZEN_BUNDLE_SET", str(current))
    for relative, path in actual.items():
        path = scoped(root, path)
        prior, now = expected[relative], path.lstat()
        if prior["kind"] == "directory":
            if not stat.S_ISDIR(now.st_mode):
                raise Blocked("BLOCKED_FROZEN_BUNDLE_DRIFT", str(path))
            continue
        fact = identity(path)
        original_exe = (Path(definition["candidate_executable_rel"]) if original_role == "candidate" else EXE_REL)
        if enabled and relative == str(original_exe):
            wanted_mode = 0o700
        elif not same_inode:
            wanted_mode = 0o600
        else:
            wanted_mode = prior["mode"] & ~0o111
        if fact["sha256"] != prior["sha256"] or fact["size"] != prior["size"] or fact["mode"] != wanted_mode:
            raise Blocked("BLOCKED_FROZEN_BUNDLE_DRIFT", str(path))
        if same_inode and (fact["dev"], fact["ino"]) != (prior["dev"], prior["inode"]):
            raise Blocked("BLOCKED_FROZEN_BUNDLE_IDENTITY", str(path))


def _closed_final_tree(root, definition, paths):
    _frozen_bundle(root, definition, "installed", paths["archive"], same_inode=True)
    _frozen_bundle(root, definition, "candidate", paths["candidate"], same_inode=True)
    _frozen_bundle(root, definition, "candidate", paths["staging"], same_inode=False)
    _frozen_bundle(root, definition, "candidate", paths["installed"], same_inode=False, enabled=True)
    allowed_containers = {root / "managed", *(path.parent for path in paths.values())}
    for item in tree_facts(root):
        path = Path(item["path"])
        if path not in allowed_containers and not any(path == bundle or path.is_relative_to(bundle) for bundle in paths.values()):
            raise Blocked("BLOCKED_UNDECLARED_MANAGED_ROUTE", str(path))
        if item["kind"] == "file" and item["mode"] & 0o111 and path != paths["installed"] / Path(definition["candidate_executable_rel"]):
            raise Blocked("BLOCKED_EXTRA_EXECUTABLE_ROUTE", str(path))


def _contract_bundles(root, paths):
    actual = discover(root, [root / "managed"], all_bundles=True)
    top = {str(path): role for role, path in paths.items()}
    bundles = []
    for name in sorted(actual):
        path = Path(name)
        bundles.append({"role": top.get(name, "nested"), "path": name,
                        "executable": str(path / _bundle_exe_rel(path)),
                        "info_plist": str(path / "Contents/Info.plist"),
                        "manifest": str(path / MANIFEST_REL), "bundle_id": actual[name]["bundle_id"],
                        "enabled": bool((path / _bundle_exe_rel(path)).stat().st_mode & 0o111)})
    return actual, bundles


def _retained_child_start(child, expected_session, expected_executable):
    """Require a project-runtime readiness handshake before recording PID start."""
    if child.poll() is not None:
        raise Blocked("BLOCKED_MANAGED_RUNTIME_IDENTITY_UNKNOWN", "child exited before OS start observation")
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ)
    try:
        if not selector.select(timeout=5):
            raise Blocked("BLOCKED_OLD_RUNTIME_READINESS_TIMEOUT", "no project runtime handshake")
        line = child.stdout.readline()
    finally:
        selector.close()
    try:
        readiness = json.loads(line)
    except (json.JSONDecodeError, TypeError) as exc:
        raise Blocked("BLOCKED_OLD_RUNTIME_READINESS_INVALID", repr(line)) from exc
    expected = {"protocol": "pfc.synthetic-old-runtime.ready.v1", "pid": child.pid,
                "session": expected_session, "initialized": True}
    if readiness != expected or identity(Path(child.args[0]))["sha256"] != expected_executable["sha256"]:
        raise Blocked("BLOCKED_OLD_RUNTIME_READINESS_BINDING", "runtime/session/executable identity mismatch")
    if child.poll() is not None:
        raise Blocked("BLOCKED_OLD_RUNTIME_READINESS_EARLY_EXIT", "runtime exited before readiness association")
    env = os.environ.copy()
    env["LC_ALL"] = "C"
    result = subprocess.run(["/bin/ps", "-p", str(child.pid), "-o", "lstart="],
                            env=env, capture_output=True, text=True, timeout=5)
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if result.returncode != 0 or len(lines) != 1 or child.poll() is not None:
        raise Blocked("BLOCKED_MANAGED_RUNTIME_IDENTITY_UNKNOWN", "OS start fact unavailable")
    return {"value": lines[0], "pid": child.pid, "collector": "ps_exact_retained_child_lstart",
            "ownership": "retained_Popen_waitpid", "returncode": result.returncode,
            "readiness": {"protocol": readiness["protocol"], "pid": readiness["pid"],
                          "session": readiness["session"], "initialized": readiness["initialized"],
                          "executable_sha256": expected_executable["sha256"]}}


def _verify_requested_old_exit(returncode, readiness=None):
    if returncode != 0 or not readiness or readiness.get("initialized") is not True:
        raise Blocked("BLOCKED_OLD_FIXTURE_EXECUTION_UNPROVEN",
            f"requested termination/readiness was not proven: exit={returncode}; no contract/permit")


def prepare_managed(root, lease, *, stop_old=True, observer=None):
    """Run S0-S2 once. Every phase persists; an interrupted phase never resumes.

    observer is test-only instrumentation and cannot skip a transition. Native
    independently rechecks every frozen managed file and every bound receipt.
    """
    root = fixture_root(Path(root))
    lease.validate()
    if lease.root != root:
        raise Blocked("BLOCKED_LEASE_ROOT")
    definition_path = scoped(root, root / "fixture-definition.json")
    identity(definition_path)
    definition = json.loads(definition_path.read_bytes())
    if definition.get("format_version") != 2 or definition.get("synthetic_only") is not True or definition.get("root") != str(root) or definition.get("session") != lease.session:
        raise Blocked("BLOCKED_FIXTURE_BINDING")
    if any((root / name).exists() or (root / name).is_symlink() for name in (
        "managed-progress.json", "managed-progress.json.pending", "permit.json", "permit.claimed.json",
        "consumed.json", "outcome.json", "outcome.json.pending", "managed-contract.json", "authorization.json",
        "native-launch.json", "gate-handoff.json")) or list(root.glob("managed-state-*.json")):
        raise Blocked("BLOCKED_MANAGED_ATTEMPT_PENDING", "diagnose only; no automatic retry")
    paths = _paths(root)
    if definition["paths"] != {key: str(value) for key, value in paths.items()}:
        raise Blocked("BLOCKED_MANAGED_OBJECT_SET")
    if tree_facts(root) != definition["initial_inventory"]:
        raise Blocked("BLOCKED_MANAGED_OBJECT_DRIFT")
    if paths["archive"].exists() or paths["staging"].exists():
        raise Blocked("BLOCKED_DESTINATION_EXISTS")
    # Explicit pairwise refusal happens before launching or disabling anything.
    for name, path in paths.items():
        for other, target in paths.items():
            if name != other and (path.is_relative_to(target) or target.is_relative_to(path)):
                raise Blocked("BLOCKED_COPY_OVERLAP")
    pre = _verify_v3(root)
    if pre["sha256"] != definition["bootstrap"]["database_sha256"]:
        raise Blocked("BLOCKED_PREMIGRATION_DB_DRIFT")
    candidate = bundle_identity(root, paths["candidate"], expected_bundle_id=definition["runtime_bundle_id"])
    if candidate["executable_sha256"] != definition["native_sha256"]:
        raise Blocked("BLOCKED_NATIVE_IDENTITY")
    candidate_signature = _code_signature(paths["candidate"], assess_gatekeeper=True,
                                           allow_local_development=definition.get("signing_identity", "").startswith("Apple Development:"))
    recorder = Recorder(root, definition)
    old_child = None
    def record(state, details):
        result = recorder.record(state, details)
        if observer:
            observer(state, root)
        return result
    try:
        record("S0_VERIFIED_CANDIDATE", {"candidate": candidate, "database": pre,
                "candidate_signature": candidate_signature,
                "initial_inventory_sha256": _sha(_bytes(definition["initial_inventory"]))})
        old_executable = paths["installed"] / EXE_REL
        old_identity = identity(old_executable)
        old_signature = _code_signature(paths["installed"], assess_gatekeeper=True,
                                        allow_local_development=definition.get("signing_identity", "").startswith("Apple Development:"))
        old_child = subprocess.Popen([str(old_executable), "--synthetic-old-runtime", definition["session"]],
                                     stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     text=True, bufsize=1)
        start_evidence = _retained_child_start(old_child, definition["session"], old_identity)
        association = {"pid": old_child.pid, "start": start_evidence["value"],
                       "identity": old_identity["sha256"], "executable_sha256": old_identity["sha256"],
                       "executable_dev": old_identity["dev"], "executable_inode": old_identity["ino"],
                       "readiness": start_evidence["readiness"], "signature": old_signature}
        if old_child.poll() is not None:
            raise Blocked("BLOCKED_MANAGED_RUNTIME_IDENTITY_UNKNOWN", "old fixture exited before association")
        record("S1_OLD_RUNTIME_RETAINED", {"association": association, "start_evidence": start_evidence,
                "association_id": uuid.uuid4().hex, "original_path": str(old_executable)})

        def exited_collector():
            _all_disabled(root)
            _frozen_bundle(root, definition, "installed", paths["installed"], same_inode=True)
            _frozen_bundle(root, definition, "candidate", paths["candidate"], same_inode=True)
            record("S1_ENTRIES_DISABLED", {"disabled_inventory": tree_facts(root),
                    "process_association": association, "source_still_in_install_slot": paths["installed"].exists()})
            if stop_old:
                old_child.terminate()  # Exact initialized child spawned above, never a host process.
                old_child.wait(timeout=5)
                _verify_requested_old_exit(old_child.returncode, start_evidence["readiness"])
            observations = collect_spawned_fixture_targets([(association, old_child)])
            if old_child.poll() is not None:
                record("S1_TARGET_EXIT_VERIFIED", observations)
            return observations

        disabled = disable_known_entries(lease, [paths["installed"], paths["candidate"]], [association], exited_collector, all_bundles=True)
        lease.validate()
        _all_disabled(root)
        os.rename(paths["installed"], paths["archive"])
        _sync_dir(paths["installed"].parent)
        _sync_dir(paths["archive"].parent)
        archive_id = identity(paths["archive"] / EXE_REL)
        if any(archive_id[key] != old_identity[key] for key in ("dev", "ino", "sha256")):
            raise Blocked("BLOCKED_RETAINED_PROCESS_ASSOCIATION")
        _all_disabled(root)
        _frozen_bundle(root, definition, "installed", paths["archive"], same_inode=True)
        record("S1_ARCHIVE_VERIFIED", {"source": str(paths["installed"]), "archive": bundle_identity(root, paths["archive"], expected_bundle_id=OLD_RUNTIME_BUNDLE_ID),
                "retained_association": association, "disabled_before_move": True, "disabled_receipt": disabled})
        copy_disabled(lease, paths["candidate"], paths["staging"])
        _all_disabled(root)
        _same_tree_bytes(paths["candidate"], paths["staging"])
        _frozen_bundle(root, definition, "candidate", paths["staging"], same_inode=False)
        staging_signature = _code_signature(paths["staging"])
        record("S1_STAGING_VERIFIED", {"staging": bundle_identity(root, paths["staging"], expected_bundle_id=definition["runtime_bundle_id"]), "born_disabled": True})
        copy_disabled(lease, paths["staging"], paths["installed"])
        _all_disabled(root)
        _same_tree_bytes(paths["candidate"], paths["installed"])
        _frozen_bundle(root, definition, "candidate", paths["installed"], same_inode=False)
        installed_disabled_signature = _code_signature(paths["installed"])
        record("S1_INSTALLED_DISABLED", {"installed": bundle_identity(root, paths["installed"], expected_bundle_id=definition["runtime_bundle_id"]), "born_disabled": True})
        installed_executable = paths["installed"] / Path(definition["candidate_executable_rel"])
        fd = os.open(installed_executable, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            os.fchmod(fd, 0o700)
            os.fsync(fd)
        finally:
            os.close(fd)
        actual, bundles = _contract_bundles(root, paths)
        _closed_final_tree(root, definition, paths)
        validate_inventory(lease, [root / "managed"], actual, paths["installed"], all_bundles=True)
        if identity(installed_executable)["sha256"] != definition["native_sha256"]:
            raise Blocked("BLOCKED_INSTALLED_READBACK")
        installed_signature = _code_signature(paths["installed"], assess_gatekeeper=True,
                                               allow_local_development=definition.get("signing_identity", "").startswith("Apple Development:"))
        record("S1_MANAGED_ISOLATED", {"bundles": bundles, "objects": tree_facts(root),
                "known_nested": [item["path"] for item in bundles if item["role"] == "nested"],
                "target_exit_evidence": disabled["exit_evidence"], "only_installed_executable_enabled": True,
                "staging_signature": staging_signature,
                "installed_disabled_signature": installed_disabled_signature,
                "installed_signature": installed_signature})

        authorization = {"format_version": 2, "synthetic_only": True, "scope": "synthetic-integration-only",
            "id": definition["authorization_id"], "session": definition["session"], "nonce": definition["nonce"],
            "database_sha256": definition["bootstrap"]["database_sha256"],
            "backup_sha256": definition["bootstrap"]["backup_sha256"],
            "candidate_executable_sha256": definition["native_sha256"],
            "allow_recovery": True, "allow_wal_infrastructure": True}
        lease_binding = lease.bind(definition["authorization_id"], definition["nonce"])
        _new_json(root / "authorization.json", authorization)
        record("S2_OWNER_AUTHORIZED", {"authorization": authorization, "lease": lease_binding,
                "authorization_sha256": identity(root / "authorization.json")["sha256"],
                "scope": "synthetic-only; no Production authority"})
        archive_helper = paths["archive"] / "Contents/Resources/legacy-helper"
        routes = sorted({item["executable"] for item in bundles} | {str(archive_helper)})
        contract = {"format_version": 2, "synthetic_only": True, "root": str(root),
            "session": definition["session"], "authorization_id": definition["authorization_id"], "nonce": definition["nonce"],
            "objects": tree_facts(root), "bundles": bundles,
            "known_nested": [item["path"] for item in bundles if item["role"] == "nested"],
            "launch_routes": [{"path": path, "enabled": bool(Path(path).stat().st_mode & 0o111)} for path in routes],
            "processes": [{key: association[key] for key in (
                "pid", "start", "executable_sha256", "executable_dev", "executable_inode")} | {"state": "EXIT_CONFIRMED"}],
            "transitions": [receipt for receipt in recorder.receipts if receipt["state"] in (
                "S0_VERIFIED_CANDIDATE", "S1_MANAGED_ISOLATED", "S2_OWNER_AUTHORIZED")],
            "lease": lease_binding, "authorization": authorization}
        _new_json(root / "managed-contract.json", contract)
        permit = {"format_version": 2, "synthetic_only": True, "session": definition["session"],
            "nonce": definition["nonce"], "authorization_id": definition["authorization_id"],
            "database_sha256": authorization["database_sha256"], "backup_sha256": authorization["backup_sha256"],
            "executable_path": str(installed_executable), "executable_sha256": definition["native_sha256"],
            "manifest_sha256": identity(root / "manifest.json")["sha256"],
            "allow_recovery": True, "allow_wal_infrastructure": True,
            "managed_contract_sha256": identity(root / "managed-contract.json")["sha256"],
            "authorization_sha256": identity(root / "authorization.json")["sha256"],
            "lease_dev": lease_binding["dev"], "lease_inode": lease_binding["inode"]}
        _new_json(root / "permit.json", permit)
        lease.validate()
        if tree_facts(root) != contract["objects"]:
            raise Blocked("BLOCKED_MANAGED_OBJECT_DRIFT")
        return {"root": str(root), "session": definition["session"], "installed_executable": str(installed_executable),
                "native_sha256": definition["native_sha256"], "permit_path": str(root / "permit.json"),
                "managed_contract_path": str(root / "managed-contract.json"),
                "authorization_path": str(root / "authorization.json"), "state": "S2_OWNER_AUTHORIZED",
                "authorization_id": definition["authorization_id"], "nonce": definition["nonce"],
                "managed_contract_sha256": permit["managed_contract_sha256"]}
    except Exception as error:
        # Deliberately do not undo disabled entries or install the old app, even
        # when the DB happens to report schema 3. The receipt survives lease exit.
        if not (root / "managed-state-MANAGED_BLOCKED.json").exists():
            recorder.record("MANAGED_BLOCKED", {"error": str(error), "error_type": type(error).__name__,
                "last_completed_state": recorder.receipts[-1]["state"] if recorder.receipts else None,
                "automatic_restore": False, "restart": "diagnostic-only"})
        raise
    finally:
        if old_child is not None:
            if old_child.poll() is None:
                old_child.terminate()
                old_child.wait(timeout=5)
            if old_child.stderr:
                old_child.stderr.close()


def diagnose(root):
    """Read-only restart classification, never SQLite recovery or auto-resume."""
    root = fixture_root(Path(root))
    def blocked(reason):
        return {"state": "GUARD_LOST_OR_UNPROVEN", "recovery_required": True,
                "normal_startup_allowed": False, "reason": reason, "automatic_action": "NONE"}
    try:
        definition_path = root / "fixture-definition.json"
        identity(definition_path)
        definition = json.loads(definition_path.read_bytes())
        if definition.get("root") != str(root) or definition.get("format_version") != 2 or definition.get("synthetic_only") is not True:
            return blocked("fixture definition binding mismatch")
        pending = [str(path) for path in root.glob("*.pending")]
        if pending:
            return blocked("pending durable write: " + ",".join(pending))
        fixed = ("managed-progress.json", "managed-contract.json", "authorization.json", "permit.json",
                 "permit.claimed.json", "consumed.json", "outcome.json", "native-launch.json", "gate-handoff.json")
        names = list(fixed) + [path.name for pattern in ("managed-state-*.json", "native-state-*.json") for path in root.glob(pattern)]
        found = {}
        for name in names:
            path = root / name
            if path.exists() or path.is_symlink():
                identity(path)
                value = json.loads(path.read_bytes())
                if not isinstance(value, dict) or value.get("format_version") != 2 or value.get("synthetic_only") is not True:
                    return blocked("invalid durable format: " + name)
                for field in ("session", "nonce"):
                    if value.get(field) != definition[field]:
                        return blocked("durable binding mismatch: " + name + ":" + field)
                auth_field = "id" if name == "authorization.json" else "authorization_id"
                if value.get(auth_field) != definition["authorization_id"]:
                    return blocked("durable authorization mismatch: " + name)
                found[name] = value
        if not found:
            return {"state": "NOT_STARTED", "recovery_required": False,
                    "normal_startup_allowed": True, "automatic_action": "NONE"}
        progress = found.get("managed-progress.json")
        if not progress:
            return blocked("durable attempt artifacts without progress receipt")
        receipts = progress.get("receipts")
        if not isinstance(receipts, list) or not receipts:
            return blocked("missing transition chain")
        seen, previous = set(), None
        for index, receipt in enumerate(receipts, 1):
            state = receipt.get("state")
            name = f"managed-state-{state}.json"
            path = root / name
            if receipt.get("path") != str(path) or name not in found or state in seen:
                return blocked("transition chain missing, redirected, or duplicated")
            if identity(path)["sha256"] != receipt.get("evidence_sha256"):
                return blocked("transition receipt hash mismatch")
            value = found[name]
            if value.get("state") != state or value.get("sequence") != index or value.get("previous_evidence_sha256") != previous:
                return blocked("transition chain order mismatch")
            previous = receipt["evidence_sha256"]
            seen.add(state)
        if progress.get("state") != receipts[-1]["state"]:
            return blocked("progress/transition mismatch")
        if set(name for name in found if name.startswith("managed-state-")) != {f"managed-state-{state}.json" for state in seen}:
            return blocked("unindexed durable transition")
        permits = [found[name] for name in ("permit.json", "permit.claimed.json", "consumed.json") if name in found]
        for permit in permits:
            for target, field in (("managed-contract.json", "managed_contract_sha256"), ("authorization.json", "authorization_sha256")):
                if target not in found or identity(root / target)["sha256"] != permit.get(field):
                    return blocked("permit bound object missing or mismatched: " + target)
        if "permit.json" in found and any(name in found for name in ("permit.claimed.json", "consumed.json", "outcome.json")):
            return blocked("permit is both unclaimed and durably consumed")
        state = found.get("outcome.json", {}).get("state") or progress["state"]
        if "permit.claimed.json" in found and "outcome.json" not in found:
            state = "PERMIT_CONSUMED_BEFORE_LOCK"
        return {"state": state, "recovery_required": True,
                "normal_startup_allowed": False, "automatic_action": "NONE",
                "required_entrypoint": "native authorized diagnostic/recovery; no restore or rerun"}
    except Exception as error:
        return blocked("corrupt or unreadable durable attempt: " + str(error))


def handoff_native(lease, child, context, *, timeout=15):
    """Release the gate's descriptor only after durable exact native ACK readback.

    This is a filesystem handshake, not frontend IPC and not a Q11 substitute.
    Any failure leaves the gate descriptor held. Closing is never LOCK_UN: the
    native duplicate owns the same open file description without an unlocked gap.
    """
    lease.validate()
    root = fixture_root(Path(context["root"]))
    if root != lease.root or context["session"] != lease.session:
        raise Blocked("BLOCKED_NATIVE_HANDOFF_BINDING")
    expected = {"format_version": 2, "synthetic_only": True, "session": context["session"],
        "nonce": context["nonce"], "authorization_id": context["authorization_id"],
        "managed_contract_sha256": context["managed_contract_sha256"], "pid": child.pid,
        "parent_pid": os.getpid(), "lease_dev": os.fstat(lease.fd).st_dev,
        "lease_inode": os.fstat(lease.fd).st_ino}
    ack = root / "native-launch.json"
    deadline = time.monotonic() + timeout
    while not ack.exists():
        if child.poll() is not None:
            raise Blocked("BLOCKED_NATIVE_HANDOFF_UNPROVEN", "native exited without durable ownership ACK")
        if time.monotonic() >= deadline:
            raise Blocked("BLOCKED_NATIVE_HANDOFF_TIMEOUT", "gate lease retained")
        time.sleep(0.01)
    before = identity(ack)
    observed = json.loads(ack.read_bytes())
    if identity(ack) != before or observed != expected:
        raise Blocked("BLOCKED_NATIVE_HANDOFF_BINDING", "native ACK differs from exact launched child")
    lease.validate()
    receipt = {**expected, "state": "NATIVE_OWNERSHIP_ACKNOWLEDGED",
        "native_ack_sha256": before["sha256"], "native_ack_path": str(ack),
        "child_alive_at_ack_readback": child.poll() is None,
        "gate_action": "close-own-FD-only; never LOCK_UN", "persistent_attempt_preserved": True}
    _new_json(root / "gate-handoff.json", receipt)
    lease.__exit__()
    return receipt


def run_formal(parent, native, scenario="normal", mode="ipc", candidate_bundle=None):
    if mode == "ipc" and candidate_bundle is None:
        raise Blocked("BLOCKED_SIGNED_IPC_BUNDLE_REQUIRED")
    fixture = create_fixture(parent, native, scenario, candidate_bundle=candidate_bundle)
    root = Path(fixture["root"])
    with MaintenanceLease(root, fixture["session"]) as lease:
        context = prepare_managed(root, lease)
        args = [] if mode == "ipc" else ["run-integrated", str(root)]
        child = lease.launch_native(Path(context["installed_executable"]), context["native_sha256"],
            arguments=args, extra_env={"PFC_IPC_ROOT": str(root), "PFC_IPC_SCENARIO": scenario,
                "PFC_IPC_EVIDENCE_NAME": "ipc-evidence.json", "PFC_IPC_PHASE": "initial"}, stdin=subprocess.DEVNULL)
        try:
            handoff = handoff_native(lease, child, context)
            stdout, stderr = child.communicate(timeout=60)
        except subprocess.TimeoutExpired:
            child.kill()
            stdout, stderr = child.communicate(timeout=5)
            raise Blocked("BLOCKED_NATIVE_TIMEOUT", f"synthetic child reaped; root={root}")
        except Exception:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)
            raise
        outcome = json.loads((root / "outcome.json").read_bytes()) if (root / "outcome.json").exists() else None
        ipc_path = root / "ipc-initial.jsonl"
        ipc_evidence = [json.loads(line) for line in ipc_path.read_bytes().splitlines()] if mode == "ipc" and ipc_path.exists() else None
        ipc_complete = [row for row in (ipc_evidence or []) if row.get("event") == "frontend_complete"]
        assertions = [row["detail"]["value"] for row in (ipc_evidence or [])
                      if row.get("event") == "frontend_evidence" and row.get("detail", {}).get("value", {}).get("kind") == "assertion"]
        ipc_passed = (bool(ipc_complete) and ipc_complete[-1].get("detail", {}).get("value", {}).get("passed") is True
                      and bool(assertions) and all(item.get("passed") is True for item in assertions)
                      and all(row.get("pid") == child.pid and row.get("transport") == "tauri-wry-ipc" for row in ipc_evidence)
                      and [row.get("sequence") for row in ipc_evidence] == list(range(1, len(ipc_evidence) + 1)))
        result = {"format_version": 2, "synthetic_only": True, **context,
            "transport": "real-tauri-webview-ipc" if mode == "ipc" else "native-cli-NOT-Q11",
            "gate_handoff": handoff,
            "child_pid": child.pid, "child_returncode": child.returncode,
            "outcome": outcome, "stdout": stdout, "stderr": stderr,
            "ipc_evidence": ipc_evidence,
            "ipc_log_sha256": identity(ipc_path)["sha256"] if ipc_evidence is not None else None,
            "frontend_assertions_passed": ipc_passed,
            "passed": child.returncode == 0 and outcome is not None and outcome.get("state") == "V4_VERIFIED"
                and outcome.get("session") == context["session"] and outcome.get("nonce") == context["nonce"]
                and (mode != "ipc" or ipc_passed)}
        _new_json(root / "managed-formal-result.json", result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    for command in ("create-fixture", "run"):
        sub = actions.add_parser(command)
        sub.add_argument("--parent", required=True, type=Path)
        sub.add_argument("--native", required=True, type=Path)
        sub.add_argument("--scenario", default="normal")
        if command == "run":
            sub.add_argument("--mode", choices=("ipc", "cli"), default="ipc")
            sub.add_argument("--bundle", type=Path)
    actions.add_parser("diagnose").add_argument("root", type=Path)
    args = parser.parse_args()
    try:
        if args.action == "create-fixture":
            result = create_fixture(args.parent, args.native, args.scenario)
        elif args.action == "run":
            result = run_formal(args.parent, args.native, args.scenario, args.mode, args.bundle)
        else:
            result = diagnose(args.root)
        print(json.dumps(result, sort_keys=True))
        return 0 if result.get("passed", True) else 2
    except (Blocked, OSError, ValueError, sqlite3.Error) as error:
        print(json.dumps({"blocked": True, "error": str(error)}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
