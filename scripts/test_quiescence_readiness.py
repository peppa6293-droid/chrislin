#!/usr/bin/env python3
"""Readiness regression tests using preserved real events; never launch a GUI."""
import ast
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock

from quiescence_local_launch_probe import REPO, rows, validate_readiness

OLD_COMMIT = "34ce22d"
RECEIPT = REPO / "evidence/quiescence-integration/local-launch-20261009T060641454564Z/launch-receipt.json"


class ReadinessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.receipt = json.loads(RECEIPT.read_text())
        source = subprocess.check_output(["git", "show", f"{OLD_COMMIT}:scripts/quiescence_local_launch_probe.py"], cwd=REPO, text=True)
        tree = ast.parse(source)
        statuses = [value for node in ast.walk(tree) if isinstance(node, ast.Dict)
                    for key, value in zip(node.keys, node.values)
                    if isinstance(key, ast.Constant) and key.value == "status" and isinstance(value, ast.IfExp)]
        assert len(statuses) == 1, "old actual status predicate must be unambiguous"
        cls.old_predicate = compile(ast.Expression(statuses[0]), "old-readiness-status", "eval")

    def setUp(self):
        r = self.receipt
        self.events = copy.deepcopy(r["runtime_events"])
        self.args = dict(root=Path(r["fixture_bundle_path"]).parents[2], session=r["session"],
                         executable=r["executable_path"], launcher_exit=0, timed_out=False,
                         controller_terminated=False, process_command=r["process_command"],
                         app_data_before=r["app_data_before"], app_data_after=r["app_data_after"],
                         synthetic_database_created=False)

    def verdict(self):
        return validate_readiness(self.events, **self.args)

    def test_real_complete_positive(self):
        self.assertTrue(self.verdict()["passed"], self.verdict())

    def test_old_ast_fatal_false_success_now_rejected(self):
        self.events[6]["detail"]["value"]["passed"] = False
        fatal = copy.deepcopy(self.events[4])
        fatal["detail"]["value"] = {"kind": "fatal_frontend_failure", "passed": False}
        self.events.insert(6, fatal)
        root = Mock()
        root.__truediv__ = Mock(return_value=Mock(exists=Mock(return_value=False)))
        environment = dict(boot=self.events[1], readiness=self.events[4], session=self.args["session"],
                           process_command=self.args["process_command"], Path=Path,
                           plist={"CFBundleExecutable": "quiescence-tauri"}, launcher_exit=0,
                           before=self.args["app_data_before"], after=self.args["app_data_after"], root=root)
        self.assertEqual(eval(self.old_predicate, {"__builtins__": {}}, environment), "PASS")
        self.assertFalse(self.verdict()["passed"])

    def test_each_required_binding_or_completion_rejects(self):
        mutations = [
            (0, ("pid",), 1), (7, ("pid",), 1), (1, ("sequence",), 99),
            (0, ("detail", "session"), "other"), (1, ("detail", "session"), "other"),
            (0, ("detail", "root"), "/other"), (1, ("detail", "app_data_dir"), "/other"),
            (0, ("detail", "actual_executable"), "/other"),
            (1, ("detail", "actual_executable"), "/other"),
            (1, ("detail", "production_setup_called"), True),
            (2, ("detail", "app_identifier"), "other"),
            (3, ("detail", "authenticated"), False), (5, ("detail", "authenticated"), False),
            (5, ("detail", "rejected_code"), "TOKEN_MISMATCH"),
            (5, ("detail", "request_id"), self.events[3]["detail"]["request_id"]),
            (4, ("detail", "value", "kind"), "fatal_frontend_failure"),
            (6, ("detail", "value", "passed"), False), (6, ("detail", "value", "passed"), 1),
            (6, ("detail", "value", "readiness_only"), False),
            (6, ("detail", "value", "assertions"), 1),
            (6, ("detail", "native", "running"), True),
            (6, ("detail", "native", "error"), {"code": "FAILED"}),
            (7, ("detail", "code"), 1), (7, ("detail", "prevented"), True),
        ]
        for index in (1, 2, 4, 6):
            mutations.extend((index, ("detail", field), "wrong") for field in ("scenario", "phase"))
        mutations.extend((6, ("detail", "value", field), "wrong") for field in ("scenario", "phase"))
        for index, path, value in mutations:
            with self.subTest(index=index, path=path, value=value):
                self.events = copy.deepcopy(self.receipt["runtime_events"])
                target = self.events[index]
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = value
                self.assertFalse(self.verdict()["passed"], self.verdict())

    def test_missing_duplicate_reorder_failed_assertion_and_corrupt(self):
        original = copy.deepcopy(self.events)
        for index in range(len(original)):
            with self.subTest(missing=index):
                self.events = copy.deepcopy(original)
                del self.events[index]
                self.assertFalse(self.verdict()["passed"])
        for kind in ("fatal_frontend_failure", "assertion"):
            self.events = copy.deepcopy(original)
            event = copy.deepcopy(original[4])
            event["detail"]["value"] = {"kind": kind, "passed": False}
            self.events.insert(5, event)
            self.assertFalse(self.verdict()["passed"])
        self.events = copy.deepcopy(original)
        self.events[4], self.events[6] = self.events[6], self.events[4]
        self.assertFalse(self.verdict()["passed"])
        self.events = original + [copy.deepcopy(original[-1])]
        self.assertFalse(self.verdict()["passed"])
        for events in ([], [None], ["corrupt"], original[:6] + [{"event": "frontend_complete"}, original[7]]):
            self.events = events
            self.assertFalse(self.verdict()["passed"])

    def test_launcher_zero_does_not_hide_timeout_or_controller_termination(self):
        for field, value in (("timed_out", True), ("controller_terminated", True),
                             ("launcher_exit", 1), ("journal_error", "truncated"),
                             ("process_command", "/other/quiescence-tauri"),
                             ("app_data_after", {}), ("synthetic_database_created", True)):
            with self.subTest(field=field):
                self.setUp()
                self.args[field] = value
                self.assertFalse(self.verdict()["passed"])

    def test_final_log_corruption_and_partial_record_refused(self):
        with tempfile.TemporaryDirectory(prefix="pfc-readiness-unit-") as directory:
            path = Path(directory) / "journal.jsonl"
            for raw in (b'{"event":', b'{}\n{"event":', b'not-json\n', b'null\n',
                        b'{"event":"frontend_evidence","detail":null}\n',
                        b'{"event":"frontend_evidence","detail":{"value":null}}\n'):
                path.write_bytes(raw)
                with self.assertRaises(ValueError):
                    rows(path, final=True)
            path.write_text(json.dumps(self.events[0]) + "\n")
            self.assertEqual(rows(path, final=True), self.events[:1])


if __name__ == "__main__":
    unittest.main()
