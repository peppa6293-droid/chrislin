# R capability: insufficient, not a permission workaround request

Scope: R1–R8 isolated executable fixtures, ordinary UID 501 on macOS 26.6.2 arm64. No Production app/DB access; no installed-app scan, `sudo`, `lsof`, or gate changes. Parent must independently rerun.

Run from authorized project root:

```sh
python3 scripts/inventory_capability/r_run.py --output evidence/inventory-capability/r_independent_result.json
```

Sources: `r_native.c` collects `proc_pidpath` between two `PROC_PIDTBSDINFO` calls. `r_fixture.c` is an isolated handshake/exec executable; two builds have distinct compiled markers and bytes. `r_run.py` uses a fresh temporary fixture directory and only stops its own explicitly tracked children, then deletes that directory. All evidence includes native returns/errno, PID/start, current path stat/hash and expected-behavior checks.

## Observed on this host

- Expected, renamed, symlink, hardlink and copied executable cases expose usable native path hints. Hardlink shares inode; copy shares SHA while retaining distinct inode.
- Both argv0 spoof directions leave native path referring to actual launched program, not argv0.
- Unlinked running executable: `proc_pidpath` returns 0 / ENOENT while child still responds.
- **Atomic replacement counterexample:** old target continues responding after pathname replacement; native path still returns that pathname, whose stat/hash now identify the different non-target replacement. Thus path+hash+stable PID/start falsely excludes a live target unless unknown is preserved. This is direct behavior evidence, not merely an undocumented-API concern.
- **Exec counterexample:** target execs non-target, native path changes, but PID + BSD start seconds/microseconds stay unchanged. Repeated start sampling cannot detect all exec races; actual PID reuse was not forced and no reuse coverage is claimed.
- PID 1: `proc_pidpath` returns `/sbin/launchd`; `PROC_PIDTBSDINFO` returns 0 / EPERM. Path success does not establish start identity or kernel-bound bytes.

## Required conclusion

`R_CAPABILITY_INSUFFICIENT`

Missing: trustworthy main running-image vnode/byte binding rather than the current pathname file; exec-generation/continuous observation sufficient for race requirements; complete all-PID including protected/other-user identity coverage. Same-user positives cannot establish those. Native mechanisms do avoid needing `lsof txt` for simple path hints, but these tested mechanisms cannot prove the approved R contract. No claim is made that elevated privileges automatically solve it, nor that every possible native approach is impossible. Preserve UNKNOWN and stop full implementation unless a separately reviewed capability mechanism resolves these gaps.
