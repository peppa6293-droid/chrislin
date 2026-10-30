#!/bin/bash
# Sync the build graph from the iCloud project dir into ~/dev/finance (not iCloud-synced), then build there.
# Aborts if any source file is evicted (dataless), instead of letting vite/cargo hang.
set -euo pipefail
SRC="/Users/linte/Documents/ChatGPT/小钱家-新/个人财务模型app开发项目 2"
DST="/Users/linte/dev/finance"

cd "$SRC"
bad=$(find src migrations src-tauri/src package.json package-lock.json index.html vite.config.ts tsconfig*.json -type f ! -name '* 2.*' -print0 | xargs -0 ls -ldO | grep dataless || true)
if [ -n "$bad" ]; then echo "EVICTED source files, abort:"; echo "$bad"; exit 1; fi

# Not synced: Cargo.*, patches, gen (the build copy holds the validated iOS link fix), conflict copies, caches.
rsync -a --delete --itemize-changes \
  --exclude='* 2.*' --exclude='* 2' --exclude='.DS_Store' \
  src/ "$DST/src/"
rsync -a --delete --itemize-changes --exclude='* 2.*' --exclude='.DS_Store' migrations/ "$DST/migrations/"
rsync -a --delete --itemize-changes --exclude='* 2.*' --exclude='.DS_Store' src-tauri/src/ "$DST/src-tauri/src/"
cp package.json package-lock.json index.html vite.config.ts tsconfig.json tsconfig.build.json "$DST/"

# Build copy must be clean of evicted files too.
if find "$DST/src" "$DST/src-tauri/src" "$DST/migrations" -type f -print0 | xargs -0 ls -ldO | grep -q dataless; then echo "dataless in build copy"; exit 1; fi
echo "SYNC OK"
