"""No Production reads/writes: exercise CLI guards with deliberately absent inputs."""
import json
import subprocess
import sys
import unittest
from pathlib import Path
from scripts import production_v4_release_gate as gate


class EntryBoundary(unittest.TestCase):
    def test_imported_legacy_mutations_reject_fixed_production_targets(self):
        absent = Path("/does-not-exist/authorization")
        with self.assertRaisesRegex(gate.GateBlocked, "REFUSE_NO_AUTHORIZATION"):
            gate.run_gate("migrate", absent, absent)
        calls = [lambda: gate.run_retirement(absent, absent),
                 lambda: gate.write_migration_permit({}, {}),
                 lambda: gate.retirement_replace(gate.APP_PATH, absent, gate.APP_PATH, absent, {}, [], [])]
        for call in calls:
            with self.assertRaises(gate.GateBlocked):
                call()

    def test_mutating_production_commands_fail_before_input_or_receipt_access(self):
        script = Path(__file__).with_name("production_v4_release_gate.py")
        cases = [
            ["migrate", "--candidate-approval", "/does-not-exist/candidate", "--migration-authorization", "/does-not-exist/auth"],
            ["retire", "--candidate-app", "/does-not-exist/app", "--replacement-authorization", "/does-not-exist/auth"],
        ]
        for args in cases:
            with self.subTest(command=args[0]):
                result = subprocess.run([sys.executable, str(script), *args], capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 2)
                output = json.loads(result.stderr)
                self.assertEqual(output["status"], "BLOCKED")
                if args[0] == "migrate":
                    self.assertIn("REFUSE_NO_AUTHORIZATION", output["reasons"][0])
                else:
                    self.assertIn("Runtime retirement remains a separate", output["reasons"][0])


if __name__ == "__main__":
    unittest.main()
