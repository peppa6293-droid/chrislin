#!/usr/bin/env python3
"""Isolated Phase A graph experiment; NOT a gate or installed-app scanner.

Only the fixture runner invokes this collector. There is deliberately no CLI
accepting host roots. Alias/bookmark and snapshot-race gaps forbid app.complete.
"""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import stat

TARGET = "org.example.isolated.productionlike"


def within(path, root):
    return path == root or root in path.parents


def inventory(roots, fixture_domain, max_nodes=10000):
    domain = Path(fixture_domain).resolve(strict=True)
    roots = [Path(p).resolve(strict=True) for p in roots]
    if not roots or any(not within(p, domain) for p in roots):
        raise ValueError("fixture roots must be inside explicit fixture domain")
    nodes, edges, unknowns, snapshots = {}, [], [], {}
    pending = list(roots)

    def unknown(path, reason, error=None):
        unknowns.append({"path": str(path), "reason": reason, "error": error})

    def key(st):
        return f"{st.st_dev}:{st.st_ino}"

    def fingerprint(st):
        return [st.st_dev, st.st_ino, st.st_mode, st.st_size, st.st_mtime_ns, st.st_ctime_ns]

    def stable_bytes(path, boundary):
        real = path.resolve(strict=True)
        if not within(real, boundary):
            raise ValueError("metadata/executable escapes its bundle")
        before = path.stat()
        data = path.read_bytes()
        after = path.stat()
        if fingerprint(before) != fingerprint(after):
            raise ValueError("file changed while read")
        snapshots[str(path)] = fingerprint(after)
        return data

    while pending:
        path = pending.pop()
        try:
            st = path.stat()
            ident = key(st)
            if ident in nodes:
                continue
            if len(nodes) >= max_nodes:
                unknown(path, "NODE_LIMIT")
                continue
            snapshots[str(path)] = fingerprint(st)
            node = {"id": ident, "path": str(path), "boundary": None, "productionLike": False}
            nodes[ident] = node
            entries = sorted(path.iterdir(), key=lambda p: p.name)
            names = {p.name for p in entries}
            mac = path / "Contents" / "Info.plist"
            flat = path / "Info.plist"
            # An actual structure also catches suffix-renamed bundles. Ordinary
            # directories and framework version nodes are not bundle identities.
            flat_structure = False
            if flat.is_file():
                try:
                    hint = plistlib.loads(flat.read_bytes())
                    flat_structure = isinstance(hint, dict) and hint.get("CFBundleSupportedPlatforms") in (["iPhoneOS"], ["WatchOS"])
                except (OSError, ValueError, plistlib.InvalidFileException):
                    pass  # A .app boundary still gets fail-closed parsing below.
            boundary = path.suffix.lower() == ".app" or mac.is_file() or flat_structure
            if boundary:
                try:
                    if mac.exists() and flat.exists():
                        raise ValueError("conflicting metadata layouts")
                    if not mac.exists() and not flat.exists() and "WrappedBundle" in names:
                        node["boundary"] = "WRAPPER_REPRESENTED_NOT_CLASSIFIED"
                        unknown(path, "WRAPPER_PARSER_NOT_APPROVED")
                    else:
                        metadata = mac if mac.exists() else flat
                        layout = "macOS" if metadata == mac else "flat"
                        info = plistlib.loads(stable_bytes(metadata, path))
                        if not isinstance(info, dict):
                            raise ValueError("metadata is not a dictionary")
                        bundle_id = info.get("CFBundleIdentifier")
                        exe_name = info.get("CFBundleExecutable")
                        if not isinstance(bundle_id, str) or not bundle_id.strip():
                            raise ValueError("missing/blank bundle ID")
                        if not isinstance(exe_name, str) or not exe_name or Path(exe_name).name != exe_name:
                            raise ValueError("invalid executable name")
                        if layout == "flat" and info.get("CFBundleSupportedPlatforms") not in (["iPhoneOS"], ["WatchOS"]):
                            raise ValueError("unproven flat platform layout")
                        exe = path / "Contents" / "MacOS" / exe_name if layout == "macOS" else path / exe_name
                        if exe.is_symlink() or not stat.S_ISREG(exe.stat().st_mode) or not exe.stat().st_mode & 0o111:
                            raise ValueError("invalid executable object")
                        digest = hashlib.sha256(stable_bytes(exe, path)).hexdigest()
                        node.update(boundary=layout, bundleId=bundle_id, exeSHA256=digest,
                                    productionLike=bundle_id == TARGET)
                except (OSError, ValueError, plistlib.InvalidFileException, TypeError) as exc:
                    node["boundary"] = "UNKNOWN"
                    unknown(path, "BUNDLE_IDENTITY_UNKNOWN", str(exc))
            for entry in entries:
                edge = {"from": ident, "entry": str(entry), "to": None, "kind": None}
                try:
                    lst = entry.lstat()
                    edge["lstat"] = fingerprint(lst)
                    if stat.S_ISLNK(lst.st_mode):
                        edge["kind"] = "symlink"
                        edge["linkText"] = os.readlink(entry)
                        target = entry.resolve(strict=True)
                        edge["canonical"] = str(target)
                        if not any(within(target, root) for root in roots):
                            edge["disposition"] = "UNKNOWN_EXTERNAL_SCOPE"
                            unknown(entry, "EXTERNAL_SCOPE")
                            edges.append(edge)
                            continue
                        target_st = target.stat()
                        if stat.S_ISDIR(target_st.st_mode):
                            edge["to"] = key(target_st)
                            edge["disposition"] = "DIRECTORY_GRAPH_EDGE"
                            pending.append(target)
                        else:
                            edge["disposition"] = "NON_DIRECTORY_RESOURCE"
                        edges.append(edge)
                    elif stat.S_ISDIR(lst.st_mode):
                        edge.update(kind="directory", to=key(lst), canonical=str(entry), disposition="DIRECTORY_GRAPH_EDGE")
                        edges.append(edge)
                        pending.append(entry)
                    # Ordinary fixture files are not app boundaries. Real Finder
                    # aliases require native detection: explicitly an unmet gap.
                except (OSError, RuntimeError) as exc:
                    edge["disposition"] = "UNKNOWN_RESOLUTION"
                    edges.append(edge)
                    unknown(entry, "EDGE_RESOLUTION", str(exc))
        except OSError as exc:
            unknown(path, "ENUMERATION_FAILED", str(exc))

    reachable = {ident for ident, node in nodes.items() if node["productionLike"]}
    changed = True
    while changed:
        changed = False
        for edge in edges:
            if edge["to"] in reachable and edge["from"] not in reachable:
                reachable.add(edge["from"])
                changed = True
    for edge in edges:
        edge["reachesProductionLike"] = edge["to"] in reachable
    for path, expected in snapshots.items():
        try:
            if fingerprint(Path(path).stat()) != expected:
                unknown(path, "SNAPSHOT_CHANGED")
        except OSError as exc:
            unknown(path, "SNAPSHOT_RECHECK_FAILED", str(exc))
    return {"scope": [str(p) for p in roots], "nodes": list(nodes.values()), "edges": edges,
            "matches": [n for n in nodes.values() if n["productionLike"]], "unknowns": unknowns,
            "fixtureGraphResolved": not unknowns, "appComplete": False,
            "limitations": ["Finder alias/bookmark detection and safe native resolution NOT IMPLEMENTED",
                            "Wrapper is represented but not classified by an approved parser",
                            "No gate integration or exact installed/candidate byte identity checks",
                            "Endpoint stat recheck is not continuous snapshot/race protection",
                            "Only synthetic fixture-domain graph and synthetic target ID tested"]}


def emit(result):
    print(json.dumps(result, indent=2, ensure_ascii=False))
