from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import production_v4_release_gate as gate
import quiescence_integration as qic
from quiescence_gate import MaintenanceLease

REPO = Path(__file__).resolve().parents[1]
NATIVE = REPO / "src-tauri/target/debug/quiescence-fixture"
MODE = qic.UNIFIED_R2B_GATE_OWNED


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class UnifiedNativeHandoff(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        result = subprocess.run(
            ["cargo", "build", "--manifest-path", "src-tauri/Cargo.toml", "--features", "quiescence-fixture", "--bin", "quiescence-fixture"],
            cwd=REPO, capture_output=True, text=True, timeout=300,
        )
        if result.returncode:
            raise RuntimeError(result.stderr)
        if not NATIVE.is_file():
            raise RuntimeError("quiescence-fixture binary missing after successful build")

    def setUp(self) -> None:
        self.parent_tmp = tempfile.TemporaryDirectory(prefix="pfc-r2b1b-parent-")
        self.parent = Path(self.parent_tmp.name).resolve()
        self.fixture = qic.create_fixture(self.parent, NATIVE, scenario="r2b1b", mode=MODE)
        self.root = Path(self.fixture["root"])
        self.inputs = self.root / "gate-inputs"
        self.inputs.mkdir()
        self.approval_path = self.inputs / "candidate-approval.json"
        self.authorization_path = self.inputs / "migration-authorization.json"
        self.lease = MaintenanceLease(self.root, self.fixture["session"], mode="unified-r2b")
        self.lease.__enter__()
        qic.prepare_managed(self.root, self.lease, mode=MODE)
        self._write_inputs()

    def tearDown(self) -> None:
        if self.lease.fd >= 0:
            self.lease.__exit__()
        self.parent_tmp.cleanup()

    def _write_inputs(self) -> None:
        exe = self.root / "managed/install/Installed.app/Contents/MacOS/personal-finance-console"
        manifest = self.root / "managed/install/Installed.app/Contents/Resources/runtime-compatibility.json"
        db = self.root / "personal-finance-console.sqlite3"
        backup = self.root / "backup.sqlite3"
        candidate_hash, manifest_hash, db_hash = digest(exe), digest(manifest), digest(db)
        approval = {
            "status": "OWNER_APPROVED_SYNTHETIC_R2B_CANDIDATE",
            "authorizationId": "synthetic-candidate-approval-r2b1b",
            "candidateExecutableSha256": candidate_hash,
            "compatibilityManifestSha256": manifest_hash,
            "bundleId": "org.pfc.quiescence.integration",
            "maxSupportedSchemaVersion": 4,
            "syntheticOnly": True,
        }
        authorization = {
            "status": "OWNER_AUTHORIZED_SYNTHETIC_R2B_MIGRATION",
            "authorizationId": "synthetic-migration-authorization-r2b1b",
            "productionDbPreMigrationSha256": db_hash,
            "candidateExecutableSha256": candidate_hash,
            "backupPath": str(backup),
            "syntheticOnly": True,
        }
        self.approval_path.write_text(json.dumps(approval, ensure_ascii=False), encoding="utf-8")
        self.authorization_path.write_text(json.dumps(authorization, ensure_ascii=False), encoding="utf-8")

    def _cli(self, command: str) -> subprocess.CompletedProcess[str]:
        args = [sys.executable, str(REPO / "scripts/production_v4_release_gate.py"), command,
                "--candidate-approval", str(self.approval_path),
                "--migration-authorization", str(self.authorization_path),
                "--synthetic-root", str(self.root), "--synthetic-mode", "unified-r2b"]
        env = os.environ.copy()
        env.update(self.lease.environment())
        return subprocess.run(args, cwd=REPO, capture_output=True, text=True, timeout=120,
                              env=env, pass_fds=(self.lease.fd,))

    def _preflight(self) -> dict:
        result = self._cli("preflight")
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads((self.root / "release-receipt.json").read_text())
        self.assertTrue(receipt["syntheticOnly"])
        self.assertEqual(receipt["productionBundleId"], "org.pfc.quiescence.integration")
        self.assertFalse((self.root / "gate-permit.json").exists())
        self.assertFalse((self.root / "consumed-ledger.json").exists())
        return receipt

    def _run_migrate_with_mutation(self, mutation) -> tuple[gate.GateBlocked, dict]:
        self._preflight()
        original_run = subprocess.run
        mutation_result = {"called": False}

        def intercept(command, **kwargs):
            if command[1:2] == ["--pfc-r2b1-unified-synthetic"]:
                mutation(kwargs)
                mutation_result["called"] = True
            return original_run(command, **kwargs)

        with patch.object(gate.subprocess, "run", side_effect=intercept), patch.dict(os.environ, self.lease.environment()):
            with self.assertRaises(gate.GateBlocked) as blocked:
                gate.run_gate("migrate", self.approval_path, self.authorization_path,
                              self.root / "release-receipt.json", synthetic_fixture_root=self.root,
                              synthetic_mode="unified-r2b")
        self.assertTrue(mutation_result["called"])
        self.assertFalse((self.root / "consumed-ledger.json").exists())
        self.assertFalse((self.root / "r2b1b-s4-stop.json").exists())
        evidence = REPO / "evidence/wp04-release-cutover-readiness/36-r2b1b-native-handoff/08-drift-negative/results.json"
        evidence.parent.mkdir(parents=True, exist_ok=True)
        cases = json.loads(evidence.read_text()) if evidence.exists() else {}
        cases[self._testMethodName] = {"result": "REFUSED", "reason": str(blocked.exception),
                                       "consumedLedgerCount": 0, "s4ReceiptCount": 0}
        evidence.write_text(json.dumps(cases, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return blocked.exception, mutation_result

    def test_exact_permit_byte_mutation_is_refused(self) -> None:
        blocked, _ = self._run_migrate_with_mutation(lambda _: (self.root / "gate-permit.json").write_bytes(
            (self.root / "gate-permit.json").read_bytes() + b" "))
        self.assertIn("GATE_PERMIT_EXACT_BYTES_DRIFT", str(blocked))

    def test_receipt_drift_is_refused(self) -> None:
        blocked, _ = self._run_migrate_with_mutation(lambda _: (self.root / "release-receipt.json").write_bytes(
            (self.root / "release-receipt.json").read_bytes() + b" "))
        self.assertIn("GATE_AUTHORITY_HASH_MISMATCH", str(blocked))

    def test_authorization_byte_drift_is_refused(self) -> None:
        blocked, _ = self._run_migrate_with_mutation(lambda _: self.authorization_path.write_bytes(
            self.authorization_path.read_bytes() + b" "))
        self.assertIn("GATE_AUTHORITY_HASH_MISMATCH", str(blocked))

    def test_candidate_executable_drift_is_refused(self) -> None:
        exe = self.root / "managed/install/Installed.app/Contents/MacOS/personal-finance-console"
        blocked, _ = self._run_migrate_with_mutation(lambda _: exe.write_bytes(exe.read_bytes() + b"\0"))
        self.assertTrue(any(code in str(blocked) for code in ("GATE_AUTHORITY_HASH_MISMATCH", "GATE_C3_CANDIDATE_DRIFT")))

    def test_database_drift_is_refused(self) -> None:
        db = self.root / "personal-finance-console.sqlite3"
        blocked, _ = self._run_migrate_with_mutation(lambda _: db.write_bytes(db.read_bytes() + b"x"))
        self.assertIn("GATE_AUTHORITY_HASH_MISMATCH", str(blocked))

    def test_backup_drift_is_refused(self) -> None:
        backup = self.root / "backup.sqlite3"
        blocked, _ = self._run_migrate_with_mutation(lambda _: backup.write_bytes(backup.read_bytes() + b"x"))
        self.assertIn("GATE_AUTHORITY_HASH_MISMATCH", str(blocked))

    def test_manifest_drift_is_refused(self) -> None:
        manifest = self.root / "managed/install/Installed.app/Contents/Resources/runtime-compatibility.json"
        blocked, _ = self._run_migrate_with_mutation(lambda _: manifest.write_bytes(manifest.read_bytes() + b" "))
        self.assertIn("GATE_AUTHORITY_HASH_MISMATCH", str(blocked))

    def test_production_domain_permit_is_refused_by_unified_consumer(self) -> None:
        def mark_non_synthetic(kwargs):
            path = self.root / "gate-permit.json"
            permit = json.loads(path.read_text())
            permit["syntheticOnly"] = False
            path.write_text(json.dumps(permit), encoding="utf-8")
            kwargs["env"]["PFC_GATE_PERMIT_SHA256"] = digest(path)
        blocked, _ = self._run_migrate_with_mutation(mark_non_synthetic)
        self.assertIn("GATE_PERMIT_DOMAIN", str(blocked))

    def test_expired_permit_is_refused_by_unified_consumer(self) -> None:
        def expire(kwargs):
            path = self.root / "gate-permit.json"
            permit = json.loads(path.read_text())
            permit["issuedAtUnix"] = 1
            permit["expiresAtUnix"] = 2
            path.write_text(json.dumps(permit), encoding="utf-8")
            kwargs["env"]["PFC_GATE_PERMIT_SHA256"] = digest(path)
        blocked, _ = self._run_migrate_with_mutation(expire)
        self.assertIn("GATE_PERMIT_EXPIRED", str(blocked))

    def test_wrong_unified_marker_is_refused_before_gate_receipt(self) -> None:
        marker = self.root / "SYNTHETIC_ONLY"
        marker.write_bytes(b"PFC_WP04R2A_GATE_SYNTHETIC_V1\n")
        result = self._cli("preflight")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "release-receipt.json").exists())
        self._save_case("09-domain-negative", "wrong-marker", {"result":"REFUSED","permitCount":0,"receiptCount":0})

    def test_unmarked_arbitrary_synthetic_root_is_refused(self) -> None:
        with self.assertRaises(gate.GateBlocked):
            gate._validate_synthetic_gate_root(self.parent, unified_r2b=True)
        self.assertFalse((self.parent / "release-receipt.json").exists())
        self._save_case("09-domain-negative", "arbitrary-root", {"result":"REFUSED","permitCount":0,"receiptCount":0})

    def test_wrong_bundle_id_approval_is_refused(self) -> None:
        approval = json.loads(self.approval_path.read_text())
        approval["bundleId"] = "com.personalfinance.console.wp03preview"
        self.approval_path.write_text(json.dumps(approval), encoding="utf-8")
        result = self._cli("preflight")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "release-receipt.json").exists())
        self._save_case("09-domain-negative", "wp03-identity", {"result":"REFUSED","permitCount":0,"receiptCount":0})

    def test_concurrent_consumers_have_exactly_one_s4_winner(self) -> None:
        self._preflight()
        original_run = subprocess.run
        race = {}

        def run_race(command, **kwargs):
            if command[1:2] != ["--pfc-r2b1-unified-synthetic"]:
                return original_run(command, **kwargs)
            children = [subprocess.Popen(command, cwd=kwargs["cwd"], env=kwargs["env"],
                         pass_fds=kwargs["pass_fds"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                        for _ in range(2)]
            outcomes = [child.communicate(timeout=60) + (child.returncode,) for child in children]
            winners = [i for i, item in enumerate(outcomes) if item[2] == 0]
            losers = [i for i, item in enumerate(outcomes) if item[2] != 0]
            race.update({"outcomes": outcomes, "winner_count": len(winners), "loser_count": len(losers)})
            winner = outcomes[winners[0]] if winners else outcomes[0]
            return subprocess.CompletedProcess(command, winner[2], winner[0], winner[1])

        with patch.object(gate.subprocess, "run", side_effect=run_race), patch.dict(os.environ, self.lease.environment()):
            result = gate.run_gate("migrate", self.approval_path, self.authorization_path,
                                   self.root / "release-receipt.json", synthetic_fixture_root=self.root,
                                   synthetic_mode="unified-r2b")
        self.assertEqual(race["winner_count"], 1)
        self.assertEqual(race["loser_count"], 1)
        self.assertEqual(result["native"]["status"], "S4_CONNECTION_PREPARED")
        self.assertTrue((self.root / "consumed-ledger.json").is_file())
        self.assertFalse((self.root / "gate-permit.json").exists())
        self._save_case("07-replay", "double-consumer-race", {"winnerCount":1,"refusalCount":1,"ledgerCount":1,
                                                               "runnerS4Count":1})

    def test_formal_gate_cli_rust_claim_ledger_runner_stops_at_s4(self) -> None:
        before = digest(self.root / "personal-finance-console.sqlite3")
        receipt = self._preflight()
        migrate = self._cli("migrate")
        self.assertEqual(migrate.returncode, 0, migrate.stderr)
        result = json.loads(migrate.stdout)
        native = result["native"]
        self.assertEqual(native["status"], "S4_CONNECTION_PREPARED")
        self.assertEqual(native["highestState"], "S4_CONNECTION_PREPARED")
        self.assertTrue(native["connection"]["opened"])
        self.assertEqual(native["connection"]["busyTimeout"], 0)
        self.assertEqual(native["connection"]["lockingMode"], "exclusive")
        self.assertFalse(native["beginExclusiveExecuted"])
        self.assertFalse(native["migration4Executed"])
        self.assertEqual(native["databaseSchema"], {"userVersion": 3, "migrationRows": [1, 2, 3]})
        self.assertFalse((self.root / "gate-permit.json").exists())
        self.assertTrue((self.root / "gate-permit.claimed/permit.json").is_file())
        ledger = json.loads((self.root / "consumed-ledger.json").read_text())
        self.assertEqual(ledger["permitSha256"], native["continuity"]["gatePermitSha256"])
        self.assertEqual(native["continuity"]["gatePermitSha256"], native["continuity"]["consumerInputSha256"])
        self.assertEqual(native["continuity"]["gatePermitSha256"], native["continuity"]["claimedPermitSha256"])
        self.assertEqual(native["continuity"]["gatePermitSha256"], native["continuity"]["ledgerPermitSha256"])
        self.assertEqual(native["continuity"]["gatePermitSha256"], native["continuity"]["runnerAuthorityPermitSha256"])
        self.assertEqual(native["continuity"]["receiptSha256"], digest(self.root / "release-receipt.json"))
        self.assertEqual(native["continuity"]["authorizationSha256"], digest(self.authorization_path))
        self.assertEqual(digest(self.root / "personal-finance-console.sqlite3"), before)
        self.assertEqual(ledger["syntheticOnly"], True)
        self.assertEqual((self.root / "consumed-ledger.json").stat().st_mode & 0o077, 0)
        self.assertEqual(ledger["expiryValidated"], True)
        self.assertFalse((self.root / "permit.json").exists())
        self.assertFalse((self.root / "consumed.json").exists())
        s4 = json.loads((self.root / "r2b1b-s4-stop.json").read_text())
        self.assertEqual(s4["state"], "R2B1B_TEST_STOP_BEFORE_QUIESCENCE")
        self._save_evidence(self.root, receipt, result, ledger, s4)

    def test_formal_gate_replay_is_refused_after_native_claim(self) -> None:
        self._preflight()
        first = self._cli("migrate")
        self.assertEqual(first.returncode, 0, first.stderr)
        ledger_before = (self.root / "consumed-ledger.json").read_bytes()
        replay = self._cli("migrate")
        self.assertNotEqual(replay.returncode, 0)
        self.assertIn("already claimed", replay.stderr)
        self.assertEqual((self.root / "consumed-ledger.json").read_bytes(), ledger_before)
        self._save_case("07-replay", "formal-gate-replay", {"result":"REFUSED","ledgerCountAfter":1,"secondS4":False})

    def test_unified_domain_cannot_use_legacy_component_raw_permit_entry(self) -> None:
        self._preflight()
        permit = self.root / "gate-permit.json"
        receipt = json.loads((self.root / "release-receipt.json").read_text())
        receipt["releaseReceiptSha256"] = digest(self.root / "release-receipt.json")
        gate.write_migration_permit(
            receipt,
            json.loads(self.approval_path.read_text()), permit,
            synthetic_fixture_root=self.root, unified_r2b=True,
        )
        legacy = subprocess.run([str(self.root / "managed/install/Installed.app/Contents/MacOS/personal-finance-console"),
                                 "--pfc-synthetic-gate-consume", str(self.root)],
                                capture_output=True, text=True, timeout=15)
        self.assertNotEqual(legacy.returncode, 0)
        self.assertFalse((self.root / "consumed-ledger.json").exists())
        self._save_case("09-domain-negative", "legacy-runner-bypass", {"result":"REFUSED","exitCode":legacy.returncode,"ledgerCount":0})

    @staticmethod
    def _save_evidence(fixture_root: Path, receipt: dict, result: dict, ledger: dict, s4: dict) -> None:
        evidence_positive = REPO / "evidence/wp04-release-cutover-readiness/36-r2b1b-native-handoff/05-positive-s4"
        evidence_positive.mkdir(parents=True, exist_ok=True)
        for name, value in (("release-receipt-summary.json", receipt), ("gate-to-s4-result.json", result),
                            ("consumed-ledger.json", ledger), ("s4-stop.json", s4)):
            (evidence_positive / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        source_root = fixture_root
        evidence_root = REPO / "evidence/wp04-release-cutover-readiness/36-r2b1b-native-handoff"
        (evidence_root / "06-continuity").mkdir(parents=True, exist_ok=True)
        (evidence_root / "02-consumer").mkdir(parents=True, exist_ok=True)
        (evidence_root / "03-ledger").mkdir(parents=True, exist_ok=True)
        (evidence_root / "04-runner-authority").mkdir(parents=True, exist_ok=True)
        (evidence_root / "06-continuity/gate-issued-permit.raw.json").write_bytes((source_root / "gate-permit.claimed/permit.json").read_bytes())
        (evidence_root / "06-continuity/release-receipt.raw.json").write_bytes((source_root / "release-receipt.json").read_bytes())
        (evidence_root / "06-continuity/candidate-approval.raw.json").write_bytes((source_root / "gate-inputs/candidate-approval.json").read_bytes())
        (evidence_root / "06-continuity/migration-authorization.raw.json").write_bytes((source_root / "gate-inputs/migration-authorization.json").read_bytes())
        (evidence_root / "02-consumer/native-consumer-result.json").write_text(json.dumps(result["native"], indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        (evidence_root / "03-ledger/consumed-ledger.json").write_text(json.dumps(ledger, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        (evidence_root / "04-runner-authority/s4-stop-receipt.json").write_text(json.dumps(s4, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        (evidence_root / "05-positive-s4/c3-managed-isolated-receipt.json").write_bytes((source_root / "SYNTHETIC_C3_MANAGED_ISOLATED.json").read_bytes())
        (evidence_root / "05-positive-s4/c3-managed-contract.json").write_bytes((source_root / "managed-contract.json").read_bytes())
        (evidence_root / "05-positive-s4/c3-managed-state-S1.json").write_bytes((source_root / "managed-state-S1_MANAGED_ISOLATED.json").read_bytes())
        continuity = {**result["native"]["continuity"], "exactBytePermitPreserved": True,
                      "claimedPermitSha256": digest(evidence_root / "06-continuity/gate-issued-permit.raw.json"),
                      "releaseReceiptSha256Readback": digest(evidence_root / "06-continuity/release-receipt.raw.json"),
                      "candidateApprovalSha256Readback": digest(evidence_root / "06-continuity/candidate-approval.raw.json"),
                      "migrationAuthorizationSha256Readback": digest(evidence_root / "06-continuity/migration-authorization.raw.json")}
        continuity["allPermitShaFieldsEqual"] = len({continuity[key] for key in (
            "gatePermitSha256", "consumerInputSha256", "claimedPermitSha256", "ledgerPermitSha256", "runnerAuthorityPermitSha256")}) == 1
        (evidence_root / "06-continuity/permit-continuity.json").write_text(json.dumps(continuity, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    @staticmethod
    def _save_case(folder: str, name: str, value: dict) -> None:
        path = REPO / "evidence/wp04-release-cutover-readiness/36-r2b1b-native-handoff" / folder / "results.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        current = json.loads(path.read_text()) if path.exists() else {}
        current[name] = value
        path.write_text(json.dumps(current, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    unittest.main(verbosity=2)
