# tauri-plugin-notification 2.8.0 — iOS UTC scheduling patch

**Vendored from:** crates.io `tauri-plugin-notification 2.8.0`

**Patched file:** `ios/Sources/Notification.swift`, `handleScheduledNotification`

```swift
dateFormatter.timeZone = TimeZone(secondsFromGMT: 0)
```

## Why

Tauri's `Schedule.at` serializes the date as an ISO-8601 UTC string
(`2026-10-29T15:22:14.000Z`). The plugin's `DateFormatter` format is
`yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`, where `'Z'` is a literal. Without an explicit
time zone it parses the UTC wall clock as local time. On UTC+8 the parsed date
is eight hours in the past, so iOS throws `ShowNotificationError` and the
notification is never scheduled.

Setting the formatter time zone to UTC makes the `Z` timestamp parse correctly.
`Schedule.at(new Date(Date.now() + 60_000))` then schedules +60s on UTC+8.

## Verification

- `evidence/m0-20261029/44-*.png`: official `Schedule.at` path, foreground.
- `evidence/m0-20261029/45-*.png` / `46-*.png`: background / terminated.
- Log: `evidence/m0-20261029/ios-build-notifpatch.log`.

## Remove when

The upstream `tauri-plugin-notification` crate parses the `Z` suffix as UTC
(or sets `timeZone` to UTC) and the fix is available in the version used by
`src-tauri/Cargo.toml`. Remove this directory and the `[patch.crates-io]` line.
