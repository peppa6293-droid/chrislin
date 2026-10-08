"""Preserve final isolated regression output; never launches a Production app."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
COMMANDS = [
    ["npm", "run", "typecheck"],
    ["npm", "test"],
    [sys.executable, "-m", "unittest", "scripts/test_production_v4_release_gate.py", "scripts/test_quiescence_entry_boundary.py", "-v"],
    [sys.executable, "-m", "unittest", "discover", "-s", "scripts", "-p", "test_quiescence_gate.py", "-v"],
    ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--lib"],
    ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--features", "quiescence-fixture", "--bin", "quiescence-fixture"],
]


def main():
    output = ROOT / "evidence/quiescence/regressions.json"
    if output.exists():
        previous = json.loads(output.read_text())
        failure = output.with_name("regressions-prior-failure.json")
        if any(result["exit_code"] for result in previous["results"]) and not failure.exists():
            failure.write_bytes(output.read_bytes())
    results = []
    for command in COMMANDS:
        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=180)
        results.append({"command": command, "exit_code": result.returncode, "stdout": result.stdout, "stderr": result.stderr})
        print(json.dumps({"command": command, "exit_code": result.returncode}), flush=True)
    files = ["src-tauri/src/lib.rs", "src-tauri/src/quiescence.rs", "src-tauri/src/bin/quiescence_fixture.rs", "src-tauri/src/bin/quiescence_competitor.rs", "src-tauri/build.rs", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src/persistence/migrations.ts", "scripts/production_v4_release_gate.py", "scripts/quiescence_gate.py"]
    hashes = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in files}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"synthetic_only": True, "production_launched": False, "source_hashes": hashes, "results": results}, indent=2) + "\n")
    return int(any(result["exit_code"] for result in results))


if __name__ == "__main__":
    raise SystemExit(main())
