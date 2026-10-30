# M1 步骤 2 报告（2026-10-30）：剔除测试代码并证明进不去 —— 通过

## 做了什么
1. 核对：原项目 src/、src-tauri/src、capabilities、package.json、vite 配置等 grep `M0Lab|lab/glass|m0_spike|VITE_M0_LAB|m0-lab|--m0-|M0-AUTO` = 0 命中（grep-original.txt）。M0Lab.tsx、m0-lab.css、tauri.m0lab.conf.json、main.tsx 分支、v2-tokens.css 的 m0 token 已不在（工作树删除，未提交，非本步骤所为，S0 已记）。
2. 构建副本 ~/dev/finance 里残留 tauri.m0lab.conf.json 与 README-BUILD.md 的 VITE_M0_LAB 命令：已删该配置（git rm，未提交），README-BUILD.md 命令改为无变量并指向同步脚本。复核 grep = 0。
3. tests/m1-entry-no-lab.test.tsx（他处新增）：只做 biome 格式化，逻辑未改。

## 证据
| 验收项 | 证据 | 结果 |
|---|---|---|
| 源码/配置 0 命中 | grep-original.txt（0 行）；构建副本 grep 0 | 通过 |
| 无变量构建产物 0 命中 | dist-matrix.txt：unset build_exit=0，lab_hit_files=0 | 通过 |
| 旧变量也开不了 | 同表：VITE_M0_LAB=1 与 =true 均 exit 0、lab_hit_files=0，三种构建 dist_hash 完全相同（0087cc7804a3f34f），即变量对产物无任何影响 | 通过 |
| 自动化测试：设 /lab/glass + VITE_M0_LAB=1 仍渲染 App | tests/m1-entry-no-lab.test.tsx 2 条通过 | 通过 |
| 测试确有效（变异验证） | 临时让 main.tsx 重新支持 lab 分支 → 两条都失败（mutant-run.log，exit 1）；恢复后 main.tsx sha256 与改前一致 ffd71dcb…（main-before/after） | 通过 |
| 门禁 | lint exit 0（201 文件）、tsc exit 0、vitest 56 文件 570 passed/44 skipped、exit 0（exit-codes.txt） | 通过 |
| 真机已装包 | S1 的 IPA 由同一 main.tsx（sha256 ffd71dcb…）构建，IPA 内 lab 命中 0 | 通过 |

## 说明 / 未覆盖
- 一次作废：我的第一次三变量构建因 zsh 把 `env ...` 存变量导致 exit 127，那份矩阵已改名 INVALID-dist-matrix-exit127.txt 保留，不作证据；正式结果是重跑的 dist-matrix.txt。
- 测试是 happy-dom 里的入口渲染，不是真机界面；真机目视首屏仍待验证。
- 通知/震动插件保留注册、无入口（Owner 决定）：grep 确认 src 内无调用页面；capability（mobile.json）未改。
- 原项目 tauri.m0lab.conf.json 在工作树已删，但这些删除和 main.tsx 改动仍是未提交状态。
- 未碰 src/model、migrations、签名；保护区哈希复核见步骤 7。
