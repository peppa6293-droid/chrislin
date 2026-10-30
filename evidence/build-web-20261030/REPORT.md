# Web 构建诊断与 iOS 构建记录（2026-10-30）

状态：PARTIAL。Web 构建方案已验证；指定 iOS 构建已执行，但原生链接失败，尚无可交付安装包。

## 根因证据

原目录受 iCloud File Provider 管理。`tauri-bootstrap.ts` 和 `MyFinancePages.tsx` 的文件标志为 `compressed,dataless`、分配块数为 0；File Provider 回读显示 `isDownloaded=0`、`isDownloading=1`、`isKeepDownloaded=0`。Vite 主线程等待事件，Rolldown 工作线程停在 read；独立 rg/head 也在读取相同文件时超时。Vite 最后报 UNLOADABLE_DEPENDENCY / Operation timed out (os error 60)。

最后显示的 SVG 是进度文本，不能据此把 SVG 当作阻塞文件。配置只有 react()；源码构建入口无 process.exit，VITE_M0_LAB 仅参与渲染分支。Node v24.21.0，Vite 8.3.2，React 插件 6.1.1，Rolldown 1.2.12。

## 顺序对照

所有 Web 对照限时 300 秒，均设 VITE_M0_LAB=1；使用临时等效 timeout 工具，因为主机未安装 timeout。首轮管道启用 pipefail，其余直接保留构建退出码。

| 位置 | NODE_ENV | 结果 | 耗时/说明 |
|---|---|---|---|
| 原目录 | 未设置 | exit 1 | Vite 3m31s，两份源码读取超时 |
| 原目录 | production | exit 1 | Vite 4m58s，同样两份源码读取超时 |
| 原目录 | development | exit 124 | 300s 限时终止，停在 transforming |
| ~/dev/finance | 未设置，第1次 | exit 0 | built in 497ms |
| ~/dev/finance | 未设置，第2次 | exit 0 | built in 108ms |
| ~/dev/finance | production | exit 0 | built in 102ms |
| ~/dev/finance | development | exit 0 | built in 121ms |
| /tmp/finance-中文 空格-20261030 | 未设置 | exit 0 | built in 166ms |

结论：NODE_ENV=development 不是当前故障根因，中文和空格对照通过。已验证的修复方案是在云盘外使用完整落地的构建源码和依赖。原目录未被修复为可稳定读取，不能宣称原路径恢复。

未复现“Vite 无错误且 exit 0、没有 built in”；不能解释该历史单次现象。普通 `... | tee` 未启用 pipefail 时，退出码可能只是 tee 的退出码，不能作为构建完成证据。

## 本地副本和范围

构建目录：`/Users/linte/dev/finance`。312 个构建相关文件内容逐一与 Git 索引 blob 哈希核对一致；293 个从工作区复制，19 个云占位文件从索引对应 blob 恢复。原目录 HEAD 9e92b3c，当前已跟踪修改仍仅用户原有 PROJECT-STATE.md / WORKLOG.md。未修改业务源码、Vite 配置、依赖版本、生产数据库或系统 iCloud 配置。新目录仅为构建快照，不自动同步后续源码。

原目录两份故障文件已通过 FileManager 重新请求下载；请求成功不代表数据已落地，回读仍为 dataless。

Web 产物引用已回读核对：web-dist/index.html 引用的 JS/CSS 存在。

## iOS

执行命令：

```sh
cd /Users/linte/dev/finance
env -u NODE_ENV VITE_M0_LAB=1 npx tauri ios build --target aarch64 --config src-tauri/tauri.smoke.conf.json --config src-tauri/tauri.m0lab.conf.json
```

共执行两轮：

1. 首轮本地副本遗漏 migrations 静态定义，build.rs 报 native M4 artifact / NotFound。已补齐原项目受管 migrations 文件，未执行数据库迁移。
2. 第二轮通过该检查，随后原生链接失败：Undefined symbols for architecture arm64，涉及 `_log_stdout`、`_on_webview_created`、`_register_plugin`、`_run_plugin_command`。Cargo 101，xcodebuild 65，外层 CLI exit 1。另有 framework 链接警告；未把警告直接认定为根因。

iOS 前置 Web 构建再次成功。第二轮失败已经超出 Web 构建卡住的故障点，原生符号缺失的根因尚未验证，未修改 Tauri/Swift 链接逻辑或签名配置。未安装到设备、未发布。

下一步：由后续原生构建诊断继续检查 Tauri Swift 静态库符号及链接输入。可从 `/Users/linte/dev/finance` 和本报告保留的两轮日志接续。

## 证据

a.log、finance-production.log、finance-development.log 为原目录三组对照。finance-local-*.log 和对应 exit 为本地副本四组。finance-chinese-space.log 为中文空格路径对照。采样和 File Provider 回读见 finance-*-sample.txt、finance-fileprovider.txt；复制来源见 snapshot-copy-receipt.json。

Vite 官方说明：vite build 默认使用生产构建，不需要手工设置 NODE_ENV=development。
https://vite.dev/guide/build
