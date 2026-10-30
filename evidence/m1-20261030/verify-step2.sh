#!/usr/bin/env bash
# M1 步骤2 验证：不设任何变量重建 -> 产物与源码零命中 -> 三门禁。在 Mac 终端运行。
set -u
PROJ="/Users/linte/Documents/ChatGPT/小钱家-新/个人财务模型app开发项目 2"
OUT="$PROJ/evidence/m1-20261030/step2-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"; cd "$PROJ" || exit 1
unset VITE_M0_LAB
export NODE_ENV=development

echo "== A. 恢复 dataless 文件 =="
n=0
while IFS= read -r -d '' f; do
  ls -lO "$f" 2>/dev/null | grep -q dataless && { rm -f "$f" && git checkout -- "$f" && n=$((n+1)); }
done < <(git ls-files -z)
echo "已恢复 $n 个"

echo "== B. 不设变量重建 web-dist =="
rm -rf web-dist
npm run build:web 2>&1 | tee "$OUT/b-build.log" | tail -5

echo "== C. 产物/源码/配置 零命中（期望每行 0） =="
{
  echo "web-dist: $(grep -rEl 'M0Lab|lab/glass|m0_spike|m0-lab|--m0-' web-dist | wc -l | tr -d ' ')"
  echo "src:      $(grep -rE 'M0Lab|lab/glass|m0_spike|VITE_M0_LAB|m0-lab|--m0-' src --include='*.ts' --include='*.tsx' --include='*.css' | grep -v ' 2\.' | wc -l | tr -d ' ')"
  echo "src-tauri: $(grep -rE 'm0lab|M0Lab|lab/glass' src-tauri/src src-tauri/*.json 2>/dev/null | wc -l | tr -d ' ')"
  echo "web-dist 文件哈希:"; find web-dist -type f -exec shasum -a 256 {} \;
} | tee "$OUT/c-zero-hits.txt"

echo "== D. 三门禁 =="
npm run lint      2>&1 | tail -3 | tee "$OUT/d-lint.log"
npm run typecheck 2>&1 | tail -5 | tee "$OUT/d-tsc.log"
npx vitest run tests/m1-entry-no-lab.test.tsx 2>&1 | tail -12 | tee "$OUT/d-entry-test.log"
npm run test:product 2>&1 | tail -8 | tee "$OUT/d-test-product.log"
echo "证据目录: $OUT"
