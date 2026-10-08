from __future__ import annotations

import importlib.util
import json
import plistlib
import shutil
import sqlite3
import sys
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
        self.db = self.root / "production.sqlite3"
        self.backup = self.root / "backups/production.sqlite3"
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
            "production_apps": [candidate],
            "candidate": candidate,
            "candidate_approval": {
                "status": "OWNER_APPROVED_V4_PRODUCTION_CANDIDATE",
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
            },
            "production_database": {
                "path": str(self.db.resolve()),
                "sha256": database_hash,
                "user_version": 3,
                "migration_version": 3,
                "integrity": ["ok"],
                "foreign_key_violations": [],
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
            {"status": "OWNER_AUTHORIZED_RUNTIME_REPLACEMENT", "authorizationId": "fixture-replacement-authorization", "oldExecutableSha256": gate.sha256_file(old_executable), "candidateExecutableSha256": gate.sha256_file(candidate / "Contents/MacOS/personal-finance-console"), "candidateAppPath": str(candidate), "targetAppPath": str(normal), "oldAppPath": str(normal)},
            [], facts, expected_old_sha256=gate.sha256_file(old_executable),
        )
        archive_exe = Path(result["archivePath"]) / "Contents/MacOS/personal-finance-console"
        self.assertEqual(result["status"], "LEGACY_ARCHIVED_CANDIDATE_INSTALLED")
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
            calls += 1
            if calls == 2:
                raise OSError("synthetic candidate copy failure")
            return original_copytree(*args, **kwargs)
        with patch.object(gate.shutil, "copytree", side_effect=fail_candidate_copy):
            with self.assertRaises(OSError):
                gate.retirement_replace(
                    normal, candidate, normal, self.root / "archive",
                    {"status": "OWNER_AUTHORIZED_RUNTIME_REPLACEMENT", "authorizationId": "fixture-replacement-authorization", "oldExecutableSha256": gate.sha256_file(old_executable), "candidateExecutableSha256": gate.sha256_file(candidate / "Contents/MacOS/personal-finance-console"), "candidateAppPath": str(candidate), "targetAppPath": str(normal), "oldAppPath": str(normal)},
                    [], [gate.read_bundle(normal)], expected_old_sha256=gate.sha256_file(old_executable),
                )
        restored = normal / "Contents/MacOS/personal-finance-console"
        self.assertEqual(gate.sha256_file(restored), gate.sha256_file(old_executable))
        self.assertTrue(restored.stat().st_mode & 0o111)


if __name__ == "__main__":
    unittest.main()
