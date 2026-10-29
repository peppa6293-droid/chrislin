# Local patch: tauri-runtime-wry 2.12.1

This directory is a vendored copy of the crates.io `tauri-runtime-wry` 2.12.1
source with one local change.

## Upstream

- PR: <https://github.com/tauri-apps/tauri/pull/16082>
- Title: `fix(runtime-wry): skip webview_version check on non-Windows platforms`
- Status at vendoring time: open / unmerged.

## Why

On the iOS 26/27 simulator, `wry::webview_version()` →
`platform_webview_version` → `[NSBundle bundleWithIdentifier:]` hits a
`CFRelease` assertion and the app dies with `EXC_BREAKPOINT` / `SIGTRAP` before
the first frame. The runtime check is only meaningful on Windows (WebView2
Evergreen); every other platform ships a system webview.

## Change

`src/lib.rs`, `Context::new`, field `webview_runtime_installed`:

```diff
-      webview_runtime_installed: wry::webview_version().is_ok(),
+      webview_runtime_installed: (cfg!(windows)
+        && wry::webview_version().is_ok())
+        || !cfg!(windows),
```

Remove this patch when Tauri ships the upstream fix (PR #16082 or later).
