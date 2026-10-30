# M1 步骤 1 报告（2026-10-30，进行中：BLOCKED 等 Owner 在手机信任描述文件）

## 已完成并有证据
1. 取证（卸载前）：files.txt、copy.txt、pre-uninstall.sqlite3、sha256.txt（74b02ea1…c049e0c431）、readback.txt
   - 容器：/private/var/mobile/Containers/Data/Application/980FE3AF-BB70-4785-A95A-F6B5F8889295
   - 库：Library/Application Support/com.personalfinance.console.smoke/personal-finance-console.sqlite3，12 KB
   - 内容：user_version=0；表 m0_spike、sqlite_sequence；m0_spike 2 行；无 -wal/-shm 附属文件。
2. 卸载旧 App：uninstall.log "App uninstalled."；after-uninstall.txt "Apps installed:"（空）。
3. 构建：构建目录 ~/dev/finance（不被 iCloud 同步），先跑 scripts/m1-sync-build.sh（dataless 检查通过、SYNC OK）。无 VITE_M0_LAB、NODE_ENV 未设：build:web exit 0，web-dist 无 M0Lab/lab/glass/m0_spike；tauri ios build exit 0。
4. IPA：sha256 839bb3d1…b923；bundle id com.personalfinance.console.smoke；TeamIdentifier SSRKA7A4TN；IPA 内 lab 字符串命中文件数 0（ipa-lab-grep.txt）。
5. 安装：install.log 成功，新 installationURL …/60A07B01-5318-44F1-879E-0C9283A360D6/…。

## 未通过：真机启动（验证 ensure_smoke_data_dir_isolated）
- launch.log：FBSOpenApplicationServiceErrorDomain error 1，Security："invalid code signature, inadequate entitlements or its profile has not been explicitly trusted by the user"。
- 判断：BLOCKED（权限，不是代码失败）。与 M0 首次真机启动同一错误（.ios-link-diagnosis/device-launch-console.log）。重装清掉了信任状态。
- 需要 Owner：iPhone「设置 > 通用 > VPN 与设备管理」里信任该开发者描述文件，再告诉我。我不改签名、不绕过。
- 信任后我执行：launch；查进程存活；用 devicectl 取库，读新库路径与表，作为 ensure_smoke_data_dir_isolated 未拒绝的证据。

---
# 更新 03:40：Owner 已信任描述文件，真机启动验证 —— 通过

| 项 | 证据 | 结果 |
|---|---|---|
| launch 成功 | launch2.log："Launched application with com.personalfinance.console.smoke bundle identifier." | 通过 |
| 进程存活 | processes2.json：pid 1154，…/60A07B01-…/小钱家.app/小钱家；约 30 秒后 processes3.json（alive-30s.txt）仍在 | 通过（≥30 秒；更长时间待验证） |
| ensure_smoke_data_dir_isolated 未拒绝 | 启动后库文件 340 KB、03:27 写入（files2.txt）；该检查在 setup 里先于建库，拒绝则不会生成库 | 通过 |
| 真机实际数据库路径 | /private/var/mobile/Containers/Data/Application/7FA1E4C9-B17A-407E-8F48-F60645BE7FC6/Library/Application Support/com.personalfinance.console.smoke/personal-finance-console.sqlite3 | 已证 |
| 库内容 | post-launch-readback.txt：user_version=8；integrity_check=ok；schema_migrations 最大版本=8；30 张表；无 m0_spike；profiles=0 | 已证 |
| 是产品入口而非 lab | 库里有迁移链建的 30 张表且无 m0_spike；IPA 内 lab 字符串命中 0 | 已证（界面截图未取得，待验证） |

说明
- 容器 UUID 由 980FE3AF… 变为 7FA1E4C9…（卸载重装所致，预期内）。不得硬编码，运行时解析 app_data_dir。
- 旧 M0 库已取证并随卸载清掉；新库是迁移链新建（无 m0_spike）。
- 数据库为空（profiles=0），首次启动应进入「首次设置」。该界面未目视确认，待验证。
- 过程中我的一次进程检查误报 "NO PROCESS"：进程名含中文且在 JSON 里是 URL 编码，匹配方式错了，后以 Bundle 路径片段匹配纠正（processes2.json 可复核）。
- 未写任何业务代码，未加任何诊断代码，无需删除。
