"""C3-only ownership contract tests. Every fixture is synthetic and temporary."""
import json
import os
import plistlib
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

from quiescence_gate import Blocked, MaintenanceLease, MARKER, UNIFIED_MARKER
from quiescence_integration import (
    DATABASE, ISOLATED_BUNDLE_ID, STANDALONE_COMPONENT, UNIFIED_R2B_GATE_OWNED,
    create_fixture, prepare_managed,
)

SIGNING_IDENTITY = "Apple Development: 8619814730147 (FW5KHTFNZ6)"
NATIVE_FIXTURE = Path(__file__).resolve().parents[1] / "src-tauri/target/debug/quiescence-fixture"
AUTHORITY_FILES = ("authorization.json", "permit.json", "permit.claimed.json", "consumed.json",
                   "consumed-ledger.json", "migration-terminal.json", "outcome.json",
                   "migration-authorization.json", "production-v4-migration-authorization.json",
                   "migration-permit.json", "gate-permit.json", "gate-permit.claimed.json",
                   "production-v4-consumed-authorizations.json", "release-receipt.json")


class GateOwnedC3Tests(unittest.TestCase):
    def setUp(self):
        if not os.environ.get("APPLE_SIGNING_IDENTITY"):
            os.environ["APPLE_SIGNING_IDENTITY"] = SIGNING_IDENTITY
        self.temp = tempfile.TemporaryDirectory(prefix="pfc-r2b1a-c3-")
        self.parent = Path(self.temp.name).resolve()
        if not NATIVE_FIXTURE.exists():
            self.skipTest("quiescence-fixture binary must be built before this integration suite")

    def tearDown(self):
        self.temp.cleanup()

    def make_fixture(self, *, mode=UNIFIED_R2B_GATE_OWNED, bundle_id=ISOLATED_BUNDLE_ID):
        return create_fixture(self.parent, NATIVE_FIXTURE, self._testMethodName,
                              runtime_bundle_id=bundle_id, signing_identity=SIGNING_IDENTITY, mode=mode)

    def assert_no_migration_authority(self, root):
        self.assertFalse([name for name in AUTHORITY_FILES if (root / name).exists() or (root / name).is_symlink()])

    def run_prepare(self, fixture, **kwargs):
        root = Path(fixture["root"])
        with MaintenanceLease(root, fixture["session"], mode="unified-r2b") as lease:
            return prepare_managed(root, lease, mode=UNIFIED_R2B_GATE_OWNED, **kwargs)

    def test_gate_owned_c3_stops_at_s1_without_migration_authority(self):
        fixture = self.make_fixture()
        root = Path(fixture["root"])
        result = self.run_prepare(fixture)
        self.assertEqual(result["state"], "MANAGED_ISOLATED")
        self.assertEqual(result["mode"], UNIFIED_R2B_GATE_OWNED)
        self.assertEqual((root / "SYNTHETIC_ONLY").read_bytes(), UNIFIED_MARKER.encode())
        self.assertEqual(result["installed_executable"], str(root / "managed/install/Installed.app/Contents/MacOS/personal-finance-console"))
        receipt_path = root / "SYNTHETIC_C3_MANAGED_ISOLATED.json"
        receipt = json.loads(receipt_path.read_bytes())
        self.assertEqual(len(list(root.glob("SYNTHETIC_C3_MANAGED_ISOLATED*.json"))), 1)
        self.assertEqual(receipt["status"], "SYNTHETIC_C3_MANAGED_ISOLATED")
        self.assertEqual(receipt["mode"], UNIFIED_R2B_GATE_OWNED)
        self.assertEqual(receipt["candidate"]["bundleId"], ISOLATED_BUNDLE_ID)
        self.assertEqual(receipt["databasePath"], str(root / DATABASE))
        self.assertEqual(receipt["schemaVersion"], 3)
        self.assertEqual(receipt["migrationVersions"], [1, 2, 3])
        self.assertNotIn("nonce", receipt)
        self.assertNotIn("authorizationId", receipt)
        contract = json.loads((root / "managed-contract.json").read_bytes())
        self.assertEqual(contract["mode"], UNIFIED_R2B_GATE_OWNED)
        self.assertNotIn("authorization", contract)
        self.assertEqual(json.loads((root / "managed-progress.json").read_bytes())["state"], "S1_MANAGED_ISOLATED")
        self.assertFalse((root / "managed-state-S2_OWNER_AUTHORIZED.json").exists())
        for path in [root / "fixture-definition.json", root / "managed-progress.json",
                     *root.glob("managed-state-*.json"), root / "managed-contract.json"]:
            value = json.loads(path.read_bytes())
            self.assertNotIn("nonce", value)
            self.assertNotIn("authorization_id", value)
            self.assertNotIn("authorizationId", value)
        self.assert_no_migration_authority(root)
        with sqlite3.connect((root / DATABASE).as_uri() + "?mode=ro", uri=True) as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 3)
            self.assertEqual(db.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall(), [(1,), (2,), (3,)])

    def test_unified_mode_requires_exact_marker_and_is_never_inferred(self):
        fixture = self.make_fixture()
        root = Path(fixture["root"])
        self.assertEqual((root / "SYNTHETIC_ONLY").read_bytes(), UNIFIED_MARKER.encode())
        with self.assertRaises(Blocked):
            MaintenanceLease(root, fixture["session"], mode="standalone")
        with self.assertRaisesRegex(Blocked, "BLOCKED_UNKNOWN_MANAGED_MODE"):
            MaintenanceLease(root, fixture["session"], mode="guess-from-files")
        with self.assertRaises(Blocked):
            MaintenanceLease(root, fixture["session"])
        self.assert_no_migration_authority(root)

    def test_legacy_marker_is_refused_in_unified_mode(self):
        fixture = self.make_fixture(mode=STANDALONE_COMPONENT)
        root = Path(fixture["root"])
        self.assertEqual((root / "SYNTHETIC_ONLY").read_bytes(), MARKER.encode())
        with self.assertRaises(Blocked):
            MaintenanceLease(root, fixture["session"], mode="unified-r2b")

    def test_missing_wrong_and_symlink_markers_are_refused(self):
        fixture = self.make_fixture()
        root = Path(fixture["root"])
        marker = root / "SYNTHETIC_ONLY"
        original = marker.read_bytes()
        marker.unlink()
        with self.assertRaises(Blocked):
            MaintenanceLease(root, fixture["session"], mode="unified-r2b")
        marker.write_bytes(b"wrong marker\n")
        with self.assertRaises(Blocked):
            MaintenanceLease(root, fixture["session"], mode="unified-r2b")
        marker.unlink()
        (root / "marker-target").write_bytes(original)
        marker.symlink_to(root / "marker-target")
        with self.assertRaises(Blocked):
            MaintenanceLease(root, fixture["session"], mode="unified-r2b")

    def test_unified_mode_rejects_noncanonical_bundle_identities(self):
        for bundle_id in ("com.personalfinance.console", "com.personalfinance.console.wp03preview",
                          "com.personalfinance.console.wp02preview", "org.example.random"):
            with self.subTest(bundle_id=bundle_id), self.assertRaisesRegex(Blocked, "REFUSE_UNIFIED_SYNTHETIC_IDENTITY"):
                create_fixture(self.parent, NATIVE_FIXTURE, "wrong-" + str(len(list(self.parent.iterdir()))),
                               runtime_bundle_id=bundle_id, mode=UNIFIED_R2B_GATE_OWNED,
                               signing_identity=SIGNING_IDENTITY)

    def test_unknown_mode_refuses(self):
        with self.assertRaisesRegex(Blocked, "BLOCKED_UNKNOWN_MANAGED_MODE"):
            create_fixture(self.parent, NATIVE_FIXTURE, "unknown", mode="AUTO", signing_identity=SIGNING_IDENTITY)
        fixture = self.make_fixture()
        root = Path(fixture["root"])
        with MaintenanceLease(root, fixture["session"], mode="unified-r2b") as lease:
            with self.assertRaisesRegex(Blocked, "BLOCKED_UNKNOWN_MANAGED_MODE"):
                prepare_managed(root, lease, mode="AUTO")

    def test_existing_standalone_permit_is_refused_and_preserved(self):
        fixture = self.make_fixture()
        root = Path(fixture["root"])
        permit = root / "permit.json"
        permit.write_text('{"legacy":"permit"}\n')
        before = permit.read_bytes()
        with self.assertRaisesRegex(Blocked, "REFUSE_AMBIGUOUS_MIGRATION_AUTHORITY"):
            self.run_prepare(fixture)
        self.assertEqual(permit.read_bytes(), before)
        self.assertFalse((root / "SYNTHETIC_C3_MANAGED_ISOLATED.json").exists())

    def test_existing_standalone_authorization_is_refused_and_preserved(self):
        fixture = self.make_fixture()
        root = Path(fixture["root"])
        authorization = root / "authorization.json"
        authorization.write_text('{"legacy":"authorization"}\n')
        before = authorization.read_bytes()
        with self.assertRaisesRegex(Blocked, "REFUSE_AMBIGUOUS_MIGRATION_AUTHORITY"):
            self.run_prepare(fixture)
        self.assertEqual(authorization.read_bytes(), before)

    def test_existing_formal_gate_permit_is_refused_and_preserved(self):
        fixture = self.make_fixture()
        root = Path(fixture["root"])
        permit = root / "gate-permit.json"
        permit.write_text('{"formal":"gate-permit"}\n')
        before = permit.read_bytes()
        with self.assertRaisesRegex(Blocked, "REFUSE_AMBIGUOUS_MIGRATION_AUTHORITY"):
            self.run_prepare(fixture)
        self.assertEqual(permit.read_bytes(), before)

    def test_candidate_mismatch_failure_leaves_no_migration_authority(self):
        fixture = self.make_fixture()
        root = Path(fixture["root"])
        plist = root / "managed/candidate/Candidate.app/Contents/Info.plist"
        info = plistlib.loads(plist.read_bytes())
        info["CFBundleIdentifier"] = "com.personalfinance.console.wp03preview"
        plist.write_bytes(plistlib.dumps(info))
        with self.assertRaises(Blocked):
            self.run_prepare(fixture)
        self.assert_no_migration_authority(root)
        self.assertFalse((root / "SYNTHETIC_C3_MANAGED_ISOLATED.json").exists())

    def test_archive_failure_leaves_no_migration_authority(self):
        fixture = self.make_fixture()
        root = Path(fixture["root"])
        archive = Path(fixture["paths"]["archive"])
        def inject(state, _root):
            if state == "S1_TARGET_EXIT_VERIFIED":
                archive.mkdir(parents=True)
                (archive / "do-not-replace").write_text("collision")
        with self.assertRaises((Blocked, OSError)):
            self.run_prepare(fixture, observer=inject)
        self.assert_no_migration_authority(root)
        self.assertFalse((root / "SYNTHETIC_C3_MANAGED_ISOLATED.json").exists())

    def test_copy_failure_leaves_no_migration_authority(self):
        fixture = self.make_fixture()
        root = Path(fixture["root"])
        staging = Path(fixture["paths"]["staging"])
        def inject(state, _root):
            if state == "S1_ARCHIVE_VERIFIED":
                staging.mkdir(parents=True)
        with self.assertRaises((Blocked, OSError)):
            self.run_prepare(fixture, observer=inject)
        self.assert_no_migration_authority(root)
        self.assertFalse((root / "SYNTHETIC_C3_MANAGED_ISOLATED.json").exists())

    def test_install_failure_leaves_no_migration_authority(self):
        fixture = self.make_fixture()
        root = Path(fixture["root"])
        installed = Path(fixture["paths"]["installed"])
        def inject(state, _root):
            if state == "S1_STAGING_VERIFIED":
                installed.mkdir(parents=True)
        with self.assertRaises((Blocked, OSError)):
            self.run_prepare(fixture, observer=inject)
        self.assert_no_migration_authority(root)
        self.assertFalse((root / "SYNTHETIC_C3_MANAGED_ISOLATED.json").exists())

    def test_old_runtime_still_active_failure_leaves_no_migration_authority(self):
        fixture = self.make_fixture()
        root = Path(fixture["root"])
        with self.assertRaises(Blocked):
            self.run_prepare(fixture, stop_old=False)
        self.assert_no_migration_authority(root)
        self.assertFalse((root / "SYNTHETIC_C3_MANAGED_ISOLATED.json").exists())

    def test_standalone_component_still_issues_its_component_authority(self):
        fixture = self.make_fixture(mode=STANDALONE_COMPONENT)
        root = Path(fixture["root"])
        with MaintenanceLease(root, fixture["session"]) as lease:
            result = prepare_managed(root, lease, mode=STANDALONE_COMPONENT)
        self.assertEqual(result["state"], "S2_OWNER_AUTHORIZED")
        self.assertTrue((root / "authorization.json").is_file())
        self.assertTrue((root / "permit.json").is_file())


if __name__ == "__main__":
    unittest.main()
