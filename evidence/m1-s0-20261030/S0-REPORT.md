# M1 S0 基线（2026-10-30）
- 工作目录：原项目目录，分支 feat/mobile，HEAD 9e92b3c，工作树有未提交改动（见 git-status.txt）。
- 门禁基线：tsc exit 0；vitest tests 56 文件 570 passed/44 skipped，exit 0；biome exit 1，唯一错误 = tests/m1-entry-no-lab.test.tsx 格式（该文件 03:14 出现，作者未核实）。
- 签名：DEVELOPMENT_TEAM=SSRKA7A4TN，PRODUCT_BUNDLE_IDENTIFIER=com.personalfinance.console.smoke（pbxproj 308-365 行）；smoke/pbxproj/project.yml 哈希见 exit-codes 同目录。
- 保护区指纹：src/model + migrations（排除 " 2." 副本）聚合 sha256 = 5eb32540…e2da3（protected-model-migrations.sha256）。
- 构建目录：选 ~/dev/finance（不在 iCloud 同步），加 scripts/m1-sync-build.sh：同步前检查 dataless，有换出文件即中止。
- 时区：M0 日志 tauri_plugin_notification.log 含 tz=Asia/Shanghai（第 1/2/3/8/9 行）。
