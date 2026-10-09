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
    def __init__(self, context, lease, failpoint=None):
        self.context, self.root = context, Path(context["root"])
        self.log = self.root / "lease-native-events.jsonl"
        self.output = self.log.open("x")
        self.error = (self.root / "lease-native-stderr.log").open("x")
        self.child = lease.launch_native(Path(context["installed_executable"]), context["native_sha256"],
            arguments=["run-integrated", str(self.root), "--barrier"],
            extra_env={"PFC_Q_FAIL": failpoint or ""}, stdout=self.output, stderr=self.error)
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
        gate_probe = subprocess.run([sys.executable, str(Path(__file__).resolve()),
            "--gate-probe", str(native.root), "--session", context["session"]],
            capture_output=True, text=True, timeout=15)
        require(gate_probe.returncode == 0, gate_probe.stderr + gate_probe.stdout)
        gate_duplicate = json.loads(gate_probe.stdout)
        require(gate_duplicate == {"acquired": False, "blocked": True},
                f"second independent gate was not rejected: {gate_duplicate}")
        second = lease.launch_native(Path(context["installed_executable"]), context["native_sha256"],
            arguments=["run-integrated", context["root"]], stdin=subprocess.DEVNULL)
        stdout, stderr = second.communicate(timeout=15)
        error = json.loads(stdout.splitlines()[-1])
        require(second.returncode != 0 and error["error"]["code"] == "PERMIT_REPLAY_OR_PENDING", "second native using same inherited description was not rejected")
        require(json.loads((native.root / "native-launch.json").read_bytes())["pid"] == native.child.pid, "native ownership overwritten")
        return {"root": context["root"], "native_pid": native.child.pid, "duplicate_pid": second.pid,
                "owner_ack": owned, "gate_duplicate_probe": gate_duplicate,
                "duplicate_result": error, "native_log": str(native.log), "passed": True}
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


def case_native_death_after_ack_before_gate_close(base, binary):
    context, lease = setup(base, binary, "native-death-after-ack")
    native = Native(context, lease)
    try:
        ack_event = native.advance("lease_native_owned")
        ack = ack_event["details"]
        require(ack["pid"] == native.child.pid, "ACK PID differs from launched native")
        lock = (native.root / "maintenance.lock").stat()
        require((ack["lease_dev"], ack["lease_inode"]) == (lock.st_dev, lock.st_ino),
                "ACK does not bind current lock inode")
        require(ack["session"] == context["session"], "ACK does not bind fixture session")
        native.child.kill()
        native.child.wait(timeout=5)
        require(contended(native.root), "native death before gate close released gate ownership")
        persisted = json.loads((native.root / "native-launch.json").read_bytes())
        require(persisted == ack, "native ACK changed after child death")
        checked = diagnostic(context)
        before = identity(native.root / "native-launch.json")["sha256"]
        lease.__exit__()
        require(not contended(native.root), "gate close did not release lease after native death")
        require(identity(native.root / "native-launch.json")["sha256"] == before,
                "native death or lease release changed durable ACK")
        return {"root": context["root"], "native_pid": native.child.pid,
                "ack": ack, "ack_event": ack_event, "persistent_diagnostic": checked,
                "gate_retained_until_close": True, "persistent_ack_after_release": True,
                "native_log": str(native.log), "passed": True}
    finally:
        native.close()
        lease.__exit__()


