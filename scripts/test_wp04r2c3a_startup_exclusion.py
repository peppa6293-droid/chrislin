"""Synthetic full-chain startup exclusion acceptance. Never launches Production."""
from __future__ import annotations
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time
import unittest

REPO = Path(__file__).resolve().parents[1]
EVIDENCE = REPO / "evidence/wp04-release-cutover-readiness/51-r2c3a-startup-exclusion"
SIGNING_IDENTITY = "Apple Development: 8619814730147 (FW5KHTFNZ6)"
UNIFIED_MARKER = "PFC_WP04_SYNTHETIC_CUTOVER_V1\n"

sys.path.insert(0, str(REPO / "scripts"))
import production_v4_release_gate as gate
import quiescence_integration as qic
from quiescence_gate import MaintenanceLease


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def synthetic_root(parent: Path) -> Path:
    root = Path(tempfile.mkdtemp(prefix="pfc-r2c3a-", dir=parent)).resolve()
    (root / "SYNTHETIC_ONLY").write_text(UNIFIED_MARKER)
    return root


def probe(binary: Path, root: Path, timeout: int = 15, check_durable: bool = False) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ, PFC_IPC_ROOT=str(root), PFC_IPC_CHECK_DURABLE_STARTUP="1" if check_durable else "0")
    return subprocess.run([str(binary), "--pfc-startup-exclusion-probe"], cwd=REPO,
                          env=env, capture_output=True, text=True, timeout=timeout)


def launch_probe_app(app: Path, root: Path, log: Path, hold_seconds: int = 4, check_durable: bool = False) -> subprocess.Popen[str]:
    command=["open", "-n", "-W", str(app), "--args", "--pfc-startup-exclusion-probe", str(root), str(log), str(hold_seconds)]
    if check_durable: command.append("--check-durable")
    return subprocess.Popen(command, cwd=REPO, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def wait_probe_event(log: Path, event: str, timeout: float = 20) -> dict:
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        if log.is_file():
            for line in log.read_text().splitlines():
                try: value=json.loads(line)
                except json.JSONDecodeError: continue
                if value.get("event")==event: return value
        time.sleep(0.025)
    raise AssertionError(f"probe app did not record {event}: {log}")


def webcontent_attribution(bundle_id: str, output_dir: Path) -> dict:
    inventory = subprocess.run(["ps", "-Ao", "pid=,args="], capture_output=True, text=True, timeout=10)
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "process-inventory.txt").write_text(inventory.stdout)
    candidates = []
    for line in inventory.stdout.splitlines():
        match = re.match(r"\s*(\d+)\s+(.*)$", line)
        if match and re.search(r"/com\.apple\.WebKit\.WebContent(?:\s|$)", match.group(2)):
            candidates.append((int(match.group(1)), line))
    attributed, unknown, lsapp = [], [], {}
    for pid, line in candidates:
        result = subprocess.run(["launchctl", "print", f"pid/{pid}"], capture_output=True, text=True, timeout=10)
        (output_dir / f"launchctl-{pid}.txt").write_text(result.stdout + result.stderr)
        if result.returncode != 0:
            unknown.append({"pid":pid,"process":line,"error":result.stderr.strip()})
        elif re.search(rf"bundle ID = {re.escape(bundle_id)}(?:\s|$)", result.stdout):
            attributed.append(pid)
            info=subprocess.run(["lsappinfo","info","-pid",str(pid)],capture_output=True,text=True,timeout=10)
            lsapp[str(pid)]=info.stdout+info.stderr
            (output_dir / f"lsappinfo-{pid}.txt").write_text(lsapp[str(pid)])
    return {"bundle_id":bundle_id,"webcontent_processes_seen":len(candidates),"attributed_pids":attributed,
            "attributed_count":len(attributed),"unknown_pid_count":len(unknown),"unknown":unknown,"lsappinfo":lsapp,
            "method":"ps executable identity + launchctl pid coalition bundle ID"}


def wait_for(path: Path, timeout: float = 90) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.is_file():
            return
        time.sleep(0.025)
    raise AssertionError(f"test hook phase was not reached: {path.name}")


class StartupExclusionAcceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.native = REPO / "src-tauri/target/debug/quiescence-fixture"
        cls.probe_binary = REPO / "src-tauri/target/debug/quiescence-tauri"
        config = json.loads((REPO / "src-tauri/tauri.quiescence.conf.json").read_text())
        env = dict(os.environ, TAURI_CONFIG=json.dumps(config, ensure_ascii=False))
        for command in (
            ["cargo", "build", "--manifest-path", "src-tauri/Cargo.toml", "--features",
             "quiescence-fixture,wp04-r2c3a-startup-exclusion-test-hooks", "--bin", "quiescence-fixture"],
            ["cargo", "build", "--manifest-path", "src-tauri/Cargo.toml", "--features",
             "quiescence-tauri", "--bin", "quiescence-tauri"],
        ):
            result = subprocess.run(command, cwd=REPO, env=env, capture_output=True, text=True, timeout=300)
            if result.returncode:
                raise RuntimeError(result.stderr)
        if not cls.native.is_file() or not cls.probe_binary.is_file():
            raise RuntimeError("synthetic startup-exclusion executables are missing")
        binding=json.loads((EVIDENCE / "11-regression/startup-exclusion-ui-probe/test-app-binding.json").read_text())
        cls.probe_app=Path(binding["bundle_path"])
        if binding.get("bundle_id")!="org.pfc.quiescence.integration" or not (cls.probe_app/"Contents/MacOS/quiescence-tauri").is_file():
            raise RuntimeError("signed synthetic Tauri probe app identity is not bound")

    def test_full_chain_exclusion_and_lifetime(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pfc-r2c3a-gate-parent-") as temp:
            parent = Path(temp).resolve()
            fixture = qic.create_fixture(parent, self.native, scenario="r2c3a-exclusion", mode=qic.UNIFIED_R2B_GATE_OWNED,
                                         signing_identity=SIGNING_IDENTITY)
            root = Path(fixture["root"])
            inputs = root / "gate-inputs"
            inputs.mkdir()
            approval_path, authorization_path = inputs / "candidate-approval.json", inputs / "migration-authorization.json"
            executable = root / "managed/install/Installed.app/Contents/MacOS/personal-finance-console"
            manifest = root / "managed/install/Installed.app/Contents/Resources/runtime-compatibility.json"
            database, backup = root / "personal-finance-console.sqlite3", root / "backup.sqlite3"
            lease = MaintenanceLease(root, fixture["session"], mode="unified-r2b")
            lease.__enter__()
            try:
                qic.prepare_managed(root, lease, mode=qic.UNIFIED_R2B_GATE_OWNED)
                approval_path.write_text(json.dumps({"status":"OWNER_APPROVED_SYNTHETIC_R2B_CANDIDATE",
                    "authorizationId":"synthetic-r2c3a-approval","candidateExecutableSha256":digest(executable),
                    "compatibilityManifestSha256":digest(manifest),"bundleId":"org.pfc.quiescence.integration",
                    "maxSupportedSchemaVersion":4,"syntheticOnly":True}))
                authorization_path.write_text(json.dumps({"status":"OWNER_AUTHORIZED_SYNTHETIC_R2B_MIGRATION",
                    "authorizationId":"synthetic-r2c3a-migration","productionDbPreMigrationSha256":digest(database),
                    "candidateExecutableSha256":digest(executable),"backupPath":str(backup),"syntheticOnly":True}))
                base = [sys.executable, str(REPO / "scripts/production_v4_release_gate.py"),
                    "preflight", "--candidate-approval", str(approval_path), "--migration-authorization", str(authorization_path),
                    "--synthetic-root", str(root), "--synthetic-mode", "unified-r2b"]
                env = dict(os.environ, **lease.environment())
                preflight = subprocess.run(base, cwd=REPO, env=env, pass_fds=(lease.fd,), capture_output=True, text=True, timeout=120)
                self.assertEqual(preflight.returncode, 0, preflight.stderr + preflight.stdout)
                hook_dir = Path(tempfile.mkdtemp(prefix="pfc-r2c3a-hooks-", dir=parent)).resolve()
                env.update({"PFC_R2C3A_STARTUP_EXCLUSION_TEST_DOMAIN":"UNIFIED_R2B_SYNTHETIC",
                            "PFC_R2C3A_STARTUP_EXCLUSION_HOOK_DIR":str(hook_dir)})
                migrate = list(base); migrate[2] = "migrate"
                phase_results = []
                phases = (("AFTER_S5_QUIESCENCE_ACQUIRED", "05-s5"),
                          ("AFTER_COMMIT_BEFORE_VERIFIED_READBACK", "06-post-commit"))
                env["PFC_R2C3A_STARTUP_EXCLUSION_PAUSE_AT"] = ",".join(phase for phase, _ in phases)
                process = subprocess.Popen(migrate, cwd=REPO, env=env, pass_fds=(lease.fd,),
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                for phase, folder in phases:
                    reached = hook_dir / f"{phase}.reached"
                    wait_for(reached)
                    ui_log=hook_dir/f"ui-{phase}.jsonl"
                    ui_process=launch_probe_app(self.probe_app,root,ui_log)
                    blocked_event=wait_probe_event(ui_log,"blocked")
                    ui_stdout,ui_stderr=ui_process.communicate(timeout=20)
                    self.assertEqual(ui_process.returncode,0,ui_stderr+ui_stdout)
                    self.assertIn("STARTUP_EXCLUSION_BUSY",blocked_event["details"]["error"])
                    self.assertNotIn("guard_acquired_before_builder",ui_log.read_text())
                    self.assertIsNone(process.poll(), "native migration did not remain active while UI was excluded")
                    attribution = webcontent_attribution("org.pfc.quiescence.integration", EVIDENCE / "10-renderer-attribution" / phase)
                    self.assertEqual(attribution["unknown_pid_count"], 0, json.dumps(attribution))
                    self.assertEqual(attribution["attributed_count"], 0, json.dumps(attribution))
                    (EVIDENCE / folder).mkdir(parents=True, exist_ok=True)
                    row = {"phase":phase,"ui_exit_code":ui_process.returncode,"ui_event":blocked_event,
                           "native_migration_still_active":True,"renderer_created":False,
                           "renderer_count":attribution["attributed_count"],"renderer_attribution":attribution,
                           "renderer_basis":"UI probe exits at shared-lock contention before Tauri context/Builder/WebView creation"}
                    (EVIDENCE / folder / "startup-attempt.json").write_text(json.dumps(row, indent=2) + "\n")
                    phase_results.append(row)
                    (hook_dir / f"{phase}.resume").write_text(phase)
                stdout, stderr = process.communicate(timeout=120)
                self.assertEqual(process.returncode, 0, stderr + stdout)
                lease.__exit__()
                s10_log=hook_dir/"ui-S10.jsonl"
                released_process=launch_probe_app(self.probe_app,root,s10_log,hold_seconds=10)
                webview_event=wait_probe_event(s10_log,"webview_created")
                attempts=[]
                for _ in range(12):
                    s10_attribution=webcontent_attribution("org.pfc.quiescence.integration", EVIDENCE / "10-renderer-attribution" / "S10")
                    attempts.append(s10_attribution)
                    if s10_attribution["attributed_count"]>0: break
                    time.sleep(0.25)
                native_pid=webview_event["pid"]
                native_launchservices=subprocess.run(["lsappinfo","info","-pid",str(native_pid)],capture_output=True,text=True,timeout=10)
                native_launchctl=subprocess.run(["launchctl","print",f"pid/{native_pid}"],capture_output=True,text=True,timeout=10)
                native_identity=native_launchservices.stdout+native_launchservices.stderr+native_launchctl.stdout+native_launchctl.stderr
                (EVIDENCE / "10-renderer-attribution" / "S10" / f"native-{native_pid}-launchservices-launchctl.txt").write_text(native_identity)
                self.assertIn("org.pfc.quiescence.integration",native_identity)
                stdout, stderr=released_process.communicate(timeout=20)
                self.assertEqual(released_process.returncode, 0, stderr + stdout)
                self.assertGreater(s10_attribution["attributed_count"],0,json.dumps(attempts))
                self.assertEqual(json.loads((root / "verified-handoff.json").read_text())["state"], "VERIFIED_HANDOFF")
                conn = __import__("sqlite3").connect(database)
                self.assertEqual(conn.execute("PRAGMA user_version").fetchone()[0], 4)
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM schema_migrations WHERE version=4").fetchone()[0], 1)
                conn.close()
                (EVIDENCE / "07-s10-release").mkdir(parents=True, exist_ok=True)
                (EVIDENCE / "07-s10-release" / "startup-attempt.json").write_text(json.dumps({
                    "state":"VERIFIED_HANDOFF","ui_exit_code":released_process.returncode,
                    "ui_event":webview_event,"renderer_created":True,
                    "migration4_rows":1,"authority":"isolated unified synthetic Gate"}, indent=2) + "\n")
                (EVIDENCE / "10-renderer-attribution").mkdir(parents=True, exist_ok=True)
                (EVIDENCE / "10-renderer-attribution" / "phase-attribution.json").write_text(json.dumps({
                    "s5":{"renderer_count":phase_results[0]["renderer_count"],"renderer_attribution":phase_results[0]["renderer_attribution"]},
                    "post_commit":{"renderer_count":phase_results[1]["renderer_count"],"renderer_attribution":phase_results[1]["renderer_attribution"]},
                    "s10":{"renderer_count":s10_attribution["attributed_count"],"renderer_attribution":s10_attribution,
                    "webview_created_marker":webview_event},
                    "launchservices_coalition_capture":"captured per visible WebContent PID"}, indent=2) + "\n")
            finally:
                if lease.fd >= 0:
                    lease.__exit__()
                import shutil
                shutil.rmtree(locals().get("hook_dir", parent / "__missing__"), ignore_errors=True)

    def test_ui_shared_lock_excludes_gate_exclusive_lock(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pfc-r2c3a-ui-owner-") as temp:
            root = synthetic_root(Path(temp).resolve())
            ui_log=Path(temp)/"ui.jsonl"
            process=launch_probe_app(self.probe_app,root,ui_log)
            try:
                event=wait_probe_event(ui_log,"webview_created")
                with self.assertRaises(BlockingIOError):
                    MaintenanceLease(root, "r2c3a-r01", mode="unified-r2b").__enter__()
            finally:
                try:
                    process.communicate(timeout=20)
                except subprocess.TimeoutExpired:
                    process.terminate(); process.wait(timeout=3)
            (EVIDENCE / "03-ui-holds").mkdir(parents=True, exist_ok=True)
            (EVIDENCE / "04-gate-holds").mkdir(parents=True, exist_ok=True)
            (EVIDENCE / "03-ui-holds" / "ui-holds-shared-lock.json").write_text(json.dumps({"ui_guard":"HELD","tauri_builder_reached":True,"ui_event":event}, indent=2) + "\n")
            (EVIDENCE / "04-gate-holds" / "gate-refused-exclusive.json").write_text(json.dumps({"gate_exclusive_acquire":"REFUSED_WHILE_UI_SHARED_LOCK_HELD"}, indent=2) + "\n")

    def test_crash_releases_os_lock_but_durable_state_blocks_ui(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pfc-r2c3a-crash-") as temp:
            root = synthetic_root(Path(temp).resolve())
            (root / "outcome.json").write_text(json.dumps({"state":"COMMIT_OUTCOME_UNKNOWN"}) + "\n")
            ready = root / "holder-ready"
            code = "import fcntl,os,time; p=os.path.join(os.environ['PFC_IPC_ROOT'],'maintenance.lock'); fd=os.open(p,os.O_CREAT|os.O_RDWR,0o600); f=os.fdopen(fd,'r+b'); fcntl.flock(f,fcntl.LOCK_EX); open(os.environ['READY'],'w').write('held'); time.sleep(60)"
            holder = subprocess.Popen([sys.executable,"-c",code],env=dict(os.environ,PFC_IPC_ROOT=str(root),READY=str(ready)))
            try:
                wait_for(ready)
                holder.kill(); holder.wait(timeout=5)
                ui_log=root.parent/"crash-ui.jsonl"
                result=launch_probe_app(self.probe_app,root,ui_log,check_durable=True)
                blocked=wait_probe_event(ui_log,"durable_state_blocked")
                stdout,stderr=result.communicate(timeout=20)
                self.assertEqual(result.returncode,0,stderr+stdout)
                (EVIDENCE / "08-crash-unresolved").mkdir(parents=True, exist_ok=True)
                (EVIDENCE / "08-crash-unresolved" / "crash-lock-release.json").write_text(json.dumps({
                    "holder_exit":"SIGKILL","os_exclusive_lock_released":True,"ui_exit_code":result.returncode,"startup_decision":blocked,
                    "unresolved_state":"COMMIT_OUTCOME_UNKNOWN","ui_blocked_before_builder":True}, indent=2) + "\n")
            finally:
                if holder.poll() is None: holder.kill(); holder.wait()

    def test_wrong_namespace_attempt_is_not_a_pass(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pfc-r2c3a-namespaces-") as temp:
            parent=Path(temp).resolve(); gate_root=synthetic_root(parent); ui_root=synthetic_root(parent)
            fd=os.open(gate_root/"maintenance.lock",os.O_CREAT|os.O_RDWR,0o600)
            try:
                fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
                ui_log=parent/"wrong-namespace-ui.jsonl"
                result=launch_probe_app(self.probe_app,ui_root,ui_log)
                event=wait_probe_event(ui_log,"webview_created")
                stdout,stderr=result.communicate(timeout=20)
                self.assertEqual(result.returncode,0,stderr+stdout)
                (EVIDENCE / "02-design").mkdir(parents=True,exist_ok=True)
                (EVIDENCE / "02-design" / "wrong-namespace-negative.json").write_text(json.dumps({
                    "gate_lock_root":str(gate_root),"ui_lock_root":str(ui_root),"ui_started":True,"ui_event":event,
                    "counted_as_exclusion_pass":False,"reason":"the roots differ"},indent=2)+"\n")
            finally:
                os.close(fd)

if __name__ == "__main__":
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    raise SystemExit(0 if result.wasSuccessful() else 1)
