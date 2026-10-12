import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tauriSource = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const previewBuilder = readFileSync(
  new URL("../scripts/build_wp01_product_preview.py", import.meta.url),
  "utf8",
);

describe("WP-01 preview identity and simulation guard (static only)", () => {
  it("uses the existing guarded smoke identity with the normal product frontend", () => {
    expect(previewBuilder).toContain('IDENTIFIER = "com.personalfinance.console.smoke"');
    expect(previewBuilder).toContain('ROOT / "src/main.tsx"');
    expect(previewBuilder).toContain('"database_filename": "personal-finance-console.sqlite3"');
    expect(previewBuilder).toContain('"runtime-compatibility.json": None');
    expect(previewBuilder).toContain('return {str(manifest_path): "runtime-compatibility.json"}');
    expect(previewBuilder).toContain('"database_or_app_data_accessed": False');
    expect(tauriSource).toContain(
      'const PRODUCTION_IDENTIFIER: &str = "com.personalfinance.console"',
    );
    expect(tauriSource).toContain(
      'const PRODUCTION_DATABASE: &str = "personal-finance-console.sqlite3"',
    );
    expect(tauriSource).toContain("ensure_smoke_data_dir_isolated");
  });

  it("uses an isolated build target and never starts the resulting app", () => {
    expect(previewBuilder).toContain('"CARGO_TARGET_DIR"] = str(cargo_target)');
    expect(previewBuilder).toContain('vite_config_path = output / "vite.wp01.preview.config.mjs"');
    expect(previewBuilder).toContain("outDir:%s");
    expect(previewBuilder).toContain('"npx", "tauri", "bundle"');
    expect(previewBuilder).toContain('"app_launched": False');
    expect(previewBuilder).toContain('"codesign", "--force", "--deep"');
    expect(previewBuilder).toContain('receipt["bundle_executable_uuid"] = bundled_rows[0][0]');
    expect(previewBuilder).not.toContain('"npx", "tauri", "dev"');
    expect(previewBuilder).not.toContain('"npx", "tauri", "build"');
  });
});
