# Lock Primitive Readback

- Primitive: POSIX `flock(2)` with `LOCK_SH` for ordinary Production UI and `LOCK_EX` for formal Production migration; both nonblocking.
- Namespace: canonical `$HOME/Library/Application Support/com.personalfinance.console/maintenance.lock` for both Production roles. Synthetic tests substitute a canonical marked temporary authority root and use that same lock path for both roles.
- Safety: `O_NOFOLLOW|O_CLOEXEC`, owner-only mode, owner UID, regular-file/single-link check, canonical directory check, and inode identity recheck before/after acquisition.
- Race invariant: 50/50 synchronized UI-vs-migration acquisitions; double-win count 0.
