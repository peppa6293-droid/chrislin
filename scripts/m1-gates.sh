#!/bin/bash
# One-command gate run on the Mac. Usage: bash scripts/m1-gates.sh <evidence-dir>
# Writes lint/tsc/test logs, exit codes, protected-area hash and git status into <evidence-dir>.
set -u
cd "$(dirname "$0")/.."
OUT="${1:?usage: bash scripts/m1-gates.sh <evidence-dir>}"
mkdir -p "$OUT"
: > "$OUT/exit-codes.txt"
rc=0

run() { # run <name> <command...>  (command passed as separate words, never as one string)
  name=$1; shift
  "$@" > "$OUT/$name.log" 2>&1
  code=$?
  echo "$name exit=$code" | tee -a "$OUT/exit-codes.txt"
  [ "$code" -ne 0 ] && rc=1
}

run lint env -u NODE_ENV npx biome check src tests
run tsc env -u NODE_ENV npx tsc --noEmit
# --pool=threads: the default forks pool has timed out on this machine without any code cause.
run test env -u NODE_ENV npx vitest run tests --pool=threads
grep -E "Test Files|Tests " "$OUT/test.log" | tee -a "$OUT/exit-codes.txt"

# Protected area: src/model + migrations, ignoring iCloud conflict copies (" 2." in the name).
now=$(find src/model migrations -type f ! -name '* 2.*' | sort | xargs shasum -a 256 | shasum -a 256 | cut -d' ' -f1)
base=$(cut -d' ' -f1 evidence/m1-s0-20261030/protected-model-migrations.sha256)
echo "$now" > "$OUT/protected-now.sha256"
if [ "$now" = "$base" ]; then echo "protected hash SAME as S0 ($base)" | tee -a "$OUT/exit-codes.txt"
else echo "protected hash CHANGED now=$now base=$base" | tee -a "$OUT/exit-codes.txt"; rc=1; fi

# Signing / identity must not move.
grep -E "DEVELOPMENT_TEAM|PRODUCT_BUNDLE_IDENTIFIER" src-tauri/gen/apple/personal-finance-console.xcodeproj/project.pbxproj | sort -u > "$OUT/signing.txt"

git status --short | grep -v ' 2\.' > "$OUT/git-status.txt"
echo "gates rc=$rc" | tee -a "$OUT/exit-codes.txt"
exit $rc
