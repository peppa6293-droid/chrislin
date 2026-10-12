#!/usr/bin/env python3
"""Build and source-bind the WP-03 synthetic preview without launching it."""
from __future__ import annotations

import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import stat
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PARENT = ROOT / "artifacts/wp03-isolated-product-preview-20261012"
IDENTIFIER = "com.personalfinance.console.wp03preview"
PRODUCTION_IDENTIFIER = "com.personalfinance.console"
EXECUTABLE = "personal-finance-console"
PRODUCT_NAME = "小钱家 WP-03 测试版"
SIGNING_IDENTITY = "Apple Development: 8619814730147 (FW5KHTFNZ6)"
MACH_O_UUID = re.compile(r"UUID:\s+(\S+)\s+\(([^)]+)\)\s+(.+)")
UUID_VALUE = re.compile(r"[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}")


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def source_paths() -> list[Path]:
    return [
        ROOT / "src", ROOT / "migrations", ROOT / "src-tauri/src",
        ROOT / "src-tauri/capabilities", ROOT / "src-tauri/build.rs",
        ROOT / "src-tauri/Cargo.toml", ROOT / "src-tauri/Cargo.lock",
        ROOT / "src-tauri/tauri.conf.json", ROOT / "src-tauri/tauri.smoke.conf.json",
        ROOT / "src-tauri/runtime-compatibility.json",
        ROOT / "src/persistence/migrations.ts", ROOT / "package.json",
        ROOT / "package-lock.json", ROOT / "vite.config.ts", ROOT / "index.html",
        ROOT / "tsconfig.json", ROOT / "tsconfig.build.json", ROOT / "tsconfig.quiescence.json",
        ROOT / "tests",
        ROOT / "node_modules/@biomejs/biome", ROOT / "node_modules/@tauri-apps/api",
        ROOT / "node_modules/@tauri-apps/cli", ROOT / "node_modules/@testing-library/react",
        ROOT / "node_modules/@testing-library/user-event", ROOT / "node_modules/@types/node",
        ROOT / "node_modules/@types/react", ROOT / "node_modules/@types/react-dom",
        ROOT / "node_modules/@vitejs/plugin-react", ROOT / "node_modules/decimal.js",
        ROOT / "node_modules/happy-dom", ROOT / "node_modules/react", ROOT / "node_modules/react-dom",
        ROOT / "node_modules/typescript", ROOT / "node_modules/vite", ROOT / "node_modules/vitest",
        ROOT / "scripts/build_wp03_product_preview.py",
        ROOT / "scripts/test_wp03_preview_packaging.py",
        ROOT / "src-tauri/src/wp03_preview_isolation.rs",
    ]


def tree_hashes(paths: list[Path]) -> dict[str, str]:
    files: set[Path] = set()
    for path in paths:
        if path.is_dir():
            files.update(item for item in path.rglob("*") if item.is_file())
        elif path.is_file():
            files.add(path)
    return {str(path.relative_to(ROOT)): sha(path) for path in sorted(files)}


def parse_macho_uuids(output: str) -> list[tuple[str, str, str]]:
    rows = []
    for line in output.splitlines():
        match = MACH_O_UUID.fullmatch(line)
        if match and UUID_VALUE.fullmatch(match.group(1)):
            rows.append(match.groups())
    return rows


def find_codesign_forbidden_xattrs(output: str) -> list[str]:
    forbidden = ("com.apple.FinderInfo", "com.apple.ResourceFork")
    return [line for line in output.splitlines() if any(name in line for name in forbidden)]


def preview_resource_mapping(manifest_path: Path) -> dict[str, str]:
    if not manifest_path.is_absolute() or not manifest_path.is_relative_to(OUTPUT_PARENT):
        raise ValueError("preview runtime manifest source must stay within the WP-03 artifact root")
    return {str(manifest_path): "runtime-compatibility.json"}


