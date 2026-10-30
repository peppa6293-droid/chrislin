# M1 步骤 6 报告（2026-10-30）：重启后数据回读（真机）

状态：命令行终止+冷启动部分通过；Owner 手动上划划掉后重开的部分待 Owner 操作后读库。

## 做了什么（均在同一台 iPhone 上，bundle com.personalfinance.console.smoke，同一 IPA 9dee9cee…df57，同一容器）
1. 重启前基线：容器 …/CA51C648-417F-487B-BD99-6DBCBEB64E7E；进程 pid 1219 在运行；取库 before-restart.sqlite3，sha256 345ac2d2…bf73。
2. 终止进程：`devicectl device process terminate --pid 1219` → "Sent signal to terminate process"；再查进程列表：NOT RUNNING（pid-after-kill.txt）。
3. 冷启动：`devicectl device process launch` → "Launched application"；新 pid 1642（≠1219，确为新进程）。
4. 重启后取库 after-cli-restart.sqlite3。

## 证据
| 项 | 证据 | 结果 |
|---|---|---|
| 真终止、真重启（不是刷新 WebView） | pid 1219 → 终止后无进程 → 新 pid 1642 | 通过 |
| 数据库逐字节相同 | 重启前后 sha256 均为 345ac2d2dcf9e7760a9cb98b3f68516b4caaad9ad1d4c5242c4c8479d72bbf73 | 通过 |
| 仍读同一库、同一路径 | 同一容器内同一文件，修改时间仍为 04:01（未被重写） | 通过 |
| 设置与消费保留 | profiles=1；设置 6/1/2000；收入 10000；现金 30000；expenses=4、expense_records=4；合计 134.3；integrity ok | 通过 |
| 不重走首次设置、不重复初始化/播种 | profiles/financial_settings/accounts/cash_accounts/income_records 行数、分类 11 个、schema_migrations 8 重启前后完全相同；expenses 最晚 created_at 仍是 20:01:51Z（无新写入） | 通过 |
| 不自动补写消费 | expenses 仍 4 行 | 通过 |
| 不加载 M0 表 | 库内无 m0_spike（S1 已证） | 通过 |
| 启动无异常 | 进程存活（pid 1642，10 秒后仍在） | 通过（仅限进程存活，未读崩溃日志） |
| 重启后首页界面 | 无截图能力 | 待验证，需 Owner |
| Owner 手动上划划掉后重开 | 待 Owner 操作 | 待验证 |

## 局限
- devicectl terminate 发的是终止信号，与用户在多任务界面上划不是同一路径；M0 时 Owner 也要求二者分开验证，所以保留手动上划这一步。
- 我只证明了"重启后库没变"。"重启后首页显示什么"要靠 Owner 看屏幕。
- 重启前基线时 App 一直在前台运行（pid 1219 自 S5 安装后未退出），所以这次"重启前"并没有经过"后台被系统回收"的路径。

## 请 Owner 做
1. 在手机上从多任务界面把「小钱家」上划划掉。
2. 重新点开「小钱家」。
3. 看首页：应直接是首页（不是首次设置），本月消费 ¥134.30、还可花 ¥1,865.70、最近三笔 5 餐饮 / 20 交通 / 100.50 其他。
4. 截图或告诉我。我再读一次库，应仍是 345ac2d2…bf73（若你没有再记账）。

---
# 更新：Owner 手动上划划掉后重开 —— 步骤 6 通过

证据：owner-after-swipe-home-screenshot.jpg（手机时钟 11:01）、processes-after-owner-swipe.json、after-owner-swipe.sqlite3。

| 项 | 证据 | 结果 |
|---|---|---|
| 确为新进程（上划后重开） | 我冷启动后 pid 1642；Owner 上划重开后 pid 1652 | 通过 |
| 重开后直接进首页，不是首次设置 | 截图：首页，无设置页面 | 通过 |
| 首页数字 | 本月已花 ¥134.30、建议上限 ¥2,000.00、还可花 ¥1,865.70、期望 ¥2,000.00 | 通过 |
| 最近三笔 | ¥5.00 餐饮；¥20.00 交通；¥100.50 其他/午餐 | 通过 |
| 库逐字节不变 | sha256 仍为 345ac2d2dcf9e7760a9cb98b3f68516b4caaad9ad1d4c5242c4c8479d72bbf73（与重启前、命令行重启后相同） | 通过 |
| 数据 | profiles=1，expenses=4，合计 134.3，integrity ok | 通过 |

两次重启（命令行终止、手动上划）均通过。截图只覆盖首屏。
步骤 6 结论：重启后数据回读在真机上通过。
