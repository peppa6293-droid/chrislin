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
        self.db = self.root / gate.PRODUCTION_BUNDLE_ID / gate.DATABASE_NAME
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
        self.assertTrue(gate.validate_preflight(facts))

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

    def test_process_inventory_uses_actual_path_and_blocks_inspector_failure(self) -> None:
        executable = self.app / "Contents/MacOS/personal-finance-console"
        def renamed_runner(command, **_kwargs):
            if command[0] == "/bin/ps": return subprocess.CompletedProcess(command, 0, "123 renamed --custom\n", "")
            return subprocess.CompletedProcess(command, 0, f"p123\nn{executable}\n", "")
        with patch.object(gate.sys, "platform", "darwin"):
            processes = gate.inventory_production_processes(renamed_runner, [gate.read_bundle(self.app)])
        self.assertEqual(processes[0]["pid"], 123)
        facts = self._safe_facts()
        facts["running_production_processes"] = processes
        self.assertTrue(gate.validate_preflight(facts))
        def denied_runner(command, **_kwargs):
            if command[0] == "/bin/ps": return subprocess.CompletedProcess(command, 0, "123 random\n", "")
            return subprocess.CompletedProcess(command, 1, "", "Permission denied")
        with patch.object(gate.sys, "platform", "darwin"):
            with self.assertRaises(gate.GateBlocked):
                gate.inventory_production_processes(denied_runner, [])

    def test_clean_process_inventory_is_known_empty(self) -> None:
        executable = self.root / "other-process"
        executable.write_text("fixture")
        def runner(command, **_kwargs):
            if command[0] == "/bin/ps": return subprocess.CompletedProcess(command, 0, "12 other-process\n", "")
            return subprocess.CompletedProcess(command, 0, f"p12\nn{executable}\n", "")
        with patch.object(gate.sys, "platform", "darwin"):
            clean = gate.inventory_production_processes(runner)
        self.assertEqual(clean, [])
        facts = self._safe_facts()
        self.assertEqual(gate.validate_preflight(facts), [])

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

    def test_wal_sidecar_blocks_even_with_matching_main_file_backup(self) -> None:
        db_path = self.root / "wal.sqlite3"
        connection = sqlite3.connect(db_path)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA wal_autocheckpoint=0")
        connection.executescript("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES(1),(2),(3); PRAGMA user_version=3; CREATE TABLE wal_only(value TEXT);")
        connection.execute("INSERT INTO wal_only VALUES('committed in WAL')")
        connection.commit()
        backup = self.root / "wal-backup.sqlite3"
        shutil.copyfile(db_path, backup)
        self.assertEqual(gate.sha256_file(db_path), gate.sha256_file(backup))
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM wal_only").fetchone()[0], 1)
        facts = self._safe_facts()
        wal_facts = gate.inspect_database(db_path)
        self.assertIn(str(db_path) + "-wal", wal_facts["sidecars"])
        facts["expected_database_path"] = str(db_path.resolve())
        facts["production_database"] = wal_facts
        facts["backup"] = {"path": str(backup.resolve()), "exists": True, "sha256": gate.sha256_file(backup)}
        facts["migration_authorization"]["productionDbPreMigrationSha256"] = wal_facts["sha256"]
        facts["migration_authorization"]["backupPath"] = str(backup.resolve())
        facts["sidecars_absent"] = False
        reasons = gate.validate_preflight(facts)
        self.assertTrue(any("sidecar" in reason.lower() for reason in reasons), reasons)
        with self.assertRaises(gate.GateBlocked):
            gate.make_release_receipt(facts)
        connection.close()

    def test_missing_authorization_id_equal_backup_path_and_wrong_executable_name_block(self) -> None:
        self.assert_blocked(lambda facts: facts["migration_authorization"].update(authorizationId=""))
        self.assert_blocked(lambda facts: facts["candidate_approval"].update(authorizationId=""))
        self.assert_blocked(lambda facts: facts["backup"].update(path=facts["production_database"]["path"]))
        self.assert_blocked(lambda facts: facts["candidate"].update(executable_name="renamed-console"))

    def test_all_safe_facts_produce_pre_migration_receipt(self) -> None:
        facts = self._safe_facts()
        receipt = gate.make_release_receipt(facts)
        self.assertEqual(receipt["status"], "PREFLIGHT_PASS_READY_FOR_SEPARATELY_AUTHORIZED_MIGRATION")
        self.assertEqual(receipt["candidateExecutableSha256"], facts["candidate"]["executable_sha256"])
        self.assertEqual(receipt["productionDatabasePreMigrationSha256"], facts["production_database"]["sha256"])
        self.assertEqual(receipt["productionSchema"], {"userVersion": 3, "migrationVersion": 3})

    def test_persistent_receipt_is_written_once_and_readable(self) -> None:
        receipt_path = self.root / "evidence/release-receipt.json"
        receipt = gate.make_release_receipt(self._safe_facts())
        gate._persist_receipt(receipt_path, receipt, create=True)
        self.assertEqual(json.loads(receipt_path.read_text(encoding="utf-8")), receipt)
        with self.assertRaises(FileExistsError):
            gate._persist_receipt(receipt_path, receipt, create=True)

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
        self.assertEqual(gate.read_bundle(normal)["executable_sha256"], gate.sha256_file(candidate / "Contents/MacOS/personal-finance-console"))

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

    def test_source_manifest_byte_mismatch_rejects_before_removal(self) -> None:
        old, candidate, normal, old_executable, authorization = self._retirement_case("source-manifest")
        manifest = self.manifest_path(candidate)
        manifest.write_bytes(manifest.read_bytes() + b"\n")
        with self.assertRaises(gate.GateBlocked):
            gate.retirement_replace(normal, candidate, normal, self.root / "archive-source-manifest", authorization, [], [gate.read_bundle(normal)], expected_old_sha256=authorization["oldExecutableSha256"])
        self.assertEqual(gate.sha256_file(normal / "Contents/MacOS/personal-finance-console"), gate.sha256_file(old_executable))

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
