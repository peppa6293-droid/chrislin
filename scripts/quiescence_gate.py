"""Isolated managed-runtime cutover primitives. No Production entrypoint.

The flock lease serializes cooperating entrypoints, not legacy V3 processes.
Target process evidence must come from a collector; this module never turns an
empty observation into proof that an unknown target exited.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import stat
import subprocess
import tempfile

from production_v4_release_gate import read_bundle, PRODUCTION_BUNDLE_ID, EXECUTABLE_NAME

MARKER = "PFC_QUIESCENCE_SYNTHETIC_V1\n"


class Blocked(RuntimeError):
    def __init__(self, code, detail=""):
        self.code = code
        super().__init__(f"{code}: {detail}")


def fixture_root(root: Path) -> Path:
    root = Path(root).absolute()
    resolved = root.resolve(strict=True)
    temp = Path(tempfile.gettempdir()).resolve()
    if root != resolved or not resolved.is_relative_to(temp) or resolved == temp:
        raise Blocked("BLOCKED_NOT_ISOLATED_FIXTURE", str(root))
    marker = root / "SYNTHETIC_ONLY"
    if marker.is_symlink() or marker.read_text() != MARKER:
        raise Blocked("BLOCKED_NOT_ISOLATED_FIXTURE", "marker")
    return root


def scoped(root: Path, path: Path, *, exists=True) -> Path:
    path = Path(path).absolute()
    resolved = path.resolve(strict=exists)
    if path != resolved or not resolved.is_relative_to(root) or resolved == root:
        raise Blocked("BLOCKED_CANONICAL_ESCAPE", str(path))
    return resolved


class MaintenanceLease:
    """Stable flock inode; never unlink or explicitly unlock a shared FD."""
    def __init__(self, root: Path, session: str):
        self.root = fixture_root(root)
        if not session or not isinstance(session, str):
            raise Blocked("BLOCKED_SESSION")
        self.session = session
        self.path = self.root / "maintenance.lock"
        self.fd = -1

    def __enter__(self):
        self.fd = os.open(self.path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.validate()
        except Exception:
            os.close(self.fd)
            self.fd = -1
            raise
        return self

    def validate(self):
        if self.fd < 0:
            raise Blocked("BLOCKED_LEASE_NOT_OWNED")
        opened, named = os.fstat(self.fd), self.path.lstat()
        if not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1 or (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino):
            raise Blocked("BLOCKED_LEASE_IDENTITY")
        fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def launch_native(self, executable: Path, expected_sha256: str, *, barrier=False):
        self.validate()
        executable = scoped(self.root, executable)
        if identity(executable)["sha256"] != expected_sha256:
            raise Blocked("BLOCKED_NATIVE_IDENTITY")
        env = os.environ.copy()
        env.update(PFC_QUIESCENCE_LEASE_FD=str(self.fd), PFC_QUIESCENCE_LEASE_PATH=str(self.path), PFC_QUIESCENCE_SESSION=self.session)
        args = [str(executable), "run", str(self.root)] + (["--barrier"] if barrier else [])
        # The parent retains its own descriptor; child inherits the same open file
        # description. Closing either copy cannot release the other's flock.
        return subprocess.Popen(args, env=env, pass_fds=(self.fd,), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def __exit__(self, *_):
        if self.fd >= 0:
            os.close(self.fd)
            self.fd = -1


def identity(path: Path):
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
        raise Blocked("BLOCKED_FILE_IDENTITY", str(path))
    with path.open("rb") as stream:
        opened = os.fstat(stream.fileno())
        hasher = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(block)
        digest = hasher.hexdigest()
        after = os.fstat(stream.fileno())
    named = path.lstat()
    fields = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_nlink)
    if not fields(before) == fields(opened) == fields(after) == fields(named):
        raise Blocked("BLOCKED_FILE_IDENTITY_DRIFT", str(path))
    return {"dev": before.st_dev, "ino": before.st_ino, "size": before.st_size, "sha256": digest, "mode": stat.S_IMODE(before.st_mode)}


def bundle_identity(root: Path, path: Path):
    path = scoped(root, path)
    try:
        result = read_bundle(path)
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        raise Blocked("BLOCKED_BUNDLE_IDENTITY", str(exc)) from exc
    if result["bundle_id"] != PRODUCTION_BUNDLE_ID:
        raise Blocked("BLOCKED_BUNDLE_ID")
    for label, relative in (("executable", "Contents/MacOS/" + EXECUTABLE_NAME), ("plist", "Contents/Info.plist"), ("manifest", "Contents/Resources/runtime-compatibility.json")):
        target = scoped(root, path / relative)
        result[label + "_identity"] = identity(target)
    return result


def discover(root: Path, roots: list[Path]):
    """Finite declared closure, no unrelated outer-bundle pruning."""
    root = fixture_root(root)
    found, links = {}, []
    for scan in roots:
        scan = scoped(root, scan)
        for current, dirs, files in os.walk(scan, followlinks=False, onerror=lambda e: (_ for _ in ()).throw(Blocked("BLOCKED_DISCOVERY_UNKNOWN", str(e)))):
            current = Path(current)
            for name in dirs + files:
                p = current / name
                if p.is_symlink():
                    try:
                        target = p.resolve(strict=True)
                    except OSError as exc:
                        raise Blocked("BLOCKED_LINK_UNKNOWN", str(p)) from exc
                    if not target.is_relative_to(scan):
                        raise Blocked("BLOCKED_CANONICAL_ESCAPE", str(p))
                    links.append((p, target))
                    if name in dirs:
                        dirs.remove(name)
                if name.endswith((".alias", ".bookmark")):
                    raise Blocked("BLOCKED_LAUNCH_ALIAS_UNKNOWN", str(p))
            for meta in (current / "Contents/Info.plist", current / "Info.plist"):
                if not meta.exists():
                    continue
                try:
                    info = plistlib.loads(meta.read_bytes())
                except Exception as exc:
                    raise Blocked("BLOCKED_METADATA_UNKNOWN", str(meta)) from exc
                if not isinstance(info, dict) or not isinstance(info.get("CFBundleIdentifier"), str):
                    raise Blocked("BLOCKED_METADATA_UNKNOWN", str(meta))
                if info["CFBundleIdentifier"] == PRODUCTION_BUNDLE_ID:
                    if meta == current / "Info.plist" and current.name == "Contents":
                        continue
                    if meta == current / "Info.plist":
                        raise Blocked("BLOCKED_UNSUPPORTED_PRODUCTION_LAYOUT", str(current))
                    found[str(current)] = bundle_identity(root, current)
    for link, target in links:
        # An internal framework alias is harmless only after canonical coverage
        # establishes that it cannot be an additional Production launch route.
        if any(Path(p).is_relative_to(target) or target.is_relative_to(Path(p)) for p in found):
            raise Blocked("BLOCKED_EXTRA_LAUNCH_ALIAS", str(link))
    return found


def validate_processes(known_targets: list[dict], observations: list[dict], *, complete: bool):
    if known_targets and not complete:
        raise Blocked("BLOCKED_MANAGED_RUNTIME_IDENTITY_UNKNOWN", "enumeration incomplete")
    by_key = {(o.get("pid"), o.get("start")): o for o in observations if o.get("target")}
    for target in known_targets:
        observed = by_key.get((target.get("pid"), target.get("start")))
        if not observed or observed.get("identity") != target.get("identity") or observed.get("state") != "EXIT_CONFIRMED":
            raise Blocked("BLOCKED_MANAGED_RUNTIME_IDENTITY_UNKNOWN", str(target))
    for observed in observations:
        if observed.get("target") and observed.get("state") != "EXIT_CONFIRMED":
            raise Blocked("BLOCKED_MANAGED_RUNTIME_ACTIVE_OR_UNKNOWN", str(observed))
    return {"target_exit_verified": True, "unrelated": "NOT_INSPECTED_OUTSIDE_TARGET_SCOPE"}


def collect_spawned_fixture_targets(targets):
    """Authoritative waitpid evidence only for children spawned by this fixture.

    This is deliberately not a general macOS process/image identity collector.
    The controller retains each Popen handle across disable/exit checks; a child
    cannot be omitted simply because its executable path moved or vanished.
    """
    observations = []
    for association, child in targets:
        if child.pid != association["pid"]:
            raise Blocked("BLOCKED_MANAGED_RUNTIME_IDENTITY_UNKNOWN")
        observations.append({**association, "target": True,
                             "state": "EXIT_CONFIRMED" if child.poll() is not None else "ACTIVE",
                             "exitCode": child.returncode,
                             "evidence": "retained_Popen_waitpid"})
    return {"complete": True, "observations": observations}


def validate_inventory(lease: MaintenanceLease, roots: list[Path], expected: dict, installed: Path):
    lease.validate()
    installed = scoped(lease.root, installed)
    actual = discover(lease.root, roots)
    if set(actual) != set(expected) or str(installed) not in actual:
        raise Blocked("BLOCKED_MANAGED_OBJECT_SET")
    for path, item in actual.items():
        if item != expected[path]:
            raise Blocked("BLOCKED_MANAGED_OBJECT_DRIFT", path)
        # No role whitelist: every non-installed executable is forbidden.
        for entry in Path(path).rglob("*"):
            if entry.is_file() and entry.stat().st_mode & 0o111:
                if entry != installed / "Contents/MacOS" / EXECUTABLE_NAME:
                    raise Blocked("BLOCKED_EXTRA_EXECUTABLE_ROUTE", str(entry))
    approved_hashes = {item["executable_sha256"] for item in actual.values()}
    approved_exes = {item["executable_path"] for item in actual.values()}
    for scan in roots:
        for entry in scoped(lease.root, scan).rglob("*"):
            if entry.is_file() and not entry.is_symlink() and str(entry) not in approved_exes:
                if entry.name == EXECUTABLE_NAME or (entry.stat().st_mode & 0o111 and identity(entry)["sha256"] in approved_hashes):
                    raise Blocked("BLOCKED_UNDECLARED_BARE_PRODUCTION", str(entry))
    lease.validate()
    return actual


def disable_known_entries(lease: MaintenanceLease, bundles: list[Path], known_targets: list[dict], collector):
    """Disable before exit recheck; never rename away a live target association.

    Collector returns {complete, observations}; only explicit EXIT_CONFIRMED for
    the retained pid/start/image association passes. No kill or auto-restore.
    """
    lease.validate()
    identities = {str(path): bundle_identity(lease.root, path) for path in bundles}
    disabled = []
    for path in bundles:
        for entry in scoped(lease.root, path).rglob("*"):
            if entry.is_symlink():
                raise Blocked("BLOCKED_DISABLE_REDIRECTED_ENTRY", str(entry))
            if entry.is_file() and entry.stat().st_mode & 0o111:
                before = identity(entry)
                fd = os.open(entry, os.O_RDONLY | os.O_NOFOLLOW)
                try:
                    opened = os.fstat(fd)
                    if (opened.st_dev, opened.st_ino) != (before["dev"], before["ino"]):
                        raise Blocked("BLOCKED_DISABLE_IDENTITY_DRIFT")
                    os.fchmod(fd, before["mode"] & ~0o111)
                    os.fsync(fd)
                finally:
                    os.close(fd)
                after = identity(entry)
                if after["sha256"] != before["sha256"] or after["ino"] != before["ino"] or after["mode"] & 0o111:
                    raise Blocked("BLOCKED_DISABLE_IDENTITY_DRIFT")
                disabled.append(str(entry))
    observed = collector()
    validate_processes(known_targets, observed["observations"], complete=observed["complete"])
    lease.validate()
    return {"before": identities, "disabled": disabled, "exit_evidence": observed}


def copy_disabled(lease: MaintenanceLease, source: Path, target: Path):
    """Each destination file is born 0600; no copy2 executable staging gap."""
    lease.validate()
    source = scoped(lease.root, source)
    target = scoped(lease.root, target, exists=False)
    if target.is_relative_to(source) or source.is_relative_to(target):
        raise Blocked("BLOCKED_COPY_OVERLAP")
    if target.exists():
        raise Blocked("BLOCKED_DESTINATION_EXISTS")
    target.mkdir(mode=0o700)
    for current, dirs, files in os.walk(source, followlinks=False):
        relative = Path(current).relative_to(source)
        for name in dirs:
            src = Path(current) / name
            scoped(lease.root, src)
            if src.is_symlink():
                raise Blocked("BLOCKED_COPY_SYMLINK")
            (target / relative / name).mkdir(mode=0o700)
        for name in files:
            src = scoped(lease.root, Path(current) / name)
            prior = identity(src)
            dst = target / relative / name
            fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as output, src.open("rb") as inp:
                while block := inp.read(1024 * 1024):
                    output.write(block)
                output.flush()
                os.fsync(output.fileno())
            if identity(src) != prior or identity(dst)["sha256"] != prior["sha256"]:
                raise Blocked("BLOCKED_COPY_DRIFT")
    lease.validate()
    return target
