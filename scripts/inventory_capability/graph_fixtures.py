#!/usr/bin/env python3
"""Run only fresh synthetic fixtures; JSON is written to stdout."""
from pathlib import Path
import plistlib
import tempfile
from graph_prototype import TARGET, emit, inventory


def bundle(path, identity="org.example.unrelated", flat=False):
    metadata = path / "Info.plist" if flat else path / "Contents" / "Info.plist"
    exe = path / "fixture" if flat else path / "Contents" / "MacOS" / "fixture"
    exe.parent.mkdir(parents=True)
    exe.write_bytes(b"synthetic non-runnable app fixture\n")
    exe.chmod(0o700)
    info = {"CFBundleIdentifier": identity, "CFBundleExecutable": "fixture"}
    if flat:
        info["CFBundleSupportedPlatforms"] = ["iPhoneOS"]
    metadata.write_bytes(plistlib.dumps(info))


def main():
    results = []
    with tempfile.TemporaryDirectory(prefix="pf-graph-fixture-") as temp:
        domain = Path(temp)

        def scenario(name, build, check):
            base = domain / name
            base.mkdir()
            roots = build(base) or [base]
            result = inventory(roots, domain)
            passed = bool(check(result))
            results.append({"case": name, "passed": passed, "evidence": result})
            if not passed:
                emit({"case": name, "unknowns": result["unknowns"], "nodeCount": len(result["nodes"]),
                      "symlinkCount": sum(e["kind"] == "symlink" for e in result["edges"])})
                raise AssertionError(name)

        def framework(p):
            bundle(p / "Unrelated.app")
            f = p / "Unrelated.app/Contents/Frameworks/Kit.framework"
            (f / "Versions/A/Resources").mkdir(parents=True)
            (f / "Versions/Current").symlink_to("A")
            (f / "Resources").symlink_to("Versions/Current/Resources")
            for i in range(1500):
                (f / f"alias{i}").symlink_to("Versions/A")
        scenario("A_framework_1502_aliases", framework,
                 lambda r: not r["unknowns"] and len(r["nodes"]) < 15 and
                 len([e for e in r["edges"] if e["kind"] == "symlink"]) == 1502)

        def nested(p):
            bundle(p / "Unrelated.app")
            bundle(p / "Unrelated.app/Contents/Resources/Helper.app")
            bundle(p / "Unrelated.app/Contents/Resources/Helper.app/Contents/hidden/Old.APP", TARGET)
        scenario("B_nested_unrelated", nested, lambda r: len(r["matches"]) == 1 and not r["unknowns"])

        def hidden(p):
            bundle(p / ".hidden/renamed-payload", TARGET)
            (p / "innocent-name").symlink_to(".hidden")
        scenario("C_hidden_symlink", hidden, lambda r: len(r["matches"]) == 1 and any(
            e["kind"] == "symlink" and e["reachesProductionLike"] for e in r["edges"]))

        def external(p):
            (p / "scan").mkdir()
            bundle(p / "external/Old.app", TARGET)
            (p / "scan/innocent").symlink_to("../external")
            return [p / "scan"]
        scenario("D_external_unapproved", external, lambda r: not r["matches"] and
                 any(u["reason"] == "EXTERNAL_SCOPE" for u in r["unknowns"]))

        def external_approved(p):
            external(p)
            return [p / "scan", p / "external"]
        scenario("D_external_explicit_scope", external_approved, lambda r: len(r["matches"]) == 1 and
                 not r["unknowns"] and any(e["kind"] == "symlink" and e["reachesProductionLike"] for e in r["edges"]))

        def cycle(p):
            bundle(p / "nested/Old.app", TARGET)
            (p / "nested/ancestor").symlink_to("..")
            (p / "alias").symlink_to("nested")
        scenario("E_cycle_reachability", cycle, lambda r: not r["unknowns"] and len(r["matches"]) == 1 and
                 len([e for e in r["edges"] if e["kind"] == "symlink" and e["reachesProductionLike"]]) == 2)

        def malformed(p):
            bundle(p / "Unrelated.app")
            (p / "Unrelated.app/Contents/Info.plist").write_bytes(b"not a plist")
        scenario("F_malformed_boundary", malformed, lambda r: any(u["reason"] == "BUNDLE_IDENTITY_UNKNOWN" for u in r["unknowns"]))

        def layouts(p):
            wrapper = p / "Wrapper.app"
            bundle(wrapper / "Wrapper/Payload.app", flat=True)
            bundle(wrapper / "Wrapper/Payload.app/Watch/Nested.app", TARGET, flat=True)
            (wrapper / "WrappedBundle").symlink_to("Wrapper/Payload.app")
        scenario("G_wrapper_flat_nested", layouts, lambda r: len(r["matches"]) == 1 and
                 sum(n["boundary"] == "flat" for n in r["nodes"]) == 2 and
                 len(r["unknowns"]) == 1 and r["unknowns"][0]["reason"] == "WRAPPER_PARSER_NOT_APPROVED")

    emit({"contractId": "PKG-G-1008", "conclusion": "APP_GRAPH_CAPABILITY_PROVEN",
          "conclusionScope": "Authorization section 6 A-G bounded synthetic graph prototype only; not full design acceptance",
          "fullAppInventoryCapabilityProven": False, "productionGateImplemented": False,
          "fixtureTreesRemovedAfterRun": True, "cases": results})


if __name__ == "__main__":
    main()
