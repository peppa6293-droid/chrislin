#!/usr/bin/env python3
"""Build and independently assess the signed isolated Q11 app bundle."""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys

REPO = Path(__file__).resolve().parents[1]
IDENTIFIER = "org.pfc.quiescence.integration"
EXECUTABLE = "quiescence-tauri"
EXPECTED_IDENTITY = "Apple Development: 8619814730147 (FW5KHTFNZ6)"
EXPECTED_TEAM_IDENTIFIER = "SSRKA7A4TN"
PASS_STATUS = "SIGNED_LOCAL_DEVELOPMENT_ENTRY_BINDING_PASS"


def build_sources():
    files = list((REPO / "src-tauri/src").rglob("*.rs")) + list((REPO / "quiescence-web").rglob("*"))
    for directory in ("migrations", "src-tauri/capabilities", "src-tauri/icons", "src-tauri/.cargo", ".cargo"):
        files += list((REPO / directory).rglob("*"))
    files += [REPO / name for name in ("src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/build.rs",
        "src-tauri/tauri.quiescence.conf.json", "src-tauri/tauri.quiescence.package.conf.json",
        "src-tauri/tauri.conf.json", "src-tauri/quiescence-runtime-compatibility.json",
        "src/persistence/migrations.ts", "vite.quiescence.config.ts", "package.json", "package-lock.json",
        "scripts/package_quiescence_runtime.py")]
    files += list((REPO / "src-tauri").glob("tauri.*.conf.json"))
    return {str(path.relative_to(REPO)): sha(path) for path in files if path.is_file()}


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def expected_commands():
    return [
        ["npx", "vite", "build", "--config", "vite.quiescence.config.ts"],
        ["cargo", "build", "--manifest-path", "src-tauri/Cargo.toml", "--features", "quiescence-fixture", "--bin", "quiescence-old-runtime"],
        ["cargo", "build", "--manifest-path", "src-tauri/Cargo.toml", "--release", "--features", "quiescence-tauri", "--bin", "quiescence-tauri", "--message-format=json-render-diagnostics"],
        ["npx", "tauri", "bundle", "--config", "src-tauri/tauri.quiescence.conf.json", "--config", "src-tauri/tauri.quiescence.package.conf.json", "--features", "quiescence-tauri", "--bundles", "app", "--no-binary-patching"],
    ]


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def validate_artifact(artifact, build_dir):
    binary = build_dir / "release" / EXECUTABLE
    require(isinstance(artifact, dict) and artifact.get("reason") == "compiler-artifact", "invalid compiler artifact")
    target = artifact.get("target", {})
    require(target.get("name") == EXECUTABLE and target.get("kind") == ["bin"]
            and target.get("src_path") == str(REPO / "src-tauri/src/bin/quiescence_tauri.rs")
            and artifact.get("manifest_path") == str(REPO / "src-tauri/Cargo.toml")
            and artifact.get("executable") == str(binary)
            and artifact.get("filenames") == [str(binary)], "compiler artifact source/name/path/builddir mismatch")
    require(binary.resolve(strict=True) == binary, "compiler artifact path is redirected")
    return binary


