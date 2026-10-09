#!/usr/bin/env python3
"""Read back the scoped isolated handoff; not an independent external audit."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile

from verify_quiescence_integration import synthetic_root, snapshot

REPO = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load(path):
    return json.loads(Path(path).read_text())


def main():
    parser = argparse.ArgumentParser()
    for name in ("package", "launch", "ipc", "lease", "recovery", "formal", "regressions", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    assert not args.output.exists(), "never replace evidence"
    reports = {name: load(getattr(args, name)) for name in
               ("package", "launch", "ipc", "lease", "recovery", "formal", "regressions")}
    p = reports["package"]
    assert p["status"] == "SIGNED_LOCAL_DEVELOPMENT_ENTRY_BINDING_PASS"
    assert p["source_sha256_before"] == p["source_sha256_after"]
    for name, digest in p["source_sha256_after"].items():
        assert sha(REPO / name) == digest, name
    assert p["isolated_compiler_artifact"]["target"]["name"] == "quiescence-tauri"
    assert Path(p["isolated_compiler_artifact"]["target"]["src_path"]) == REPO / "src-tauri/src/bin/quiescence_tauri.rs"
    binary_hash = p["app_bundle"]["executable_sha256"]
    assert sha(p["app_bundle"]["executable"]) == binary_hash
    launch = reports["launch"]
    assert launch["status"] == "PASS" and launch["app_data_unchanged"]
    assert not launch["synthetic_database_created"] and launch["executable_sha256"] == binary_hash
    events = [r["event"] for r in launch["runtime_events"]]
    assert events.index("native_entry_validated") < events.index("native_runtime_boot") < events.index("frontend_bootstrap")
    ipc = reports["ipc"]
    assert ipc["status"] == "PASS" and ipc["binary_sha256"] == binary_hash
    assert len(ipc["cases"]) == 5 and all(c["passed"] for c in ipc["cases"])
    for name, digest in ipc["source_sha256"].items():
        assert sha(REPO / name) == digest, name
    lease = reports["lease"]
    assert lease["status"] == "PASS" and len(lease["cases"]) == 15
    assert all(c["passed"] for c in lease["cases"])
    assert all(v == "PASS" for v in lease["coverage_matrix"].values())
    assert lease["source_sha256"] == sha(REPO / "scripts/quiescence_native_lease_tests.py")
    recovery = reports["recovery"]
    assert recovery["status"] == "PASS" and len(recovery["cases"]) == 10
    assert not recovery["source_drift"] and recovery["native_sha256"] == lease["native_sha256"]
    for name, digest in recovery["sources_after"].items():
        assert sha(name) == digest, name
    for case in recovery["cases"]:
        assert case["passed"]
        root = synthetic_root(case["root"])
        for name, digest in case["final_records"].items():
            assert sha(root / name) == digest
        for invocation in case["invocations"]:
            assert invocation["protected_before"] == invocation["protected_after"]
            assert load(root / ("matrix-" + invocation["name"] + ".json")) == invocation
    formal = reports["formal"]
    assert formal["passed"] and formal["frontend_assertions_passed"]
    assert formal["transport"] == "real-tauri-webview-ipc" and formal["native_sha256"] == binary_hash
    root = synthetic_root(formal["root"])
    assert load(root / "managed-formal-result.json") == formal
    receipts = [load(path) for path in sorted(root.glob("native-state-*.json"))]
    assert sorted(set(r["phase"] for r in receipts)) == list(range(11))
    assert receipts[-1] == formal["outcome"] == load(root / "outcome.json")
    assert formal["outcome"]["state"] == "V4_VERIFIED"
    db, backup = snapshot(root / "personal-finance-console.sqlite3"), snapshot(root / "backup.sqlite3")
    assert db["version"] == 4 and backup["version"] == 3 and db["legacy_rows"] == backup["legacy_rows"]
    regressions = reports["regressions"]
    assert regressions["passed"] and not regressions["source_drift_during_run"]
    for name, digest in regressions["source_hashes_after"].items():
        assert sha(REPO / name) == digest, name
    # Repository-only preservation: never read or open installed Production.
    protected = ("src-tauri/src/lib.rs", "src-tauri/src/main.rs", "src-tauri/Cargo.toml",
                 "src/persistence/migrations.ts", "migrations/004.sql", "docs/CURRENT_PHASE.md")
    for name in protected:
        assert (REPO / name).read_bytes() == subprocess.check_output(["git", "show", "1ef7fdd:" + name], cwd=REPO)
    archive = args.output.with_suffix(".tar.gz")
    roots = [root] + [synthetic_root(c["root"]) for c in lease["cases"] + recovery["cases"]]
    with tarfile.open(archive, "x:gz") as out:
        for fixture in roots:
            for path in sorted(fixture.rglob("*")):
                if path.is_file() and "managed" not in path.relative_to(fixture).parts:
                    out.add(path, arcname=str(Path(fixture.name) / path.relative_to(fixture)), recursive=False)
    result = {"status": "PASS", "scope": "isolated integration handoff, not blocker closure or Production approval",
              "reports": {name: {"path": str(getattr(args, name).resolve()), "sha256": sha(getattr(args, name))} for name in reports},
              "archive": str(archive.resolve()), "archive_sha256": sha(archive),
              "formal_phases": list(range(11)), "formal_legacy_rows_equal": True,
              "production_accessed": False, "repository_protected_sources_unchanged": list(protected),
              "blocker": "OPEN", "independent_audit": "NOT_PERFORMED"}
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    assert load(args.output) == result
    print(json.dumps(result))


if __name__ == "__main__":
    main()
