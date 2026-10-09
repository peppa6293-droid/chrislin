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
import subprocess
import sys

REPO = Path(__file__).resolve().parents[1]
IDENTIFIER = "org.pfc.quiescence.integration"
EXECUTABLE = "personal-finance-console"
EXPECTED_IDENTITY = "Apple Development: 8619814730147 (FW5KHTFNZ6)"
EXPECTED_TEAM_IDENTIFIER = "SSRKA7A4TN"


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--signing-identity", default=EXPECTED_IDENTITY)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    evidence_dir = REPO / "evidence/quiescence-integration" / f"signed-runtime-{stamp}"
    evidence_dir.mkdir(parents=True, exist_ok=False)
    output = args.output or evidence_dir / "package-validation.json"
    receipt = {"format_version": 1, "synthetic_only": True, "status": "RUNNING",
               "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
               "repo_head": subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True,
                                              text=True, check=True).stdout.strip(),
               "signing_identity": args.signing_identity, "commands": [], "app_bundle": None}
    env = os.environ.copy()
    env["APPLE_SIGNING_IDENTITY"] = args.signing_identity
    commands = [
        ["npx", "vite", "build", "--config", "vite.quiescence.config.ts"],
        ["cargo", "build", "--manifest-path", "src-tauri/Cargo.toml", "--features", "quiescence-fixture",
         "--bin", "quiescence-old-runtime"],
        ["npx", "tauri", "build", "--config", "src-tauri/tauri.quiescence.conf.json", "--config",
         "src-tauri/tauri.quiescence.package.conf.json", "--features", "quiescence-tauri", "--bundles", "app",
         "--", "--bin", "quiescence-tauri"],
    ]
    try:
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

        app = REPO / "src-tauri/target/release/bundle/macos/PFC Isolated Quiescence IPC.app"
        app = app.resolve(strict=True)
        if not app.is_relative_to(REPO / "src-tauri/target/release/bundle/macos"):
            raise RuntimeError(f"unexpected app output path: {app}")
        plist_path = app / "Contents/Info.plist"
        executable = app / "Contents/MacOS" / EXECUTABLE
        manifest = app / "Contents/Resources/runtime-compatibility.json"
        plist = plistlib.loads(plist_path.read_bytes())
        manifest_value = json.loads(manifest.read_text())
        if plist.get("CFBundleIdentifier") != IDENTIFIER or plist.get("CFBundleExecutable") != EXECUTABLE:
            raise RuntimeError(f"isolated plist identity mismatch: {plist}")
        if manifest_value.get("bundleId") != IDENTIFIER or manifest_value.get("executable") != f"Contents/MacOS/{EXECUTABLE}":
            raise RuntimeError(f"isolated runtime manifest mismatch: {manifest_value}")

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
        receipt["app_bundle"] = {
            "path": str(app), "bundle_identifier": plist["CFBundleIdentifier"],
            "executable": str(executable), "executable_sha256": sha(executable),
            "info_plist_sha256": sha(plist_path), "runtime_manifest_sha256": sha(manifest),
            "codesign_verify": {"exit_code": verify.returncode, "stdout": verify.stdout, "stderr": verify.stderr},
            "signature_details": detail, "designated_requirement": requirement.stderr.strip(),
            "gatekeeper_assessment": {"exit_code": assess.returncode, "stdout": assess.stdout, "stderr": assess.stderr},
            "extended_attributes": attrs.stdout, "extended_attributes_exit_code": attrs.returncode,
            "files": files,
        }
        if assess.returncode:
            receipt["status"] = "BLOCKED_GATEKEEPER_ASSESSMENT"
            raise RuntimeError("Gatekeeper assessment rejected the signed synthetic app; do not launch")
        receipt["status"] = "SIGNED_BUNDLE_READY_FOR_LAUNCH"
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
    return 0 if receipt["status"] == "SIGNED_BUNDLE_READY_FOR_LAUNCH" else 2


if __name__ == "__main__":
    raise SystemExit(main())
