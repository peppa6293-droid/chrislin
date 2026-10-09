#!/usr/bin/env python3
"""Pure temporary-fixture receipt checks; no builds, apps, or original evidence writes."""
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import package_quiescence_runtime as package


class ProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pfc-package-provenance-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.repo_patch = patch.object(package, "REPO", self.root)
        self.repo_patch.start()
        self.addCleanup(self.repo_patch.stop)
        self.sources = {"src-tauri/src/bin/quiescence_tauri.rs": "a" * 64, "Cargo.lock": "b" * 64}
        self.build = self.root / "src-tauri/target/isolated-quiescence-test"
        self.binary = self.build / "release/quiescence-tauri"
        self.app = self.build / "release/bundle/macos/PFC Isolated Quiescence IPC.app"
        self.entry = self.app / "Contents/MacOS/quiescence-tauri"
        for file, contents in [(self.binary, b"candidate A"), (self.entry, b"signed candidate A"),
                (self.app / "Contents/Info.plist", b"plist A"),
                (self.app / "Contents/Resources/runtime-compatibility.json", b"manifest A")]:
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(contents)
        artifact = {"reason": "compiler-artifact", "target": {"kind": ["bin"], "name": package.EXECUTABLE,
            "src_path": str(self.root / "src-tauri/src/bin/quiescence_tauri.rs")},
            "manifest_path": str(self.root / "src-tauri/Cargo.toml"), "executable": str(self.binary), "filenames": [str(self.binary)]}
        self.uuid = "12345678-1234-1234-1234-123456789ABC"
        self.uuid_output = "".join(f"UUID: {self.uuid} (arm64) {p}\n" for p in [self.entry, self.binary])
        commands = []
        for index, argv in enumerate(package.expected_commands()):
            item = {"argv": argv, "exit_code": 0}
            for stream in ("stdout", "stderr"):
                log = self.root / f"command-{index}.{stream}"
                log.write_text(json.dumps(artifact) + "\n" if index == 2 and stream == "stdout" else "log\n")
                item[stream + "_path"] = str(log)
                item[stream + "_sha256"] = package.sha(log)
            commands.append(item)
        self.receipt = {"format_version": 1, "synthetic_only": True, "receipt_kind": "build", "status": package.PASS_STATUS,
            "signing_identity": package.EXPECTED_IDENTITY, "source_sha256_before": self.sources.copy(),
            "source_sha256_after": self.sources.copy(), "build_target_dir": str(self.build), "commands": commands,
            "isolated_compiler_artifact": artifact, "prebundle_uuid": self.uuid, "prebundle_binary_sha256": package.sha(self.binary),
            "app_bundle": {"path": str(self.app), "executable": str(self.entry), "cargo_binary": str(self.binary),
                "bundle_identifier": package.IDENTIFIER, "executable_sha256": package.sha(self.entry),
                "cargo_binary_sha256": package.sha(self.binary), "info_plist_sha256": package.sha(self.app / "Contents/Info.plist"),
                "runtime_manifest_sha256": package.sha(self.app / "Contents/Resources/runtime-compatibility.json"),
                "mach_o_uuid_binding": self.uuid_output}}
        self.run_patch = patch.object(package.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, self.uuid_output, ""))
        self.mock_run = self.run_patch.start()
        self.addCleanup(self.run_patch.stop)

    def validate(self, receipt=None, sources=None):
        return package.validate_prior_receipt(self.receipt if receipt is None else receipt,
            self.sources if sources is None else sources, package.EXPECTED_IDENTITY)

    def test_a_build_a_sources_pass_without_mutating_receipt(self):
        original = copy.deepcopy(self.receipt)
        self.assertEqual(self.validate(), self.build)
        self.assertEqual(original, self.receipt)

    def test_a_build_b_sources_rejected(self):
        changed = dict(self.sources, **{"src-tauri/src/bin/quiescence_tauri.rs": "c" * 64})
        with self.assertRaises(RuntimeError): self.validate(sources=changed)

    def test_failed_incomplete_and_wrong_type_receipts_rejected(self):
        for field, value in [("status", "BUILD_OR_SIGNATURE_FAILED"), ("status", "SOURCE_DRIFT_DURING_BUILD"),
                ("receipt_kind", "revalidation"), ("format_version", True), ("synthetic_only", 1),
                ("commands", self.receipt["commands"][:3]), ("commands", list(reversed(self.receipt["commands"]))),
                ("source_sha256_before", {}), ("source_sha256_after", {"partial": "a" * 64})]:
            with self.subTest(field=field, value=value):
                r = copy.deepcopy(self.receipt); r[field] = value
                with self.assertRaises(RuntimeError): self.validate(r)
        with self.assertRaises(RuntimeError): self.validate([])

    def test_exit_must_be_explicit_integer_zero(self):
        for value in [None, False, True, "0", 0.0, 1, -9, "missing"]:
            r = copy.deepcopy(self.receipt)
            if value == "missing": del r["commands"][1]["exit_code"]
            else: r["commands"][1]["exit_code"] = value
            with self.subTest(value=value), self.assertRaises(RuntimeError): self.validate(r)

    def test_original_log_drift_rejected(self):
        Path(self.receipt["commands"][0]["stderr_path"]).write_text("tampered")
        with self.assertRaises(RuntimeError): self.validate()

    def test_equal_but_incomplete_original_source_maps_rejected(self):
        r = copy.deepcopy(self.receipt)
        del r["source_sha256_before"]["Cargo.lock"]
        del r["source_sha256_after"]["Cargo.lock"]
        with self.assertRaises(RuntimeError): self.validate(r)

    def test_changed_actual_uuid_and_changed_entry_bytes_rejected(self):
        self.mock_run.return_value = subprocess.CompletedProcess([], 0, self.uuid_output.replace(self.uuid, "DIFFERENT"), "")
        with self.assertRaises(RuntimeError): self.validate()
        self.mock_run.return_value = subprocess.CompletedProcess([], 0, self.uuid_output, "")
        self.entry.write_bytes(b"signed B")
        with self.assertRaises(RuntimeError): self.validate()

    def test_build_directory_drift_rejected(self):
        r = copy.deepcopy(self.receipt)
        other = self.build.parent / "isolated-quiescence-other"
        other.mkdir()
        r["build_target_dir"] = str(other)
        with self.assertRaises(RuntimeError): self.validate(r)

    def test_artifact_source_name_path_builddir_and_log_mismatch_rejected(self):
        for field, value in [("src_path", "/wrong.rs"), ("name", "personal-finance-console")]:
            r = copy.deepcopy(self.receipt); r["isolated_compiler_artifact"]["target"][field] = value
            with self.subTest(field=field), self.assertRaises(RuntimeError): self.validate(r)
        for field, value in [("executable", str(self.entry)), ("manifest_path", "/wrong/Cargo.toml")]:
            r = copy.deepcopy(self.receipt); r["isolated_compiler_artifact"][field] = value
            with self.subTest(field=field), self.assertRaises(RuntimeError): self.validate(r)
        r = copy.deepcopy(self.receipt); r["isolated_compiler_artifact"]["fresh"] = True
        with self.assertRaises(RuntimeError): self.validate(r)

    def test_entry_candidate_identity_hash_and_uuid_mismatch_rejected(self):
        for field, value in [("bundle_identifier", "wrong"), ("executable", str(self.binary)),
                ("executable_sha256", "0" * 64), ("cargo_binary_sha256", "0" * 64)]:
            r = copy.deepcopy(self.receipt); r["app_bundle"][field] = value
            with self.subTest(field=field), self.assertRaises(RuntimeError): self.validate(r)
        r = copy.deepcopy(self.receipt); r["prebundle_uuid"] = "wrong"
        with self.assertRaises(RuntimeError): self.validate(r)
        self.binary.write_bytes(b"candidate B")
        with self.assertRaises(RuntimeError): self.validate()


if __name__ == "__main__":
    unittest.main()
