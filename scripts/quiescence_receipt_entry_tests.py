#!/usr/bin/env python3
"""Exercise the public revalidation entry on immutable copies of one new receipt."""
import argparse
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile

from package_quiescence_runtime import REPO, sha


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    assert not args.output.exists()
    original_hash = sha(args.receipt)
    original = json.loads(args.receipt.read_text())
    base = Path(tempfile.mkdtemp(prefix="pfc-reaudit-receipt-tests-")).resolve()
    mutations = {
        "source-A-versus-current-B": "source fingerprints",
        "build-time-drift": "source fingerprints",
        "missing-command": "four commands",
        "missing-exit": "explicit zero exit",
        "null-exit": "explicit zero exit",
        "failed-command": "explicit zero exit",
        "bad-log-hash": "log hash mismatch",
        "wrong-entry": "source/name/path/builddir mismatch",
        "wrong-candidate": "candidate identity mismatch",
    }
    results = []
    for name, reason in mutations.items():
        prior = copy.deepcopy(original)
        source = "src-tauri/src/bin/quiescence_tauri.rs"
        if name == "source-A-versus-current-B":
            prior["source_sha256_before"][source] = prior["source_sha256_after"][source] = "0" * 64
        elif name == "build-time-drift":
            prior["source_sha256_after"][source] = "0" * 64
        elif name == "missing-command":
            prior["commands"].pop()
        elif name == "missing-exit":
            del prior["commands"][0]["exit_code"]
        elif name == "null-exit":
            prior["commands"][0]["exit_code"] = None
        elif name == "failed-command":
            prior["commands"][0]["exit_code"] = 1
        elif name == "bad-log-hash":
            prior["commands"][0]["stdout_sha256"] = "0" * 64
        elif name == "wrong-entry":
            prior["isolated_compiler_artifact"]["target"]["name"] = "personal-finance-console"
        elif name == "wrong-candidate":
            prior["app_bundle"]["bundle_identifier"] = "wrong.synthetic.identity"
        path, output = base / (name + ".json"), base / (name + "-result.json")
        path.write_text(json.dumps(prior, indent=2) + "\n")
        command = [sys.executable, str(REPO / "scripts/package_quiescence_runtime.py"),
                   "--validate-build-receipt", str(path), "--output", str(output)]
        process = subprocess.run(command, cwd=REPO, capture_output=True, text=True, timeout=30)
        result = json.loads(output.read_text())
        assert process.returncode == 2 and result["status"] == "BUILD_OR_SIGNATURE_FAILED" and reason in result["error"], (name, result)
        results.append({"name": name, "expected_error_contains": reason, "returncode": process.returncode,
                        "input": str(path), "input_sha256": sha(path), "result": result,
                        "stdout": process.stdout, "stderr": process.stderr, "passed": True})
    assert sha(args.receipt) == original_hash
    report = {"status": "PASS", "scope": "public-entry negative receipts, no builds or runtime launches",
              "original_receipt": str(args.receipt.resolve()), "original_sha256_unchanged": original_hash,
              "retained_root": str(base), "script_sha256": sha(__file__), "cases": results}
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    assert json.loads(args.output.read_text()) == report
    print(json.dumps({"status": "PASS", "cases": len(results), "output": str(args.output)}))


if __name__ == "__main__":
    main()
