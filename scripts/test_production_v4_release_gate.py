from __future__ import annotations

import importlib.util
import json
import plistlib
import shutil
import sqlite3
import stat
import sys
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("production_v4_release_gate.py")
SPEC = importlib.util.spec_from_file_location("production_v4_release_gate", MODULE_PATH)
gate = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = gate
SPEC.loader.exec_module(gate)


class ReleaseGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="pf-v4-gate-")
        self.root = Path(self.temp.name)
        self.app = self.root / "Applications" / gate.APP_NAME
        self.executable = self.app / "Contents/MacOS/personal-finance-console"
        self.manifest = self.app / gate.MANIFEST_RELATIVE_PATH
        self._make_app(self.app, gate.PRODUCTION_BUNDLE_ID)
        self.db = self.root / "Library/Application Support" / gate.PRODUCTION_BUNDLE_ID / gate.DATABASE_NAME
        self.backup = self.db.parent / "production-v4-backups" / gate.DATABASE_NAME
        self.backup.parent.mkdir(parents=True)
        with sqlite3.connect(self.db) as connection:
            connection.executescript(
                "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);"
                "INSERT INTO schema_migrations VALUES(1),(2),(3); PRAGMA user_version=3;"
            )
        shutil.copyfile(self.db, self.backup)
        self.facts = self._safe_facts()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def validate_facts(self, facts: dict) -> list[str]:
        return gate.validate_preflight(facts, synthetic_fixture_root=self.root)

    def make_receipt(self, facts: dict) -> dict:
        return gate.make_release_receipt(facts, synthetic_fixture_root=self.root)

    def _normal_entrypoint_facts(self) -> dict:
        return self._safe_facts()

    def _patch_entrypoint_paths(self):
        return (
            patch.object(gate, "APP_PATH", self.app),
            patch.object(gate, "DATABASE_PATH", self.db),
            patch.object(gate, "APP_DATA", self.db.parent),
        )

    def _write_entrypoint_inputs(self, facts: dict, root: Path) -> tuple[Path, Path]:
        root.mkdir(parents=True, exist_ok=True)
        approval = root / "candidate-approval.json"
        authorization = root / "migration-authorization.json"
        approval.write_text(json.dumps(facts["candidate_approval"]), encoding="utf-8")
        authorization.write_text(json.dumps(facts["migration_authorization"]), encoding="utf-8")
        return approval, authorization

    def _make_app(self, path: Path, bundle_id: str, with_manifest: bool = True) -> None:
        executable = path / "Contents/MacOS/personal-finance-console"
        executable.parent.mkdir(parents=True, exist_ok=True)
        executable.write_bytes(b"fixture-v4-executable")
        executable.chmod(0o755)
        info = {
            "CFBundleIdentifier": bundle_id,
            "CFBundleExecutable": "personal-finance-console",
            "CFBundleShortVersionString": "0.1.2",
        }
        with (path / "Contents/Info.plist").open("wb") as stream:
            plistlib.dump(info, stream)
        if with_manifest:
            manifest = {
                "manifestFormatVersion": 1,
                "runtimeGeneration": 4,
                "minSupportedSchemaVersion": 1,
                "maxSupportedSchemaVersion": 4,
                "bundleId": bundle_id,
                "executable": "Contents/MacOS/personal-finance-console",
            }
            manifest_path = self.manifest_path(path)
            manifest_path.parent.mkdir(parents=True, exist_ok=True)
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    @staticmethod
    def manifest_path(path: Path) -> Path:
        return path / gate.MANIFEST_RELATIVE_PATH

    def _safe_facts(self) -> dict:
        candidate = gate.read_bundle(self.app)
        database_hash = gate.sha256_file(self.db)
        return {
            "platform": "darwin",
            "expected_installed_app": str(self.app),
            "expected_database_path": str(self.db),
            "running_production_processes": [],
            "process_inventory": {"complete": True, "processes": []},
            "process_inventory_complete": True,
            "app_inventory_complete": True,
            "sidecars_absent": True,
            "production_apps": [candidate],
            "candidate": candidate,
            "candidate_approval": {
                "status": "OWNER_APPROVED_V4_PRODUCTION_CANDIDATE",
                "authorizationId": "fixture-candidate-approval",
                "candidateExecutableSha256": candidate["executable_sha256"],
                "compatibilityManifestSha256": candidate["manifest_sha256"],
                "bundleId": gate.PRODUCTION_BUNDLE_ID,
                "maxSupportedSchemaVersion": 4,
            },
            "migration_authorization": {
                "status": "OWNER_AUTHORIZED_PRODUCTION_V4_MIGRATION",
                "authorizationId": "fixture-owner-authorization",
                "productionDbPreMigrationSha256": database_hash,
                "candidateExecutableSha256": candidate["executable_sha256"],
                "backupPath": str(self.backup),
                "authorizationId": "fixture-owner-authorization",
            },
            "production_database": {
                "path": str(self.db.resolve()),
                "sha256": database_hash,
                "user_version": 3,
                "migration_version": 3,
                "integrity": ["ok"],
                "foreign_key_violations": [],
                "sidecars": [],
            },
            "backup": {"path": str(self.backup), "exists": True, "sha256": gate.sha256_file(self.backup)},
        }

    def assert_blocked(self, mutate) -> None:
        facts = self._safe_facts()
        mutate(facts)
        self.assertTrue(self.validate_facts(facts))

    def test_rejects_running_old_production_process(self) -> None:
        self.assert_blocked(lambda facts: facts.update(running_production_processes=[{"pid": 42, "executable_sha256": gate.LEGACY_EXECUTABLE_SHA256}]))

    def test_rejects_installed_old_production_app(self) -> None:
        self.assert_blocked(lambda facts: facts["production_apps"][0].update(executable_sha256=gate.LEGACY_EXECUTABLE_SHA256))

    def test_rejects_unknown_executable_hash(self) -> None:
        def mutate(facts):
            facts["candidate"]["executable_sha256"] = "unknown-hash"
        self.assert_blocked(mutate)

    def test_rejects_wrong_bundle_and_acceptance_bundle(self) -> None:
        for bundle_id in ("com.example.wrong", gate.ACCEPTANCE_BUNDLE_ID):
            with self.subTest(bundle_id=bundle_id):
                self.assert_blocked(lambda facts, value=bundle_id: facts["candidate"].update(bundle_id=value))

    def test_rejects_candidate_without_compatibility_manifest(self) -> None:
        self.assert_blocked(lambda facts: facts.update(candidate={**facts["candidate"], "manifest": None, "manifest_sha256": None}))

    def test_rejects_missing_or_mismatched_backup(self) -> None:
        self.assert_blocked(lambda facts: facts.update(backup={"path": str(self.backup), "exists": False, "sha256": None}))
        self.assert_blocked(lambda facts: facts["backup"].update(sha256="different"))

    def test_rejects_unsupported_database_schema(self) -> None:
        self.assert_blocked(lambda facts: facts["production_database"].update(user_version=5, migration_version=5))

    def test_inventory_fails_closed_for_hidden_subtree_and_traversal_error(self) -> None:
        scan = self.root / "scan"
        hidden = scan / "unreadable" / "Hidden Old.app" / "Contents"
        hidden.mkdir(parents=True)
        with (hidden / "Info.plist").open("wb") as stream:
            plistlib.dump({"CFBundleIdentifier": gate.PRODUCTION_BUNDLE_ID, "CFBundleExecutable": gate.EXECUTABLE_NAME}, stream)
        hidden_executable = hidden.parent / "Contents/MacOS" / gate.EXECUTABLE_NAME
        hidden_executable.parent.mkdir(parents=True)
        hidden_executable.write_bytes(b"synthetic hidden old runtime")
        def failed_walk(root, followlinks, onerror):
            onerror(PermissionError(13, "permission denied", str(root / "unreadable")))
            yield str(root), ["unreadable"], []
        with self.assertRaises(gate.GateBlocked):
            gate.inventory_production_apps([scan], walk=failed_walk)

    def test_malformed_app_metadata_produces_structured_block(self) -> None:
        contents = self.root / "malformed" / "Unknown.app" / "Contents"
        contents.mkdir(parents=True)
        (contents / "Info.plist").write_bytes(b"not a plist")
        with self.assertRaises(gate.GateBlocked) as error:
            gate.inventory_production_apps([self.root / "malformed"])
        self.assertTrue(error.exception.reasons)
        self.assertIn("Unknown.app", error.exception.reasons[0])

    def test_clean_inventory_continues_and_optional_missing_root_is_absent(self) -> None:
        with patch.object(gate.Path, "home", return_value=self.root / "home"):
            optional_home_root = Path.home() / "Applications"
            result = gate.inventory_production_apps([self.app.parent, optional_home_root])
        self.assertEqual([item["bundle_id"] for item in result], [gate.PRODUCTION_BUNDLE_ID])

    def test_nested_production_bundle_blocks_and_nested_neutral_helper_is_scanned(self) -> None:
        scan = self.root / "Applications"
        production_candidate = scan / gate.APP_NAME
        neutral = scan / "Neutral.app"
        self._make_app(production_candidate, gate.PRODUCTION_BUNDLE_ID)
        self._make_app(neutral, "org.example.neutral", with_manifest=False)
        nested_production = neutral / "Contents/Helpers/Hidden Old.app"
        self._make_app(nested_production, gate.PRODUCTION_BUNDLE_ID, with_manifest=False)
        found = gate.inventory_production_apps([scan])
        self.assertEqual(len(found), 2)
        facts = self._safe_facts()
        candidate = gate.read_bundle(production_candidate)
        facts["expected_installed_app"] = str(production_candidate.resolve())
        facts["candidate"] = candidate
        facts["production_apps"] = found
        facts["candidate_approval"].update(candidateExecutableSha256=candidate["executable_sha256"], compatibilityManifestSha256=candidate["manifest_sha256"])
        facts["migration_authorization"].update(candidateExecutableSha256=candidate["executable_sha256"])
        self.assertTrue(self.validate_facts(facts))
        with self.assertRaises(gate.GateBlocked):
            gate.make_release_receipt(facts, synthetic_fixture_root=self.root)
        self.assertFalse((self.root / "evidence" / "preflight-receipt.json").exists())
        self.assertFalse((self.root / "Library/Application Support" / gate.PRODUCTION_BUNDLE_ID / gate.PRODUCTION_MIGRATION_AUTHORIZATION).exists())

        nested_helper = neutral / "Contents/Helpers/Neutral Helper.app"
        self._make_app(nested_helper, "org.example.helper", with_manifest=False)
        found_with_helper = gate.inventory_production_apps([scan])
        self.assertEqual([item["bundle_path"] for item in found_with_helper], [str(production_candidate.resolve()), str(nested_production.resolve())])

    def test_nested_production_metadata_failure_blocks(self) -> None:
        outer = self.root / "nested-bad" / "Neutral.app" / "Contents/Helpers/Hidden.app" / "Contents"
        outer.mkdir(parents=True)
        (outer / "Info.plist").write_bytes(b"malformed hidden nested plist")
        with self.assertRaises(gate.GateBlocked):
            gate.inventory_production_apps([self.root / "nested-bad"])

    def test_walker_that_returns_no_root_entry_is_unknown(self) -> None:
        with self.assertRaises(gate.GateBlocked):
            gate.inventory_production_apps([self.app.parent], walk=lambda *_args, **_kwargs: iter(()))

    def test_process_inventory_uses_actual_path_and_blocks_inspector_failure(self) -> None:
        executable = self.app / "Contents/MacOS/personal-finance-console"
        def renamed_runner(command, **_kwargs):
            if command[0] == "/bin/ps": return subprocess.CompletedProcess(command, 0, "123 renamed --custom\n", "")
            return subprocess.CompletedProcess(command, 0, f"p123\nn{executable}\n", "")
        with patch.object(gate.sys, "platform", "darwin"):
            inventory = gate.inventory_production_processes(renamed_runner, [gate.read_bundle(self.app)])
        self.assertTrue(inventory["complete"])
        processes = inventory["processes"]
        self.assertEqual(processes[0]["pid"], 123)
        facts = self._safe_facts()
        facts["running_production_processes"] = processes
        facts["process_inventory"] = inventory
        self.assertTrue(self.validate_facts(facts))
        def denied_runner(command, **_kwargs):
            if command[0] == "/bin/ps": return subprocess.CompletedProcess(command, 0, "123 random\n", "")
            return subprocess.CompletedProcess(command, 1, "", "Permission denied")
        with patch.object(gate.sys, "platform", "darwin"):
            incomplete = gate.inventory_production_processes(denied_runner, [])
        self.assertFalse(incomplete["complete"])
        facts = self._safe_facts()
        facts["process_inventory"] = incomplete
        facts["process_inventory_complete"] = False
        facts["running_production_processes"] = None
        self.assertTrue(self.validate_facts(facts))

    def test_clean_process_inventory_is_known_empty(self) -> None:
        executable = self.root / "other-process"
        executable.write_text("fixture")
        def runner(command, **_kwargs):
            if command[0] == "/bin/ps": return subprocess.CompletedProcess(command, 0, "12 other-process other-process --service\n", "")
            return subprocess.CompletedProcess(command, 0, f"p12\nn{executable}\n", "")
        with patch.object(gate.sys, "platform", "darwin"):
            clean = gate.inventory_production_processes(runner)
        self.assertTrue(clean["complete"])
        self.assertEqual(clean["processes"], [])
        facts = self._safe_facts()
        facts["process_inventory"] = clean
        facts["running_production_processes"] = clean["processes"]
        self.assertEqual(self.validate_facts(facts), [])

    def _process_probe(self, ps_stdout: str, executable_fields: str, open_fields: str, known_apps=None):
        def runner(command, **_kwargs):
            if command[0] == "/bin/ps": return subprocess.CompletedProcess(command, 0, ps_stdout, "")
            if "-d" in command: return subprocess.CompletedProcess(command, 0, executable_fields, "")
            return subprocess.CompletedProcess(command, 0, open_fields, "")
        with patch.object(gate.sys, "platform", "darwin"):
            return gate.inventory_production_processes(runner, known_apps or [])

    def test_incomplete_process_snapshot_matrix_is_never_empty_success(self) -> None:
        cases = [
            ("empty ps", "", "", ""),
            ("blank process row", "\n", "", ""),
            ("malformed ps", "not-a-pid proc args\n", "", ""),
            ("missing fields", "123\n", "", ""),
            ("empty executable lsof", "123 proc args\n", "", "p123\nn/tmp/open\n"),
            ("malformed executable lsof", "123 proc args\n", "bad-field\n", "p123\nn/tmp/open\n"),
            ("empty open-file lsof", "123 proc args\n", "p123\nn/tmp/proc\n", ""),
            ("malformed open-file lsof", "123 proc args\n", "p123\nn/tmp/proc\n", "p123\nnot-a-path\n"),
            ("ambiguous executable", "123 proc args\n", "p123\nn/tmp/one\nn/tmp/two\n", "p123\nn/tmp/open\n"),
            ("nonexistent executable", "123 missing args\n", f"p123\nn{self.root / 'not-created'}\n", "p123\nn/tmp/open\n"),
        ]
        for label, ps, text_fds, open_fds in cases:
            with self.subTest(label=label):
                inventory = self._process_probe(ps, text_fds, open_fds)
                self.assertFalse(inventory["complete"])
                facts = self._safe_facts()
                facts["process_inventory"] = inventory
                facts["process_inventory_complete"] = inventory["complete"]
                facts["running_production_processes"] = inventory["processes"]
                self.assertTrue(self.validate_facts(facts))

    def test_process_snapshot_blocks_unknown_bundle_identity_and_malformed_fields(self) -> None:
        for label, bundle_id in (("missing", None), ("wrong-type", 9)):
            with self.subTest(label=label):
                app = self.root / f"unknown-id-{label}.app"
                executable = app / "Contents/MacOS/proc"
                executable.parent.mkdir(parents=True)
                executable.write_text("process")
                metadata = {"CFBundleExecutable": "proc"}
                if bundle_id is not None:
                    metadata["CFBundleIdentifier"] = bundle_id
                with (app / "Contents/Info.plist").open("wb") as stream:
                    plistlib.dump(metadata, stream)
                inventory = self._process_probe("123 proc args\n", f"p123\nn{executable}\n", f"p123\nn{executable}\n")
                self.assertFalse(inventory["complete"])

    def test_preflight_requires_process_inventory_completeness_contract(self) -> None:
        facts = self._safe_facts()
        facts["process_inventory"] = {"complete": False, "processes": None, "diagnostics": ["unknown"]}
        facts["process_inventory_complete"] = True
        facts["running_production_processes"] = []
        self.assertTrue(self.validate_facts(facts))

    def test_app_process_bundle_missing_or_nonstring_bundle_id_blocks(self) -> None:
        for label, info in (
            ("missing", {"CFBundleExecutable": "proc"}),
            ("wrong type", {"CFBundleIdentifier": 42, "CFBundleExecutable": "proc"}),
        ):
            with self.subTest(label=label):
                bundle = self.root / f"process-{label}.app"
                executable = bundle / "Contents/MacOS/proc"
                executable.parent.mkdir(parents=True)
                executable.write_text("synthetic process")
                with (bundle / "Contents/Info.plist").open("wb") as stream:
                    plistlib.dump(info, stream)
                inventory = self._process_probe("123 proc args\n", f"p123\nn{executable}\n", f"p123\nn{executable}\n")
                self.assertFalse(inventory["complete"])

    def test_precheck_failure_is_persisted_as_structured_blocked_receipt(self) -> None:
        auth = self.root / "runtime-replacement.json"
        auth.write_text(json.dumps({"status": "OWNER_AUTHORIZED_RUNTIME_REPLACEMENT", "authorizationId": "fixture"}), encoding="utf-8")
        runtime_data = self.root / "runtime-data"
        with patch.object(gate.sys, "platform", "darwin"), patch.object(gate, "APP_DATA", runtime_data), patch.object(gate, "inventory_production_apps", side_effect=gate.GateBlocked(["injected unreadable subtree"])):
            with self.assertRaises(gate.GateBlocked):
                gate.run_retirement(self.app, auth)
        receipt = next((runtime_data / "runtime-replacement-receipts").glob("precheck-blocked-*.json"))
        facts = json.loads(receipt.read_text(encoding="utf-8"))
        self.assertEqual(facts["status"], "PRECHECK_BLOCKED")
        self.assertFalse(facts["appInventoryComplete"])
        self.assertFalse(facts["processInventory"]["complete"])

    def test_malformed_candidate_metadata_persists_precheck_receipt(self) -> None:
        for defect in ("manifest-json", "plist", "null-auth-id"):
            with self.subTest(defect=defect):
                old, candidate, normal, old_executable, authorization = self._retirement_case(f"receipt-{defect}")
                if defect == "manifest-json":
                    self.manifest_path(candidate).write_text("{ malformed manifest", encoding="utf-8")
                elif defect == "plist":
                    (candidate / "Contents/Info.plist").write_bytes(b"malformed plist")
                else:
                    authorization["authorizationId"] = None
                authorization_path = self.root / f"{defect}-authorization.json"
                authorization_path.write_text(json.dumps(authorization), encoding="utf-8")
                runtime_data = self.root / f"runtime-data-{defect}"
                with patch.object(gate.sys, "platform", "darwin"), patch.object(gate, "APP_PATH", normal), patch.object(gate, "APP_DATA", runtime_data), patch.object(gate, "LEGACY_EXECUTABLE_SHA256", authorization["oldExecutableSha256"]), patch.object(gate, "inventory_production_apps", return_value=[gate.read_bundle(normal)]), patch.object(gate, "inventory_production_processes", return_value={"complete": True, "processes": [], "diagnostics": []}):
                    with self.assertRaises(gate.GateBlocked):
                        gate.run_retirement(candidate, authorization_path)
                receipt_path = next((runtime_data / "runtime-replacement-receipts").glob("precheck-blocked-*.json"))
                receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
                self.assertEqual(receipt["status"], "PRECHECK_BLOCKED")
                self.assertFalse(receipt["destructiveActionPerformed"])
                self.assertEqual(receipt["candidatePath"], str(candidate))
                self.assertEqual(receipt["oldAppPath"], str(normal))
                self.assertTrue(receipt["exceptionCategory"])
                self.assertTrue(receipt["exceptionMessage"])
                self.assertEqual(gate.sha256_file(normal / "Contents/MacOS" / gate.EXECUTABLE_NAME), gate.sha256_file(old_executable))

    def test_wal_sidecar_blocks_even_with_matching_main_file_backup(self) -> None:
        wal_root = self.root / "wal-fixture"
        db_path = wal_root / "Library/Application Support" / gate.PRODUCTION_BUNDLE_ID / gate.DATABASE_NAME
        db_path.parent.mkdir(parents=True)
        connection = sqlite3.connect(db_path)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA wal_autocheckpoint=0")
        connection.executescript("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES(1),(2),(3); PRAGMA user_version=3; CREATE TABLE wal_only(value TEXT);")
        connection.execute("INSERT INTO wal_only VALUES('committed in WAL')")
        connection.commit()
        backup = db_path.parent / "production-v4-backups" / gate.DATABASE_NAME
        backup.parent.mkdir(parents=True)
        shutil.copyfile(db_path, backup)
        self.assertEqual(gate.sha256_file(db_path), gate.sha256_file(backup))
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM wal_only").fetchone()[0], 1)
        facts = self._safe_facts()
        wal_app = wal_root / "Applications" / gate.APP_NAME
        wal_app.parent.mkdir(parents=True)
        shutil.copytree(self.app, wal_app)
        candidate = gate.read_bundle(wal_app)
        wal_facts = gate.inspect_database(db_path)
        self.assertIn(str(db_path) + "-wal", wal_facts["sidecars"])
        facts["expected_database_path"] = str(db_path.resolve())
        facts["expected_installed_app"] = str(wal_app.resolve())
        facts["candidate"] = candidate
        facts["production_apps"] = [candidate]
        facts["candidate_approval"].update(candidateExecutableSha256=candidate["executable_sha256"], compatibilityManifestSha256=candidate["manifest_sha256"])
        facts["production_database"] = wal_facts
        facts["backup"] = {"path": str(backup.resolve()), "exists": True, "sha256": gate.sha256_file(backup)}
        facts["migration_authorization"]["productionDbPreMigrationSha256"] = wal_facts["sha256"]
        facts["migration_authorization"]["backupPath"] = str(backup.resolve())
        facts["migration_authorization"]["candidateExecutableSha256"] = candidate["executable_sha256"]
        facts["sidecars_absent"] = False
        reasons = gate.validate_preflight(facts, synthetic_fixture_root=wal_root)
        self.assertTrue(any("sidecar" in reason.lower() for reason in reasons), reasons)
        with self.assertRaises(gate.GateBlocked):
            gate.make_release_receipt(facts, synthetic_fixture_root=wal_root)
        connection.close()

    def test_missing_authorization_id_equal_backup_path_and_wrong_executable_name_block(self) -> None:
        for invalid_id in (None, 1, [], {}, True, "", "   "):
            with self.subTest(invalid_id=invalid_id):
                self.assert_blocked(lambda facts, value=invalid_id: facts["migration_authorization"].update(authorizationId=value))
                self.assert_blocked(lambda facts, value=invalid_id: facts["candidate_approval"].update(authorizationId=value))
        self.assert_blocked(lambda facts: facts["backup"].update(path=facts["production_database"]["path"]))
        self.assert_blocked(lambda facts: facts["candidate"].update(executable_name="renamed-console"))
        outside = self.root / "outside" / gate.EXECUTABLE_NAME
        outside.parent.mkdir()
        outside.write_text("same-name wrong directory")
        self.assert_blocked(lambda facts: facts["candidate"].update(executable_path=str(outside)))
        wrong_directory = self.app / "Contents/Helpers" / gate.EXECUTABLE_NAME
        wrong_directory.parent.mkdir()
        wrong_directory.write_text("same-name wrong bundle directory")
        self.assert_blocked(lambda facts: facts["candidate"].update(executable_path=str(wrong_directory)))

    def test_read_bundle_rejects_executable_symlink_escaping_bundle(self) -> None:
        external = self.root / "external-executable"
        external.write_text("outside bundle")
        original = self.app / "Contents/MacOS" / gate.EXECUTABLE_NAME
        original.unlink()
        original.symlink_to(external)
        with self.assertRaises(ValueError):
            gate.read_bundle(self.app)

    def test_all_safe_facts_produce_pre_migration_receipt(self) -> None:
        facts = self._safe_facts()
        receipt = self.make_receipt(facts)
        self.assertEqual(receipt["status"], "PREFLIGHT_PASS_READY_FOR_SEPARATELY_AUTHORIZED_MIGRATION")
        self.assertEqual(receipt["candidateExecutableSha256"], facts["candidate"]["executable_sha256"])
        self.assertEqual(receipt["productionDatabasePreMigrationSha256"], facts["production_database"]["sha256"])
        self.assertEqual(receipt["productionSchema"], {"userVersion": 3, "migrationVersion": 3})

    def test_persistent_receipt_is_written_once_and_readable(self) -> None:
        receipt_path = self.root / "evidence/release-receipt.json"
        receipt = self.make_receipt(self._safe_facts())
        gate._persist_receipt(receipt_path, receipt, create=True)
        self.assertEqual(json.loads(receipt_path.read_text(encoding="utf-8")), receipt)
        with self.assertRaises(FileExistsError):
            gate._persist_receipt(receipt_path, receipt, create=True)

    def test_actual_run_gate_preflight_persists_receipt_without_permit_or_launch(self) -> None:
        facts = self._normal_entrypoint_facts()
        approval, authorization = self._write_entrypoint_inputs(facts, self.root)
        receipt_path = self.root / "actual-run-gate-preflight.json"
        with patch.object(gate.sys, "platform", "darwin"), patch.object(gate, "APP_PATH", self.app), patch.object(gate, "DATABASE_PATH", self.db), patch.object(gate, "APP_DATA", self.db.parent), patch.object(gate, "collect_real_facts", return_value=facts), patch.object(gate, "write_migration_permit") as permit_writer, patch.object(gate.subprocess, "Popen") as launcher:
            result = gate.run_gate("preflight", approval, authorization, receipt_path)
        self.assertEqual(result["status"], "PREFLIGHT_PASS_READY_FOR_SEPARATELY_AUTHORIZED_MIGRATION")
        persisted = json.loads(receipt_path.read_text(encoding="utf-8"))
        self.assertEqual(persisted["candidateExecutableSha256"], facts["candidate"]["executable_sha256"])
        self.assertEqual(persisted["productionDatabasePreMigrationSha256"], facts["production_database"]["sha256"])
        self.assertEqual(persisted["backupPath"], str(Path(facts["backup"]["path"]).resolve()))
        self.assertEqual(persisted["ownerAuthorizationId"], facts["migration_authorization"]["authorizationId"])
        self.assertFalse((self.root / "production-v4-migration-authorization.json").exists())
        permit_writer.assert_not_called()
        launcher.assert_not_called()

    def test_actual_run_gate_migrate_reaches_only_mocked_permit_and_launcher_boundary(self) -> None:
        facts = self._normal_entrypoint_facts()
        approval, authorization = self._write_entrypoint_inputs(facts, self.root)
        receipt_path = self.root / "actual-run-gate-migrate.json"
        permit_path = self.root / "isolated-migration-permit.json"
        order: list[str] = []
        def fake_permit(receipt, auth):
            order.append("permit")
            self.assertTrue(receipt_path.is_file())
            self.assertEqual(json.loads(receipt_path.read_text(encoding="utf-8"))["status"], "GATE_PASSED_MIGRATION_PERMITTED")
            self.assertEqual(auth["authorizationId"], facts["migration_authorization"]["authorizationId"])
            permit_path.write_text("synthetic permit", encoding="utf-8")
            return permit_path, "test-only-nonce"
        def fake_launch(command, **_kwargs):
            order.append("launch")
            self.assertEqual(Path(command[0]), Path(facts["candidate"]["executable_path"]))
            self.assertTrue(permit_path.is_file())
            return SimpleNamespace(pid=51515)
        with patch.object(gate.sys, "platform", "darwin"), patch.object(gate, "APP_PATH", self.app), patch.object(gate, "DATABASE_PATH", self.db), patch.object(gate, "APP_DATA", self.db.parent), patch.object(gate, "collect_real_facts", return_value=facts), patch.object(gate, "write_migration_permit", side_effect=fake_permit), patch.object(gate.subprocess, "Popen", side_effect=fake_launch):
            result = gate.run_gate("migrate", approval, authorization, receipt_path)
        self.assertEqual(order, ["permit", "launch"])
        self.assertEqual(result["status"], "GATE_PASSED_CANDIDATE_LAUNCHED_MIGRATION_PENDING")
        self.assertEqual(result["launchPid"], 51515)
        self.assertEqual(json.loads(receipt_path.read_text(encoding="utf-8"))["status"], "GATE_PASSED_CANDIDATE_LAUNCHED_MIGRATION_PENDING")

    def test_actual_run_gate_negative_preflight_matrix_blocks_in_gate_logic(self) -> None:
        cases = [
            ("nested-old-app", lambda f: f["production_apps"].append({**f["candidate"], "bundle_path": f["expected_installed_app"] + "/Contents/Helpers/Hidden.app"}), "exactly one Production-identity app"),
            ("incomplete-app-inventory", lambda f: f.update(app_inventory_complete=False), "inventory is incomplete"),
            ("incomplete-process-inventory", lambda f: (f.update(process_inventory_complete=False, running_production_processes=None), f["process_inventory"].update(complete=False, processes=None)), "process inventory is unknown"),
            ("invalid-candidate-identity", lambda f: f["candidate"].update(bundle_id="com.example.wrong"), "Candidate bundle ID"),
            ("wal-present", lambda f: (f["production_database"].update(sidecars=["fixture-wal"]), f.update(sidecars_absent=False)), "WAL/SHM/journal"),
            ("shm-present", lambda f: (f["production_database"].update(sidecars=["fixture-shm"]), f.update(sidecars_absent=False)), "WAL/SHM/journal"),
            ("journal-present", lambda f: (f["production_database"].update(sidecars=["fixture-journal"]), f.update(sidecars_absent=False)), "WAL/SHM/journal"),
            ("backup-missing", lambda f: f["backup"].update(exists=False), "backup is missing"),
            ("backup-mismatched", lambda f: f["backup"].update(sha256="stale-backup"), "backup hash does not match"),
            ("stale-db-approval", lambda f: f["migration_authorization"].update(productionDbPreMigrationSha256="stale-db"), "not bound to the verified Production pre-migration hash"),
        ]
        for name, mutate, reason in cases:
            with self.subTest(name=name):
                facts = self._normal_entrypoint_facts()
                mutate(facts)
                approval, authorization = self._write_entrypoint_inputs(facts, self.root / name)
                receipt_path = self.root / f"{name}-receipt.json"
                with patch.object(gate.sys, "platform", "darwin"), patch.object(gate, "APP_PATH", self.app), patch.object(gate, "DATABASE_PATH", self.db), patch.object(gate, "APP_DATA", self.db.parent), patch.object(gate, "collect_real_facts", return_value=facts), patch.object(gate, "write_migration_permit") as permit_writer, patch.object(gate.subprocess, "Popen") as launcher:
                    with self.assertRaises(gate.GateBlocked) as caught:
                        gate.run_gate("preflight", approval, authorization, receipt_path)
                self.assertIn(reason.lower(), str(caught.exception).lower())
                self.assertFalse(receipt_path.exists())
                permit_writer.assert_not_called()
                launcher.assert_not_called()

    def test_actual_run_gate_missing_authorization_file_blocks_before_receipt(self) -> None:
        facts = self._normal_entrypoint_facts()
        approval, _authorization = self._write_entrypoint_inputs(facts, self.root)
        missing_authorization = self.root / "missing-authorization.json"
        receipt_path = self.root / "missing-auth-receipt.json"
        with patch.object(gate.sys, "platform", "darwin"), patch.object(gate, "APP_PATH", self.app), patch.object(gate, "DATABASE_PATH", self.db), patch.object(gate, "APP_DATA", self.db.parent), patch.object(gate, "collect_real_facts") as collect, patch.object(gate, "write_migration_permit") as permit_writer, patch.object(gate.subprocess, "Popen") as launcher:
            with self.assertRaises(gate.GateBlocked) as caught:
                gate.run_gate("preflight", approval, missing_authorization, receipt_path)
        self.assertIn("authorization is missing or unreadable", str(caught.exception).lower())
        self.assertFalse(receipt_path.exists())
        collect.assert_not_called()
        permit_writer.assert_not_called()
        launcher.assert_not_called()

    def test_retirement_archives_disables_and_installs_candidate(self) -> None:
        old = self.root / "old" / gate.APP_NAME
        self._make_app(old, gate.PRODUCTION_BUNDLE_ID, with_manifest=False)
        old_executable = old / "Contents/MacOS/personal-finance-console"
        old_executable.write_bytes(b"legacy-v3-fixture")
        old_executable.chmod(0o755)
        candidate = self.root / "candidate" / gate.APP_NAME
        self._make_app(candidate, gate.PRODUCTION_BUNDLE_ID)
        normal = self.root / "install" / gate.APP_NAME
        shutil.copytree(old, normal)
        facts = [gate.read_bundle(normal)]
        result = gate.retirement_replace(
            normal, candidate, normal, self.root / "archive",
            {"status": "OWNER_AUTHORIZED_RUNTIME_REPLACEMENT", "authorizationId": "fixture-replacement-authorization", "oldExecutableSha256": gate.sha256_file(old_executable), "candidateExecutableSha256": gate.sha256_file(candidate / "Contents/MacOS/personal-finance-console"), "candidateManifestSha256": gate.sha256_file(self.manifest_path(candidate)), "candidateAppPath": str(candidate), "targetAppPath": str(normal), "oldAppPath": str(normal)},
            [], facts, expected_old_sha256=gate.sha256_file(old_executable),
        )
        archive_exe = Path(result["archivePath"]) / "Contents/MacOS/personal-finance-console"
        self.assertEqual(result["status"], "CANDIDATE_INSTALLED_AND_VERIFIED")
        self.assertFalse(archive_exe.stat().st_mode & 0o111)
        installed = gate.read_bundle(normal)
        self.assertEqual(installed["bundle_id"], gate.PRODUCTION_BUNDLE_ID)
        self.assertEqual(installed["executable_name"], gate.EXECUTABLE_NAME)
        self.assertEqual(installed["executable_path"], str(normal.resolve() / "Contents/MacOS" / gate.EXECUTABLE_NAME))
        self.assertEqual(installed["executable_sha256"], gate.sha256_file(candidate / "Contents/MacOS/personal-finance-console"))
        self.assertEqual(installed["manifest_sha256"], gate.sha256_file(self.manifest_path(candidate)))

    def test_retirement_failure_restores_old_app_and_executable_mode(self) -> None:
        old = self.root / "old" / gate.APP_NAME
        self._make_app(old, gate.PRODUCTION_BUNDLE_ID, with_manifest=False)
        old_executable = old / "Contents/MacOS/personal-finance-console"
        old_executable.write_bytes(b"legacy-v3-fixture")
        old_executable.chmod(0o755)
        candidate = self.root / "candidate" / gate.APP_NAME
        self._make_app(candidate, gate.PRODUCTION_BUNDLE_ID)
        normal = self.root / "install" / gate.APP_NAME
        shutil.copytree(old, normal)
        original_copytree = gate.shutil.copytree
        calls = 0
        def fail_candidate_copy(*args, **kwargs):
            nonlocal calls
            if Path(args[0]) == candidate:
                calls += 1
                raise OSError("synthetic candidate copy failure")
            return original_copytree(*args, **kwargs)
        with patch.object(gate.shutil, "copytree", side_effect=fail_candidate_copy):
            with self.assertRaises(gate.GateBlocked):
                gate.retirement_replace(
                    normal, candidate, normal, self.root / "archive",
                    {"status": "OWNER_AUTHORIZED_RUNTIME_REPLACEMENT", "authorizationId": "fixture-replacement-authorization", "oldExecutableSha256": gate.sha256_file(old_executable), "candidateExecutableSha256": gate.sha256_file(candidate / "Contents/MacOS/personal-finance-console"), "candidateManifestSha256": gate.sha256_file(self.manifest_path(candidate)), "candidateAppPath": str(candidate), "targetAppPath": str(normal), "oldAppPath": str(normal)},
                    [], [gate.read_bundle(normal)], expected_old_sha256=gate.sha256_file(old_executable),
                )
        restored = normal / "Contents/MacOS/personal-finance-console"
        self.assertEqual(gate.sha256_file(restored), gate.sha256_file(old_executable))
        self.assertTrue(restored.stat().st_mode & 0o111)
        receipt_path = next((self.root / "archive").glob("*/retirement-receipt.json"))
        self.assertEqual(json.loads(receipt_path.read_text(encoding="utf-8"))["status"], "ROLLBACK_COMPLETED")

    def _retirement_case(self, failure_point: str) -> tuple[Path, Path, Path, Path, dict]:
        old = self.root / f"old-{failure_point}" / gate.APP_NAME
        self._make_app(old, gate.PRODUCTION_BUNDLE_ID, with_manifest=False)
        old_executable = old / "Contents/MacOS/personal-finance-console"
        old_executable.write_bytes(b"legacy-v3-fixture")
        old_executable.chmod(0o755)
        candidate = self.root / f"candidate-{failure_point}" / gate.APP_NAME
        self._make_app(candidate, gate.PRODUCTION_BUNDLE_ID)
        normal = self.root / f"install-{failure_point}" / gate.APP_NAME
        shutil.copytree(old, normal)
        authorization = {
            "status": "OWNER_AUTHORIZED_RUNTIME_REPLACEMENT",
            "authorizationId": f"fixture-replacement-{failure_point}",
            "oldExecutableSha256": gate.sha256_file(old_executable),
            "candidateExecutableSha256": gate.sha256_file(candidate / "Contents/MacOS/personal-finance-console"),
            "candidateManifestSha256": gate.sha256_file(self.manifest_path(candidate)),
            "candidateAppPath": str(candidate), "targetAppPath": str(normal), "oldAppPath": str(normal),
        }
        return old, candidate, normal, old_executable, authorization

    def _assert_rollback(self, old: Path, normal: Path, old_executable: Path, archive_root: Path) -> None:
        restored = normal / "Contents/MacOS/personal-finance-console"
        self.assertEqual(gate.sha256_file(restored), gate.sha256_file(old_executable))
        self.assertEqual(stat.S_IMODE(restored.stat().st_mode), stat.S_IMODE(old_executable.stat().st_mode))
        self.assertEqual(gate.read_bundle(normal)["bundle_id"], gate.PRODUCTION_BUNDLE_ID)
        receipt_path = next(archive_root.glob("*/retirement-receipt.json"))
        self.assertEqual(json.loads(receipt_path.read_text(encoding="utf-8"))["status"], "ROLLBACK_COMPLETED")

    def test_postinstall_failures_each_restore_old_app(self) -> None:
        original_copytree = gate.shutil.copytree
        original_replace = gate.os.replace
        for failure_point in ("staged-hash", "installed-executable", "manifest-semantic", "manifest-byte-hash"):
            with self.subTest(failure_point=failure_point):
                old, candidate, normal, old_executable, authorization = self._retirement_case(failure_point)
                archive_root = self.root / f"archive-{failure_point}"
                if failure_point == "staged-hash":
                    def copytree(source, destination, *args, **kwargs):
                        result = original_copytree(source, destination, *args, **kwargs)
                        if Path(source) == candidate:
                            (Path(destination) / "Contents/MacOS/personal-finance-console").write_bytes(b"tampered staged binary")
                        return result
                    change = patch.object(gate.shutil, "copytree", side_effect=copytree)
                else:
                    def replace(source, destination):
                        result = original_replace(source, destination)
                        if Path(destination) == normal:
                            if failure_point == "installed-executable":
                                (normal / "Contents/MacOS/personal-finance-console").write_bytes(b"tampered installed binary")
                            else:
                                manifest = self.manifest_path(normal)
                                value = json.loads(manifest.read_text(encoding="utf-8"))
                                if failure_point == "manifest-semantic":
                                    value["maxSupportedSchemaVersion"] = 5
                                    manifest.write_text(json.dumps(value), encoding="utf-8")
                                else:
                                    manifest.write_bytes(manifest.read_bytes() + b" ")
                        return result
                    change = patch.object(gate.os, "replace", side_effect=replace)
                with change:
                    with self.assertRaises(gate.GateBlocked):
                        gate.retirement_replace(normal, candidate, normal, archive_root, authorization, [], [gate.read_bundle(normal)], expected_old_sha256=authorization["oldExecutableSha256"])
                self._assert_rollback(old, normal, old_executable, archive_root)
                restored = gate.read_bundle(normal)
                self.assertTrue(gate.validate_manifest(restored))
                restored = gate.read_bundle(normal)
                self.assertEqual(restored["bundle_id"], gate.PRODUCTION_BUNDLE_ID)
                self.assertEqual(restored["executable_sha256"], gate.sha256_file(old_executable))

    def test_source_manifest_byte_mismatch_rejects_before_removal(self) -> None:
        old, candidate, normal, old_executable, authorization = self._retirement_case("source-manifest")
        manifest = self.manifest_path(candidate)
        manifest.write_bytes(manifest.read_bytes() + b"\n")
        with self.assertRaises(gate.GateBlocked):
            gate.retirement_replace(normal, candidate, normal, self.root / "archive-source-manifest", authorization, [], [gate.read_bundle(normal)], expected_old_sha256=authorization["oldExecutableSha256"])
        self.assertEqual(gate.sha256_file(normal / "Contents/MacOS/personal-finance-console"), gate.sha256_file(old_executable))

    def test_installed_plist_identity_or_executable_mutation_rolls_back(self) -> None:
        original_replace = gate.os.replace
        for mutation in ("bundle-id", "executable-name", "symlink-escape", "manifest-correct-plist-wrong"):
            with self.subTest(mutation=mutation):
                old, candidate, normal, old_executable, authorization = self._retirement_case(mutation)
                archive_root = self.root / f"archive-{mutation}"
                outside_executable = self.root / f"outside-{mutation}" / gate.EXECUTABLE_NAME
                outside_executable.parent.mkdir(parents=True)
                outside_executable.write_text("outside executable")
                def mutate_after_install(source, destination):
                    result = original_replace(source, destination)
                    if Path(destination) == normal:
                        exe = normal / "Contents/MacOS" / gate.EXECUTABLE_NAME
                        if mutation == "symlink-escape":
                            exe.unlink()
                            exe.symlink_to(outside_executable)
                        else:
                            info_path = normal / "Contents/Info.plist"
                            with info_path.open("rb") as stream:
                                info = plistlib.load(stream)
                            if mutation in ("bundle-id", "manifest-correct-plist-wrong"):
                                info["CFBundleIdentifier"] = "com.independent.wrong"
                            elif mutation == "executable-name":
                                info["CFBundleExecutable"] = "renamed-executable"
                            with info_path.open("wb") as stream:
                                plistlib.dump(info, stream)
                    return result
                with patch.object(gate.os, "replace", side_effect=mutate_after_install):
                    with self.assertRaises(gate.GateBlocked):
                        gate.retirement_replace(normal, candidate, normal, archive_root, authorization, [], [gate.read_bundle(normal)], expected_old_sha256=authorization["oldExecutableSha256"])
                self._assert_rollback(old, normal, old_executable, archive_root)
                self.assertTrue(gate.validate_manifest(gate.read_bundle(normal)))

    def test_rollback_failure_is_hard_blocked_and_persisted(self) -> None:
        old, candidate, normal, old_executable, authorization = self._retirement_case("rollback-failure")
        archive_root = self.root / "archive-rollback-failure"
        original_copytree = gate.shutil.copytree
        def fail_candidate_and_recovery(source, destination, *args, **kwargs):
            if Path(source) == candidate:
                raise OSError("synthetic stage-copy failure")
            if str(destination).endswith(gate.APP_NAME) and Path(source).name.endswith(".retired"):
                raise OSError("synthetic rollback-copy failure")
            return original_copytree(source, destination, *args, **kwargs)
        with patch.object(gate.shutil, "copytree", side_effect=fail_candidate_and_recovery):
            with self.assertRaises(gate.GateBlocked) as blocked:
                gate.retirement_replace(normal, candidate, normal, archive_root, authorization, [], [gate.read_bundle(normal)], expected_old_sha256=authorization["oldExecutableSha256"])
        self.assertIn("rollback failed", str(blocked.exception).lower())
        receipt_path = next(archive_root.glob("*/retirement-receipt.json"))
        self.assertEqual(json.loads(receipt_path.read_text(encoding="utf-8"))["status"], "ROLLBACK_FAILED")
        self.assertTrue(Path(json.loads(receipt_path.read_text(encoding="utf-8"))["recoveryArchivePath"]).exists())


if __name__ == "__main__":
    unittest.main()
