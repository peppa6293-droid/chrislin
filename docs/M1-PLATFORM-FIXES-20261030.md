# M1 平台修复（不改外观）

日期：2026-10-30　状态：自动化通过，已装机并启动；真机体验待 Owner 确认。
依据：`mobile-native` skill 的"网页感"清单。目标是只去掉 WebView 里"像网页"的细节，不改任何颜色、布局、文案。

## 改了什么

| 问题 | 修复 | 位置 |
|---|---|---|
| 安全区不生效（`env()` 全为 0） | viewport 加 `viewport-fit=cover`；顶部栏与首次设置页顶部加 `env(safe-area-inset-top)` 内边距，防止内容钻到状态栏下 | `index.html`、`v2-surface.css`（含 720px 以下规则）、`style.css` |
| 手指点过后悬停样式粘住 | 全部 46 条 `:hover` 规则包进 `@media (hover: hover) and (pointer: fine)`；混合选择器 `.v2-nav-button:hover, .v2-nav-button.is-active` 拆开，只门控 `:hover` 部分 | 13 个 CSS 文件 |
| 高度随地址栏/键盘错位 | 17 处 `vh` 改为 `dvh`（构建产物里 raw vh 为 0，dvh/svh 共 19 处） | `style.css`、`v2-surface.css`、`v2-feedback.css` |
| 点击时灰块高亮 | `html { -webkit-tap-highlight-color: transparent }` | `style.css` |
| 点击延迟 | 按钮、链接、select、summary 加 `touch-action: manipulation` | `style.css` |
| 长按选中按钮文字 | 按钮、`[role=button]`、summary 加 `user-select: none` 与 `-webkit-touch-callout: none`（正文不受影响） | `style.css` |
| iOS 点输入框自动放大页面 | 触屏设备上，全局输入框与维护页输入框改 16px（原 14px 与 13px）；记账金额框原本 26px，没被缩小 | `style.css`（放在文件末尾，保证级联顺序） |

## 没做，以及为什么
- `theme-color` 和暗色模式：我先加了 `theme-color` 后撤回了。App 没有暗色支持，设成固定浅色在深色系统下只会让状态栏与背景错配，不如不设。待 A-DARK-006 决定。
- `overscroll-behavior`：App 内部有自己的滚动容器（记账弹层），改它会影响现有行为，我没有在真机验证前动它。
- `user-scalable=no`：明确不加，这是无障碍问题。

## 证据

| 项 | 证据 | 结果 |
|---|---|---|
| 所有 CSS 仍可解析 | postcss 解析 22 个文件，失败 0 | 通过 |
| 构建产物里悬停规则全部在媒体查询内 | 构建后的 CSS：44 条门控、0 条未门控（打包器把 `hover: hover` 压缩成了 `hover:hover`，所以简单 grep 会误报 0） | 通过 |
| 构建产物无 raw `vh` | 0 条；dvh/svh 共 19 条 | 通过 |
| 守护测试 | `tests/m1-platform-baseline.test.ts` 6 条：viewport、悬停门控、无 raw vh、点击高亮与 touch-action、16px 输入框且级联靠后、顶部安全区 | 通过 |
| 守护测试确实有效 | 我故意把 `viewport-fit` 改回 `auto`、加一条未门控 `:hover` 和一条 `100vh`，3 条测试变红；恢复后文件哈希与改前一致，6 条全绿 | 通过 |
| 门禁 | `biome` 0（207 个文件）；`tsc` 0；`vitest` 61 个文件，629 通过，44 跳过（用 `--pool=threads`，原因见下） | 通过 |
| 保护区未变 | `src/model`、`migrations` 哈希 `5eb32540…` 与 S0 相同 | 通过 |
| 真机 | IPA `591482e7…4576`，Team SSRKA7A4TN，lab 命中 0；覆盖安装；数据库安装前后哈希相同 `345ac2d2…`（`profiles=1`、`expenses=4`）；第一次启动因手机锁屏被拒，解锁后重试成功，进程 2356 存活 | 通过 |
| 真机观感 | 没有截图、没有手感验证 | **待验证，需 Owner** |

## 过程中的差错（已修，留痕）
1. 我先机械地给每条 `100vh` 后面补了一行 `dvh` 作回退，被 `biome` 的 `noDuplicateProperties` 拦下 17 处错误。已改成只保留 `dvh`（iOS 15.4 以上都支持，你的手机是 iOS 27），再重跑 lint 为 0。
2. 我先把 16px 输入规则写成 `max(16px, 1em)`，发现 `1em` 取继承字号，可能会把 26px 的金额框压小。已改成对小于 16px 的两组选择器写死 16px，并核对没有覆盖金额框。
3. 我先加了 `theme-color` 后撤回，原因见上。
4. 脚本批量包裹 `:hover` 后缩进不整齐，用 `biome format` 整理，并核对 diff。
5. 本机 vitest 的 forks 池曾出现启动超时，与代码无关，本轮所有测试用 `--pool=threads`。

## 请 Owner 在手机上看
- 打开 App：顶部栏应该不贴着状态栏，整体观感与你之前看到的一致，没有任何颜色或布局变化。
- 点一下「记一笔」和别的按钮：不应再出现灰色点击闪块；点过后按钮不应停在放大状态。
- 点备注输入框：页面不应自动放大。
- 如果有任何和之前不一样的地方，请告诉我，我会按"外观不应变"来处理。
