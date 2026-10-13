# IPC boundary

The product automated suite (including `tests/quiescence-ipc-contract.test.ts`) passed 300/300; the current-source Rust recovery/quiescence suite passed 33/33. The formal Gate handoff is not a registered Tauri invoke command; it is the native CLI argument branch in `src-tauri/src/main.rs`. Current renderer-specific business IPC during unsafe/safe Gate states was not observed in a shared runtime, so that R2C field remains UNKNOWN. Prior R2B native Tauri/Q11 fail-closed coverage is reused only for the native portion.
