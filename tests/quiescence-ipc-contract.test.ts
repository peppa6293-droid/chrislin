import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("isolated Q11 frontend/runtime boundaries (source regression only; not Q11 substitute)", () => {
  const frontend = readFileSync(new URL("../quiescence-web/main.ts", import.meta.url), "utf8");
  const native = readFileSync(
    new URL("../src-tauri/src/bin/quiescence_tauri.rs", import.meta.url),
    "utf8",
  );
  const controller = readFileSync(
    new URL("../scripts/quiescence_ipc_tests.py", import.meta.url),
    "utf8",
  );
  const packager = readFileSync(
    new URL("../scripts/package_quiescence_runtime.py", import.meta.url),
    "utf8",
  );
  const config = JSON.parse(
    readFileSync(new URL("../src-tauri/tauri.quiescence.conf.json", import.meta.url), "utf8"),
  ) as { identifier: string };
  const packageConfig = JSON.parse(
    readFileSync(
      new URL("../src-tauri/tauri.quiescence.package.conf.json", import.meta.url),
      "utf8",
    ),
  ) as {
    identifier: string;
    mainBinaryName: string;
    bundle: { resources: Record<string, string | null> };
  };
  const isolatedManifest = JSON.parse(
    readFileSync(
      new URL("../src-tauri/quiescence-runtime-compatibility.json", import.meta.url),
      "utf8",
    ),
  ) as {
    bundleId: string;
    executable: string;
  };
  const productionManifest = JSON.parse(
    readFileSync(new URL("../src-tauri/runtime-compatibility.json", import.meta.url), "utf8"),
  ) as {
    bundleId: string;
  };
  it("uses bundled TypeScript real invoke and a separate Tauri identity", () => {
    expect(frontend).toContain('import { invoke } from "@tauri-apps/api/core"');
    expect(config.identifier).toBe("org.pfc.quiescence.integration");
    expect(native).toContain(".incognito(true)");
    expect(native).toContain("quiescence::run_integrated");
  });
  it("drives actual window close and actual document navigation", () => {
    expect(frontend).toContain("await getCurrentWindow().close()");
    expect(frontend).toContain("window.location.replace(");
    expect(native).toContain("WindowEvent::CloseRequested");
    expect(native).toContain("RunEvent::ExitRequested");
    expect(native).toContain(".on_navigation(");
  });
  it("does not expose SQL or commit or a production entrypoint to the page", () => {
    expect(native).toContain('"EARLY_COMMIT_FORBIDDEN_NATIVE_ONLY"');
    expect(native).toContain('"EARLY_END_FORBIDDEN_NATIVE_ONLY"');
    expect(native).toContain('"BUSINESS_IPC_BLOCKED_DURING_CUTOVER"');
    expect(native).not.toContain("personal_finance_console_lib::run");
    expect(frontend).not.toMatch(/node:sqlite|child_process|mockIPC|mockInvoke/);
  });
  it("rejects an incorrect compiled config before Tauri can create default windows", () => {
    const guard = native.indexOf("if context.config().identifier!=APP_ID");
    const builder = native.indexOf("let app=tauri::Builder::default()");
    expect(guard).toBeGreaterThan(0);
    expect(builder).toBeGreaterThan(guard);
    expect(native).toContain("!context.config().app.windows.is_empty()");
    expect(native).toContain("context.config().build.dev_url.is_some()");
    expect(native).toContain("ISOLATED_CONTEXT_REJECTED_BEFORE_TAURI_BUILD");
  });
  it("preserves failed-process identity and avoids invented zero-side-effect attestations", () => {
    expect(controller).toContain('"provenance": "external_process_controller_not_IPC"');
    expect(controller).toContain('"pid": process.pid');
    expect(controller).toContain('"exit_code": process.returncode');
    expect(controller).toContain('"stdout_sha256": sha(output.name)');
    expect(controller).toContain('"os_profile_side_effects": "NOT_INDEPENDENTLY_AUDITED"');
    expect(controller).not.toContain('"production_access":');
    expect(packager).toContain('"--config", "src-tauri/tauri.quiescence.conf.json"');
    expect(packager).toContain('"src-tauri/tauri.quiescence.package.conf.json"');
    expect(packager).toContain(
      '"--bin", "quiescence-tauri", "--message-format=json-render-diagnostics"',
    );
    expect(packager).toContain('"npx", "tauri", "bundle"');
    expect(packager).not.toContain('["npx", "tauri", "build"');
    expect(packager).toContain('provenance["prebundle_uuid"]');
    expect(controller).toContain('"--build-only"');
    expect(controller).toContain("Contents/MacOS/quiescence-tauri");
  });
  it("binds the isolated bundle entry to Q11 and excludes the Production manifest", () => {
    expect(packageConfig.identifier).toBe("org.pfc.quiescence.integration");
    expect(packageConfig.mainBinaryName).toBe("quiescence-tauri");
    expect(packageConfig.bundle.resources["runtime-compatibility.json"]).toBeNull();
    expect(packageConfig.bundle.resources["quiescence-runtime-compatibility.json"]).toBe(
      "runtime-compatibility.json",
    );
    expect(isolatedManifest.bundleId).toBe(packageConfig.identifier);
    expect(isolatedManifest.executable).toBe("Contents/MacOS/quiescence-tauri");
    expect(productionManifest.bundleId).toBe("com.personalfinance.console");
    expect(productionManifest.bundleId).not.toBe(packageConfig.identifier);
  });
});
