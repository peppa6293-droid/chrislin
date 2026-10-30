#!/usr/bin/env bash
# M0 通知修复：真机构建 + 安装 + 启动抓日志（纯命令行，不开 Xcode）
# 用法：在 Mac 终端 bash device-install-verify.sh
set -u
DEV=00008140-001C55E91A40801C
BID=com.personalfinance.console.smoke
PROJ="/Users/linte/Documents/ChatGPT/小钱家-新/个人财务模型app开发项目 2"
OUT="$PROJ/evidence/m0-20261029/device-run-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"; cd "$PROJ" || exit 1

echo "== 0. 恢复被 iCloud 换出(dataless)的已跟踪文件（从 git HEAD 重写） =="
n=0
while IFS= read -r -d '' f; do
  if ls -lO "$f" 2>/dev/null | grep -q dataless; then
    rm -f "$f" && git checkout -- "$f" 2>/dev/null && n=$((n+1)) || echo "WARN 无法恢复: $f"
  fi
done < <(git ls-files -z)
echo "已恢复 $n 个文件"
# 未跟踪但仍是 dataless 的文件（git 无法恢复），只告警
find src src-tauri/*.json index.html public package.json -type f 2>/dev/null | while IFS= read -r f; do
  ls -lO "$f" | grep -q dataless && echo "WARN 未跟踪/未恢复仍为 dataless: $f"
done

echo "== 1. 设备可见性 =="
xcrun devicectl list devices | tee "$OUT/01-devices.txt"
if ! grep -q "$DEV" "$OUT/01-devices.txt"; then
  echo "STOP: 看不到设备。检查：USB 连线 / 手机解锁 / 点过「信任此电脑」/ 开发者模式"; exit 2
fi
grep "$DEV" "$OUT/01-devices.txt" | grep -qi "connected\|available" || {
  echo "STOP: 设备可见但状态不是 connected（多为未解锁或未信任）"; exit 3; }

echo "== 2. 设备信息（含时区，若有） =="
xcrun devicectl device info details --device "$DEV" > "$OUT/02-details.txt" 2>&1
grep -i "timezone\|time zone\|osVersion\|developerMode" "$OUT/02-details.txt"

echo "== 3a. 检查是否有残留的 tauri/xcodebuild 构建进程 =="
STALE=$(pgrep -fl "tauri ios (build|dev)|xcodebuild.*personal-finance-console" | grep -v "$$" || true)
if [ -n "$STALE" ]; then
  echo "STOP: 发现残留构建进程，会和本次构建抢 .tauri/cli-options-server.json："
  echo "$STALE" | cut -c1-120
  echo "先关掉其他跑着脚本/构建的终端窗口（或 pkill -f 'tauri ios'; pkill xcodebuild），再重跑本脚本"; exit 6
fi
rm -rf src-tauri/gen/apple/.tauri 2>/dev/null

echo "== 3. 构建（release，自动签名；bundle id 不改） =="
export NODE_ENV=development VITE_M0_LAB=1
npx tauri ios build --target aarch64 \
  --config src-tauri/tauri.smoke.conf.json \
  --config src-tauri/tauri.m0lab.conf.json 2>&1 | tee "$OUT/03-build.log"
[ "${PIPESTATUS[0]}" -eq 0 ] || { echo "STOP: 构建失败，见 03-build.log"; exit 4; }

IPA=$(ls -t src-tauri/gen/apple/build/arm64/*.ipa 2>/dev/null | head -1)
[ -n "$IPA" ] || { echo "STOP: 未找到 ipa"; exit 5; }

echo "== 4. 安装 =="
xcrun devicectl device install app --device "$DEV" "$IPA" 2>&1 | tee "$OUT/04-install.log"

echo "== 5. 启动并抓控制台日志（Ctrl-C 结束；自动保存） =="
echo "启动后请在手机上点「立即通知」「1 分钟后定时通知」「震动」"
xcrun devicectl device process launch --device "$DEV" --console \
  --terminate-existing "$BID" 2>&1 | tee "$OUT/05-console.log"

echo "== 6. 含 tauri_plugin_notification 的行 =="
grep -n "tauri_plugin_notification" "$OUT/05-console.log" | tee "$OUT/06-notification-lines.txt"
echo "输出目录: $OUT"
