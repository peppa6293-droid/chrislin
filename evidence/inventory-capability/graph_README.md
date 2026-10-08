# App graph Phase A capability receipt

Contract: `PKG-G-1008`; date: 2026-10-08 Asia/Shanghai.

Conclusion: `APP_GRAPH_CAPABILITY_PROVEN`, scoped strictly to authorization §6
A–G isolated synthetic bounded-directory-graph prototype. This is **not** full
app inventory acceptance and does not authorize Phase B by itself.

Reproduce from project root:

```sh
python3 scripts/inventory_capability/graph_fixtures.py
```

Saved run: `graph_capability.json`. Each case includes actual canonical node
identities, edges, boundary classifications, matches and structured unknowns.
The temporary synthetic trees are removed after execution; their recorded paths
are evidence of that run, not persistent installed objects.

Verified cases:

- A: 1,502 framework-style symlinks resolve to nine canonical nodes without
  duplicate identity UNKNOWNs. No name/brand/framework allowlist.
- B: Production-like nested bundle remains discoverable beneath unrelated apps.
- C: arbitrary-name symlink reaches hidden, suffix-renamed Production-like app.
- D: external target is UNKNOWN unless separately declared as a bounded root;
  explicitly scoped case finds the target and preserves the alias edge.
- E: ancestor cycle terminates and both alias edges retain target reachability.
- F: malformed unrelated app metadata remains UNKNOWN.
- G: flat/nested payload identities are represented; outer wrapper remains
  `WRAPPER_PARSER_NOT_APPROVED` rather than inheriting its payload identity.

Unmet full-contract requirements:

- Native Finder alias/bookmark detection and safe resolution are not implemented.
- No approved wrapper parser or installed/candidate byte-binding integration.
- No continuous stable-snapshot or TOCTOU guarantee; endpoint stats do not prove
  uninterrupted graph stability and symlink replacement is not fully guarded.
- No guarantee for arbitrary malformed suffixless platform layouts.
- No host installed-app inventory, Production DB or Production app access.
- No gate changes, permit, release receipt, build, install, launch or migration.

Therefore all observations deliberately retain `appComplete=false`;
`fullAppInventoryCapabilityProven=false` is explicit in JSON. Complete Phase B
still requires the independent R/H capability decision and unmet design coverage.

Development correction: first framework run exposed Contents/Info.plist being
mistaken for an independent flat boundary. Flat inference now requires an
explicit supported flat platform; the original actual .app boundary still fails
closed on malformed/missing metadata. Corrected full fixture run passed.

Historical blocker `RB-V4-OLD-RUNTIME-01` remains CLOSED;
`RB-V4-CUTOVER-INVENTORY-01` remains OPEN. Production V4 Migration is NOT AUTHORIZED.
