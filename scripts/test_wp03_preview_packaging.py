import unittest
from pathlib import Path

import build_wp03_product_preview as preview

ROOT = Path(__file__).resolve().parents[1]


class PreviewPackagingTests(unittest.TestCase):
    def test_parses_real_dwarfdump_line_and_rejects_malformed_rows(self):
        binary = "/tmp/wp03/cargo-target/release/personal-finance-console"
        output = "UUID: 0685AEAB-4B6A-3395-B427-A973B2589040 (arm64e) " + binary
        self.assertEqual(
            preview.parse_macho_uuids(output),
            [("0685AEAB-4B6A-3395-B427-A973B2589040", "arm64e", binary)],
        )
        self.assertEqual(preview.parse_macho_uuids("UUID: bad (arm64) /tmp/file"), [])

    def test_preview_manifest_is_source_mapped_to_the_bundle_resource_name(self):
        root = preview.OUTPUT_PARENT / "build-test"
        source = root / "runtime-compatibility.json"
        self.assertEqual(preview.preview_resource_mapping(source), {
            str(source): "runtime-compatibility.json",
        })
        with self.assertRaisesRegex(ValueError, "artifact root"):
            preview.preview_resource_mapping(Path("/tmp/unrelated/runtime-compatibility.json"))

    def test_finds_finderinfo_and_resource_fork_attributed_to_exact_paths(self):
        output = (
            "/tmp/preview.app: com.apple.FinderInfo: \n"
            "/tmp/preview.app/Contents/Resources/icon.icns: com.apple.ResourceFork: \n"
            "/tmp/preview.app/Contents/Info.plist: com.apple.provenance: value"
        )
        self.assertEqual(preview.find_codesign_forbidden_xattrs(output), output.splitlines()[:2])

    def test_acceptance_date_is_only_enabled_by_wp03_preview_build_and_identity(self):
        default_vite = (ROOT / "vite.config.ts").read_text()
        preview_builder = (ROOT / "scripts/build_wp03_product_preview.py").read_text()
        rust_runtime = (ROOT / "src-tauri/src/lib.rs").read_text()
        date_commands = (ROOT / "src-tauri/src/wp03_preview_test_date.rs").read_text()

        self.assertIn('__WP03_PREVIEW_BUILD__: "false"', default_vite)
        self.assertIn("__WP03_PREVIEW_BUILD__:true", preview_builder)
        self.assertIn('#[cfg(feature = "wp03-preview")]\nmod wp03_preview_test_date;', rust_runtime)
        self.assertIn("wp03_preview_test_date::wp03_preview_set_test_date", rust_runtime)
        self.assertIn("require_preview_identity(&app.config().identifier)", date_commands)
        self.assertNotIn("std::env", date_commands)

    def test_wp03_source_binds_acceptance_date_feature_and_identity(self):
        cargo = (ROOT / "src-tauri/Cargo.toml").read_text()
        isolation = (ROOT / "src-tauri/src/wp03_preview_isolation.rs").read_text()
        self.assertIn("wp03-preview = []", cargo)
        self.assertIn('pub const IDENTIFIER: &str = "com.personalfinance.console.wp03preview";', isolation)


if __name__ == "__main__":
    unittest.main()
