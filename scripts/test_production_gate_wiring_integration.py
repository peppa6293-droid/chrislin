from __future__ import annotations

import hashlib
import json
import os
import plistlib
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
GATE = REPO / "scripts/production_v4_release_gate.py"
NATIVE = REPO / "src-tauri/target/debug/quiescence-fixture"
MARKER = b"PFC_WP04R2A_GATE_SYNTHETIC_V1\n"
APP_NAME = "Personal Finance Console.app"
EXECUTABLE = "personal-finance-console"
BUNDLE_ID = "com.personalfinance.console"
DB_NAME = "personal-finance-console.sqlite3"
RECEIPT_NAME = "production-v4-release-receipt.json"
PERMIT_NAME = "production-v4-migration-authorization.json"
LEDGER_NAME = "production-v4-consumed-authorizations.json"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class GateWiringIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if not NATIVE.is_file():
            build = subprocess.run(
                ["cargo", "build", "--manifest-path", "src-tauri/Cargo.toml", "--features", "quiescence-fixture", "--bin", "quiescence-fixture"],
                cwd=REPO, capture_output=True, text=True, timeout=300,
            )
            if build.returncode:
                raise RuntimeError(build.stderr)

    def setUp(self) -> None:
        temp_root = Path(tempfile.gettempdir()).resolve(strict=True)
        self.temp = tempfile.TemporaryDirectory(prefix="pfc-r2a-gate-", dir=temp_root)
        self.root = Path(self.temp.name).resolve(strict=True)
        (self.root / "SYNTHETIC_ONLY").write_bytes(MARKER)
        os.chmod(self.root / "SYNTHETIC_ONLY", 0o600)
        self.app = self.root / "Applications" / APP_NAME
        self.exe = self.app / "Contents/MacOS" / EXECUTABLE
        self.exe.parent.mkdir(parents=True)
        shutil.copyfile(NATIVE, self.exe)
        self.exe.chmod(0o700)
        with (self.app / "Contents/Info.plist").open("wb") as stream:
            plistlib.dump({"CFBundleIdentifier": BUNDLE_ID, "CFBundleExecutable": EXECUTABLE}, stream)
        manifest = self.app / "Contents/Resources/runtime-compatibility.json"
        manifest.parent.mkdir(parents=True)
        manifest.write_text(json.dumps({
            "manifestFormatVersion": 1, "runtimeGeneration": 4,
            "minSupportedSchemaVersion": 1, "maxSupportedSchemaVersion": 4,
            "bundleId": BUNDLE_ID, "executable": f"Contents/MacOS/{EXECUTABLE}",
        }), encoding="utf-8")
        self.app_data = self.root / "Library/Application Support" / BUNDLE_ID
        self.app_data.mkdir(parents=True)
        self.db = self.app_data / DB_NAME
        with sqlite3.connect(self.db) as connection:
            connection.executescript(
                "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);"
                "INSERT INTO schema_migrations VALUES(1,'fixture'),(2,'fixture'),(3,'fixture');"
                "PRAGMA user_version=3;"
            )
        self.backup = self.app_data / "production-v4-backups" / DB_NAME
        self.backup.parent.mkdir(parents=True)
        shutil.copyfile(self.db, self.backup)
        self.inputs = self.root / "gate-inputs"
        self.inputs.mkdir()
        self.approval = self.inputs / "candidate-approval.json"
        self.authorization = self.inputs / "migration-authorization.json"
        self._write_authority_files(synthetic=True)
        self.receipt = self.app_data / RECEIPT_NAME
        self.permit = self.app_data / PERMIT_NAME
        self.ledger = self.app_data / LEDGER_NAME

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _write_authority_files(self, *, synthetic: bool) -> None:
        candidate_hash = digest(self.exe)
        manifest_hash = digest(self.app / "Contents/Resources/runtime-compatibility.json")
        db_hash = digest(self.db)
        approval = {
            "status": "OWNER_APPROVED_V4_PRODUCTION_CANDIDATE",
            "authorizationId": "synthetic-candidate-approval",
            "candidateExecutableSha256": candidate_hash,
            "compatibilityManifestSha256": manifest_hash,
            "bundleId": BUNDLE_ID,
            "maxSupportedSchemaVersion": 4,
            "syntheticOnly": synthetic,
        }
        authorization = {
            "status": "OWNER_AUTHORIZED_PRODUCTION_V4_MIGRATION",
            "authorizationId": "synthetic-migration-authorization",
            "productionDbPreMigrationSha256": db_hash,
            "candidateExecutableSha256": candidate_hash,
            "backupPath": str(self.backup.resolve()),
            "syntheticOnly": synthetic,
        }
        self.approval.write_text(json.dumps(approval), encoding="utf-8")
        self.authorization.write_text(json.dumps(authorization), encoding="utf-8")

    def _cli(self, command: str, *, synthetic_root: Path | None = None, approval: Path | None = None,
             authorization: Path | None = None, extra: tuple[str, ...] = ()) -> subprocess.CompletedProcess[str]:
        args = [sys.executable, str(GATE), command,
                "--candidate-approval", str(approval or self.approval),
                "--migration-authorization", str(authorization or self.authorization)]
        if synthetic_root is not None:
            args += ["--synthetic-root", str(synthetic_root)]
        args += list(extra)
        return subprocess.run(args, cwd=REPO, capture_output=True, text=True, timeout=90)

    def test_formal_core_reaches_actual_native_consumer_and_stops_before_migration4(self) -> None:
        preflight = self._cli("preflight", synthetic_root=self.root)
        self.assertEqual(preflight.returncode, 0, preflight.stderr)
        receipt = json.loads(self.receipt.read_text())
        self.assertEqual(receipt["status"], "PREFLIGHT_PASS_READY_FOR_SEPARATELY_AUTHORIZED_MIGRATION")
        self.assertTrue(receipt["syntheticOnly"])
        self.assertEqual(receipt["candidateApprovalSha256"], digest(self.approval))
        self.assertEqual(receipt["migrationAuthorizationSha256"], digest(self.authorization))
        self.assertFalse(self.permit.exists())
        self.assertFalse(self.ledger.exists())

        migrate = self._cli("migrate", synthetic_root=self.root)
        self.assertEqual(migrate.returncode, 0, migrate.stderr)
        result = json.loads(migrate.stdout)
        self.assertEqual(result["status"], "NATIVE_CONSUMER_BOUND")
        self.assertEqual(result["native"]["event"], "gate_permit_consumed")
        self.assertEqual(result["native"]["status"], "AUTHORIZATION_CONSUMED_NATIVE_MIGRATION_PENDING")
        self.assertTrue(result["native"]["syntheticOnly"])
        self.assertFalse(result["native"]["migration4Executed"])
        self.assertFalse(self.permit.exists())
        ledger = json.loads(self.ledger.read_text())
        self.assertEqual(len(ledger), 1)
        self.assertEqual(ledger[0]["authorizationId"], "synthetic-migration-authorization")
        with sqlite3.connect(f"file:{self.db}?mode=ro", uri=True) as connection:
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 3)
        self._write_run_evidence({"actual_native_consumer": "PASS", "migration4_executed": False})

    def test_migrate_requires_persisted_receipt_and_rejects_receipt_tampering(self) -> None:
        missing = self._cli("migrate", synthetic_root=self.root)
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn("Persisted release receipt", missing.stderr)
        self.assertFalse(self.permit.exists())

        self.assertEqual(self._cli("preflight", synthetic_root=self.root).returncode, 0)
        receipt = json.loads(self.receipt.read_text())
        receipt["candidateExecutableSha256"] = "tampered"
        self.receipt.write_text(json.dumps(receipt), encoding="utf-8")
        tampered = self._cli("migrate", synthetic_root=self.root)
        self.assertNotEqual(tampered.returncode, 0)
        self.assertIn("Persisted preflight receipt", tampered.stderr)
        self.assertFalse(self.permit.exists())

    def test_authorization_byte_change_and_manual_permit_are_refused(self) -> None:
        self.assertEqual(self._cli("preflight", synthetic_root=self.root).returncode, 0)
        self.authorization.write_text(self.authorization.read_text() + " ", encoding="utf-8")
        changed = self._cli("migrate", synthetic_root=self.root)
        self.assertNotEqual(changed.returncode, 0)
        self.assertIn("Persisted preflight receipt", changed.stderr)
        self.assertFalse(self.permit.exists())

        self.authorization.write_text(json.dumps({
            "status": "OWNER_AUTHORIZED_PRODUCTION_V4_MIGRATION", "authorizationId": "synthetic-migration-authorization",
            "productionDbPreMigrationSha256": digest(self.db), "candidateExecutableSha256": digest(self.exe),
            "backupPath": str(self.backup.resolve()), "syntheticOnly": True,
        }), encoding="utf-8")
        self.receipt.unlink()
        self.assertEqual(self._cli("preflight", synthetic_root=self.root).returncode, 0)
        self.permit.write_text("{}", encoding="utf-8")
        manual = self._cli("migrate", synthetic_root=self.root)
        self.assertNotEqual(manual.returncode, 0)
        self.assertIn("already exists", manual.stderr)

    def test_synthetic_and_production_authorization_domains_are_separate(self) -> None:
        production_mode = self._cli("preflight")
        self.assertNotEqual(production_mode.returncode, 0)
        self.assertIn("Authorization domain", production_mode.stderr)
        self.assertFalse(self.receipt.exists())

        self._write_authority_files(synthetic=False)
        synthetic_mode = self._cli("preflight", synthetic_root=self.root)
        self.assertNotEqual(synthetic_mode.returncode, 0)
        self.assertIn("syntheticOnly=true", synthetic_mode.stderr)
        self.assertFalse(self.receipt.exists())

    def test_gate_cli_has_no_arbitrary_target_or_permit_options(self) -> None:
        help_result = subprocess.run([sys.executable, str(GATE), "migrate", "--help"], cwd=REPO,
                                     capture_output=True, text=True, timeout=10)
        self.assertEqual(help_result.returncode, 0)
        for forbidden in ("--db", "--bundle-id", "--sqlite-name", "--target-schema", "--migration-sql", "--permit"):
            self.assertNotIn(forbidden, help_result.stdout)
        override = self._cli("migrate", synthetic_root=self.root, extra=("--db", "/tmp/arbitrary.sqlite3"))
        self.assertNotEqual(override.returncode, 0)
        self.assertFalse(self.permit.exists())

    @staticmethod
    def _write_run_evidence(result: dict) -> None:
        root = REPO / "evidence/wp04-release-cutover-readiness/32-gate-wiring"
        root.mkdir(parents=True, exist_ok=True)
        (root / "SYNTHETIC_DOMAIN_RESULTS.json").write_text(json.dumps({
            "format_version": 1, "synthetic_only": True, "status": "PASS",
            "scope": "formal gate core through actual Rust authorization consumer; Migration 4 not executed",
            **result,
        }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    unittest.main(verbosity=2)
