from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
import plistlib
import shutil
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

MODULE_PATH = Path(__file__).with_name("production_v8_release_gate.py")
SPEC = importlib.util.spec_from_file_location("production_v8_release_gate", MODULE_PATH)
gate = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = gate
SPEC.loader.exec_module(gate)


class V8ReleaseGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="pfc-v8-gate-")
        self.root = Path(self.temporary.name).resolve()
        (self.root / "SYNTHETIC_ONLY").write_bytes(gate.SYNTHETIC_GATE_MARKER)
        self.app = self.root / "Applications" / gate.APP_NAME
        self.executable = self.app / "Contents/MacOS" / gate.EXECUTABLE_NAME
        self.manifest_path = self.app / gate.MANIFEST_RELATIVE_PATH
        self._make_app()
        self.app_data = self.root / "Library/Application Support" / gate.PRODUCTION_BUNDLE_ID
        self.db = self.app_data / gate.DATABASE_NAME
        self.backup = self.app_data / gate.BACKUP_DIRECTORY / gate.DATABASE_NAME
        self.backup.parent.mkdir(parents=True)
        with sqlite3.connect(self.db) as connection:
            connection.executescript(
                "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);"
                "INSERT INTO schema_migrations VALUES(1),(2),(3);"
                "PRAGMA user_version=3;"
            )
        shutil.copyfile(self.db, self.backup)
        self.pre_database_sha256 = gate.sha256_file(self.db)
        self.approval_path = self.root / "authorization" / "candidate-approval.json"
        self.authorization_path = self.root / "authorization" / "migration-authorization.json"
        self.approval = {
            "status": gate.APPROVAL_STATUS,
            "syntheticOnly": True,
            "authorizationId": "owner-approval-v8-1",
            "candidateExecutableSha256": gate.sha256_file(self.executable),
            "candidateInfoPlistPath": str(self.app / "Contents/Info.plist"),
            "candidateInfoPlistSha256": gate.sha256_file(self.app / "Contents/Info.plist"),
            "compatibilityManifestSha256": gate.sha256_file(self.manifest_path),
            "bundleId": gate.PRODUCTION_BUNDLE_ID,
            "maxSupportedSchemaVersion": 8,
            "migrationSourceSchemaVersion": 3,
        }
        self.authorization = {
            "status": gate.AUTHORIZATION_STATUS,
            "syntheticOnly": True,
            "authorizationId": "owner-auth-request-v8-1",
            "ownerAuthorizationId": self.approval["authorizationId"],
            "candidateExecutableSha256": gate.sha256_file(self.executable),
            "candidateInfoPlistPath": str(self.app / "Contents/Info.plist"),
            "candidateInfoPlistSha256": gate.sha256_file(self.app / "Contents/Info.plist"),
            "compatibilityManifestSha256": gate.sha256_file(self.manifest_path),
            "productionDbPreMigrationSha256": self.pre_database_sha256,
            "backupPath": str(self.backup.resolve()),
            "productionBundleId": gate.PRODUCTION_BUNDLE_ID,
            "sourceSchemaVersion": 3,
            "targetSchemaVersion": 8,
        }
        self._write_json(self.approval_path, self.approval)
        self._write_json(self.authorization_path, self.authorization)
        self.facts = self.collect()
        self.receipt_path = self.app_data / gate.RELEASE_RECEIPT_NAME
        self.permit_path = self.app_data / gate.AUTHORIZATION_NAME
        self.terminal_path = self.app_data / gate.TERMINAL_NAME
        self.ledger_path = self.app_data / gate.CONSUMED_LEDGER_NAME

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _make_app(self) -> None:
        self.executable.parent.mkdir(parents=True, exist_ok=True)
        self.executable.write_bytes(b"fixture-v8-production-executable")
        self.executable.chmod(0o755)
        with (self.app / "Contents/Info.plist").open("wb") as stream:
            plistlib.dump(
                {
                    "CFBundleIdentifier": gate.PRODUCTION_BUNDLE_ID,
                    "CFBundleExecutable": gate.EXECUTABLE_NAME,
                    "CFBundleShortVersionString": "8.0.0",
                },
                stream,
            )
        self.manifest_path.parent.mkdir(parents=True, exist_ok=True)
        self._write_json(self.manifest_path, gate.REQUIRED_MANIFEST)

    @staticmethod
    def _write_json(path: Path, value: object) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        path.chmod(0o600)

    def collect(self) -> dict:
        return gate.collect_synthetic_facts(self.root, self.approval_path, self.authorization_path)

    def validate(self, facts: dict | None = None) -> list[str]:
        return gate.validate_preflight(facts or self.facts, synthetic_fixture_root=self.root)

    def assert_blocked(self, facts: dict | None = None, needle: str | None = None) -> list[str]:
        errors = self.validate(facts)
        self.assertTrue(errors, "expected the V8 gate to refuse")
        if needle:
            self.assertTrue(any(needle.lower() in error.lower() for error in errors), errors)
        return errors

    def make_receipt(self, facts: dict | None = None) -> dict:
        return gate.make_release_receipt(
            facts or self.facts,
            receipt_path=self.receipt_path,
            synthetic_fixture_root=self.root,
        )

    def persist_receipt(self) -> tuple[dict, bytes]:
        receipt = self.make_receipt()
        gate._persist_json_create(self.receipt_path, receipt)
        receipt_bytes = self.receipt_path.read_bytes()
        receipt["releaseReceiptSha256"] = hashlib.sha256(receipt_bytes).hexdigest()
        return receipt, receipt_bytes

    def write_permit(self) -> tuple[dict, bytes]:
        receipt, _ = self.persist_receipt()
        path, nonce = gate.write_migration_permit(
            receipt,
            self.approval,
            self.authorization,
            self.permit_path,
            synthetic_fixture_root=self.root,
        )
        self.assertEqual(path, self.permit_path)
        permit = json.loads(self.permit_path.read_text(encoding="utf-8"))
        self.assertEqual(permit["nonce"], nonce)
        return permit, self.permit_path.read_bytes()

    def migrate_fixture(self) -> dict:
        permit, _ = self.write_permit()
        self.permit_path.unlink()
        with sqlite3.connect(self.db) as connection:
            connection.executescript(
                "INSERT INTO schema_migrations VALUES(4),(5),(6),(7),(8);"
                "PRAGMA user_version=8;"
            )
        post_sha256 = gate.sha256_file(self.db)
        database_metadata = self.db.stat()
        backup_metadata = self.backup.stat()
        receipt_bytes = self.receipt_path.read_bytes()
        ledger = [
            {
                "authorizationId": permit["ownerAuthorizationId"],
                "nonce": permit["nonce"],
                "consumedAtUnix": permit["issuedAtUnix"],
                "candidateExecutableSha256": self.facts["candidate"]["executable_sha256"],
                "compatibilityManifestSha256": self.facts["candidate"]["manifest_sha256"],
            }
        ]
        self._write_json(self.ledger_path, ledger)
        ledger_bytes = self.ledger_path.read_bytes()
        terminal = {
            "formatVersion": 2,
            "domain": "PRODUCTION",
            "syntheticOnly": True,
            "state": "V8_VERIFIED",
            "authorizationId": permit["ownerAuthorizationId"],
            "nonce": permit["nonce"],
            "consumedAtUnix": permit["issuedAtUnix"],
            "migrationAuthorizationSha256": self.facts["migration_authorization_sha256"],
            "migrationAuthorizationContractSha256": self.facts["migration_authorization_sha256"],
            "releaseReceiptPath": str(self.receipt_path),
            "releaseReceiptSha256": hashlib.sha256(receipt_bytes).hexdigest(),
            "consumedLedgerPath": str(self.ledger_path),
            "consumedLedgerSha256": hashlib.sha256(ledger_bytes).hexdigest(),
            "candidateExecutablePath": self.facts["candidate"]["executable_path"],
            "candidateExecutableSha256": self.facts["candidate"]["executable_sha256"],
            "candidateInfoPlistPath": self.facts["candidate"]["info_plist_path"],
            "candidateInfoPlistSha256": self.facts["candidate"]["info_plist_sha256"],
            "compatibilityManifestPath": self.facts["candidate"]["manifest_path"],
            "compatibilityManifestSha256": self.facts["candidate"]["manifest_sha256"],
            "databasePath": self.facts["production_database"]["path"],
            "databaseDevice": database_metadata.st_dev,
            "databaseInode": database_metadata.st_ino,
            "databasePreMigrationSha256": self.pre_database_sha256,
            "databasePostMigrationSha256": post_sha256,
            "backupPath": str(self.backup.resolve()),
            "backupDevice": backup_metadata.st_dev,
            "backupInode": backup_metadata.st_ino,
            "backupSha256": self.pre_database_sha256,
            "sourceUserVersion": 3,
            "sourceMigrationVersion": 3,
            "targetUserVersion": 8,
            "targetMigrationVersion": 8,
            "migrationRows": list(range(1, 9)),
            "migrationRowCount": 8,
            "integrityCheck": "ok",
            "foreignKeyViolationCount": 0,
            "sidecarsAbsent": True,
        }
        self._write_json(self.terminal_path, terminal)
        return {
            "event": "gate_permit_consumed",
            "status": gate.NATIVE_SUCCESS,
            "syntheticOnly": True,
            "terminalSha256": hashlib.sha256(self.terminal_path.read_bytes()).hexdigest(),
            "databaseSha256": post_sha256,
            "schema": {
                "userVersion": 8,
                "migrationVersion": 8,
                "migrationRows": list(range(1, 9)),
                "migrationRowCount": 8,
            },
        }

    def test_preflight_accepts_only_exact_v8_contract_and_persists_receipt(self) -> None:
        self.assertEqual(self.validate(), [])
        receipt, bytes_read = self.persist_receipt()
        self.assertEqual(receipt["status"], gate.PREFLIGHT_STATUS)
        self.assertTrue(receipt["sidecarsAbsent"])
        self.assertEqual(json.loads(bytes_read)["productionSchema"], {"userVersion": 3, "migrationVersion": 3})
        self.assertEqual(json.loads(bytes_read)["maxSupportedSchemaVersion"], 8)
        self.assertEqual(bytes_read and json.loads(bytes_read)["candidateInfoPlistPath"], str(self.app / "Contents/Info.plist"))

    def _rewrite_info_plist(self, **changes: object) -> None:
        info_path = self.app / "Contents/Info.plist"
        with info_path.open("rb") as stream:
            info = plistlib.load(stream)
        info.update(changes)
        with info_path.open("wb") as stream:
            plistlib.dump(info, stream)

    def test_info_plist_content_change_with_identical_identity_is_rejected(self) -> None:
        self.assertEqual(self.validate(), [])
        self._rewrite_info_plist(CFBundleShortVersionString="8.0.1")
        self.assert_blocked(needle="info")
        with self.assertRaises(gate.GateBlocked):
            self.persist_receipt()
        self.assertFalse(self.receipt_path.exists())
        self.assertFalse(self.permit_path.exists())

    def test_info_plist_bindings_are_required_in_approval_and_authorization(self) -> None:
        facts = copy.deepcopy(self.facts)
        del facts["candidate_approval"]["candidateInfoPlistSha256"]
        self.assert_blocked(facts, needle="info")
        facts = copy.deepcopy(self.facts)
        facts["candidate_approval"]["candidateInfoPlistSha256"] = "not-a-sha"
        self.assert_blocked(facts, needle="info")
        facts = copy.deepcopy(self.facts)
        facts["candidate_approval"]["candidateInfoPlistPath"] = str(self.app / "Contents/Other.plist")
        self.assert_blocked(facts, needle="info")
        facts = copy.deepcopy(self.facts)
        del facts["migration_authorization"]["candidateInfoPlistSha256"]
        self.assert_blocked(facts, needle="info")
        facts = copy.deepcopy(self.facts)
        facts["migration_authorization"]["candidateInfoPlistSha256"] = "0" * 64
        self.assert_blocked(facts, needle="info")
        facts = copy.deepcopy(self.facts)
        facts["migration_authorization"]["candidateInfoPlistPath"] = str(self.app / "Contents/Other.plist")
        self.assert_blocked(facts, needle="info")

    def test_info_plist_change_after_migration_blocks_completed_verification(self) -> None:
        native = self.migrate_fixture()
        self.assertEqual(
            gate.verify_completed_migration(self.facts, native, synthetic_fixture_root=self.root)["status"],
            "V8_RELEASE_GATE_VERIFIED",
        )
        self._rewrite_info_plist(CFBundleShortVersionString="8.0.9")
        with self.assertRaises(gate.GateBlocked) as raised:
            gate.verify_completed_migration(self.facts, native, synthetic_fixture_root=self.root)
        self.assertTrue(any("info_plist" in error.lower() for error in raised.exception.reasons), raised.exception.reasons)

    def test_info_plist_replacement_after_open_is_rejected_by_the_same_descriptor_read(self) -> None:
        info_path = self.app / "Contents/Info.plist"
        replacement = self.app / "Contents/Info.replacement"
        replacement.write_bytes(info_path.read_bytes())
        real_fstat = os.fstat
        calls = {"count": 0}

        def racing_fstat(descriptor: int) -> os.stat_result:
            result = real_fstat(descriptor)
            calls["count"] += 1
            if calls["count"] == 2:
                os.replace(replacement, info_path)
            return result

        with mock.patch.object(gate.os, "fstat", side_effect=racing_fstat):
            with self.assertRaises(gate.GateBlocked) as raised:
                gate.read_bundle(self.app)
        self.assertTrue(
            any("changed while being read" in error for error in raised.exception.reasons),
            raised.exception.reasons,
        )

    def test_info_plist_symlink_is_rejected(self) -> None:
        info_path = self.app / "Contents/Info.plist"
        target = self.app / "Contents/Info.real.plist"
        os.replace(info_path, target)
        os.symlink(target, info_path)
        with self.assertRaises(gate.GateBlocked) as raised:
            gate.read_bundle(self.app)
        self.assertTrue(
            any("Info.plist" in error for error in raised.exception.reasons),
            raised.exception.reasons,
        )

    def test_info_plist_hard_link_is_rejected(self) -> None:
        info_path = self.app / "Contents/Info.plist"
        target = self.app / "Contents/Info.hardlink.plist"
        target.write_bytes(info_path.read_bytes())
        info_path.unlink()
        os.link(target, info_path)
        self.assertEqual(info_path.stat().st_nlink, 2)
        with self.assertRaises(gate.GateBlocked) as raised:
            gate.read_bundle(self.app)
        self.assertTrue(
            any("hard link" in error for error in raised.exception.reasons),
            raised.exception.reasons,
        )

    def test_permit_is_create_only_one_time_and_bound_to_receipt(self) -> None:
        permit, _ = self.write_permit()
        self.assertEqual(permit["status"], gate.PERMIT_STATUS)
        self.assertEqual(permit["ownerAuthorizationId"], self.approval["authorizationId"])
        self.assertEqual(gate.validate_permit(permit), [])
        with self.assertRaises(gate.GateBlocked):
            gate.write_migration_permit(
                permit, self.approval, self.authorization, self.permit_path,
                synthetic_fixture_root=self.root,
            )

    def test_completed_migration_requires_terminal_ledger_and_exact_restart_readback(self) -> None:
        native = self.migrate_fixture()
        result = gate.verify_completed_migration(self.facts, native, synthetic_fixture_root=self.root)
        self.assertEqual(result["status"], "V8_RELEASE_GATE_VERIFIED")
        self.assertEqual(result["schema"]["migrationRows"], list(range(1, 9)))
        self.assertEqual(result["databaseSha256"], gate.sha256_file(self.db))

    def test_post_migration_candidate_executable_replacement_is_rejected(self) -> None:
        native = self.migrate_fixture()
        original_sha256 = self.facts["candidate"]["executable_sha256"]
        self.executable.write_bytes(b"replaced-v8-production-executable")
        self.executable.chmod(0o755)
        self.assertNotEqual(gate.sha256_file(self.executable), original_sha256)
        with self.assertRaises(gate.GateBlocked) as raised:
            gate.verify_completed_migration(self.facts, native, synthetic_fixture_root=self.root)
        self.assertTrue(any("candidate facts disagree" in error for error in raised.exception.reasons), raised.exception.reasons)
        self.assertFalse(self.permit_path.exists())

    def test_post_migration_manifest_modification_is_rejected(self) -> None:
        native = self.migrate_fixture()
        manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        manifest["tamperedAfterMigration"] = True
        self._write_json(self.manifest_path, manifest)
        with self.assertRaises(gate.GateBlocked) as raised:
            gate.verify_completed_migration(self.facts, native, synthetic_fixture_root=self.root)
        self.assertTrue(any("candidate facts disagree" in error for error in raised.exception.reasons), raised.exception.reasons)
        self.assertFalse(self.permit_path.exists())

    def test_post_migration_backup_replacement_is_rejected(self) -> None:
        native = self.migrate_fixture()
        before = self.backup.stat()
        replacement = self.backup.parent / "backup-replacement.tmp"
        replacement.write_bytes(self.backup.read_bytes())
        replacement.chmod(self.backup.stat().st_mode & 0o777)
        os.replace(replacement, self.backup)
        after = self.backup.stat()
        self.assertNotEqual((before.st_dev, before.st_ino), (after.st_dev, after.st_ino))
        self.assertEqual(gate.sha256_file(self.backup), self.pre_database_sha256)
        with self.assertRaises(gate.GateBlocked) as raised:
            gate.verify_completed_migration(self.facts, native, synthetic_fixture_root=self.root)
        self.assertTrue(any("backup facts disagree" in error for error in raised.exception.reasons), raised.exception.reasons)
        self.assertFalse(self.permit_path.exists())

    def test_post_migration_backup_modification_is_rejected(self) -> None:
        native = self.migrate_fixture()
        with self.backup.open("ab") as stream:
            stream.write(b"tampered-after-migration")
        with self.assertRaises(gate.GateBlocked) as raised:
            gate.verify_completed_migration(self.facts, native, synthetic_fixture_root=self.root)
        self.assertTrue(any("backup" in error.lower() for error in raised.exception.reasons), raised.exception.reasons)
        self.assertFalse(self.permit_path.exists())

    def test_post_migration_backup_parent_symlink_is_rejected_even_when_it_points_back(self) -> None:
        native = self.migrate_fixture()
        real_directory = self.backup.parent
        displaced = real_directory.with_name("production-v8-backups-displaced")
        os.rename(real_directory, displaced)
        os.symlink(displaced, real_directory)
        try:
            with self.assertRaises(gate.GateBlocked) as raised:
                gate.verify_completed_migration(self.facts, native, synthetic_fixture_root=self.root)
        finally:
            os.remove(real_directory)
            os.rename(displaced, real_directory)
        self.assertTrue(
            any("alias" in error or "canonical" in error for error in raised.exception.reasons),
            raised.exception.reasons,
        )
        self.assertFalse(self.permit_path.exists())
        self.assertEqual(
            gate.verify_completed_migration(self.facts, native, synthetic_fixture_root=self.root)["status"],
            "V8_RELEASE_GATE_VERIFIED",
        )

    def test_native_terminal_sha256_is_required_and_bound_to_exact_bytes(self) -> None:
        native = self.migrate_fixture()
        original = self.terminal_path.read_bytes()
        # This field is not otherwise interpreted by validate_terminal; the exact
        # raw-byte binding through native_result.terminalSha256 must catch it.
        terminal = json.loads(original)
        terminal["migrationAuthorizationSha256"] = "0" * 64
        self._write_json(self.terminal_path, terminal)
        with self.assertRaises(gate.GateBlocked) as raised:
            gate.verify_completed_migration(self.facts, native, synthetic_fixture_root=self.root)
        self.assertTrue(any("terminalSha256" in error for error in raised.exception.reasons), raised.exception.reasons)
        self.terminal_path.write_bytes(original)
        self.assertEqual(
            gate.verify_completed_migration(self.facts, native, synthetic_fixture_root=self.root)["status"],
            "V8_RELEASE_GATE_VERIFIED",
        )
        for label, operation in (
            ("missing", lambda result: result.pop("terminalSha256")),
            ("null", lambda result: result.__setitem__("terminalSha256", None)),
            ("malformed", lambda result: result.__setitem__("terminalSha256", "not-a-sha256")),
            ("wrong", lambda result: result.__setitem__("terminalSha256", "a" * 64)),
        ):
            with self.subTest(label=label):
                candidate = copy.deepcopy(native)
                operation(candidate)
                with self.assertRaises(gate.GateBlocked) as raised:
                    gate.verify_completed_migration(self.facts, candidate, synthetic_fixture_root=self.root)
                self.assertTrue(any("terminalSha256" in error for error in raised.exception.reasons), raised.exception.reasons)

    def test_native_database_sha256_is_required_and_matches_disk(self) -> None:
        native = self.migrate_fixture()
        self.assertEqual(
            gate.verify_completed_migration(self.facts, native, synthetic_fixture_root=self.root)["status"],
            "V8_RELEASE_GATE_VERIFIED",
        )
        for label, operation in (
            ("missing", lambda result: result.pop("databaseSha256")),
            ("null", lambda result: result.__setitem__("databaseSha256", None)),
            ("malformed", lambda result: result.__setitem__("databaseSha256", "xyz")),
            ("disk-mismatch", lambda result: result.__setitem__("databaseSha256", "a" * 64)),
        ):
            with self.subTest(label=label):
                candidate = copy.deepcopy(native)
                operation(candidate)
                with self.assertRaises(gate.GateBlocked) as raised:
                    gate.verify_completed_migration(self.facts, candidate, synthetic_fixture_root=self.root)
                self.assertTrue(any("database" in error.lower() for error in raised.exception.reasons), raised.exception.reasons)

    def test_terminal_post_migration_hash_must_equal_native_database_sha256(self) -> None:
        native = self.migrate_fixture()
        terminal = json.loads(self.terminal_path.read_text(encoding="utf-8"))
        terminal["databasePostMigrationSha256"] = "a" * 64
        self._write_json(self.terminal_path, terminal)
        native["terminalSha256"] = hashlib.sha256(self.terminal_path.read_bytes()).hexdigest()
        with self.assertRaises(gate.GateBlocked) as raised:
            gate.verify_completed_migration(self.facts, native, synthetic_fixture_root=self.root)
        self.assertTrue(any("post-migration" in error.lower() for error in raised.exception.reasons), raised.exception.reasons)

    def test_future_schema_version_is_rejected(self) -> None:
        with sqlite3.connect(self.db) as connection:
            connection.executescript("INSERT INTO schema_migrations VALUES(4); PRAGMA user_version=9;")
        self.assert_blocked(self.collect(), needle="schema")

    def test_user_version_and_migration_version_mismatch_is_rejected(self) -> None:
        with sqlite3.connect(self.db) as connection:
            connection.executescript("INSERT INTO schema_migrations VALUES(4); PRAGMA user_version=8;")
        self.assert_blocked(self.collect(), needle="schema")

    def test_v4_manifest_cannot_authorize_v8(self) -> None:
        facts = copy.deepcopy(self.facts)
        facts["candidate"]["manifest"]["runtimeGeneration"] = 4
        self.assert_blocked(facts, needle="manifest")

    def test_wrong_bundle_id_is_rejected(self) -> None:
        facts = copy.deepcopy(self.facts)
        facts["candidate"]["bundle_id"] = "com.example.other"
        self.assert_blocked(facts, needle="bundle")

    def test_known_legacy_executable_is_rejected(self) -> None:
        facts = copy.deepcopy(self.facts)
        facts["candidate"]["executable_sha256"] = gate.LEGACY_V4_EXECUTABLE_SHA256
        self.assert_blocked(facts, needle="legacy")

    def test_missing_manifest_is_rejected(self) -> None:
        facts = copy.deepcopy(self.facts)
        facts["candidate"]["manifest"] = None
        self.assert_blocked(facts, needle="manifest")

    def test_backup_hash_mismatch_is_rejected(self) -> None:
        facts = copy.deepcopy(self.facts)
        facts["backup"]["sha256"] = "0" * 64
        self.assert_blocked(facts, needle="backup")

    def test_backup_path_escape_is_rejected(self) -> None:
        facts = copy.deepcopy(self.facts)
        facts["backup"]["path"] = str(self.root / "outside.sqlite3")
        facts["migration_authorization"]["backupPath"] = str(self.root / "outside.sqlite3")
        self.assert_blocked(facts, needle="backup")

    def test_backup_device_or_inode_mismatch_is_rejected(self) -> None:
        facts = copy.deepcopy(self.facts)
        facts["backup"]["inode"] += 1
        self.assert_blocked(facts, needle="backup")
        facts = copy.deepcopy(self.facts)
        facts["backup"]["device"] += 1
        self.assert_blocked(facts, needle="backup")

    def test_sqlite_sidecar_is_rejected(self) -> None:
        Path(str(self.db) + "-wal").write_bytes(b"not-a-real-wal")
        self.assert_blocked(needle="sidecar")

    def test_historical_v4_permit_or_terminal_is_block_only(self) -> None:
        facts = copy.deepcopy(self.facts)
        facts["legacy_authorization_present"] = True
        self.assert_blocked(facts, needle="v4")
        facts = copy.deepcopy(self.facts)
        facts["legacy_terminal"] = {"state": "V4_VERIFIED"}
        self.assert_blocked(facts, needle="v4")

    def test_expired_and_future_dated_permits_are_rejected(self) -> None:
        valid = {
            "receiptFormatVersion": 2,
            "status": gate.PERMIT_STATUS,
            "syntheticOnly": True,
            "nonce": "nonce",
            "issuedAtUnix": 1000,
            "expiresAtUnix": 1120,
            "ownerAuthorizationId": "owner-1",
            "productionBundleId": gate.PRODUCTION_BUNDLE_ID,
            "installedAppPath": "/tmp/app",
            "candidateExecutablePath": "/tmp/app/Contents/MacOS/exe",
            "candidateExecutableSha256": "a" * 64,
            "candidateInfoPlistPath": "/tmp/app/Contents/Info.plist",
            "candidateInfoPlistSha256": "b" * 64,
            "compatibilityManifestSha256": "b" * 64,
            "productionDatabasePath": "/tmp/db.sqlite3",
            "productionDatabasePreMigrationSha256": "c" * 64,
            "backupPath": "/tmp/backup.sqlite3",
            "backupSha256": "c" * 64,
            "releaseReceiptPath": "/tmp/receipt.json",
            "releaseReceiptSha256": "d" * 64,
            "candidateApprovalSha256": "e" * 64,
            "migrationAuthorizationSha256": "f" * 64,
            "maxSupportedSchemaVersion": 8,
            "sidecarsAbsent": True,
            "productionSchema": {"userVersion": 3, "migrationVersion": 3},
        }
        self.assertEqual(gate.validate_permit(valid, now=1100), [])
        self.assertTrue(any("expired" in error for error in gate.validate_permit(valid, now=1121)))
        self.assertTrue(any("future" in error for error in gate.validate_permit(valid, now=999)))

    def test_duplicate_authorization_and_nonce_in_ledger_are_rejected(self) -> None:
        native = self.migrate_fixture()
        ledger = json.loads(self.ledger_path.read_text(encoding="utf-8"))
        self._write_json(self.ledger_path, ledger + [copy.deepcopy(ledger[0])])
        with self.assertRaises(gate.GateBlocked) as raised:
            gate.verify_completed_migration(self.facts, native, synthetic_fixture_root=self.root)
        self.assertTrue(any("ledger" in error.lower() or "duplicate" in error.lower() for error in raised.exception.reasons))

    def test_terminal_missing_is_rejected(self) -> None:
        native = self.migrate_fixture()
        self.terminal_path.unlink()
        with self.assertRaises(gate.GateBlocked) as raised:
            gate.verify_completed_migration(self.facts, native, synthetic_fixture_root=self.root)
        self.assertTrue(any("terminal" in error.lower() for error in raised.exception.reasons))

    def test_terminal_tamper_is_rejected(self) -> None:
        native = self.migrate_fixture()
        terminal = json.loads(self.terminal_path.read_text(encoding="utf-8"))
        terminal["state"] = "V4_VERIFIED"
        self._write_json(self.terminal_path, terminal)
        with self.assertRaises(gate.GateBlocked) as raised:
            gate.verify_completed_migration(self.facts, native, synthetic_fixture_root=self.root)
        self.assertTrue(any("terminal" in error.lower() for error in raised.exception.reasons))

    def test_ledger_missing_is_rejected(self) -> None:
        native = self.migrate_fixture()
        self.ledger_path.unlink()
        with self.assertRaises(gate.GateBlocked) as raised:
            gate.verify_completed_migration(self.facts, native, synthetic_fixture_root=self.root)
        self.assertTrue(any("ledger" in error.lower() for error in raised.exception.reasons))

    def test_ledger_tamper_is_rejected(self) -> None:
        native = self.migrate_fixture()
        ledger = json.loads(self.ledger_path.read_text(encoding="utf-8"))
        ledger[0]["authorizationId"] = "tampered"
        self._write_json(self.ledger_path, ledger)
        with self.assertRaises(gate.GateBlocked) as raised:
            gate.verify_completed_migration(self.facts, native, synthetic_fixture_root=self.root)
        self.assertTrue(any("ledger" in error.lower() for error in raised.exception.reasons))

    def test_permit_resurrection_is_rejected(self) -> None:
        native = self.migrate_fixture()
        self._write_json(self.permit_path, {"status": "resurrected"})
        with self.assertRaises(gate.GateBlocked) as raised:
            gate.verify_completed_migration(self.facts, native, synthetic_fixture_root=self.root)
        self.assertTrue(any("resurrected" in error.lower() or "permit" in error.lower() for error in raised.exception.reasons))

    def test_path_alias_backup_is_rejected(self) -> None:
        alias = self.app_data / gate.BACKUP_DIRECTORY / "alias.sqlite3"
        alias.symlink_to(self.backup)
        facts = copy.deepcopy(self.facts)
        facts["backup"]["path"] = str(alias)
        self.assert_blocked(facts, needle="backup")

    def _rewrite_authorization_backup(self, path: Path) -> None:
        authorization = copy.deepcopy(self.authorization)
        authorization["backupPath"] = str(path)
        self._write_json(self.authorization_path, authorization)

    def test_backup_path_must_be_the_exact_fixed_file(self) -> None:
        nested = self.backup.parent / "nested" / gate.DATABASE_NAME
        nested.parent.mkdir()
        shutil.copyfile(self.db, nested)
        candidates = [
            nested,
            self.backup.parent / "copy.sqlite3",
            self.backup.parent / "other.sqlite3",
            self.db,
            self.backup.parent,
            self.root / "outside.sqlite3",
            self.app_data / "alias-database.sqlite3",
        ]
        for candidate in candidates:
            with self.subTest(candidate=str(candidate)):
                self._rewrite_authorization_backup(candidate)
                with self.assertRaises(gate.GateBlocked) as raised:
                    self.collect()
                self.assertTrue(
                    any("backup" in reason.lower() for reason in raised.exception.reasons),
                    raised.exception.reasons,
                )

    def test_backup_symlink_alias_is_rejected_before_facts(self) -> None:
        alias = self.backup.parent / "alias.sqlite3"
        alias.symlink_to(self.backup)
        self._rewrite_authorization_backup(alias)
        with self.assertRaises(gate.GateBlocked) as raised:
            self.collect()
        self.assertTrue(any("backup" in reason.lower() for reason in raised.exception.reasons), raised.exception.reasons)

    def test_backup_hard_link_is_rejected(self) -> None:
        hard_link = self.backup.parent / "hard-link.sqlite3"
        os.link(self.backup, hard_link)
        try:
            self._rewrite_authorization_backup(self.backup)
            with self.assertRaises(gate.GateBlocked) as raised:
                self.collect()
            self.assertTrue(any("single-link" in reason.lower() or "backup" in reason.lower() for reason in raised.exception.reasons), raised.exception.reasons)
        finally:
            hard_link.unlink()

    def test_fixed_backup_path_validator_does_not_normalize_aliases(self) -> None:
        expected_data = self.root / "expected-app-data"
        expected = expected_data / gate.BACKUP_DIRECTORY / gate.DATABASE_NAME
        expected.parent.mkdir(parents=True)
        self.assertEqual(gate.validate_fixed_backup_path(str(expected), expected_data), [])
        for candidate in (
            expected.parent / "copy.sqlite3",
            expected_data / gate.DATABASE_NAME,
            expected_data,
            expected.parent,
            self.root / "outside.sqlite3",
        ):
            self.assertTrue(gate.validate_fixed_backup_path(str(candidate), expected_data), candidate)

        redirected = self.root / "redirected-app-data"
        redirected.mkdir()
        real_backups = self.root / "real-backups"
        real_backups.mkdir()
        (redirected / gate.BACKUP_DIRECTORY).symlink_to(real_backups)
        redirected_expected = redirected / gate.BACKUP_DIRECTORY / gate.DATABASE_NAME
        self.assertTrue(gate.validate_fixed_backup_path(str(redirected_expected), redirected))

    def test_fixed_receipt_path_validator_rejects_custom_paths(self) -> None:
        expected = self.app_data / gate.RELEASE_RECEIPT_NAME
        self.assertEqual(gate.validate_receipt_path(str(expected), self.app_data, synthetic_root=self.root), [])
        for candidate in (
            self.app_data / "custom-release-receipt.json",
            self.app_data / "nested" / gate.RELEASE_RECEIPT_NAME,
            self.root / gate.RELEASE_RECEIPT_NAME,
            self.root / "outside-release-receipt.json",
        ):
            self.assertTrue(
                gate.validate_receipt_path(str(candidate), self.app_data, synthetic_root=self.root),
                candidate,
            )

    def test_default_receipt_path_is_the_fixed_synthetic_file(self) -> None:
        result = gate.run_gate(
            "preflight",
            self.approval_path,
            self.authorization_path,
            synthetic_fixture_root=self.root,
        )
        self.assertEqual(result["status"], "PREFLIGHT_PASS")
        self.assertEqual(Path(result["receiptPath"]), self.receipt_path)
        self.assertTrue(self.receipt_path.is_file())
        self.assertFalse(self.permit_path.exists())

    def test_synthetic_gate_refuses_custom_receipt_before_artifacts_or_native_runner(self) -> None:
        custom = self.app_data / "custom-production-v8-release-receipt.json"
        with self.assertRaises(gate.GateBlocked) as caught:
            gate.run_gate(
                "preflight",
                self.approval_path,
                self.authorization_path,
                custom,
                synthetic_fixture_root=self.root,
            )
        self.assertTrue(any("receipt" in reason.lower() for reason in caught.exception.reasons))
        self.assertFalse(custom.exists())
        self.assertFalse(self.receipt_path.exists())
        self.assertFalse(self.permit_path.exists())

        called: list[list[str]] = []
        with self.assertRaises(gate.GateBlocked):
            gate.run_gate(
                "migrate",
                self.approval_path,
                self.authorization_path,
                custom,
                synthetic_fixture_root=self.root,
                native_runner=lambda command: called.append(command) or {"status": "SHOULD_NOT_RUN"},
            )
        self.assertEqual(called, [])
        self.assertFalse(custom.exists())
        self.assertFalse(self.receipt_path.exists())
        self.assertFalse(self.permit_path.exists())

    def test_production_gate_refuses_custom_receipt_before_artifacts_or_native_runner(self) -> None:
        temporary_data = self.root / "production-expected-app-data"
        temporary_data.mkdir()
        facts = copy.deepcopy(self.facts)
        facts["app_data"] = str(temporary_data)
        custom = temporary_data / "custom-release-receipt.json"
        called: list[list[str]] = []
        with mock.patch.object(gate, "collect_real_facts", return_value=facts):
            with self.assertRaises(gate.GateBlocked) as caught:
                gate.run_gate(
                    "migrate",
                    self.approval_path,
                    self.authorization_path,
                    custom,
                    native_runner=lambda command: called.append(command) or {"status": "SHOULD_NOT_RUN"},
                )
        self.assertTrue(any("receipt" in reason.lower() for reason in caught.exception.reasons))
        self.assertEqual(called, [])
        self.assertFalse(custom.exists())
        self.assertFalse((temporary_data / gate.RELEASE_RECEIPT_NAME).exists())
        self.assertFalse((temporary_data / gate.AUTHORIZATION_NAME).exists())

    def test_incomplete_or_unknown_process_inventory_is_rejected(self) -> None:
        facts = copy.deepcopy(self.facts)
        facts["process_inventory"] = {"complete": False, "processes": [], "diagnostics": ["ps failed"]}
        facts["process_inventory_complete"] = False
        self.assert_blocked(facts, needle="process")
        facts = copy.deepcopy(self.facts)
        facts["running_production_processes"] = [{"pid": 42, "command": "personal-finance-console"}]
        self.assert_blocked(facts, needle="process")

    def test_synthetic_root_escape_is_rejected(self) -> None:
        with self.assertRaises(gate.GateBlocked):
            gate._validate_synthetic_gate_root(Path("/Applications"))
        with self.assertRaises(gate.GateBlocked):
            gate._validate_synthetic_gate_root(self.root / "..")

    def test_old_unconsumed_permit_blocks_a_new_permit(self) -> None:
        receipt, _ = self.persist_receipt()
        self._write_json(self.app_data / gate.LEGACY_AUTHORIZATION_NAME, {"status": "ONE_TIME_PRODUCTION_V4_MIGRATION_AUTHORIZATION"})
        with self.assertRaises(gate.GateBlocked):
            gate.write_migration_permit(receipt, self.approval, self.authorization, self.permit_path, synthetic_fixture_root=self.root)


if __name__ == "__main__":
    unittest.main()
