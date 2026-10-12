import tempfile
import unittest
from pathlib import Path

from production_v4_release_gate import (
    GateBlocked,
    UNIFIED_SYNTHETIC_BUNDLE_ID,
    UNIFIED_SYNTHETIC_MARKER,
    _validate_synthetic_gate_root,
    validate_manifest,
)
from quiescence_gate import Blocked, MARKER, UNIFIED_MARKER, fixture_root


class UnifiedRootContractTests(unittest.TestCase):
    def setUp(self):
        self.parent = Path(tempfile.mkdtemp(prefix="r2b1-contract-")).resolve()
        self.root = self.parent / "root"
        self.root.mkdir()

    def tearDown(self):
        import shutil
        shutil.rmtree(self.parent)

    def marker(self, content):
        (self.root / "SYNTHETIC_ONLY").write_bytes(content)

    def test_unified_marker_is_explicitly_accepted_by_both_components(self):
        self.marker(UNIFIED_SYNTHETIC_MARKER)
        self.assertEqual(_validate_synthetic_gate_root(self.root, unified_r2b=True), self.root)
        self.assertEqual(fixture_root(self.root, mode="unified-r2b"), self.root)

    def test_legacy_markers_are_not_unified_markers(self):
        for value in (MARKER.encode(), b"PFC_WP04R2A_GATE_SYNTHETIC_V1\n", b"wrong\n"):
            with self.subTest(value=value):
                self.marker(value)
                with self.assertRaises(GateBlocked):
                    _validate_synthetic_gate_root(self.root, unified_r2b=True)
                with self.assertRaises(Blocked):
                    fixture_root(self.root, mode="unified-r2b")

    def test_unified_mode_is_never_inferred_from_marker(self):
        self.marker(UNIFIED_SYNTHETIC_MARKER)
        with self.assertRaises(GateBlocked):
            _validate_synthetic_gate_root(self.root)
        with self.assertRaises(Blocked):
            fixture_root(self.root)

    def test_unified_manifest_has_one_fixed_bundle_identity(self):
        manifest = {"manifestFormatVersion": 1, "runtimeGeneration": 4,
                    "maxSupportedSchemaVersion": 4, "minSupportedSchemaVersion": 3,
                    "bundleId": UNIFIED_SYNTHETIC_BUNDLE_ID,
                    "executable": "Contents/MacOS/personal-finance-console"}
        bundle = {"manifest": manifest, "executable_name": "personal-finance-console"}
        self.assertEqual(validate_manifest(bundle, expected_bundle_id=UNIFIED_SYNTHETIC_BUNDLE_ID), [])
        manifest["bundleId"] = "com.personalfinance.console"
        self.assertTrue(validate_manifest(bundle, expected_bundle_id=UNIFIED_SYNTHETIC_BUNDLE_ID))

    def test_symlink_marker_is_rejected(self):
        marker = self.root / "SYNTHETIC_ONLY"
        marker.write_bytes(UNIFIED_SYNTHETIC_MARKER)
        marker.replace(self.root / "marker-target")
        marker.symlink_to(self.root / "marker-target")
        with self.assertRaises(GateBlocked):
            _validate_synthetic_gate_root(self.root, unified_r2b=True)
        with self.assertRaises(Blocked):
            fixture_root(self.root, mode="unified-r2b")


if __name__ == "__main__":
    unittest.main()
