# V2 快捷记录隔离候选说明

本批 U-02 只实现可测试的 mock IPC 流程，不注册真实 macOS 全局快捷键、不访问 Tauri Production 环境。

## 隔离流程

1. 候选入口可绑定 `Cmd+Shift+E`，实际按键注册由后续候选 UI/本地 mock 注入。
2. 菜单栏入口与快捷键入口都进入同一 `QuickEntryDraft` 面板状态。
3. 草稿支持最近分类、最近账户、重复上次和模板复制；复制采用新对象，避免修改历史记录。
4. `submitQuickEntry` 通过 `QuickEntryIpc.saveExpense` mock 保存。
5. 成功返回 `saved` 和耗时；失败返回 `failed` 与 inline 提示。
6. 通知权限 `denied`/`unsupported` 不阻塞面板，改用应用内提示。

专项测试使用 synthetic mock IPC，验证成功、失败、重复上次、模板、权限降级和 3–5 秒目标，不代表真实 Tauri 全局快捷键已接入或产品已发布。