def case_gate_death_before_native_launch(base, binary):
    fixture = create_fixture(base, binary, "gate-death-before-ack")
    root = Path(fixture["root"])
    read_fd, write_fd = os.pipe()
    ready = root / "lease-gate-ready.json"
    gate = subprocess.Popen([sys.executable, str(Path(__file__).resolve()),
        "--gate-before-native", str(root), "--read-fd", str(read_fd)],
        pass_fds=(read_fd,), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    os.close(read_fd)
    try:
        wait_file(ready, gate)
        gate.kill()
        gate.wait(timeout=5)
        require(not (root / "native-launch.json").exists(), "gate death before launch produced native ACK")
        require(not (root / "gate-handoff.json").exists(), "gate death before launch produced handoff receipt")
        with MaintenanceLease(root, fixture["session"]) as probe:
            lock = (root / "maintenance.lock").stat()
            require((os.fstat(probe.fd).st_dev, os.fstat(probe.fd).st_ino) ==
                    (lock.st_dev, lock.st_ino), "released gate lock inode changed")
        return {"root": str(root), "gate_pid": gate.pid, "native_launched": False,
                "ack_absent": True, "handoff_receipt_absent": True,
                "lease_reacquired_after_gate_death": True, "passed": True}
    finally:
        os.close(write_fd)
        if gate.poll() is None:
            gate.kill()
            gate.wait(timeout=5)
        gate.stderr.close()


def case_native_exit_before_ack(base, binary):
    context, lease = setup(base, binary, "native-exit-before-ack")
    env = os.environ.copy()
    env.update(lease.environment())
    env["PFC_QUIESCENCE_SESSION"] = "deliberately-wrong-session"
    try:
        child = subprocess.run([context["installed_executable"], "run-integrated", context["root"]],
            env=env, pass_fds=(lease.fd,), capture_output=True, text=True, timeout=15)
        require(child.returncode != 0, "native unexpectedly accepted wrong pre-ACK session")
        require(not (Path(context["root"]) / "native-launch.json").exists(),
                "native wrote ownership ACK before rejecting session")
        require(contended(Path(context["root"])), "gate lost lease after native pre-ACK rejection")
        error = json.loads(child.stdout.splitlines()[-1])
        require(error["error"]["code"] == "SESSION_MISMATCH", error)
        return {"root": context["root"], "native_returncode": child.returncode,
                "native_exited_before_ack": True, "observed": error,
                "gate_retained_lease": True, "passed": True}
    finally:
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


def gate_child(root, read_fd, failpoint=None):
    """A real gate subprocess intentionally killed by the outer test controller."""
    fixture = json.loads((root / "fixture-definition.json").read_bytes())
    with MaintenanceLease(root, fixture["session"]) as lease:
        context = prepare_managed(root, lease)
        with (root / "lease-native-events.jsonl").open("x") as output, (root / "lease-native-stderr.log").open("x") as error:
            child = lease.launch_native(Path(context["installed_executable"]), context["native_sha256"],
                arguments=["run-integrated", str(root), "--barrier"],
                extra_env={"PFC_Q_FAIL": failpoint or ""}, stdin=read_fd, stdout=output, stderr=error)
            _new_json(root / "lease-gate-child.json", {"context": context, "child_pid": child.pid, "gate_pid": os.getpid()})
            child.wait(timeout=60)


def gate_before_native(root, read_fd):
    """Hold the gate lease at a deterministic pre-launch point for death testing."""
    fixture = json.loads((root / "fixture-definition.json").read_bytes())
    with MaintenanceLease(root, fixture["session"]) as lease:
        prepare_managed(root, lease)
        _new_json(root / "lease-gate-ready.json", {"gate_pid": os.getpid(), "lease_held": True})
        os.read(read_fd, 1)


def case_parent_death(base, binary, during_ack=False):
    fixture = create_fixture(base, binary, "gate-death-during-ack" if during_ack else "native-parent-death")
    root = Path(fixture["root"])
    read_fd, write_fd = os.pipe()
    gate = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--gate-child", str(root), "--read-fd", str(read_fd)] +
                            (["--failpoint", "native_ack_created"] if during_ack else []),
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
        boundary = advance("native_ack_created") if during_ack else None
        if during_ack:
            require((root / "native-launch.json").read_bytes() == b"", "not at incomplete ACK boundary")
            require(not (root / "consumed.json").exists(), "permit consumed before ACK")
            require(contended(root), "lease absent at incomplete ACK boundary")
        else:
            ack = advance("lease_native_owned")
        gate.kill()
        gate.wait(timeout=5)
        require(contended(root), "parent death released native's inherited ownership")
        if during_ack:
            os.write(write_fd, b"continue\n")
            ack = advance("lease_native_owned")
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
                "native_ack": ack, "incomplete_ack_boundary": boundary,
                "post_parent_death_quiescence": acquired,
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


def case_native_kill_before_ack(base, binary):
    context, lease = setup(base, binary, "native-kill-before-ack")
    native = Native(context, lease, "native_ack_pre_write")
    before = identity(native.root / "personal-finance-console.sqlite3")
    try:
        boundary = native.advance("native_ack_pre_write")
        require(not (native.root / "native-launch.json").exists(), "ACK already exists")
        require(contended(native.root), "lease absent before ACK")
        native.child.kill()
        native.child.wait(timeout=5)
        require(native.child.returncode == -signal.SIGKILL, "not an abrupt native kill")
        require(contended(native.root), "gate lost ownership after pre-ACK kill")
        require(not (native.root / "native-launch.json").exists(), "kill produced ACK")
        require(not (native.root / "consumed.json").exists(), "pre-ACK kill consumed permit")
        require((native.root / "permit.json").exists(), "pre-ACK permit missing")
        require(identity(native.root / "personal-finance-console.sqlite3") == before, "pre-ACK kill changed database")
        lease.__exit__()
        require(not contended(native.root), "gate close failed to release final owner")
        return {"root": str(native.root), "boundary": boundary, "native_returncode": native.child.returncode,
                "gate_retained_until_close": True, "database_unchanged": True,
                "ack_absent": True, "permit_not_consumed": True, "passed": True}
    finally:
        native.close()
        lease.__exit__()


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
    parser.add_argument("--gate-before-native", type=Path)
    parser.add_argument("--gate-probe", type=Path)
    parser.add_argument("--session")
    parser.add_argument("--read-fd", type=int)
    parser.add_argument("--failpoint", choices=["native_ack_created"])
    parser.add_argument("--case", action="append", dest="selected_cases",
                        help="Run only this named case; repeat for multiple cases. Unselected coverage remains BLOCKED_NOT_RUN.")
    args = parser.parse_args()
    if args.gate_child:
        gate_child(args.gate_child, args.read_fd, args.failpoint)
        return 0
    if args.gate_before_native:
        gate_before_native(args.gate_before_native, args.read_fd)
        return 0
    if args.gate_probe:
        try:
            require(args.session, "--session required with --gate-probe")
            with MaintenanceLease(args.gate_probe, args.session):
                pass
        except BlockingIOError:
            print(json.dumps({"acquired": False, "blocked": True}))
            return 0
        print(json.dumps({"acquired": True, "blocked": False}))
        return 0
    require(args.native is not None, "--native required")
    require(not args.output.exists(), "report already exists; choose a new output to preserve prior evidence")
    binary = args.native.resolve(strict=True)
    base = Path(tempfile.mkdtemp(prefix="pfc-qic-native-lease-")).resolve()
    report = {"format_version": 1, "synthetic_only": True, "transport": "native-v2-cli-barrier-NOT-Q11",
              "source_sha256": identity(Path(__file__))["sha256"], "native_sha256": identity(binary)["sha256"],
              "retained_root": str(base), "cases": [], "status": "RUNNING",
              "coverage_matrix": {
                  "overlapping_gate_native_handoff": "BLOCKED_NOT_RUN",
                  "exact_inode_session_ack": "BLOCKED_NOT_RUN",
                  "gate_close_only_after_exact_ack": "BLOCKED_NOT_RUN",
                  "no_LOCK_UN_gap": "BLOCKED_NOT_RUN",
                  "wrong_recreated_stale_lock": "BLOCKED_NOT_RUN",
                  "duplicate_gate_and_native": "BLOCKED_NOT_RUN",
                  "gate_death_before_ack_no_native_started": "BLOCKED_NOT_RUN",
                  "gate_death_during_ack": "BLOCKED_NOT_RUN",
                  "native_exit_before_ack_wrong_session": "BLOCKED_NOT_RUN",
                  "native_kill_before_ack": "BLOCKED_NOT_RUN",
                  "native_death_after_ack": "BLOCKED_NOT_RUN",
                  "unrelated_lock_contention": "BLOCKED_NOT_RUN",
                  "persistent_state_after_release": "BLOCKED_NOT_RUN"},
              "known_limitations": ["Process-death tests are not machine power-loss or storage-fsync fault tests; native-v2 CLI evidence is not Q11."]}
    cases = [("duplicate-native-and-gate", lambda: case_duplicate(base, binary)),
             ("native-child-death", lambda: case_child_death(base, binary)),
             ("native-death-after-ack-before-gate-close", lambda: case_native_death_after_ack_before_gate_close(base, binary)),
             ("gate-death-before-native-launch-ack-absent", lambda: case_gate_death_before_native_launch(base, binary)),
             ("native-exit-before-ack-wrong-session", lambda: case_native_exit_before_ack(base, binary)),
             ("native-kill-before-ack", lambda: case_native_kill_before_ack(base, binary)),
             ("gate-death-during-ack", lambda: case_parent_death(base, binary, during_ack=True)),
             ("acknowledged-handoff-no-gap", lambda: case_explicit_handoff(base, binary)),
             ("actual-parent-death", lambda: case_parent_death(base, binary))]
    for kind in ("wrong-inode", "unlocked-fd", "unrelated-holder", "recreated-file", "stale-session", "wrong-session"):
        cases.append((kind, lambda kind=kind: rejection(base, binary, kind)))
    if args.selected_cases:
        requested = set(args.selected_cases)
        require(requested.issubset({name for name, _ in cases}),
                f"unknown --case values: {sorted(requested - {name for name, _ in cases})}")
        cases = [(name, run) for name, run in cases if name in requested]
    report["selected_cases"] = [name for name, _ in cases]
    for name, run in cases:
        try:
            report["cases"].append({"name": name, **run()})
        except Exception as error:
            report["cases"].append({"name": name, "passed": False, "error": str(error), "error_type": type(error).__name__})
            report["status"] = "FAILED"
            save_report(args.output, report)
            print(json.dumps({"status": report["status"], "failed_case": name, "error": str(error), "report": str(args.output)}))
            return 2
    case_names = {item["name"] for item in report["cases"] if item.get("passed")}
    matrix = report["coverage_matrix"]
    if "acknowledged-handoff-no-gap" in case_names:
        matrix.update({"overlapping_gate_native_handoff": "PASS",
            "exact_inode_session_ack": "PASS", "gate_close_only_after_exact_ack": "PASS",
            "no_LOCK_UN_gap": "PASS", "persistent_state_after_release": "PASS"})
    if {"wrong-inode", "recreated-file", "stale-session"}.issubset(case_names):
        matrix["wrong_recreated_stale_lock"] = "PASS"
    if "duplicate-native-and-gate" in case_names:
        matrix["duplicate_gate_and_native"] = "PASS"
    if "gate-death-before-native-launch-ack-absent" in case_names:
        matrix["gate_death_before_ack_no_native_started"] = "PASS"
    if "native-exit-before-ack-wrong-session" in case_names:
        matrix["native_exit_before_ack_wrong_session"] = "PASS"
    for boundary in ("native-kill-before-ack", "gate-death-during-ack"):
        if boundary in case_names:
            matrix[boundary.replace("-", "_")] = "PASS"
    if any(name in case_names for name in ("native-child-death", "native-death-after-ack-before-gate-close", "actual-parent-death")):
        matrix["native_death_after_ack"] = "PASS"
    if "unrelated-holder" in case_names:
        matrix["unrelated_lock_contention"] = "PASS"
    blocked = [name for name, state in report["coverage_matrix"].items()
               if state.startswith("BLOCKED")]
    report["status"] = "PASS_WITH_BLOCKED_COVERAGE" if blocked else "PASS"
    save_report(args.output, report)
    print(json.dumps({"status": report["status"], "cases": len(report["cases"]),
                      "blocked_coverage": blocked, "report": str(args.output), "retained_root": str(base)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