def validate_prior_receipt(prior, current_sources, signing_identity):
    require(isinstance(prior, dict) and type(prior.get("format_version")) is int
            and prior["format_version"] == 1 and prior.get("synthetic_only") is True
            and prior.get("receipt_kind") == "build" and prior.get("status") == PASS_STATUS
            and not prior.get("error") and not prior.get("build_receipt_path"), "not a successful original build receipt")
    require(prior.get("signing_identity") == signing_identity, "original signing identity mismatch")
    before, after = prior.get("source_sha256_before"), prior.get("source_sha256_after")
    require(isinstance(before, dict) and bool(before) and before == after == current_sources
            and all(isinstance(v, str) and re.fullmatch(r"[0-9a-f]{64}", v) for v in before.values()),
            "original before/after/current source fingerprints or complete key set mismatch")
    build_dir = Path(prior.get("build_target_dir", ""))
    require(build_dir.is_absolute() and build_dir.parent == REPO / "src-tauri/target"
            and build_dir.name.startswith("isolated-quiescence-") and build_dir.resolve(strict=True) == build_dir,
            "original build directory is not canonical isolated target")
    commands = prior.get("commands")
    require(isinstance(commands, list) and len(commands) == 4, "original build must contain four commands")
    for item, expected in zip(commands, expected_commands()):
        require(isinstance(item, dict) and item.get("argv") == expected
                and type(item.get("exit_code")) is int and item["exit_code"] == 0,
                "original command order/arguments/explicit zero exit mismatch")
        for stream in ("stdout", "stderr"):
            log = Path(item.get(stream + "_path", ""))
            require(log.is_absolute() and log.is_file() and sha(log) == item.get(stream + "_sha256"), "original command log hash mismatch")
    artifact = prior.get("isolated_compiler_artifact")
    binary = validate_artifact(artifact, build_dir)
    cargo_rows = [json.loads(line) for line in Path(commands[2]["stdout_path"]).read_text().splitlines() if line.startswith("{")]
    selected = [row for row in cargo_rows if row.get("reason") == "compiler-artifact" and row.get("target", {}).get("name") == EXECUTABLE and row.get("executable")]
    require(selected == [artifact], "compiler artifact differs from original hashed Cargo log")
    require(sha(binary) == prior.get("prebundle_binary_sha256"), "source-bound candidate binary hash mismatch")
    bundle = prior.get("app_bundle")
    require(isinstance(bundle, dict), "missing original package identity")
    app = build_dir / "release/bundle/macos/PFC Isolated Quiescence IPC.app"
    executable = app / "Contents/MacOS" / EXECUTABLE
    require(bundle.get("path") == str(app) and bundle.get("executable") == str(executable)
            and bundle.get("cargo_binary") == str(binary) and bundle.get("bundle_identifier") == IDENTIFIER,
            "original package/candidate identity mismatch")
    require(sha(binary) == bundle.get("cargo_binary_sha256") and sha(executable) == bundle.get("executable_sha256")
            and sha(app / "Contents/Info.plist") == bundle.get("info_plist_sha256")
            and sha(app / "Contents/Resources/runtime-compatibility.json") == bundle.get("runtime_manifest_sha256"),
            "original package or candidate bytes changed")
    require(isinstance(prior.get("prebundle_uuid"), str) and bool(prior["prebundle_uuid"]), "original UUID missing")
    recorded_uuid = bundle.get("mach_o_uuid_binding", "")
    check = subprocess.run(["dwarfdump", "--uuid", str(executable), str(binary)], capture_output=True, text=True)
    require(type(check.returncode) is int and check.returncode == 0 and check.stdout == recorded_uuid,
            "original package/candidate UUID observation changed")
    uuid_rows = [re.fullmatch(r"UUID:\s+(\S+)\s+\(([^)]+)\)\s+(.+)", line) for line in check.stdout.splitlines()]
    require(len(uuid_rows) == 2 and all(uuid_rows)
            and all(row[1] == prior["prebundle_uuid"] for row in uuid_rows)
            and uuid_rows[0][2] == uuid_rows[1][2]
            and [row[3] for row in uuid_rows] == [str(executable), str(binary)], "original package UUID binding mismatch")
    return build_dir


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--signing-identity", default=EXPECTED_IDENTITY)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--validate-build-receipt", type=Path,
                        help="independently validate a newly built bundle whose build commands already completed")
    args = parser.parse_args()
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    evidence_dir = REPO / "evidence/quiescence-integration" / f"signed-runtime-{stamp}"
    evidence_dir.mkdir(parents=True, exist_ok=False)
    output = args.output or evidence_dir / "package-validation.json"
    receipt = {"format_version": 1, "synthetic_only": True, "status": "RUNNING",
               "receipt_kind": "revalidation" if args.validate_build_receipt else "build",
               "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
               "repo_head": subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True,
                                              text=True, check=True).stdout.strip(),
               "signing_identity": args.signing_identity, "commands": [], "app_bundle": None,
               "build_target_dir": str(REPO / "src-tauri/target" / f"isolated-quiescence-{stamp}")}
    current_sources = build_sources()
    if args.validate_build_receipt:
        receipt["revalidation_source_sha256_before"] = current_sources
    else:
        receipt["source_sha256_before"] = current_sources
    env = os.environ.copy()
    env["APPLE_SIGNING_IDENTITY"] = args.signing_identity
    env["CARGO_TARGET_DIR"] = receipt["build_target_dir"]
    # Build the isolated source explicitly; tauri build renames default-run.
    env["TAURI_CONFIG"] = json.dumps(json.loads((REPO / "src-tauri/tauri.quiescence.conf.json").read_text()))
    commands = expected_commands()
    try:
        if args.validate_build_receipt:
            prior_path = args.validate_build_receipt.resolve(strict=True)
            prior = json.loads(prior_path.read_text())
            receipt["build_target_dir"] = str(validate_prior_receipt(prior, current_sources, args.signing_identity))
            receipt["commands"] = prior["commands"]
            receipt["build_receipt_path"] = str(prior_path)
            receipt["build_receipt_sha256"] = sha(prior_path)
            receipt["original_build_provenance"] = prior
            # Preserve historical build fingerprints verbatim, separately from
            # this read-only revalidation's source snapshot and repo head.
            receipt["original_build_repo_head"] = prior.get("repo_head")
            for field in ("source_sha256_before", "source_sha256_after", "isolated_compiler_artifact", "prebundle_binary_sha256", "prebundle_uuid"):
                receipt[field] = prior[field]
        else:
            for index, command in enumerate(commands, start=1):
                result = subprocess.run(command, cwd=REPO, env=env, capture_output=True, text=True, timeout=1800)
                stdout_path = evidence_dir / f"command-{index}.stdout.txt"
                stderr_path = evidence_dir / f"command-{index}.stderr.txt"
                stdout_path.write_text(result.stdout)
                stderr_path.write_text(result.stderr)
                item = {"argv": command, "exit_code": result.returncode,
                        "stdout_path": str(stdout_path), "stderr_path": str(stderr_path),
                        "stdout_sha256": sha(stdout_path), "stderr_sha256": sha(stderr_path)}
                receipt["commands"].append(item)
                if result.returncode:
                    raise RuntimeError(f"command {index} failed ({result.returncode}); see {stderr_path}")
                if command[0:2] == ["cargo", "build"] and "--release" in command:
                    artifacts = [json.loads(line) for line in result.stdout.splitlines() if line.startswith("{")]
                    selected = [row for row in artifacts if row.get("reason") == "compiler-artifact"
                                and row.get("target", {}).get("name") == EXECUTABLE and row.get("executable")]
                    if len(selected) != 1 or Path(selected[0]["target"]["src_path"]).resolve() != REPO / "src-tauri/src/bin/quiescence_tauri.rs":
                        raise RuntimeError("Cargo did not prove the exact isolated source entry")
                    artifact = selected[0]
                    validate_artifact(artifact, Path(receipt["build_target_dir"]))
                    receipt["isolated_compiler_artifact"] = artifact
                    receipt["prebundle_binary_sha256"] = sha(artifact["executable"])
                    receipt["prebundle_uuid"] = subprocess.run(["dwarfdump", "--uuid", artifact["executable"]],
                                                               capture_output=True, text=True, check=True).stdout.split()[1]

        app = Path(receipt["build_target_dir"]) / "release/bundle/macos/PFC Isolated Quiescence IPC.app"
        app = app.resolve(strict=True)
        if not app.is_relative_to(Path(receipt["build_target_dir"]) / "release/bundle/macos"):
            raise RuntimeError(f"unexpected app output path: {app}")
        plist_path = app / "Contents/Info.plist"
        executable = app / "Contents/MacOS" / EXECUTABLE
        manifest = app / "Contents/Resources/runtime-compatibility.json"
        plist = plistlib.loads(plist_path.read_bytes())
        manifest_value = json.loads(manifest.read_text())
        if plist.get("CFBundleIdentifier") != IDENTIFIER or plist.get("CFBundleExecutable") != EXECUTABLE:
            raise RuntimeError(f"isolated plist identity mismatch: {plist}")
        if not executable.is_file() or not os.access(executable, os.X_OK):
            raise RuntimeError(f"isolated entry executable missing or not executable: {executable}")
        macos_entries = sorted(path.name for path in (app / "Contents/MacOS").iterdir())
        if macos_entries != [EXECUTABLE]:
            raise RuntimeError(f"unexpected packaged executable set: {macos_entries}")
        build_binary = Path(receipt["build_target_dir"]) / "release" / EXECUTABLE
        if not build_binary.is_file():
            raise RuntimeError(f"expected isolated Cargo binary missing: {build_binary}")
        provenance = receipt if not args.validate_build_receipt else prior
        if not provenance.get("isolated_compiler_artifact") or not provenance.get("prebundle_uuid"):
            raise RuntimeError("missing independent pre-bundle Cargo source provenance")
        validate_artifact(provenance["isolated_compiler_artifact"], Path(receipt["build_target_dir"]))
        require(sha(build_binary) == provenance.get("prebundle_binary_sha256"), "candidate changed after source-bound compilation")
        if manifest_value.get("bundleId") != IDENTIFIER or manifest_value.get("executable") != f"Contents/MacOS/{EXECUTABLE}":
            raise RuntimeError(f"isolated runtime manifest mismatch: {manifest_value}")
        resource_entries = sorted(path.name for path in (app / "Contents/Resources").iterdir())
        if resource_entries != ["runtime-compatibility.json"]:
            raise RuntimeError(f"unexpected bundled resources (possible Production manifest leak): {resource_entries}")
        isolated_manifest = REPO / "src-tauri/quiescence-runtime-compatibility.json"
        if manifest.read_bytes() != isolated_manifest.read_bytes():
            raise RuntimeError("bundled runtime manifest differs from isolated source manifest")
        uuid_check = subprocess.run(["dwarfdump", "--uuid", str(executable), str(build_binary)],
                                    capture_output=True, text=True)
        uuid_lines = [match.groups() for line in uuid_check.stdout.splitlines()
                      if (match := re.match(r"UUID:\s+(\S+)\s+\(([^)]+)\)", line))]
        if uuid_check.returncode or len(uuid_lines) != 2 or uuid_lines[0] != uuid_lines[1]:
            raise RuntimeError(f"packaged entry does not bind to the intended Tauri Cargo binary: {uuid_check.stdout} {uuid_check.stderr}")
        if uuid_lines[0][0] != provenance["prebundle_uuid"]:
            raise RuntimeError("bundle differs from source-bound pre-bundle Cargo artifact")

        verify = subprocess.run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", str(app)],
                                capture_output=True, text=True)
        display = subprocess.run(["codesign", "-dv", "--verbose=4", str(app)], capture_output=True, text=True)
        requirement = subprocess.run(["codesign", "-dr", "-", str(app)], capture_output=True, text=True)
        assess = subprocess.run(["spctl", "--assess", "--type", "execute", "--verbose=4", str(app)],
                                capture_output=True, text=True)
        if verify.returncode or display.returncode or requirement.returncode:
            raise RuntimeError("codesign verification/display/DR did not complete successfully")
        detail = display.stderr
        if args.signing_identity not in detail or f"TeamIdentifier={EXPECTED_TEAM_IDENTIFIER}" not in detail:
            raise RuntimeError(f"signed app identity/team mismatch: {detail}")
        designated_requirement = requirement.stderr + requirement.stdout
        if IDENTIFIER not in designated_requirement or args.signing_identity not in designated_requirement:
            raise RuntimeError(f"designated requirement does not bind isolated identifier and identity: {designated_requirement}")
        files = []
        for path in sorted([app, *app.rglob("*")], key=str):
            if path.is_symlink():
                files.append({"path": str(path.relative_to(app)), "kind": "symlink", "target": os.readlink(path)})
            elif path.is_file():
                files.append({"path": str(path.relative_to(app)), "kind": "file", "bytes": path.stat().st_size,
                              "sha256": sha(path), "mode": path.stat().st_mode & 0o777})
            elif path.is_dir():
                files.append({"path": str(path.relative_to(app)), "kind": "directory"})
        attrs = subprocess.run(["xattr", "-lr", str(app)], capture_output=True, text=True)
        if "com.apple.quarantine:" in attrs.stdout:
            receipt["status"] = "UNEXPECTED_LOCAL_BUILD_QUARANTINE"
            raise RuntimeError("fresh local build unexpectedly carries com.apple.quarantine; preserve and diagnose provenance")
        receipt["app_bundle"] = {
            "path": str(app), "bundle_identifier": plist["CFBundleIdentifier"],
            "executable": str(executable), "executable_sha256": sha(executable),
            "cargo_binary": str(build_binary), "cargo_binary_sha256": sha(build_binary),
            "cargo_binary_matches_packaged_executable": sha(build_binary) == sha(executable),
            "mach_o_uuid_binding": uuid_check.stdout,
            "isolated_source_manifest_sha256": sha(isolated_manifest),
            "packaged_resource_entries": resource_entries,
            "packaged_macos_entries": macos_entries,
            "info_plist_sha256": sha(plist_path), "runtime_manifest_sha256": sha(manifest),
            "codesign_verify": {"exit_code": verify.returncode, "stdout": verify.stdout, "stderr": verify.stderr},
            "signature_details": detail, "designated_requirement": designated_requirement.strip(),
            "gatekeeper_assessment": {"exit_code": assess.returncode, "stdout": assess.stdout, "stderr": assess.stderr},
            "extended_attributes": attrs.stdout, "extended_attributes_exit_code": attrs.returncode,
            "files": files,
        }
        after_sources = build_sources()
        receipt["revalidation_source_sha256_after" if args.validate_build_receipt else "source_sha256_after"] = after_sources
        if after_sources != current_sources:
            receipt["status"] = "SOURCE_DRIFT_DURING_BUILD"
            raise RuntimeError("source drifted during build; candidate is not audit-ready")
        if args.validate_build_receipt:
            require(sha(prior_path) == receipt["build_receipt_sha256"], "original receipt changed during revalidation")
            validate_prior_receipt(prior, after_sources, args.signing_identity)
        receipt["status"] = PASS_STATUS
    except Exception as error:
        if receipt["status"] == "RUNNING":
            receipt["status"] = "BUILD_OR_SIGNATURE_FAILED"
        receipt["error"] = f"{type(error).__name__}: {error}"
    finally:
        receipt["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({"status": receipt["status"], "evidence": str(output),
                          "bundle": (receipt.get("app_bundle") or {}).get("path"),
                          "error": receipt.get("error")}, ensure_ascii=False))
    return 0 if receipt["status"] == "SIGNED_LOCAL_DEVELOPMENT_ENTRY_BINDING_PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