def save(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def capture_signing_stage(stage: str, output: Path, app: Path | None = None,
                          resources: list[Path] | None = None) -> dict[str, str]:
    """Capture xattrs and filesystem metadata at one native packaging boundary."""
    folder = output / "signing-timeline" / stage
    folder.mkdir(parents=True, exist_ok=True)
    roots = [path for path in (resources or []) if path.exists()]
    if app is not None and app.exists():
        roots.append(app)
    xattrs, inventory, stats = [], [], []
    for root in roots:
        inventory.append(f"## {root}\n")
        listing = subprocess.run(["find", str(root), "-print"], capture_output=True, text=True)
        inventory.append(listing.stdout)
        attrs = subprocess.run(["xattr", "-lr", str(root)], capture_output=True, text=True)
        xattrs.append(f"## {root}\n{attrs.stdout or '(no extended attributes reported)'}")
        entries = [root, *root.rglob("*")] if root.is_dir() else [root]
        for entry in entries:
            try:
                info = entry.lstat()
                stats.append(
                    f"{entry}\tmode={stat.filemode(info.st_mode)}\tuid={info.st_uid}"
                    f"\tgid={info.st_gid}\tnlink={info.st_nlink}\tsize={info.st_size}"
                    f"\tmtime_ns={info.st_mtime_ns}\tinode={info.st_ino}\n"
                )
            except OSError as error:
                stats.append(f"{entry}\tSTAT_ERROR={error!r}\n")
    files = {
        "bundle-inventory.txt": "\n".join(inventory),
        "bundle-xattrs.txt": "\n".join(xattrs),
        "bundle-stat.txt": "\n".join(stats),
    }
    if app is not None and app.exists():
        signature = subprocess.run(["codesign", "-dv", "--verbose=4", str(app)],
                                   capture_output=True, text=True)
        files["codesign.txt"] = signature.stdout + signature.stderr
    hashes = {}
    for name, content in files.items():
        path = folder / name
        path.write_text(content)
        hashes[name] = sha(path)
    return hashes


def run(argv: list[str], env: dict[str, str], logs: Path, name: str, timeout: int = 1200) -> dict:
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        result = subprocess.run(argv, cwd=ROOT, env=env, capture_output=True, text=True, timeout=timeout)
        stdout, stderr, exit_code, timed_out = result.stdout, result.stderr, result.returncode, False
    except subprocess.TimeoutExpired as error:
        stdout = error.stdout.decode() if isinstance(error.stdout, bytes) else (error.stdout or "")
        stderr = error.stderr.decode() if isinstance(error.stderr, bytes) else (error.stderr or "")
        exit_code, timed_out = None, True
    out_path, err_path = logs / (name + ".stdout.txt"), logs / (name + ".stderr.txt")
    out_path.write_text(stdout)
    err_path.write_text(stderr)
    return {
        "argv": argv, "cwd": str(ROOT), "started_at": started,
        "finished_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "exit_code": exit_code, "timed_out": timed_out,
        "stdout_path": str(out_path), "stderr_path": str(err_path),
        "stdout_sha256": sha(out_path), "stderr_sha256": sha(err_path),
    }


def fail(receipt: dict, output: Path, message: str) -> int:
    receipt["status"] = "BLOCKED_WITH_EVIDENCE"
    receipt["error"] = message
    receipt["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save(output / "build-record.json", receipt)
    print(json.dumps({"status": receipt["status"], "error": message, "output": str(output)}))
    return 2


def main() -> int:
    requested_output = os.environ.get("WP03_BUILD_OUTPUT_DIR")
    if requested_output:
        output = Path(requested_output).expanduser().resolve()
        if not output.is_relative_to(OUTPUT_PARENT) or output.exists():
            raise SystemExit("WP03_BUILD_OUTPUT_DIR must be a fresh directory under the WP-03 artifact root")
    else:
        build_number = 1
        while True:
            output = OUTPUT_PARENT / ("build-%02d" % build_number)
            if not output.exists():
                break
            build_number += 1
    output.mkdir(parents=True, exist_ok=False)
    logs = output / "logs"
    logs.mkdir()
    frontend = output / "frontend"
    frontend.mkdir()
    vite_config_path = output / "vite.wp03.preview.config.mjs"
    cargo_target = output / "cargo-target"
    app_config_path = output / "tauri.wp03.preview.json"
    manifest_path = output / "runtime-compatibility.json"
    config = {
        "productName": PRODUCT_NAME, "version": "0.1.0", "identifier": IDENTIFIER,
        "mainBinaryName": EXECUTABLE,
        "build": {"beforeDevCommand": None, "devUrl": None, "beforeBuildCommand": None,
                  "frontendDist": str(frontend)},
        "app": {"windows": [{"title": PRODUCT_NAME, "width": 840, "height": 580,
                              "minWidth": 640, "minHeight": 420}]},
        "bundle": {"active": True, "targets": ["app"],
            "resources": {
                "runtime-compatibility.json": None,
                **preview_resource_mapping(manifest_path),
            },
                   "macOS": {"minimumSystemVersion": "11.0"}},
    }
    manifest = {
        "manifestFormatVersion": 1, "runtimeGeneration": 4,
        "minSupportedSchemaVersion": 1, "maxSupportedSchemaVersion": 4,
        "bundleId": IDENTIFIER, "executable": "Contents/MacOS/" + EXECUTABLE,
    }
    save(app_config_path, config)
    save(manifest_path, manifest)
    vite_config = (
        "import base from %s;\n" % json.dumps((ROOT / "vite.config.ts").as_uri())
        + "export default {...base,cacheDir:%s,build:{...base.build,outDir:%s,emptyOutDir:true}};\n"
        % (json.dumps(str(output / "vite-cache")), json.dumps(str(frontend)))
    )
    vite_config_path.write_text(vite_config)
    receipt = {
        "format_version": 1,
        "work_order": "WP-03 product daily-use completion and isolated macOS black-box verification",
        "synthetic_only": True, "status": "RUNNING", "output_root": str(output),
        "app_launched": False, "existing_app_data_accessed": False,
        "production_database_accessed": False, "install_or_replace": False,
        "migration_or_restore": False,
        "source_git_head": subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
        ).stdout.strip(),
        "bundle_identifier": IDENTIFIER, "production_identifier": PRODUCTION_IDENTIFIER,
        "bundle_executable": EXECUTABLE,
        "preview_database_filename": "personal-finance-console.sqlite3",
        "data_route": "Tauri app_data_dir under the WP-03 preview Bundle ID; path not created or accessed because the app was not launched.",
        "signing_identity": SIGNING_IDENTITY, "commands": [],
    }
    try:
        timeline_resources = [
            ROOT / "src", ROOT / "src-tauri/src", ROOT / "src-tauri/icons",
            ROOT / "src-tauri/build.rs", ROOT / "src-tauri/Cargo.toml",
            ROOT / "src-tauri/tauri.conf.json", ROOT / "src-tauri/runtime-compatibility.json",
            ROOT / "scripts/build_wp03_product_preview.py",
        ]
        receipt["signing_timeline"] = {
            "S0_source_prebuild": capture_signing_stage("S0-source-prebuild", output,
                                                        resources=timeline_resources)
        }
        identity = subprocess.run(
            ["security", "find-identity", "-v", "-p", "codesigning"],
            capture_output=True, text=True, check=True,
        )
        if SIGNING_IDENTITY not in identity.stdout:
            return fail(receipt, output, "APPROVED_LOCAL_DEVELOPMENT_SIGNING_IDENTITY_UNAVAILABLE")
        receipt["signing_identity_probe"] = {"stdout": identity.stdout, "stderr": identity.stderr}
        inputs = tree_hashes(source_paths())
        receipt["source_sha256_before"] = inputs
        receipt["source_input_file_count"] = len(inputs)
        receipt["source_inputs"] = [str(path.relative_to(ROOT)) for path in source_paths()]
        receipt["config_path"] = str(app_config_path)
        receipt["config_sha256"] = sha(app_config_path)
        receipt["manifest_path"] = str(manifest_path)
        receipt["manifest_sha256"] = sha(manifest_path)
        receipt["vite_config_path"] = str(vite_config_path)
        receipt["vite_config_sha256"] = sha(vite_config_path)
        npm_tree = subprocess.run(
            ["npm", "ls", "--depth=0", "--json"], cwd=ROOT, capture_output=True, text=True
        )
        npm_tree_path = output / "npm-installed-tree.json"
        npm_tree_path.write_text(npm_tree.stdout)
        receipt["npm_installed_tree"] = {
            "argv": ["npm", "ls", "--depth=0", "--json"],
            "exit_code": npm_tree.returncode,
            "stdout_path": str(npm_tree_path),
            "stdout_sha256": sha(npm_tree_path),
            "stderr": npm_tree.stderr,
        }
        if npm_tree.returncode != 0:
            return fail(receipt, output, "NPM_INSTALLED_DEPENDENCY_TREE_INVALID")
        receipt["toolchain"] = {
            "python": sys.version,
            "platform": sys.platform,
            "node": subprocess.run(["node", "--version"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip(),
            "npm": subprocess.run(["npm", "--version"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip(),
            "cargo": subprocess.run(["cargo", "--version"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip(),
            "rustc": subprocess.run(["rustc", "--version"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip(),
            "vite": subprocess.run(["npx", "vite", "--version"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip(),
            "tauri_cli": subprocess.run(["npx", "tauri", "--version"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip(),
        }

        for index, argv in enumerate([
            ["npx", "tsc", "--noEmit"],
            [sys.executable, "-m", "unittest", "discover", "-s", "scripts", "-p",
             "test_wp03_preview_packaging.py", "-v"],
            ["npx", "vitest", "run", "tests/financial-maintenance-service.test.ts",
             "tests/ui.test.tsx", "tests/smoke-identity.test.ts", "tests/wp01-product-preview-identity.test.ts"],
            ["npx", "vitest", "run", "tests/v4-four-p1-correction.test.ts"],
        ], start=1):
            item = run(argv, os.environ.copy(), logs, "simulation-%02d" % index, timeout=900)
            receipt["commands"].append(item)
            if item["exit_code"] != 0 or item["timed_out"]:
                return fail(receipt, output, "SYNTHETIC_SIMULATION_FAILED_%02d" % index)

        env = os.environ.copy()
        env["CARGO_TARGET_DIR"] = str(cargo_target)
        env["TAURI_CONFIG"] = json.dumps(config, ensure_ascii=False)
        item = run(
            ["npx", "vite", "build", "--config", str(vite_config_path)],
            env, logs, "frontend-build",
        )
        receipt["commands"].append(item)
        if item["exit_code"] != 0 or item["timed_out"]:
            return fail(receipt, output, "FRONTEND_BUILD_FAILED")
        receipt["signing_timeline"]["S1_web_build_complete"] = capture_signing_stage(
            "S1-web-build-complete", output, resources=[frontend, app_config_path, manifest_path]
        )

        cargo_binary = cargo_target / "release" / EXECUTABLE
        item = run(
            ["cargo", "build", "--manifest-path", "src-tauri/Cargo.toml", "--release",
             "--features", "wp03-preview,tauri/custom-protocol", "--bin", EXECUTABLE,
             "--message-format=json-render-diagnostics", "--target-dir", str(cargo_target)],
            env, logs, "cargo-build",
        )
        receipt["commands"].append(item)
        if item["exit_code"] != 0 or item["timed_out"]:
            return fail(receipt, output, "NATIVE_BUILD_FAILED")
        cargo_records = [
            json.loads(line) for line in Path(item["stdout_path"]).read_text().splitlines()
            if line.startswith("{")
        ]
        artifacts = [
            row for row in cargo_records
            if row.get("reason") == "compiler-artifact"
            and row.get("target", {}).get("name") == EXECUTABLE
            and row.get("executable")
        ]
        source = str(ROOT / "src-tauri/src/main.rs")
        if (
            len(artifacts) != 1
            or artifacts[0].get("target", {}).get("kind") != ["bin"]
            or artifacts[0].get("target", {}).get("src_path") != source
            or artifacts[0].get("manifest_path") != str(ROOT / "src-tauri/Cargo.toml")
            or artifacts[0].get("executable") != str(cargo_binary)
            or artifacts[0].get("filenames") != [str(cargo_binary)]
        ):
            return fail(receipt, output, "CARGO_ARTIFACT_SOURCE_OR_ENTRY_MISMATCH")
        receipt["compiler_artifact"] = artifacts[0]
        receipt["cargo_binary_sha256"] = sha(cargo_binary)
        uuid_text = subprocess.run(
            ["dwarfdump", "--uuid", str(cargo_binary)], capture_output=True, text=True, check=True
        ).stdout
        uuid_rows = parse_macho_uuids(uuid_text)
        if len(uuid_rows) != 1 or uuid_rows[0][2] != str(cargo_binary):
            return fail(receipt, output, "CARGO_BINARY_UUID_INVALID")
        receipt["cargo_binary_uuid"] = uuid_rows[0][0]
        receipt["signing_timeline"]["S2_native_binary_built"] = capture_signing_stage(
            "S2-native-binary-built", output, resources=[cargo_binary]
        )

        item = run(
            ["npx", "tauri", "bundle", "--config", str(app_config_path),
             "--features", "wp03-preview,tauri/custom-protocol", "--bundles", "app", "--no-binary-patching"],
            env, logs, "tauri-bundle",
        )
        receipt["commands"].append(item)
        if item["exit_code"] != 0 or item["timed_out"]:
            return fail(receipt, output, "TAURI_BUNDLE_FAILED")
        apps = sorted((cargo_target / "release/bundle/macos").glob("*.app"))
        if len(apps) != 1:
            return fail(receipt, output, "EXPECTED_ONE_PREVIEW_APP_BUNDLE")
        app = apps[0]
        receipt["signing_timeline"]["S3_bundle_first_created"] = capture_signing_stage(
            "S3-bundle-first-created", output, app, [frontend, app_config_path, manifest_path]
        )
        receipt["signing_timeline"]["S4_before_sanitation"] = capture_signing_stage(
            "S4-before-sanitation", output, app, [frontend, app_config_path, manifest_path]
        )
        info = app / "Contents/Info.plist"
        plist = plistlib.loads(info.read_bytes())
        if plist.get("CFBundleIdentifier") != IDENTIFIER or plist.get("CFBundleExecutable") != EXECUTABLE:
            return fail(receipt, output, "PREVIEW_BUNDLE_IDENTITY_MISMATCH")
        executable = app / "Contents/MacOS" / EXECUTABLE
        if not executable.is_file():
            return fail(receipt, output, "BUNDLED_EXECUTABLE_MISSING")
        unsigned_sha = sha(executable)
        unsigned_uuid = parse_macho_uuids(subprocess.run(
            ["dwarfdump", "--uuid", str(executable)], capture_output=True, text=True, check=True
        ).stdout)
        if (unsigned_sha != receipt["cargo_binary_sha256"] or len(unsigned_uuid) != 1
                or unsigned_uuid[0][0] != receipt["cargo_binary_uuid"]
                or unsigned_uuid[0][2] != str(executable)):
            return fail(receipt, output, "BUNDLE_SOURCE_EXECUTABLE_BINDING_FAILED")
        bundled_manifest = app / "Contents/Resources/runtime-compatibility.json"
        if json.loads(bundled_manifest.read_text()) != manifest:
            receipt["unexpected_bundled_manifest"] = {
                "path": str(bundled_manifest),
                "sha256": sha(bundled_manifest),
                "expected_sha256": sha(manifest_path),
                "bundle_id": json.loads(bundled_manifest.read_text()).get("bundleId"),
            }
            return fail(receipt, output, "PREVIEW_RUNTIME_MANIFEST_IDENTITY_MISMATCH")
        receipt["unsigned_bundle_entry_sha256"] = unsigned_sha
        receipt["unsigned_bundle_entry_uuid"] = unsigned_uuid[0][0]
        clear_xattrs = subprocess.run(
            ["xattr", "-cr", str(app)], capture_output=True, text=True
        )
        receipt["commands"].append({
            "command": ["xattr", "-cr", str(app)],
            "exit_code": clear_xattrs.returncode,
            "stdout": clear_xattrs.stdout,
            "stderr": clear_xattrs.stderr,
        })
        if clear_xattrs.returncode != 0:
            return fail(receipt, output, "PREVIEW_BUNDLE_XATTR_CLEANUP_FAILED")
        receipt["signing_timeline"]["S5_after_sanitation"] = capture_signing_stage(
            "S5-after-sanitation", output, app, [frontend, app_config_path, manifest_path]
        )
        receipt["signing_timeline"]["S6_immediately_before_signing"] = capture_signing_stage(
            "S6-immediately-before-signing", output, app, [frontend, app_config_path, manifest_path]
        )
        # Tauri creates FinderInfo on the .app root. The diagnostic timeline
        # showed it can reappear after the first cleanup while the bundle is
        # being inspected, so do the final cleanup only after that inspection.
        final_sanitation = subprocess.run(
            ["xattr", "-cr", str(app)], capture_output=True, text=True
        )
        receipt["final_pre_sign_sanitation"] = {
            "exit_code": final_sanitation.returncode,
            "stdout": final_sanitation.stdout,
            "stderr": final_sanitation.stderr,
        }
        if final_sanitation.returncode != 0:
            return fail(receipt, output, "PREVIEW_FINAL_METADATA_SANITATION_FAILED")
        pre_sign_xattrs = subprocess.run(
            ["xattr", "-lr", str(app)], capture_output=True, text=True
        )
        forbidden_xattrs = find_codesign_forbidden_xattrs(pre_sign_xattrs.stdout)
        receipt["pre_sign_metadata_check"] = {
            "xattr_exit_code": pre_sign_xattrs.returncode,
            "forbidden_xattr_paths": forbidden_xattrs,
        }
        if pre_sign_xattrs.returncode != 0 or forbidden_xattrs:
            return fail(receipt, output, "PREVIEW_BUNDLE_HAS_CODESIGN_FORBIDDEN_METADATA")
        signature_result = run(
            ["codesign", "--force", "--deep", "--options", "runtime", "--timestamp=none",
             "--sign", SIGNING_IDENTITY, str(app)],
            env, logs, "seal-preview-bundle",
        )
        receipt["commands"].append(signature_result)
        if signature_result["exit_code"] != 0 or signature_result["timed_out"]:
            return fail(receipt, output, "PREVIEW_CODE_SIGN_FAILED")
        receipt["signing_timeline"]["S7_immediately_after_signing"] = capture_signing_stage(
            "S7-immediately-after-signing", output, app, [frontend, app_config_path, manifest_path]
        )
        bundled_uuid = subprocess.run(
            ["dwarfdump", "--uuid", str(executable)], capture_output=True, text=True, check=True
        ).stdout
        bundled_rows = parse_macho_uuids(bundled_uuid)
        if (len(bundled_rows) != 1 or bundled_rows[0][0] != receipt["cargo_binary_uuid"]
                or bundled_rows[0][2] != str(executable)):
            return fail(receipt, output, "BUNDLED_UUID_MISMATCH")
        verify = subprocess.run(
            ["codesign", "--verify", "--deep", "--strict", "--verbose=2", str(app)],
            capture_output=True, text=True,
        )
        signature = subprocess.run(
            ["codesign", "-dv", "--verbose=4", str(app)], capture_output=True, text=True
        )
        receipt["signing_timeline"]["S8_strict_verification"] = capture_signing_stage(
            "S8-strict-verification", output, app, [frontend, app_config_path, manifest_path]
        )
        if (verify.returncode != 0 or signature.returncode != 0
                or SIGNING_IDENTITY not in signature.stderr
                or "TeamIdentifier=SSRKA7A4TN" not in signature.stderr
                or "Identifier=" + IDENTIFIER not in signature.stderr):
            receipt["codesign_failure"] = {
                "verify_exit_code": verify.returncode, "verify_stdout": verify.stdout,
                "verify_stderr": verify.stderr, "details": signature.stderr,
            }
            return fail(receipt, output, "PREVIEW_SIGNATURE_VERIFICATION_FAILED")
        dr = subprocess.run(["codesign", "-dr", "-", str(app)], capture_output=True, text=True)

        assets = sorted(path for path in frontend.rglob("*") if path.is_file())
        asset_hashes = {str(path.relative_to(frontend)): sha(path) for path in assets}
        raw_refs = set(re.findall(r'(?:src|href)="([^"]+)"', (frontend / "index.html").read_text()))
        refs = {
            value.removeprefix("/").removeprefix("./")
            for value in raw_refs if value.startswith(("assets/", "/assets/", "./assets/"))
        }
        if not refs or not all((frontend / ref).is_file() for ref in refs):
            return fail(receipt, output, "FRONTEND_ENTRY_ASSET_BINDING_FAILED")
        receipt["frontend_index_sha256"] = sha(frontend / "index.html")
        receipt["frontend_assets_sha256"] = asset_hashes
        receipt["frontend_references"] = sorted(refs)
        receipt["frontend_entry_source"] = source_entry = str(ROOT / "src/main.tsx")
        receipt["frontend_entry_source_sha256"] = sha(Path(source_entry))
        receipt["cargo_entry_source"] = source
        receipt["app_bundle"] = str(app)
        receipt["bundle_identifier"] = plist["CFBundleIdentifier"]
        receipt["bundle_executable"] = str(executable)
        receipt["bundle_executable_sha256"] = sha(executable)
        receipt["bundle_executable_uuid"] = bundled_rows[0][0]
        receipt["bundle_info_plist_sha256"] = sha(info)
        receipt["bundle_manifest_sha256"] = sha(bundled_manifest)
        receipt["signature"] = {
            "identity": signature.stderr, "verify_exit_code": verify.returncode,
            "verify_stdout": verify.stdout, "verify_stderr": verify.stderr,
            "designated_requirement": dr.stderr + dr.stdout,
        }
        receipt["data_route_static_evidence"] = {
            "preview_identifier": IDENTIFIER, "production_identifier": PRODUCTION_IDENTIFIER,
            "macos_data_directory_rule": "Tauri app_data_dir selected by the Bundle ID",
            "preview_directory": "~/Library/Application Support/" + IDENTIFIER,
            "database_filename": "personal-finance-console.sqlite3",
            "database_or_app_data_accessed": False,
        }
        receipt["source_sha256_after"] = tree_hashes(source_paths())
        if receipt["source_sha256_after"] != receipt["source_sha256_before"]:
            return fail(receipt, output, "WP03_SOURCE_DRIFT_DURING_BUILD")
        receipt["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        receipt["status"] = "WP03_SYNTHETIC_CHECKS_AND_UNLAUNCHED_PREVIEW_BUILD_PASS"
        save(output / "build-record.json", receipt)
        print(json.dumps({
            "status": receipt["status"], "output": str(output), "bundle": str(app),
            "bundle_id": IDENTIFIER, "executable_sha256": receipt["bundle_executable_sha256"],
            "app_launched": False,
        }, ensure_ascii=False))
        return 0
    except Exception as error:
        return fail(receipt, output, "%s: %s" % (type(error).__name__, error))


if __name__ == "__main__":
    raise SystemExit(main())
