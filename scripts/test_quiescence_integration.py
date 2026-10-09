"""Closed managed workflow and actual OS descriptor lifetime regressions."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest
import plistlib

from quiescence_gate import Blocked, MaintenanceLease, identity
from quiescence_integration import (EXE_REL, MANIFEST_REL, create_fixture,
    OLD_RUNTIME_BUNDLE_ID, diagnose, prepare_managed, tree_facts, _verify_requested_old_exit)


class OldFixtureExitProofTests(unittest.TestCase):
    """Pure verification tests: no process or fixture execution."""
    def test_only_requested_termination_is_accepted(self):
        _verify_requested_old_exit(0, {"initialized": True})

    def test_policy_kill_unknown_or_early_exit_never_proves_old_runtime(self):
        for code in (-signal.SIGKILL, None, -signal.SIGTERM, 1, -signal.SIGSEGV):
            with self.subTest(code=code), self.assertRaisesRegex(Blocked, "BLOCKED_OLD_FIXTURE_EXECUTION_UNPROVEN"):
                _verify_requested_old_exit(code, {"initialized": True})
        with self.assertRaisesRegex(Blocked, "BLOCKED_OLD_FIXTURE_EXECUTION_UNPROVEN"):
            _verify_requested_old_exit(0, None)


class ManagedIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pfc-qic-integration-test-")
        self.parent = Path(self.temp.name).resolve()
        self.fixture = create_fixture(self.parent, Path("/usr/bin/true"), self._testMethodName)
        self.root = Path(self.fixture["root"])
        self.paths = {name: Path(path) for name, path in self.fixture["paths"].items()}

    def tearDown(self):
        self.temp.cleanup()

    def prepared(self, observer=None):
        with MaintenanceLease(self.root, self.fixture["session"]) as lease:
            return prepare_managed(self.root, lease, observer=observer)

    def test_full_chain_persisted_readback_and_exact_binding(self):
        seen = []
        def observe(state, root):
            seen.append(state)
            if state in ("S1_ENTRIES_DISABLED", "S1_TARGET_EXIT_VERIFIED", "S1_ARCHIVE_VERIFIED",
                         "S1_STAGING_VERIFIED", "S1_INSTALLED_DISABLED"):
                self.assertFalse([f for f in tree_facts(root) if f["kind"] == "file" and f["mode"] & 0o111])
            if state == "S1_ENTRIES_DISABLED":
                self.assertTrue(self.paths["installed"].exists())
                self.assertFalse(self.paths["archive"].exists())
        context = self.prepared(observe)
        self.assertEqual(seen, ["S0_VERIFIED_CANDIDATE", "S1_OLD_RUNTIME_RETAINED", "S1_ENTRIES_DISABLED",
            "S1_TARGET_EXIT_VERIFIED", "S1_ARCHIVE_VERIFIED", "S1_STAGING_VERIFIED", "S1_INSTALLED_DISABLED",
            "S1_MANAGED_ISOLATED", "S2_OWNER_AUTHORIZED"])
        contract = json.loads((self.root / "managed-contract.json").read_bytes())
        permit = json.loads((self.root / "permit.json").read_bytes())
        authorization = json.loads((self.root / "authorization.json").read_bytes())
        self.assertEqual(contract["objects"], tree_facts(self.root))
        self.assertEqual(contract["authorization"], authorization)
        self.assertEqual(permit["managed_contract_sha256"], identity(self.root / "managed-contract.json")["sha256"])
        self.assertEqual(permit["authorization_sha256"], identity(self.root / "authorization.json")["sha256"])
        self.assertEqual(permit["lease_inode"], (self.root / "maintenance.lock").stat().st_ino)
        self.assertEqual(permit["session"], self.fixture["session"])
        self.assertEqual(permit["format_version"], 2)
        self.assertEqual(Path(context["installed_executable"]), self.paths["installed"] / EXE_REL)
        self.assertEqual([item["path"] for item in contract["launch_routes"] if item["enabled"]], [context["installed_executable"]])
        self.assertEqual(len(contract["known_nested"]), 1)
        for receipt in contract["transitions"]:
            content = Path(receipt["path"]).read_bytes()
            self.assertEqual(hashlib.sha256(content).hexdigest(), receipt["evidence_sha256"])
            persisted = json.loads(content)
            self.assertEqual(persisted["state"], receipt["state"])
            self.assertEqual(persisted["session"], self.fixture["session"])
            self.assertIn("entry", persisted["state_contract"])
            self.assertIn("restart", persisted["state_contract"])

    def test_real_old_process_association_retained_across_archive_move(self):
        self.prepared()
        contract = json.loads((self.root / "managed-contract.json").read_bytes())
        process = contract["processes"][0]
        archive = identity(self.paths["archive"] / EXE_REL)
        self.assertEqual((process["executable_dev"], process["executable_inode"], process["executable_sha256"]),
                         (archive["dev"], archive["ino"], archive["sha256"]))
        self.assertEqual(process["state"], "EXIT_CONFIRMED")
        retained = json.loads((self.root / "managed-state-S1_OLD_RUNTIME_RETAINED.json").read_bytes())
        self.assertEqual(retained["details"]["start_evidence"]["collector"], "ps_exact_retained_child_lstart")
        self.assertEqual(retained["details"]["start_evidence"]["readiness"]["session"], self.fixture["session"])
        self.assertTrue(retained["details"]["start_evidence"]["readiness"]["initialized"])
        self.assertEqual(process["start"], retained["details"]["start_evidence"]["value"])
        self.assertNotIn("retained-Popen-", process["start"])
        with self.assertRaises(ProcessLookupError):
            os.kill(process["pid"], 0)
        exit_receipt = json.loads((self.root / "managed-state-S1_TARGET_EXIT_VERIFIED.json").read_bytes())
        self.assertEqual(exit_receipt["details"]["observations"][0]["evidence"], "retained_Popen_waitpid")

    def test_unexited_child_disables_before_block_and_never_moves(self):
        with MaintenanceLease(self.root, self.fixture["session"]) as lease, self.assertRaisesRegex(Blocked, "BLOCKED_MANAGED_RUNTIME_IDENTITY_UNKNOWN"):
            prepare_managed(self.root, lease, stop_old=False)
        self.assertTrue(self.paths["installed"].exists())
        self.assertFalse(self.paths["archive"].exists())
        self.assertEqual((self.paths["installed"] / EXE_REL).stat().st_mode & 0o111, 0)
        self.assertFalse((self.root / "permit.json").exists())
        self.assertEqual(diagnose(self.root)["state"], "MANAGED_BLOCKED")

    def test_second_attempt_never_reissues_permit_or_restores_runtime(self):
        self.prepared()
        before = {name: (self.root / name).read_bytes() for name in ("permit.json", "managed-progress.json", "managed-contract.json")}
        with MaintenanceLease(self.root, self.fixture["session"]) as lease, self.assertRaisesRegex(Blocked, "BLOCKED_MANAGED_ATTEMPT_PENDING"):
            prepare_managed(self.root, lease)
        for name, content in before.items():
            self.assertEqual((self.root / name).read_bytes(), content)
        self.assertFalse(diagnose(self.root)["normal_startup_allowed"])

    def test_candidate_staging_archive_born_without_execute_bits(self):
        original_open = os.open
        creations = []
        from unittest.mock import patch
        def tracked(path, flags, mode=0o777, **kwargs):
            fd = original_open(path, flags, mode, **kwargs)
            if flags & os.O_CREAT and any(label in str(path) for label in ("/staging/", "/install/")):
                creations.append(os.fstat(fd).st_mode & 0o111)
            return fd
        # Candidate was created by _copy_file(0600), before any lease/transition.
        self.assertTrue(all(not f["mode"] & 0o111 for f in self.fixture["initial_inventory"]
                            if f["kind"] == "file" and f["role"] == "candidate"))
        with patch("quiescence_gate.os.open", tracked):
            self.prepared()
        self.assertTrue(creations)
        self.assertEqual(set(creations), {0})
        for role in ("candidate", "staging", "archive"):
            self.assertTrue(all(not p.stat().st_mode & 0o111 for p in self.paths[role].rglob("*") if p.is_file()))

    def test_preflight_symlink_refused_without_mutation(self):
        (self.root / "managed/alias").symlink_to(self.paths["installed"])
        with self.assertRaisesRegex(Blocked, "BLOCKED_CANONICAL_ESCAPE"):
            self.prepared()
        self.assertTrue((self.paths["installed"] / EXE_REL).stat().st_mode & 0o111)
        self.assertFalse((self.root / "managed-progress.json").exists())

    def test_preflight_hardlink_refused_without_mutation(self):
        os.link(self.paths["installed"] / EXE_REL, self.root / "managed/bare")
        with self.assertRaisesRegex(Blocked, "BLOCKED_FILE_IDENTITY"):
            self.prepared()
        self.assertTrue((self.paths["installed"] / EXE_REL).stat().st_mode & 0o111)

    def test_preflight_unknown_bookmark_refused(self):
        (self.root / "managed/route.bookmark").write_bytes(b"unknown")
        with self.assertRaisesRegex(Blocked, "BLOCKED_LAUNCH_ALIAS_UNKNOWN"):
            self.prepared()

    def test_preflight_bare_executable_refused_even_different_hash(self):
        bare = self.root / "managed/second-launch"
        bare.write_bytes(b"other executable")
        bare.chmod(0o700)
        with self.assertRaisesRegex(Blocked, "BLOCKED_MANAGED_OBJECT_DRIFT"):
            self.prepared()

    def test_preflight_second_bundle_refused(self):
        from shutil import copytree
        copytree(self.paths["candidate"], self.root / "managed/second.app")
        with self.assertRaisesRegex(Blocked, "BLOCKED_MANAGED_OBJECT_DRIFT"):
            self.prepared()

    def test_canonical_escape_refused(self):
        (self.root / "managed/outside").symlink_to(self.parent)
        with self.assertRaisesRegex(Blocked, "BLOCKED_CANONICAL_ESCAPE"):
            self.prepared()

    def test_overlap_definition_refused_before_disable(self):
        definition = json.loads((self.root / "fixture-definition.json").read_bytes())
        definition["paths"]["staging"] = str(self.paths["candidate"] / "nested-staging")
        (self.root / "fixture-definition.json").write_text(json.dumps(definition))
        with self.assertRaisesRegex(Blocked, "BLOCKED_MANAGED_OBJECT_SET"):
            self.prepared()
        self.assertTrue((self.paths["installed"] / EXE_REL).stat().st_mode & 0o111)

    def test_candidate_plist_drift_after_S0_is_not_refrozen(self):
        def mutate(state, root):
            if state == "S1_ARCHIVE_VERIFIED":
                path = self.paths["candidate"] / "Contents/Info.plist"
                path.write_bytes(path.read_bytes() + b"\n")
        with self.assertRaisesRegex(Blocked, "BLOCKED_FROZEN_BUNDLE_DRIFT"):
            self.prepared(mutate)
        self.assertFalse((self.root / "permit.json").exists())
        self.assertEqual((self.paths["archive"] / EXE_REL).stat().st_mode & 0o111, 0)

    def test_disabled_nested_helper_bytes_drift_is_not_refrozen(self):
        def mutate(state, root):
            if state == "S1_ARCHIVE_VERIFIED":
                (self.paths["archive"] / "Contents/Resources/legacy-helper").write_bytes(b"changed disabled helper")
        with self.assertRaisesRegex(Blocked, "BLOCKED_FROZEN_BUNDLE_DRIFT"):
            self.prepared(mutate)
        self.assertFalse((self.root / "permit.json").exists())

    def test_late_second_route_blocks_before_authorization(self):
        def mutate(state, root):
            if state == "S1_INSTALLED_DISABLED":
                path = root / "managed/late-second"
                path.write_bytes(b"unknown")
                path.chmod(0o700)
        with self.assertRaisesRegex(Blocked, "BLOCKED_UNDECLARED_MANAGED_ROUTE"):
            self.prepared(mutate)
        self.assertFalse((self.root / "authorization.json").exists())

    def test_pending_and_corrupt_attempt_diagnostic_fail_closed(self):
        self.assertEqual(diagnose(self.root)["state"], "NOT_STARTED")
        (self.root / "outcome.json.pending").write_bytes(b"incomplete")
        self.assertEqual(diagnose(self.root)["state"], "GUARD_LOST_OR_UNPROVEN")
        (self.root / "outcome.json.pending").unlink()
        (self.root / "outcome.json").write_bytes(b"not JSON")
        self.assertEqual(diagnose(self.root)["state"], "GUARD_LOST_OR_UNPROVEN")

    def test_diagnostic_rejects_cross_session_and_orphan_attempt_files(self):
        self.prepared()
        path = self.root / "managed-progress.json"
        value = json.loads(path.read_bytes())
        value["session"] = "wrong-session"
        path.write_text(json.dumps(value))
        self.assertEqual(diagnose(self.root)["state"], "GUARD_LOST_OR_UNPROVEN")
        path.unlink()
        self.assertEqual(diagnose(self.root)["state"], "GUARD_LOST_OR_UNPROVEN")
        with MaintenanceLease(self.root, self.fixture["session"]) as lease, self.assertRaisesRegex(Blocked, "BLOCKED_MANAGED_ATTEMPT_PENDING"):
            prepare_managed(self.root, lease)

    def test_plain_permit_without_managed_receipt_is_never_not_started(self):
        (self.root / "permit.json").write_text(json.dumps({"format_version": 2, "synthetic_only": True,
            "session": self.fixture["session"], "nonce": self.fixture["nonce"],
            "authorization_id": self.fixture["authorization_id"]}))
        self.assertEqual(diagnose(self.root)["state"], "GUARD_LOST_OR_UNPROVEN")

    def test_partial_state_without_progress_blocks_reexecution(self):
        (self.root / "managed-state-S0_VERIFIED_CANDIDATE.json").write_text(json.dumps({"format_version": 2,
            "synthetic_only": True, "session": self.fixture["session"], "nonce": self.fixture["nonce"],
            "authorization_id": self.fixture["authorization_id"]}))
        self.assertEqual(diagnose(self.root)["state"], "GUARD_LOST_OR_UNPROVEN")
        with MaintenanceLease(self.root, self.fixture["session"]) as lease, self.assertRaisesRegex(Blocked, "BLOCKED_MANAGED_ATTEMPT_PENDING"):
            prepare_managed(self.root, lease)

    def test_actual_candidate_bundle_identity_is_isolated_and_old_is_not_skipped(self):
        self.prepared()
        contract = json.loads((self.root / "managed-contract.json").read_bytes())
        for item in contract["bundles"]:
            plist = plistlib.loads(Path(item["info_plist"]).read_bytes())
            manifest = json.loads(Path(item["manifest"]).read_bytes())
            expected = "org.pfc.quiescence.integration" if item["role"] in ("candidate", "staging", "installed") else OLD_RUNTIME_BUNDLE_ID
            self.assertEqual(plist["CFBundleIdentifier"], expected)
            self.assertEqual(manifest["bundleId"], expected)

    def test_synthetic_parent_and_marker_required(self):
        with self.assertRaises(Blocked):
            create_fixture(Path.cwd(), Path("/usr/bin/true"))
        (self.root / "SYNTHETIC_ONLY").write_text("not authorized")
        with self.assertRaises(Blocked):
            self.prepared()

    def test_v3_proof_is_not_only_schema_number(self):
        import sqlite3
        db = self.root / "personal-finance-console.sqlite3"
        connection = sqlite3.connect(db)
        connection.execute("ALTER TABLE profiles ADD COLUMN hidden TEXT")
        connection.commit()
        connection.close()
        with self.assertRaisesRegex(Blocked, "BLOCKED_PREMIGRATION_V3_UNPROVEN"):
            self.prepared()

    def test_stale_lease_record_never_rebound(self):
        with MaintenanceLease(self.root, self.fixture["session"]) as lease:
            binding = lease.bind("auth", "nonce")
        with MaintenanceLease(self.root, self.fixture["session"]) as lease:
            self.assertEqual(lease.bind("auth", "nonce"), binding)
            with self.assertRaisesRegex(Blocked, "BLOCKED_STALE_LEASE"):
                lease.bind("other-auth", "nonce")
        with MaintenanceLease(self.root, "wrong-session") as lease, self.assertRaisesRegex(Blocked, "BLOCKED_STALE_LEASE"):
            lease.bind("auth", "nonce")

    def test_corrupt_stale_lease_record_is_not_replaced(self):
        (self.root / "maintenance.lock").write_bytes(b"corrupted")
        with MaintenanceLease(self.root, self.fixture["session"]) as lease, self.assertRaisesRegex(Blocked, "BLOCKED_STALE_LEASE"):
            lease.bind("auth", "nonce")
        self.assertEqual((self.root / "maintenance.lock").read_bytes(), b"corrupted")

    def test_recreated_lease_file_never_accepted_by_original_owner(self):
        with MaintenanceLease(self.root, self.fixture["session"]) as lease:
            lease.bind("auth", "nonce")
            (self.root / "maintenance.lock").rename(self.root / "retained.lock")
            (self.root / "maintenance.lock").write_bytes(b"new inode")
            with self.assertRaisesRegex(Blocked, "BLOCKED_LEASE_IDENTITY"):
                lease.validate()

    def test_unrelated_same_path_holder_blocks_gate(self):
        path = self.root / "maintenance.lock"
        fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):
                with MaintenanceLease(self.root, self.fixture["session"]):
                    pass
        finally:
            os.close(fd)

    def test_child_death_parent_keeps_lock_and_attempt_survives_release(self):
        with MaintenanceLease(self.root, self.fixture["session"]) as lease:
            self.prepared_context = prepare_managed(self.root, lease)
            child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"], pass_fds=(lease.fd,))
            child.kill()
            child.wait(timeout=5)
            with self.assertRaises(BlockingIOError):
                with MaintenanceLease(self.root, "duplicate"):
                    pass
        self.assertTrue((self.root / "managed-progress.json").exists())
        self.assertTrue(diagnose(self.root)["recovery_required"])
        with MaintenanceLease(self.root, self.fixture["session"]) as lease:
            with self.assertRaisesRegex(Blocked, "BLOCKED_MANAGED_ATTEMPT_PENDING"):
                prepare_managed(self.root, lease)

    def test_parent_death_child_retains_same_inode_session_and_no_unlocked_gap(self):
        scripts = str(Path(__file__).resolve().parent)
        child_code = (
            "import os,sys,fcntl,json,time; fd=int(sys.argv[1]); "
            "fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB); "
            "print(json.dumps({'pid':os.getpid(),'inode':os.fstat(fd).st_ino,'record':json.loads(os.pread(fd,16384,0))}),flush=True); "
            "time.sleep(30)"
        )
        gate_code = (
            "import sys,subprocess,time; from pathlib import Path; sys.path.insert(0,sys.argv[1]); "
            "from quiescence_gate import MaintenanceLease; "
            "lease=MaintenanceLease(Path(sys.argv[2]),'parent-death-session').__enter__(); "
            "lease.bind('parent-death-auth','parent-death-nonce'); "
            "child=subprocess.Popen([sys.executable,'-u','-c',sys.argv[3],str(lease.fd)],pass_fds=(lease.fd,)); "
            "time.sleep(30)"
        )
        gate = subprocess.Popen([sys.executable, "-u", "-c", gate_code, scripts, str(self.root), child_code],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        child_pid = None
        try:
            observed = json.loads(gate.stdout.readline())
            child_pid = observed["pid"]
            self.assertEqual(observed["record"]["session"], "parent-death-session")
            self.assertEqual(observed["inode"], (self.root / "maintenance.lock").stat().st_ino)
            gate.kill()
            gate.wait(timeout=5)
            with self.assertRaises(BlockingIOError):
                with MaintenanceLease(self.root, "duplicate"):
                    pass
            self.assertEqual(json.loads((self.root / "maintenance.lock").read_bytes())["nonce"], "parent-death-nonce")
        finally:
            if gate.poll() is None:
                gate.kill()
                gate.wait(timeout=5)
            if child_pid:
                os.kill(child_pid, signal.SIGTERM)
            gate.stdout.close()
            gate.stderr.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
