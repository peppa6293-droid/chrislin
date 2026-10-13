from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import production_v4_release_gate as gate
import quiescence_integration as qic
import unified_r2b_recovery as recovery
from quiescence_gate import MaintenanceLease

REPO = Path(__file__).resolve().parents[1]
TARGET = REPO / "src-tauri/target/debug/quiescence-fixture"
EVIDENCE = REPO / "evidence/wp04-release-cutover-readiness/45-r2b3c1-recovery-test-hooks"
MODE = qic.UNIFIED_R2B_GATE_OWNED
SIGNING_IDENTITY = "Apple Development: 8619814730147 (FW5KHTFNZ6)"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class UnifiedRecoveryHooks(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        result = subprocess.run(
            ["cargo", "build", "--manifest-path", "src-tauri/Cargo.toml", "--features",
             "quiescence-fixture,wp04-r2b-recovery-test-hooks", "--bin", "quiescence-fixture"],
            cwd=REPO, capture_output=True, text=True, timeout=300,
        )
        if result.returncode:
            raise RuntimeError(result.stderr)
        if not TARGET.is_file():
            raise RuntimeError("synthetic recovery hook consumer binary is missing")

    def setUp(self) -> None:
        self.parent_tmp = tempfile.TemporaryDirectory(prefix="pfc-r2b3c1-hooks-")
        self.parent = Path(self.parent_tmp.name).resolve()
        self.fixture = qic.create_fixture(self.parent, TARGET, scenario="r2b3c1", mode=MODE,
                                           signing_identity=SIGNING_IDENTITY)
        self.root = Path(self.fixture["root"])
        self.inputs = self.root / "gate-inputs"
        self.inputs.mkdir()
        self.approval = self.inputs / "candidate-approval.json"
        self.authorization = self.inputs / "migration-authorization.json"
        self.lease = MaintenanceLease(self.root, self.fixture["session"], mode="unified-r2b")
        self.lease.__enter__()
        qic.prepare_managed(self.root, self.lease, mode=MODE)
        self._write_inputs()

    def tearDown(self) -> None:
        if self.lease.fd >= 0:
            self.lease.__exit__()
        self.parent_tmp.cleanup()

    def _write_inputs(self) -> None:
        exe = self.root / "managed/install/Installed.app/Contents/MacOS/personal-finance-console"
        manifest = self.root / "managed/install/Installed.app/Contents/Resources/runtime-compatibility.json"
        db = self.root / "personal-finance-console.sqlite3"
        backup = self.root / "backup.sqlite3"
        candidate_hash, manifest_hash, db_hash = digest(exe), digest(manifest), digest(db)
        self.approval.write_text(json.dumps({
            "status": "OWNER_APPROVED_SYNTHETIC_R2B_CANDIDATE", "authorizationId": "synthetic-r2b3c1-candidate",
            "candidateExecutableSha256": candidate_hash, "compatibilityManifestSha256": manifest_hash,
            "bundleId": "org.pfc.quiescence.integration", "maxSupportedSchemaVersion": 4, "syntheticOnly": True,
        }), encoding="utf-8")
        self.authorization.write_text(json.dumps({
            "status": "OWNER_AUTHORIZED_SYNTHETIC_R2B_MIGRATION", "authorizationId": "synthetic-r2b3c1-migration",
            "productionDbPreMigrationSha256": db_hash, "candidateExecutableSha256": candidate_hash,
            "backupPath": str(backup), "syntheticOnly": True,
        }), encoding="utf-8")

    def _cli(self, command: str, point: str | None = None, domain: str | None = None) -> subprocess.CompletedProcess[str]:
        args = [sys.executable, str(REPO / "scripts/production_v4_release_gate.py"), command,
                "--candidate-approval", str(self.approval), "--migration-authorization", str(self.authorization),
                "--synthetic-root", str(self.root), "--synthetic-mode", "unified-r2b"]
        env = os.environ.copy()
        env.update(self.lease.environment())
        if point is not None:
            env["PFC_R2B_RECOVERY_TEST_POINT"] = point
        if domain is not None:
            env["PFC_R2B_RECOVERY_TEST_DOMAIN"] = domain
        env["PFC_R2B_RECOVERY_TEST_SOURCE_COMMIT"] = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True, text=True, check=True
        ).stdout.strip()
        return subprocess.run(args, cwd=REPO, capture_output=True, text=True, timeout=180,
                              env=env, pass_fds=(self.lease.fd,))

    def _preflight(self) -> None:
        result = self._cli("preflight")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.root / "release-receipt.json").is_file())

    def _diagnose(self) -> dict:
        snapshot, _ = recovery._read_chain(self.root)
        auth = {"formatVersion": 1, "authorizationId": "synthetic-r2b3c1-diagnostic",
                "expiresAtUnix": int(time.time()) + 600, **recovery.expected_authorization_bindings(snapshot)}
        path = self.parent / (self.root.name + "-recovery-authorization.json")
        path.write_text(json.dumps(auth, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
        return recovery.diagnose(self.root, path, digest(path))

    def _save(self, name: str, point: str, result: subprocess.CompletedProcess[str], expected: str) -> None:
        folder = EVIDENCE / name
        folder.mkdir(parents=True, exist_ok=True)
        stages = self.root / "r2b-s0-s10.jsonl"
        injection = self.root / "RECOVERY_TEST_INJECTION.json"
        value = {"testPoint": point, "expectedState": expected, "exitCode": result.returncode,
                 "stdout": result.stdout, "stderr": result.stderr,
                 "stageRows": stages.read_text().splitlines() if stages.exists() else [],
                 "injection": json.loads(injection.read_text()) if injection.exists() else None,
                 "recoveryDiagnostic": self._diagnose()}
        (folder / "result.json").write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    def _run_hook(self, point: str, folder: str, expected: str, *, exit_code: int = 0) -> dict:
        self._preflight()
        before = digest(self.root / "personal-finance-console.sqlite3")
        result = self._cli("migrate", point, "UNIFIED_R2B_SYNTHETIC")
        if exit_code == 86:
            self.assertIn("exit=86", result.stderr + result.stdout)
        else:
            self.assertNotEqual(result.returncode, 0, result.stderr + result.stdout)
        injection_path = self.root / "RECOVERY_TEST_INJECTION.json"
        self.assertTrue(injection_path.is_file(), result.stderr)
        injection = json.loads(injection_path.read_text())
        self.assertEqual(injection["testPoint"], point)
        self.assertEqual(injection["candidateIdentity"]["executableSha256"], digest(
            self.root / "managed/install/Installed.app/Contents/MacOS/personal-finance-console"))
        self.assertEqual(injection["session"], self.fixture["session"])
        self.assertEqual(injection["authority"], False)
        diag = self._diagnose()
        self.assertEqual(diag["status"], "PASS")
        self.assertEqual(diag["currentState"], expected)
        self.assertEqual(diag["diagnosticMutationCount"], 0)
        if expected in {"QUIESCENCE_ACQUIRED", "M4_IN_TRANSACTION", "FAILED_V3_CONFIRMED", "GUARD_LOST_OR_UNPROVEN", "ORPHAN_ACTIVE"}:
            self.assertEqual(digest(self.root / "personal-finance-console.sqlite3"), before)
        self._save(folder, point, result, expected)
        return diag

    def test_after_s5_quiescence_acquired(self) -> None:
        self._run_hook("AFTER_S5_QUIESCENCE_ACQUIRED", "03-s5", "QUIESCENCE_ACQUIRED", exit_code=86)

    def test_after_s7_before_commit(self) -> None:
        self._run_hook("AFTER_S7_BEFORE_COMMIT", "04-before-commit", "M4_IN_TRANSACTION", exit_code=86)

    def test_after_commit_before_verified_readback(self) -> None:
        self._run_hook("AFTER_COMMIT_BEFORE_VERIFIED_READBACK", "05-after-commit", "COMMIT_OUTCOME_UNKNOWN", exit_code=86)

    def test_after_s10_reply_lost(self) -> None:
        self._run_hook("AFTER_S10_BEFORE_CALLER_REPLY", "06-reply-lost", "V4_VERIFIED", exit_code=86)

    def test_guard_lost_after_quiescence(self) -> None:
        diag = self._run_hook("GUARD_LOST_AFTER_QUIESCENCE", "07-guard-lost", "GUARD_LOST_OR_UNPROVEN", exit_code=86)
        self.assertEqual(diag["recoveryDisposition"], "REFUSE")
        self.assertTrue((self.root / "unified-recovery-state.json").is_file())

    def test_orphan_active_after_real_native_state(self) -> None:
        diag = self._run_hook("ACTIVE_STATE_THEN_PROCESS_EXIT", "08-orphan-active", "ORPHAN_ACTIVE", exit_code=86)
        self.assertEqual(diag["recoveryDisposition"], "REFUSE")
        self.assertTrue((self.root / "recovery-active.json").is_file())

    def test_safe_failed_v3_before_m4(self) -> None:
        diag = self._run_hook("BEFORE_M4_FAIL_V3_CONFIRMED", "09-failed-v3", "FAILED_V3_CONFIRMED")
        self.assertTrue(diag["migrationMayRerun"])
        self.assertTrue((self.root / "unified-recovery-terminal.json").is_file())

    def test_wrong_domain_is_refused_before_hook(self) -> None:
        self._preflight()
        result = self._cli("migrate", "AFTER_S5_QUIESCENCE_ACQUIRED", "PRODUCTION")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("RECOVERY_TEST_DOMAIN_REFUSED", result.stderr + result.stdout)
        self.assertFalse((self.root / "RECOVERY_TEST_INJECTION.json").exists())
        self.assertFalse((self.root / "r2b-s0-s10.jsonl").exists())
        (EVIDENCE / "10-production-negative").mkdir(parents=True, exist_ok=True)
        (EVIDENCE / "10-production-negative/wrong-domain.json").write_text(json.dumps(
            {"result": "REFUSED", "error": result.stderr + result.stdout,
             "injectionReceipt": False, "nativeStageLog": False}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    def test_unknown_point_is_refused_without_fallback(self) -> None:
        self._preflight()
        result = self._cli("migrate", "DELETE_DATABASE", "UNIFIED_R2B_SYNTHETIC")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("RECOVERY_TEST_POINT_UNKNOWN", result.stderr + result.stdout)
        self.assertFalse((self.root / "RECOVERY_TEST_INJECTION.json").exists())
        self.assertFalse((self.root / "r2b-s0-s10.jsonl").exists())
        (EVIDENCE / "10-production-negative").mkdir(parents=True, exist_ok=True)
        (EVIDENCE / "10-production-negative/unknown-point.json").write_text(json.dumps(
            {"result": "REFUSED", "error": result.stderr + result.stdout,
             "injectionReceipt": False, "nativeStageLog": False}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    def test_wrong_missing_and_symlink_markers_refuse_formal_gate(self) -> None:
        marker = self.root / "SYNTHETIC_ONLY"
        original = marker.read_bytes()
        cases = []
        marker.write_bytes(b"PFC_WRONG_DOMAIN\n")
        cases.append(("wrong-marker", self._cli("preflight")))
        marker.unlink()
        cases.append(("missing-marker", self._cli("preflight")))
        marker.write_bytes(original)
        outside = self.parent / "marker-target"
        outside.write_bytes(original)
        marker.unlink()
        marker.symlink_to(outside)
        cases.append(("symlink-marker", self._cli("preflight")))
        for name, result in cases:
            self.assertNotEqual(result.returncode, 0, name)
            self.assertFalse((self.root / "release-receipt.json").exists(), name)
            (EVIDENCE / "10-production-negative").mkdir(parents=True, exist_ok=True)
            (EVIDENCE / f"10-production-negative/{name}.json").write_text(json.dumps(
                {"result": "REFUSED", "exitCode": result.returncode, "stderr": result.stderr},
                indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


class DefaultBuildHookNegative(unittest.TestCase):
    """The no-hook synthetic consumer ignores hook parameters and completes its ordinary path."""

    @classmethod
    def setUpClass(cls) -> None:
        result = subprocess.run(
            ["cargo", "build", "--manifest-path", "src-tauri/Cargo.toml", "--features",
             "quiescence-fixture", "--bin", "quiescence-fixture"],
            cwd=REPO, capture_output=True, text=True, timeout=300,
        )
        if result.returncode:
            raise RuntimeError(result.stderr)

    def test_default_feature_consumer_cannot_trigger_hook(self) -> None:
        parent_tmp = tempfile.TemporaryDirectory(prefix="pfc-r2b3c1-default-negative-")
        parent = Path(parent_tmp.name).resolve()
        lease = None
        try:
            fixture = qic.create_fixture(parent, TARGET, scenario="r2b3c1-default", mode=MODE,
                                         signing_identity=SIGNING_IDENTITY)
            root = Path(fixture["root"])
            inputs = root / "gate-inputs"
            inputs.mkdir()
            lease = MaintenanceLease(root, fixture["session"], mode="unified-r2b")
            lease.__enter__()
            qic.prepare_managed(root, lease, mode=MODE)
            approval_path = inputs / "candidate-approval.json"
            auth_path = inputs / "migration-authorization.json"
            exe = root / "managed/install/Installed.app/Contents/MacOS/personal-finance-console"
            manifest = root / "managed/install/Installed.app/Contents/Resources/runtime-compatibility.json"
            db = root / "personal-finance-console.sqlite3"
            backup = root / "backup.sqlite3"
            candidate_hash, manifest_hash, db_hash = digest(exe), digest(manifest), digest(db)
            approval_path.write_text(json.dumps({"status":"OWNER_APPROVED_SYNTHETIC_R2B_CANDIDATE",
                "authorizationId":"synthetic-r2b3c1-default-candidate","candidateExecutableSha256":candidate_hash,
                "compatibilityManifestSha256":manifest_hash,"bundleId":"org.pfc.quiescence.integration",
                "maxSupportedSchemaVersion":4,"syntheticOnly":True}), encoding="utf-8")
            auth_path.write_text(json.dumps({"status":"OWNER_AUTHORIZED_SYNTHETIC_R2B_MIGRATION",
                "authorizationId":"synthetic-r2b3c1-default-migration","productionDbPreMigrationSha256":db_hash,
                "candidateExecutableSha256":candidate_hash,"backupPath":str(backup),"syntheticOnly":True}), encoding="utf-8")
            env=os.environ.copy()
            env.update(lease.environment())
            env.update({"PFC_R2B_RECOVERY_TEST_POINT":"AFTER_S5_QUIESCENCE_ACQUIRED",
                        "PFC_R2B_RECOVERY_TEST_DOMAIN":"UNIFIED_R2B_SYNTHETIC",
                        "PFC_R2B_RECOVERY_TEST_SOURCE_COMMIT":"DEFAULT_FEATURE_NEGATIVE"})
            args=[sys.executable,str(REPO/"scripts/production_v4_release_gate.py"),"migrate",
                  "--candidate-approval",str(approval_path),"--migration-authorization",str(auth_path),
                  "--synthetic-root",str(root),"--synthetic-mode","unified-r2b"]
            preflight_args=list(args)
            preflight_args[2]="preflight"
            preflight=subprocess.run(preflight_args,cwd=REPO,capture_output=True,text=True,timeout=180,
                                     env=env,pass_fds=(lease.fd,))
            self.assertEqual(preflight.returncode,0,preflight.stderr+preflight.stdout)
            result=subprocess.run(args,cwd=REPO,capture_output=True,text=True,timeout=180,env=env,pass_fds=(lease.fd,))
            self.assertEqual(result.returncode,0,result.stderr+result.stdout)
            self.assertFalse((root/"RECOVERY_TEST_INJECTION.json").exists())
            self.assertEqual(json.loads((root/"verified-handoff.json").read_text())["state"],"VERIFIED_HANDOFF")
            conn=__import__("sqlite3").connect(db)
            self.assertEqual(conn.execute("PRAGMA user_version").fetchone()[0],4)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM schema_migrations WHERE version=4").fetchone()[0],1)
            conn.close()
            folder=EVIDENCE/"10-production-negative"
            folder.mkdir(parents=True,exist_ok=True)
            (folder/"default-feature-parameters-ignored.json").write_text(json.dumps({
                "result":"HOOK_NOT_REACHABLE","consumerFeature":"quiescence-fixture without wp04-r2b-recovery-test-hooks",
                "injectionParametersPresent":True,"migration4Rows":1,"verifiedHandoff":True,
                "injectionReceipt":False,"stdout":result.stdout},indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
        finally:
            if lease is not None and lease.fd >= 0:
                lease.__exit__()
            parent_tmp.cleanup()

    def test_production_default_binary_excludes_hook_symbols(self) -> None:
        result=subprocess.run(["cargo","build","--manifest-path","src-tauri/Cargo.toml","--bin","personal-finance-console"],
                              cwd=REPO,capture_output=True,text=True,timeout=300)
        self.assertEqual(result.returncode,0,result.stderr)
        binary=REPO/"src-tauri/target/debug/personal-finance-console"
        strings=subprocess.run(["strings",str(binary)],capture_output=True,text=True,check=True).stdout
        symbols=["PFC_R2B_RECOVERY_TEST_POINT","PFC_R2B_RECOVERY_TEST_DOMAIN","RECOVERY_TEST_INJECTION.json"]
        self.assertFalse([item for item in symbols if item in strings])
        folder=EVIDENCE/"10-production-negative"
        folder.mkdir(parents=True,exist_ok=True)
        (folder/"production-default-build-symbols.json").write_text(json.dumps({
            "result":"PRODUCTION_TEST_HOOK_REACHABILITY_NONE","binary":str(binary),
            "binarySha256":digest(binary),"checkedSymbols":symbols,"foundSymbols":[]},
            indent=2,ensure_ascii=False)+"\n",encoding="utf-8")


if __name__ == "__main__":
    unittest.main(verbosity=2)
