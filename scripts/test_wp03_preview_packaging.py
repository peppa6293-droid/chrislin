import unittest
from pathlib import Path

import build_wp03_product_preview as preview


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


if __name__ == "__main__":
    unittest.main()
