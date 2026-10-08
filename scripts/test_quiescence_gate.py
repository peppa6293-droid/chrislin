"""Synthetic-only managed-runtime regression and real OS lease tests."""
import fcntl
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest

from quiescence_gate import (Blocked, MARKER, MaintenanceLease, bundle_identity,
    copy_disabled, collect_spawned_fixture_targets, disable_known_entries, discover, fixture_root, identity, validate_inventory,
    validate_processes, PRODUCTION_BUNDLE_ID, EXECUTABLE_NAME)


class ManagedGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="pfc-quiescence-managed-")
        self.root = Path(self.tmp.name).resolve()
        (self.root / "SYNTHETIC_ONLY").write_text(MARKER)
        self.apps = self.root / "apps"
        self.apps.mkdir()
        self.app = self.bundle(self.apps / "installed.app", executable=True)

    def tearDown(self):
        self.tmp.cleanup()

    def bundle(self, path, executable=False):
        (path / "Contents/MacOS").mkdir(parents=True)
        (path / "Contents/Resources").mkdir()
        (path / "Contents/Info.plist").write_bytes(plistlib.dumps({"CFBundleIdentifier": PRODUCTION_BUNDLE_ID, "CFBundleExecutable": EXECUTABLE_NAME}))
        (path / "Contents/Resources/runtime-compatibility.json").write_text('{"schemaVersions":[4]}')
        exe = path / "Contents/MacOS" / EXECUTABLE_NAME
        exe.write_bytes(b"synthetic-executable-only")
        exe.chmod(0o700 if executable else 0o600)
        return path

    def test_fixture_rejects_non_temp_and_bad_marker(self):
        with self.assertRaises(Blocked):
            fixture_root(Path.cwd())
        (self.root / "SYNTHETIC_ONLY").write_text("not authorized")
        with self.assertRaises(Blocked):
            fixture_root(self.root)

    def test_exact_inventory(self):
        expected = discover(self.root, [self.apps])
        with MaintenanceLease(self.root, "s") as lease:
            self.assertEqual(validate_inventory(lease, [self.apps], expected, self.app), expected)

    def test_manifest_semantically_same_bytes_different(self):
        expected = discover(self.root, [self.apps])
        (self.app / "Contents/Resources/runtime-compatibility.json").write_text('{ "schemaVersions": [4] }')
        with MaintenanceLease(self.root, "s") as lease, self.assertRaises(Blocked):
            validate_inventory(lease, [self.apps], expected, self.app)

    def test_nested_under_unrelated_outer_resources(self):
        nested = self.bundle(self.apps / "outer.app/Contents/Resources/nested.retired")
        self.assertIn(str(nested), discover(self.root, [self.apps]))

    def test_flat_production_is_not_silently_ignored(self):
        path = self.apps / "flat"
        path.mkdir()
        (path / "Info.plist").write_bytes(plistlib.dumps({"CFBundleIdentifier": PRODUCTION_BUNDLE_ID}))
        with self.assertRaises(Blocked):
            discover(self.root, [self.apps])

    def test_external_symlink(self):
        (self.apps / "outside").symlink_to(self.root)
        with self.assertRaises(Blocked):
            discover(self.root, [self.apps])

    def test_internal_production_alias(self):
        (self.apps / "alias").symlink_to(self.app)
        with self.assertRaises(Blocked):
            discover(self.root, [self.apps])

    def test_internal_unrelated_framework_alias_reuses_coverage(self):
        framework = self.apps / "ThirdParty/Framework/Versions/A"
        framework.mkdir(parents=True)
        (framework.parent / "Current").symlink_to(framework)
        self.assertEqual(len(discover(self.root, [self.apps])), 1)

    def test_unknown_bookmark(self):
        (self.apps / "launch.bookmark").write_bytes(b"unknown")
        with self.assertRaises(Blocked):
            discover(self.root, [self.apps])

    def test_hardlink_identity_rejected(self):
        exe = self.app / "Contents/MacOS" / EXECUTABLE_NAME
        os.link(exe, self.root / "alias")
        with self.assertRaises(Blocked):
            bundle_identity(self.root, self.app)

    def test_archive_role_does_not_whitelist_launch_route(self):
        self.bundle(self.apps / "archive.retired", executable=True)
        expected = discover(self.root, [self.apps])
        with MaintenanceLease(self.root, "s") as lease, self.assertRaises(Blocked):
            validate_inventory(lease, [self.apps], expected, self.app)

    def test_nested_helper_executable_blocks(self):
        helper = self.app / "Contents/Resources/helper"
        helper.write_bytes(b"helper")
        helper.chmod(0o700)
        expected = discover(self.root, [self.apps])
        with MaintenanceLease(self.root, "s") as lease, self.assertRaises(Blocked):
            validate_inventory(lease, [self.apps], expected, self.app)

    def test_bare_production_copy_not_hidden_by_nonapp_suffix(self):
        bare = self.apps / "other-name"
        bare.write_bytes((self.app / "Contents/MacOS" / EXECUTABLE_NAME).read_bytes())
        bare.chmod(0o700)
        expected = discover(self.root, [self.apps])
        with MaintenanceLease(self.root, "s") as lease, self.assertRaises(Blocked):
            validate_inventory(lease, [self.apps], expected, self.app)

    def test_disable_precedes_exit_check_and_never_renames_live_target(self):
        exe = self.app / "Contents/MacOS" / EXECUTABLE_NAME
        target = {"pid": 99, "start": 10, "identity": "v3"}
        def collector():
            self.assertEqual(exe.stat().st_mode & 0o111, 0)
            return {"complete": True, "observations": [{**target, "target": True, "state": "IDLE"}]}
        with MaintenanceLease(self.root, "s") as lease, self.assertRaises(Blocked):
            disable_known_entries(lease, [self.app], [target], collector)
        self.assertTrue(self.app.exists())
        self.assertEqual(exe.stat().st_mode & 0o111, 0)

    def test_actual_child_exit_after_disable_uses_retained_waitpid(self):
        child = subprocess.Popen([sys.executable, "-c", "print('idle',flush=True); input()"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(child.stdout.readline().strip(), "idle")
            association = {"pid": child.pid, "start": "fixture-controller-spawn-1", "identity": identity(Path(sys.executable).resolve())["sha256"]}
            collector = lambda: collect_spawned_fixture_targets([(association, child)])
            with MaintenanceLease(self.root, "s") as lease:
                with self.assertRaises(Blocked):
                    disable_known_entries(lease, [self.app], [association], collector)
                child.communicate("exit\n", timeout=5)
                result = disable_known_entries(lease, [self.app], [association], collector)
                self.assertEqual(result["exit_evidence"]["observations"][0]["evidence"], "retained_Popen_waitpid")
        finally:
            if child.poll() is None:
                child.kill()
                child.wait()

    def test_disabled_copy_born_without_exec_bits(self):
        observed = []
        original_open = os.open
        def monitor(path, flags, mode=0o777, **kwargs):
            fd = original_open(path, flags, mode, **kwargs)
            if str(path).startswith(str(self.apps / "staging")):
                observed.append(os.fstat(fd).st_mode & 0o111)
            return fd
        from unittest.mock import patch
        with MaintenanceLease(self.root, "s") as lease, patch("quiescence_gate.os.open", monitor):
            stage = copy_disabled(lease, self.app, self.apps / "staging")
        self.assertTrue(observed)
        self.assertEqual(set(observed), {0})
        self.assertTrue(all(not p.stat().st_mode & 0o111 for p in stage.rglob("*") if p.is_file()))

    def test_copy_overlap_is_rejected_before_any_mutation(self):
        def snapshot():
            return {str(path.relative_to(self.apps)): (path.lstat().st_mode, path.read_bytes() if path.is_file() else None)
                    for path in self.apps.rglob("*")}
        with MaintenanceLease(self.root, "s") as lease:
            before = snapshot()
            for target in (self.app, self.app / "staging", self.apps):
                with self.subTest(target=target), self.assertRaisesRegex(Blocked, "BLOCKED_COPY_OVERLAP"):
                    copy_disabled(lease, self.app, target)
                self.assertEqual(snapshot(), before)

    def test_old_runtime_idle_still_blocked(self):
        target = {"pid": 99, "start": 10, "identity": "v3"}
        with self.assertRaises(Blocked):
            validate_processes([target], [{**target, "target": True, "state": "IDLE"}], complete=True)

    def test_known_target_cannot_disappear_or_change_identity(self):
        target = {"pid": 99, "start": 10, "identity": "v3"}
        for observations in ([], [{**target, "target": True, "identity": "renamed", "state": "EXIT_CONFIRMED"}]):
            with self.assertRaises(Blocked):
                validate_processes([target], observations, complete=True)

    def test_unrelated_protected_pid_not_absence_proof(self):
        result = validate_processes([], [{"pid": 1, "target": False, "state": "UNKNOWN"}], complete=True)
        self.assertEqual(result["unrelated"], "NOT_INSPECTED_OUTSIDE_TARGET_SCOPE")

    def test_incomplete_target_enumeration_blocks(self):
        with self.assertRaises(Blocked):
            validate_processes([{"pid": 99}], [], complete=False)

    def test_os_lease_serializes_supported_entrypoints(self):
        with MaintenanceLease(self.root, "s"):
            with self.assertRaises(BlockingIOError):
                with MaintenanceLease(self.root, "other"):
                    self.fail("overlapping owner")

    def test_gapless_inherited_lease_survives_gate_close(self):
        lease = MaintenanceLease(self.root, "s").__enter__()
        child = subprocess.Popen([sys.executable, "-c", "import os,sys,fcntl; fcntl.flock(int(sys.argv[1]),fcntl.LOCK_EX|fcntl.LOCK_NB); print('owned',flush=True); input()", str(lease.fd)], pass_fds=(lease.fd,), stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(child.stdout.readline().strip(), "owned")
            lease.__exit__()
            with self.assertRaises(BlockingIOError):
                with MaintenanceLease(self.root, "competitor"):
                    self.fail("lease gap")
            child.communicate("release\n", timeout=5)
            self.assertEqual(child.returncode, 0)
            with MaintenanceLease(self.root, "after"):
                pass
        finally:
            if child.poll() is None:
                child.kill()
                child.wait()
            lease.__exit__()

    def test_lease_inode_replacement_detected(self):
        with MaintenanceLease(self.root, "s") as lease:
            lease.path.rename(self.root / "original.lock")
            lease.path.write_text("replacement")
            with self.assertRaises(Blocked):
                lease.validate()

    def test_lease_handoff_failure_retains_parent_ownership(self):
        with MaintenanceLease(self.root, "s") as lease:
            with self.assertRaises(Blocked):
                lease.launch_native(self.app / "Contents/MacOS" / EXECUTABLE_NAME, "bad-hash")
            with self.assertRaises(BlockingIOError):
                with MaintenanceLease(self.root, "other"):
                    pass


if __name__ == "__main__":
    unittest.main(verbosity=2)
