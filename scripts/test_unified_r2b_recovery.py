from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

from unified_r2b_recovery import (
    AUTH_DOMAIN,
    _classify,
    _json_snapshot,
    _read_chain,
    diagnose,
    expected_authorization_bindings,
)
from production_v4_release_gate import GateBlocked


REPO = Path(__file__).resolve().parents[1]
READBACK = REPO / "evidence/wp04-release-cutover-readiness/40-r2b-final-acceptance-v3-compatible/attempt-02/19-final-readback/FINAL_ACCEPTANCE_READBACK.json"


class UnifiedR2BRecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        readback = json.loads(READBACK.read_text())
        cls.root = Path(readback["acceptedRoot"])
        if not cls.root.exists():
            raise unittest.SkipTest("canonical accepted synthetic root is not retained on this host")
        cls.snapshot, cls.objects = _read_chain(cls.root)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pfc-r2b3a-auth-")
        self.addCleanup(self.temp.cleanup)

    def authorization(self, **changes):
        value = {
            "formatVersion": 1,
            "authorizationId": "synthetic-r2b3a-test-" + hashlib.sha256(str(time.time_ns()).encode()).hexdigest()[:12],
            "expiresAtUnix": int(time.time()) + 600,
            **expected_authorization_bindings(self.snapshot),
            **changes,
        }
        path = Path(self.temp.name) / "recovery-authorization.json"
        path.write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n")
        return path, hashlib.sha256(path.read_bytes()).hexdigest(), value

    def test_canonical_success_root_is_read_only_v4_verified(self):
        path, pin, _ = self.authorization()
        before = _read_chain(self.root)[1]
        result = diagnose(self.root, path, pin)
        after = _read_chain(self.root)[1]
        self.assertEqual(result["currentState"], "V4_VERIFIED")
        self.assertEqual(result["recoveryDisposition"], "READONLY_CONFIRMATION_ONLY")
        self.assertFalse(result["businessAccessAllowed"])
        self.assertFalse(result["migrationMayRerun"])
        self.assertFalse(result["oldPermitReusable"])
        self.assertFalse(result["restoreAllowed"])
        self.assertEqual(result["diagnosticMutationCount"], 0)
        self.assertEqual(before, after)

    def test_wrong_chain_bindings_refuse(self):
        for field, bad in (
            ("releaseReceiptSha256", "0" * 64),
            ("gatePermitSha256", "1" * 64),
            ("consumedLedgerSha256", "2" * 64),
            ("candidateExecutableSha256", "3" * 64),
            ("manifestSha256", "3" * 64),
            ("databaseSha256", "4" * 64),
            ("databaseIdentity", {"dev": -1, "inode": -1, "links": 1}),
            ("backupSha256", "5" * 64),
            ("originalMigrationAuthorizationSha256", "6" * 64),
        ):
            with self.subTest(field=field):
                path, pin, _ = self.authorization(**{field: bad})
                with self.assertRaises(GateBlocked):
                    diagnose(self.root, path, pin)

    def test_wrong_recovery_authorization_exact_bytes_refuses(self):
        path, original_pin, value = self.authorization()
        path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
        self.assertEqual(json.loads(path.read_text()), value)
        with self.assertRaises(GateBlocked):
            diagnose(self.root, path, original_pin)

    def test_receipt_semantic_equivalent_byte_replacement_breaks_binding(self):
        compact_receipt = json.dumps(self.snapshot["receipt"], sort_keys=True, separators=(",", ":")).encode()
        replacement_sha = hashlib.sha256(compact_receipt).hexdigest()
        self.assertNotEqual(replacement_sha, self.snapshot["receiptSha256"])
        path, pin, _ = self.authorization(releaseReceiptSha256=replacement_sha)
        with self.assertRaises(GateBlocked):
            diagnose(self.root, path, pin)

    def test_wrong_recovery_authorization_binding_and_expiry_refuse(self):
        path, pin, _ = self.authorization(recoveryScope="MIGRATE_AND_RESTORE")
        with self.assertRaises(GateBlocked):
            diagnose(self.root, path, pin)
        path, pin, _ = self.authorization(expiresAtUnix=int(time.time()) - 1)
        with self.assertRaises(GateBlocked):
            diagnose(self.root, path, pin)

    def test_production_domain_is_refused(self):
        path, pin, _ = self.authorization()
        with self.assertRaises(GateBlocked):
            diagnose(self.root, path, pin, domain="PRODUCTION")

    def test_typed_disposition_fixtures_are_fail_closed(self):
        cases = (
            ("V4_VERIFIED", "READONLY_CONFIRMATION_ONLY", False, False),
            ("V4_COMMITTED_BUT_REPLY_LOST", "READONLY_CONFIRMATION_ONLY", False, False),
            ("FAILED_V3_CONFIRMED", "MANUAL_DECISION_REQUIRED", True, "AUTHORIZATION_REQUIRED"),
            ("QUIESCENCE_ACQUIRED", "MANUAL_DECISION_REQUIRED", False, False),
            ("M4_IN_TRANSACTION", "MANUAL_DECISION_REQUIRED", False, False),
            ("COMMIT_OUTCOME_UNKNOWN", "MANUAL_DECISION_REQUIRED", False, False),
            ("GUARD_LOST_OR_UNPROVEN", "REFUSE", False, False),
            ("ORPHAN_ACTIVE", "REFUSE", False, False),
            ("MISSING_TERMINAL", "MANUAL_DECISION_REQUIRED", False, False),
            ("CORRUPT_STATE", "REFUSE", False, False),
        )
        for state, disposition, rerun, restore in cases:
            with self.subTest(state=state):
                fixture = copy.deepcopy(self.snapshot)
                fixture["active"] = state == "ORPHAN_ACTIVE"
                fixture["terminal"] = None
                fixture["recoveryState"] = None
                fixture["recoveryTerminal"] = None
                fixture["stageRows"] = []
                fixture["dbFacts"] = {"userVersion": 4, "migrationRows": [1, 2, 3, 4], "integrity": ["ok"]}
                if state == "V4_VERIFIED":
                    fixture["terminal"] = self.snapshot["terminal"]
                    fixture["stageRows"] = self.snapshot["stageRows"]
                    fixture["dbFacts"] = self.snapshot["dbFacts"]
                elif state == "FAILED_V3_CONFIRMED":
                    fixture["dbFacts"] = {"userVersion": 3, "migrationRows": [1, 2, 3], "integrity": ["ok"]}
                    fixture["recoveryTerminal"] = {"state": state, "rollbackConfirmed": True, "guard": "known-held"}
                elif state == "ORPHAN_ACTIVE":
                    fixture["stageRows"] = self.snapshot["stageRows"]
                elif state not in {"MISSING_TERMINAL", "CORRUPT_STATE"}:
                    fixture["recoveryState"] = {"state": state}
                elif state == "CORRUPT_STATE":
                    fixture["recoveryState"] = {"state": state}
                result = _classify(fixture)
                self.assertEqual(result["currentState"], state)
                self.assertEqual(result["recoveryDisposition"], disposition)
                self.assertEqual(result["migrationMayRerun"], rerun)
                self.assertEqual(result["restoreAllowed"], restore)
                self.assertFalse(result["businessAccessAllowed"])
                self.assertFalse(result["oldPermitReusable"])

    def test_corrupt_json_state_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ledger.json"
            path.write_text("{broken\n")
            with self.assertRaises(GateBlocked):
                _json_snapshot(path, "Consumed ledger")

    def test_existing_gate_cli_runs_read_only_diagnostic(self):
        path, pin, _ = self.authorization()
        result = subprocess.run(
            [sys.executable, str(REPO / "scripts/production_v4_release_gate.py"), "recover-diagnostic",
             "--domain", AUTH_DOMAIN, "--root", str(self.root), "--recovery-authorization", str(path),
             "--authorization-sha256", pin],
            cwd=REPO, capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual(output["currentState"], "V4_VERIFIED")
        self.assertFalse(output["automaticRecovery"])


if __name__ == "__main__":
    unittest.main()
