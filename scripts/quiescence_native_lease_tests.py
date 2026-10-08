#!/usr/bin/env python3
"""Actual native-v2 lease handoff regressions; explicitly NOT Q11 evidence.

The CLI barrier is only a deterministic fault-injection instrument for OS lease
ownership. Q11 remains the independently launched Tauri/TypeScript webview suite.
All writable targets are new marked synthetic fixtures; failed cases are retained.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

from quiescence_gate import MaintenanceLease, identity
from quiescence_integration import create_fixture, prepare_managed, handoff_native, _new_json

REPO = Path(__file__).resolve().parents[1]


def require(value, detail):
    if not value:
        raise AssertionError(detail)


def rows(path):
    if not path.exists():
        return []
    raw = path.read_bytes()
    return [json.loads(line) for line in raw[:raw.rfind(b"\n") + 1].splitlines()]


def wait_file(path, process=None, timeout=20):
    until = time.monotonic() + timeout
    while not path.exists():
        if process is not None and process.poll() is not None:
            raise AssertionError(f"child exited before {path.name}: {process.returncode}")
        if time.monotonic() > until:
            raise TimeoutError(f"missing {path}")
        time.sleep(0.01)
    return json.loads(path.read_bytes())


class Native:
    def __init__(self, context, lease):
        self.context, self.root = context, Path(context["root"])
        self.log = self.root / "lease-native-events.jsonl"
        self.output = self.log.open("x")
        self.error = (self.root / "lease-native-stderr.log").open("x")
        self.child = lease.launch_native(Path(context["installed_executable"]), context["native_sha256"],
            arguments=["run-integrated", str(self.root), "--barrier"], stdout=self.output, stderr=self.error)
        self.index = 0

    def advance(self, event):
        until = time.monotonic() + 25
        while time.monotonic() < until:
            available = rows(self.log)
            while self.index < len(available):
                item = available[self.index]
                self.index += 1
                if item.get("event") == event:
                    return item
                if item.get("event") == "blocked":
                    raise AssertionError(f"native blocked before {event}: {item}")
                self.continue_()
            if self.child.poll() is not None:
                stderr = (self.root / "lease-native-stderr.log").read_text()
                raise AssertionError(f"native exited before {event}: returncode={self.child.returncode}, events={rows(self.log)}, stderr={stderr!r}, root={self.root}")
            time.sleep(0.01)
        raise TimeoutError(event)

    def continue_(self):
        self.child.stdin.write("continue\n")
        self.child.stdin.flush()

    def close(self):
        if self.child.poll() is None:
            self.child.kill()
            self.child.wait(timeout=5)
        self.child.stdin.close()
        self.output.close()
        self.error.close()


def setup(base, binary, case):
    fixture = create_fixture(base, binary, case)
    root = Path(fixture["root"])
    lease = MaintenanceLease(root, fixture["session"]).__enter__()
    try:
        context = prepare_managed(root, lease)
    except Exception:
        lease.__exit__()
        raise
    return context, lease


def contended(root):
    try:
        with MaintenanceLease(root, "independent-competitor"):
            return False
    except BlockingIOError:
        return True


def diagnostic(context):
    result = subprocess.run([context["installed_executable"], "diagnose-integrated", context["root"]],
                            capture_output=True, text=True, timeout=15)
    require(result.returncode == 0, result.stderr + result.stdout)
    value = json.loads(result.stdout)
    require(value["startupBlocked"] is True and value["startup_allowed"] is False, "durable attempt did not block normal startup")
    return value


def case_duplicate(base, binary):
    context, lease = setup(base, binary, "native-duplicate")
    native = Native(context, lease)
    try:
        owned = native.advance("lease_native_owned")
        require(contended(native.root), "actual native/gate lease was not contended")
        second = lease.launch_native(Path(context["installed_executable"]), context["native_sha256"],
            arguments=["run-integrated", context["root"]], stdin=subprocess.DEVNULL)
        stdout, stderr = second.communicate(timeout=15)
        error = json.loads(stdout.splitlines()[-1])
        require(second.returncode != 0 and error["error"]["code"] == "PERMIT_REPLAY_OR_PENDING", "second native using same inherited description was not rejected")
        require(json.loads((native.root / "native-launch.json").read_bytes())["pid"] == native.child.pid, "native ownership overwritten")
        return {"root": context["root"], "native_pid": native.child.pid, "duplicate_pid": second.pid,
                "owner_ack": owned, "duplicate_result": error, "native_log": str(native.log), "passed": True}
    finally:
        native.close()
        lease.__exit__()


def case_child_death(base, binary):
    context, lease = setup(base, binary, "native-child-death")
    native = Native(context, lease)
    try:
        acquired = native.advance("quiescence_acquired")
        native.child.kill()
        native.child.wait(timeout=5)
        require(contended(native.root), "child death incorrectly unlocked still-owning parent")
        before = identity(native.root / "outcome.json")["sha256"]
        lease.__exit__()
        require(not contended(native.root), "dead child's descriptor leaked")
        checked = diagnostic(context)
        require(checked["state"] == "QUIESCENCE_ACQUIRED", checked)
        require(identity(native.root / "outcome.json")["sha256"] == before, "lease release changed durable state")
        return {"root": context["root"], "native_pid": native.child.pid, "acquired": acquired,
                "parent_retained_after_child_death": True, "lease_released_after_parent_close": True,
                "persistent_diagnostic": checked, "native_log": str(native.log), "passed": True}
    finally:
        native.close()
        lease.__exit__()


def case_explicit_handoff(base, binary):
    context, lease = setup(base, binary, "native-handoff")
    native = Native(context, lease)
    try:
        native.advance("lease_native_owned")
        receipt = handoff_native(lease, native.child, context)
        require(lease.fd == -1 and contended(native.root), "unlocked gap after gate close")
        native.continue_()
        native.advance("quiescence_acquired")
        require(contended(native.root), "native lost lock after further validated stages")
        native.child.kill()
        native.child.wait(timeout=5)
        require(not contended(native.root), "native descriptor not released on death")
        return {"root": context["root"], "gate_handoff": receipt,
                "native_alive_retained_same_lease": True, "persistent_diagnostic": diagnostic(context),
                "native_log": str(native.log), "passed": True}
    finally:
        native.close()
        lease.__exit__()


def rejection(base, binary, kind):
    context, lease = setup(base, binary, "native-reject-" + kind)
    root = Path(context["root"])
    extra_fds = []
    env = os.environ.copy()
    env.update(lease.environment())
    expected = {"wrong-inode": "LEASE_IDENTITY_MISMATCH", "unlocked-fd": "LEASE_HANDOFF_UNPROVEN",
        "unrelated-holder": "LEASE_NOT_HELD", "recreated-file": "LEASE_IDENTITY_MISMATCH",
        "stale-session": "LEASE_SESSION_BODY_MISMATCH", "wrong-session": "SESSION_MISMATCH"}[kind]
    try:
        inherited = lease.fd
        if kind == "wrong-inode":
            inherited = os.open(root / "wrong.lock", os.O_CREAT | os.O_RDWR, 0o600)
            extra_fds.append(inherited)
        elif kind in ("unlocked-fd", "unrelated-holder"):
            lease.__exit__()
            if kind == "unrelated-holder":
                holder = os.open(root / "maintenance.lock", os.O_RDWR)
                extra_fds.append(holder)
                fcntl.flock(holder, fcntl.LOCK_EX | fcntl.LOCK_NB)
            inherited = os.open(root / "maintenance.lock", os.O_RDWR)
            extra_fds.append(inherited)
        elif kind == "recreated-file":
            (root / "maintenance.lock").rename(root / "original-held.lock")
            (root / "maintenance.lock").write_text("{}")
        elif kind == "stale-session":
            body = json.loads((root / "maintenance.lock").read_bytes())
            body["session"] = "unrelated-stale-session"
            (root / "maintenance.lock").write_text(json.dumps(body))
        elif kind == "wrong-session":
            env["PFC_QUIESCENCE_SESSION"] = "wrong-session"
        env["PFC_QUIESCENCE_LEASE_FD"] = str(inherited)
        result = subprocess.run([context["installed_executable"], "run-integrated", str(root)],
            env=env, pass_fds=(inherited,), capture_output=True, text=True, timeout=15)
        error = json.loads(result.stdout.splitlines()[-1])
        require(result.returncode != 0 and error["error"]["code"] == expected,
                f"{kind}: expected {expected}, got {error}, stderr={result.stderr}")
        require(not (root / "consumed.json").exists() and not (root / "native-launch.json").exists(), "invalid handoff consumed authorization")
        return {"root": str(root), "expected_code": expected, "observed": error,
                "permit_not_consumed": True, "passed": True}
    finally:
        for fd in extra_fds:
            os.close(fd)
        lease.__exit__()


def gate_child(root, read_fd):
    """A real gate subprocess intentionally killed by the outer test controller."""
    fixture = json.loads((root / "fixture-definition.json").read_bytes())
    with MaintenanceLease(root, fixture["session"]) as lease:
        context = prepare_managed(root, lease)
        with (root / "lease-native-events.jsonl").open("x") as output, (root / "lease-native-stderr.log").open("x") as error:
            child = lease.launch_native(Path(context["installed_executable"]), context["native_sha256"],
                arguments=["run-integrated", str(root), "--barrier"], stdin=read_fd, stdout=output, stderr=error)
            _new_json(root / "lease-gate-child.json", {"context": context, "child_pid": child.pid, "gate_pid": os.getpid()})
            child.wait(timeout=60)


def case_parent_death(base, binary):
    fixture = create_fixture(base, binary, "native-parent-death")
    root = Path(fixture["root"])
    read_fd, write_fd = os.pipe()
    gate = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--gate-child", str(root), "--read-fd", str(read_fd)],
                            pass_fds=(read_fd,), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    os.close(read_fd)
    native_pid = None
    try:
        captured = wait_file(root / "lease-gate-child.json", gate)
        native_pid, context = captured["child_pid"], captured["context"]
        log = root / "lease-native-events.jsonl"
        index = 0
        def advance(event):
            nonlocal index
            until = time.monotonic() + 25
            while time.monotonic() < until:
                available = rows(log)
                while index < len(available):
                    item = available[index]
                    index += 1
                    if item.get("event") == event:
                        return item
                    require(item.get("event") != "blocked", item)
                    os.write(write_fd, b"continue\n")
                time.sleep(0.01)
            raise TimeoutError(event)
        ack = advance("lease_native_owned")
        gate.kill()
        gate.wait(timeout=5)
        require(contended(root), "parent death released native's inherited ownership")
        persisted_ack = json.loads((root / "native-launch.json").read_bytes())
        require(persisted_ack["pid"] == native_pid and persisted_ack["parent_pid"] == gate.pid, "actual native/parent binding lost")
        lock = (root / "maintenance.lock").stat()
        require((persisted_ack["lease_dev"], persisted_ack["lease_inode"]) == (lock.st_dev, lock.st_ino), "parent death changed inode")
        os.write(write_fd, b"continue\n")
        acquired = advance("quiescence_acquired")
        require(contended(root), "native failed post-parent-death same-session validation")
        os.kill(native_pid, signal.SIGKILL)
        until = time.monotonic() + 5
        while contended(root) and time.monotonic() < until:
            time.sleep(0.01)
        require(not contended(root), "native death did not release inherited description")
        native_pid = None
        return {"root": str(root), "gate_pid": gate.pid, "actual_native_pid": captured["child_pid"],
                "native_ack": ack, "post_parent_death_quiescence": acquired,
                "same_session_inode_retained": True, "persistent_diagnostic": diagnostic(context),
                "native_log": str(log), "passed": True}
    finally:
        os.close(write_fd)
        if gate.poll() is None:
            gate.kill()
            gate.wait(timeout=5)
        if native_pid:
            try:
                os.kill(native_pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        gate.stderr.close()


def save_report(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_suffix(path.suffix + ".pending")
    with pending.open("x") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(pending, path)
    require(json.loads(path.read_bytes()) == value, "report save/readback mismatch")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native", type=Path)
    parser.add_argument("--output", type=Path, default=REPO / "evidence/quiescence-integration/lease-report.json")
    parser.add_argument("--gate-child", type=Path)
    parser.add_argument("--read-fd", type=int)
    args = parser.parse_args()
    if args.gate_child:
        gate_child(args.gate_child, args.read_fd)
        return 0
    require(args.native is not None, "--native required")
    binary = args.native.resolve(strict=True)
    base = Path(tempfile.mkdtemp(prefix="pfc-qic-native-lease-")).resolve()
    report = {"format_version": 1, "synthetic_only": True, "transport": "native-v2-cli-barrier-NOT-Q11",
              "source_sha256": identity(Path(__file__))["sha256"], "native_sha256": identity(binary)["sha256"],
              "retained_root": str(base), "cases": [], "status": "RUNNING"}
    cases = [("duplicate-native-and-gate", lambda: case_duplicate(base, binary)),
             ("native-child-death", lambda: case_child_death(base, binary)),
             ("acknowledged-handoff-no-gap", lambda: case_explicit_handoff(base, binary)),
             ("actual-parent-death", lambda: case_parent_death(base, binary))]
    for kind in ("wrong-inode", "unlocked-fd", "unrelated-holder", "recreated-file", "stale-session", "wrong-session"):
        cases.append((kind, lambda kind=kind: rejection(base, binary, kind)))
    for name, run in cases:
        try:
            report["cases"].append({"name": name, **run()})
        except Exception as error:
            report["cases"].append({"name": name, "passed": False, "error": str(error), "error_type": type(error).__name__})
            report["status"] = "FAILED"
            save_report(args.output, report)
            print(json.dumps({"status": report["status"], "failed_case": name, "error": str(error), "report": str(args.output)}))
            return 2
    report["status"] = "PASS"
    save_report(args.output, report)
    print(json.dumps({"status": "PASS", "cases": len(report["cases"]), "report": str(args.output), "retained_root": str(base)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
