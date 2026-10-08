#!/usr/bin/env python3
"""Synthetic-only pipe-controlled experiments; evidence never implies Production GO.

No Python SQLite connection is used. Every SQL action uses project bundled SQLite
in an independently exec'd native process. Missing subcases remain NOT_RUN.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import platform
import re
import selectors
import shutil
import subprocess
import tempfile
import tarfile
import time
from pathlib import Path
from quiescence_gate import MaintenanceLease

REPO = Path(__file__).resolve().parents[1]
PEER = REPO / 'src-tauri/target/debug/quiescence_competitor'
RUNNER = REPO / 'src-tauri/target/debug/quiescence-fixture'
EXPECTED_RUNNER_SHA = None
EVENTS: list[dict] = []
PROCESSES = []

def record(kind, **fields):
    event = dict(sequence=len(EVENTS) + 1, controller_monotonic_ns=time.monotonic_ns(), kind=kind, **fields)
    EVENTS.append(event)
    return event

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def snapshot(root):
    result = {}
    for name in ('personal-finance-console.sqlite3', 'personal-finance-console.sqlite3-wal',
                 'personal-finance-console.sqlite3-shm', 'personal-finance-console.sqlite3-journal',
                 'outcome.json', 'outcome.json.pending', 'permit.json','permit.claimed.json','consumed.json'):
        p = root / name
        if p.exists():
            st = p.stat()
            result[name] = dict(size=st.st_size, inode=st.st_ino, dev=st.st_dev, nlink=st.st_nlink,
                                sha256=sha(p), header_hex=p.read_bytes()[:32].hex())
        else:
            result[name] = None
    record('filesystem', root=str(root), files=result)
    return result

class Process:
    def __init__(self, cmd, **kwargs):
        self.p = subprocess.Popen([str(x) for x in cmd], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True, bufsize=1, **kwargs)
        PROCESSES.append(self)
        record('spawn', pid=self.p.pid, command=[str(x) for x in cmd])
    def read(self):
        sel = selectors.DefaultSelector()
        sel.register(self.p.stdout, selectors.EVENT_READ)
        if not sel.select(15):
            raise TimeoutError(f'pipe response timeout pid={self.p.pid}')
        line = self.p.stdout.readline()
        sel.close()
        if not line:
            raise RuntimeError(f'EOF pid={self.p.pid}: {self.p.stderr.read()}')
        v = json.loads(line)
        record('native', controller_pid=self.p.pid, payload=v)
        return v
    def send(self, text):
        record('send', pid=self.p.pid, command=text.strip())
        self.p.stdin.write(text + '\n')
        self.p.stdin.flush()
    def kill(self):
        self.p.kill()
        self.p.wait(timeout=5)
        record('killed', pid=self.p.pid, returncode=self.p.returncode)

class Peer(Process):
    def __init__(self, root, create=False):
        super().__init__([PEER, root] + (['--create'] if create else []))
        self.meta = self.read()
    def sql(self, sql, query=False):
        self.send(json.dumps(dict(action='sql', sql=sql, query=query)))
        return self.read()
    def action(self, action):
        self.send(json.dumps(dict(action=action)))
        return self.read()
    def close(self):
        v = self.action('close')
        self.p.wait(timeout=5)
        return v

def ok(v):
    assert v.get('ok') is True, v
    return v

def busy(v):
    assert v.get('ok') is False and v.get('primary_code') == 5, v
    return v

def fixture(base, label):
    root = base / label
    root.mkdir()
    (root / 'SYNTHETIC_ONLY').write_text('PFC_QUIESCENCE_SYNTHETIC_V1\n')
    p = Peer(root, True)
    ok(p.sql('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);'))
    source = (REPO / 'src/persistence/migrations.ts').read_text()
    for v in range(1, 4):
        sql = re.search(r'const migrationV%s = `(.*?)`;' % v, source, re.S).group(1)
        ok(p.sql(sql))
        ok(p.sql(f"INSERT INTO schema_migrations VALUES({v}, 'synthetic');"))
    ok(p.sql("INSERT INTO profiles(id,display_name,created_at) VALUES('fixture','Synthetic','synthetic');"))
    ok(p.sql("INSERT INTO app_metadata(key,value) VALUES('quiescence-sentinel','unchanged');"))
    p.close()
    shutil.copyfile(root / 'personal-finance-console.sqlite3', root / 'backup.sqlite3')
    (root / 'manifest.json').write_text('{"synthetic_only":true,"version":1}\n')
    return root

def profile(p, locking='EXCLUSIVE'):
    ok(p.sql(f'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0; PRAGMA synchronous=FULL; PRAGMA fullfsync=ON; PRAGMA locking_mode={locking};'))
    for setting in ('journal_mode','locking_mode','busy_timeout','synchronous','fullfsync','foreign_keys','wal_autocheckpoint'):
        ok(p.sql('PRAGMA ' + setting, True))

def prepare_native(root):
    assert EXPECTED_RUNNER_SHA is None or sha(RUNNER)==EXPECTED_RUNNER_SHA, 'native binary changed during evidence run'
    executable = root / 'native-runner'
    shutil.copyfile(RUNNER, executable)
    executable.chmod(0o700)
    permit = dict(format_version=1, synthetic_only=True, session='fixture-session', nonce=root.name,
                  authorization_id='synthetic-'+root.name, database_sha256=sha(root/'personal-finance-console.sqlite3'),
                  backup_sha256=sha(root/'backup.sqlite3'), executable_path=str(executable),
                  executable_sha256=sha(executable), manifest_sha256=sha(root/'manifest.json'),
                  allow_recovery=True, allow_wal_infrastructure=True)
    (root/'permit.json').write_text(json.dumps(permit)+'\n')
    return executable

def run_native(root, callback=None, fail=None, prepare=True):
    executable=prepare_native(root) if prepare else root/'native-runner'
    with MaintenanceLease(root,'fixture-session') as lease:
        env=os.environ.copy()
        env.update(PFC_QUIESCENCE_LEASE_FD=str(lease.fd),PFC_QUIESCENCE_LEASE_PATH=str(lease.path),PFC_QUIESCENCE_SESSION=lease.session)
        if fail:env['PFC_Q_FAIL']=fail
        n=Process([executable,'run',root,'--barrier'],env=env,pass_fds=(lease.fd,))
        observed=[]
        while True:
            event=n.read();observed.append(event)
            if callback and callback(event,n)=='kill':
                n.kill();break
            # Only documented stages have barriers. Final results are not resumed.
            if event.get('event') in {'permit_claimed','permit_consumed','preflight','connection_prepared','quiescence_acquired','hash_complete','m4_started','m4_statement','before_commit','committed','post_readback','verified_handoff'}:
                n.send('continue')
                if event.get('event')=='verified_handoff':
                    n.p.wait(timeout=15)
                    record('runner_exit',pid=n.p.pid,returncode=n.p.returncode,stderr=n.p.stderr.read())
                    break
            elif event.get('event')=='failure_metadata':
                continue
            else:
                n.p.wait(timeout=15)
                record('runner_exit',pid=n.p.pid,returncode=n.p.returncode,stderr=n.p.stderr.read())
                break
        snapshot(root)
        return observed

def oracle(root):
    p=Peer(root)
    out={}
    for name,sql in dict(version='PRAGMA user_version',versions='SELECT version FROM schema_migrations ORDER BY version',integrity='PRAGMA integrity_check',foreign_keys='PRAGMA foreign_key_check',sentinel="SELECT * FROM app_metadata WHERE key='quiescence-sentinel'",schema="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").items():
        out[name]=ok(p.sql(sql,True))['rows']
    p.close();record('independent_oracle',root=str(root),result=out)
    return out

def native_experiments(base):
    findings={}
    root=fixture(base,'native-success')
    peer=[None,None]
    def competitor(event,n):
        stage=event.get('event')
        if stage=='preflight':peer[0]=Peer(root)
        if stage=='quiescence_acquired':peer[1]=Peer(root)
        if stage in ('quiescence_acquired','hash_complete','committed','post_readback'):
            for p in peer:
                busy(p.sql('SELECT * FROM profiles',True))
                busy(p.sql("UPDATE app_metadata SET value='forbidden'"))
            snapshot(root)
    findings['success_events']=run_native(root,competitor)
    for p in peer:p.close()
    persisted=oracle(root)
    assert persisted['version']==[{'user_version':4}], persisted
    assert persisted['versions']==[{'version':i} for i in range(1,5)],persisted
    assert persisted['integrity']==[{'integrity_check':'ok'}] and not persisted['foreign_keys'],persisted
    assert persisted['sentinel']==[{'key':'quiescence-sentinel','value':'unchanged'}],persisted
    assert json.loads((root/'outcome.json').read_text())['state']=='V4_VERIFIED'
    findings['success_persisted']=persisted
    expected=json.loads((REPO/'migrations/v4-schema.json').read_text())
    assert persisted['schema']==[x for x in expected if not x['name'].startswith('sqlite_')],persisted['schema']
    findings['replay_events']=run_native(root,prepare=False)
    assert findings['replay_events'][-1]['error']['code']=='PERMIT_REPLAY_OR_PENDING'
    for behavior in ('reader','writer','committed','deferred'):
        root=fixture(base,'native-race-'+behavior);holder=[None]
        def race(event,n):
            if event.get('event')=='preflight':
                holder[0]=Peer(root)
                sql={'reader':'BEGIN; SELECT * FROM profiles','writer':"BEGIN IMMEDIATE; UPDATE app_metadata SET value='writer'",'committed':"UPDATE app_metadata SET value='committed'",'deferred':'BEGIN DEFERRED'}[behavior]
                ok(holder[0].sql(sql))
        events=run_native(root,race)
        holder[0].close()
        state=oracle(root)
        assert state['version']==[{'user_version':4 if behavior=='deferred' else 3}],state
        findings['race_'+behavior]=events
    for fail in ('constraint','rollback_failure','post_readback','permit_persistence','hash_timeout','hash_locked_timeout','hash_locked_mismatch'):
        root=fixture(base,'native-fail-'+fail)
        events=run_native(root,fail=fail);state=oracle(root)
        assert events[-1]['event']=='blocked',events
        assert state['version']==[{'user_version':4 if fail=='post_readback' else 3}],state
        if fail=='constraint':assert events[-1]['error']['sqlite_primary']==19,events[-1]
        findings[fail]=dict(events=events,oracle=state)
    for stage in ('permit_claimed','permit_consumed','quiescence_acquired','m4_statement','before_commit','committed'):
        root=fixture(base,'native-crash-'+stage)
        events=run_native(root,lambda event,n:'kill' if event.get('event')==stage else None)
        before=snapshot(root)
        status=subprocess.run([root/'native-runner','status',root],capture_output=True,text=True,check=False)
        record('startup_status',root=str(root),returncode=status.returncode,stdout=status.stdout,stderr=status.stderr)
        # Recovery is explicitly authorized only for these synthetic fixtures;
        # preserve pre-recovery main/journal before the independent SQLite open.
        crashdir=root/'pre-recovery';crashdir.mkdir()
        for p in root.glob('personal-finance-console.sqlite3*'):shutil.copyfile(p,crashdir/p.name)
        state=oracle(root)
        assert state['version'] in ([{'user_version':3}],[{'user_version':4}]),state
        findings['crash_'+stage]=dict(events=events,pre_recovery=before,oracle=state,startup=status.stdout)
    for defect in ('wrong_m4_table','wrong_m4_index','legacy_schema','manifest_drift','db_replace','db_replace_hot','db_symlink','hardlink','wal_sidecars','wal_race','cold_journal','orphan_shm','od04a_denied','od04b_denied'):
        root=fixture(base,'native-reject-'+defect)
        hold=[None]
        if defect in ('wrong_m4_table','wrong_m4_index','legacy_schema'):
            p=Peer(root)
            sql={'wrong_m4_table':'CREATE TABLE planning_income_month_revisions(wrong TEXT)',
                 'wrong_m4_index':'CREATE INDEX planning_income_month_revision_lookup ON profiles(display_name)',
                 'legacy_schema':'ALTER TABLE profiles ADD COLUMN unexpected TEXT'}[defect]
            ok(p.sql(sql));p.close()
        elif defect=='hardlink':os.link(root/'personal-finance-console.sqlite3',root/'db-alias')
        elif defect=='wal_sidecars':
            p=Peer(root);ok(p.sql('PRAGMA journal_mode=WAL'));ok(p.sql("UPDATE app_metadata SET value='wal'"));p.close()
        elif defect in ('cold_journal','orphan_shm'):
            (root/('personal-finance-console.sqlite3-'+('journal' if defect=='cold_journal' else 'shm'))).write_bytes(bytes(512))
        if defect in ('wrong_m4_table','wrong_m4_index','legacy_schema','wal_sidecars'):
            shutil.copyfile(root/'personal-finance-console.sqlite3',root/'backup.sqlite3')
        prepare_native(root)
        if defect.startswith('od04'):
            permit=json.loads((root/'permit.json').read_text())
            permit['allow_recovery' if defect=='od04a_denied' else 'allow_wal_infrastructure']=False
            (root/'permit.json').write_text(json.dumps(permit))
        def adversary(event,n):
            if event.get('event')=='preflight':
                if defect=='manifest_drift':(root/'manifest.json').write_text('{"changed":true}')
                elif defect=='db_replace':
                    (root/'personal-finance-console.sqlite3').rename(root/'original.sqlite3')
                    shutil.copyfile(root/'backup.sqlite3',root/'personal-finance-console.sqlite3')
                elif defect=='db_symlink':
                    target=root/'separate-synthetic.sqlite3'
                    shutil.copyfile(root/'backup.sqlite3',target)
                    hold[0]=dict(target=str(target),sha256=sha(target),sidecars=[str(target)+s for s in ('-journal','-wal','-shm')])
                    (root/'personal-finance-console.sqlite3').rename(root/'original.sqlite3')
                    (root/'personal-finance-console.sqlite3').symlink_to(target)
                    record('synthetic_symlink_injected',**hold[0])
                elif defect=='db_replace_hot':
                    source=fixture(base,'separate-hot-source')
                    p=Peer(source)
                    ok(p.sql("PRAGMA cache_size=1; BEGIN IMMEDIATE; UPDATE app_metadata SET value='uncommitted'; CREATE TABLE crash_spill(v BLOB); INSERT INTO crash_spill VALUES(zeroblob(1048576));"))
                    p.kill()
                    journal=source/'personal-finance-console.sqlite3-journal'
                    assert journal.exists() and journal.read_bytes()[:8]==bytes.fromhex('d9d505f920a163d7'), 'hot journal header not observed'
                    (root/'personal-finance-console.sqlite3').rename(root/'original.sqlite3')
                    for suffix in ('','-journal'):
                        shutil.copyfile(source/('personal-finance-console.sqlite3'+suffix),root/('personal-finance-console.sqlite3'+suffix))
                    hold[0]={name:sha(root/name) for name in ('personal-finance-console.sqlite3','personal-finance-console.sqlite3-journal')}
                    record('hot_replacement_before_native',files=hold[0])
                elif defect=='wal_race':
                    hold[0]=Peer(root);ok(hold[0].sql('PRAGMA journal_mode=WAL'));ok(hold[0].sql("UPDATE app_metadata SET value='wal-race'"));snapshot(root)
        before=snapshot(root)
        events=run_native(root,adversary,prepare=False)
        assert not any(e.get('event')=='m4_started' for e in events),events
        assert events[-1].get('event')=='blocked',events
        if defect=='db_symlink':
            assert sha(hold[0]['target'])==hold[0]['sha256']
            assert all(not Path(p).exists() for p in hold[0]['sidecars'])
            record('separate_synthetic_target_unchanged',**hold[0])
        elif defect=='db_replace_hot':
            assert all(sha(root/name)==digest for name,digest in hold[0].items()),'replacement was recovered or modified'
            record('hot_replacement_unchanged',files=hold[0])
        elif hold[0]:hold[0].close()
        findings['reject_'+defect]=dict(events=events,before=before,after=snapshot(root))
    return findings

def reconcile(result):
    q=result['q_matrix']
    if result.get('controls'):
        for key,covered,gaps in [
            ('Q10','native peer BUSY at 0/100/5000ms, actual errors and elapsed microseconds','SQLITE_LOCKED injection not executed'),
            ('Q13','NORMAL COMMIT release versus EXCLUSIVE COMMIT retained; raw FD close hazard','real pager fault and normal rollback continuity matrix absent'),
            ('Q14','macOS unix VFS raw same-process close reproducibly allows competitor write','helper-time competitor barrier is absent'),
            ('Q18','WAL reader coexists with BEGIN EXCLUSIVE; no-checkpoint close sidecars saved','clean WAL first visit, checkpoint/main-hash controls and actual I/O trace absent')]:
            q[key]=dict(status='PARTIAL',completed=covered,missing=gaps)
    if result.get('native'):
        q['Q05']=dict(status='PASS',completed='fresh competitor opened after native lock; real SELECT and UPDATE return BUSY after lock, hash, COMMIT and protected post-readback; no second BEGIN')
        q['Q08']=dict(status='PASS',completed='closed fixed native M4 commit; independent reopen verifies exact expected schema, both version authorities, integrity/FK and sentinel; native verifies all legacy table rows')
        entries={
            'Q01':('idle peer before lock; reads/writes BUSY after lock','known-old-runtime case is in separate managed gate tests, not integrated with this run'),
            'Q02':('real reader blocks runner with code5; deferred-without-read permits migration','reader release then fresh authorized attempt same DB not run'),
            'Q03':('real writer blocks runner without M4; committed write rejected by C0','same writer commit then new stale-C0 attempt not chained'),
            'Q04':('preflight pipe barrier idle/reader/writer/committed controls plus deferred','known V3 classification not integrated into all four runner cases'),
            'Q06':('SIGKILL after M4 statement/before COMMIT/after COMMIT; before-recovery copies retained, atomic V3/V4 reopen and startup status','same permit replay after each crash not separately invoked'),
            'Q07':('actual constraint failure; synthetic rollback failure; post-readback failure','real injected IO/pager/rollback failure absent; synthetic rollback control not equivalent'),
            'Q09':('DELETE success; WAL-sidecars and preflight-to-WAL race rejection; orphan SHM/cold journal; OD04a/b false gates','hot journal pre-lock race and all TRUNCATE/PERSIST/OFF/MEMORY controls absent'),
            'Q12':('committed C0 drift, schema drift, lock-internal helper timeout/mismatch; competing writes at hash completion denied','helper wrong inode/truncation and competitor synchronized during helper not run'),
            'Q15':('manifest drift, DB namespace replace, symlink replacement and hardlink rejected; separate synthetic symlink target remains byte-identical with no sidecars','unlink-only and differing lock protocol/VFS configurations absent'),
            'Q16':('claim/consumed/prelock/commit crash evidence; permit persistence fault and replay after verified success; native inherited lease','actual fsync crash/IO injection, double native gate launch and native lease handoff failure absent'),
            'Q17':('wrong M4 table/index and altered legacy table rejected without M4','legacy constraint-only drift case absent')}
        for key,(covered,gaps) in entries.items():q[key]=dict(status='PARTIAL',completed=covered,missing=gaps)
    q['Q11']=dict(status='NOT_RUN',reason='fixture executable is not a real Tauri/TypeScript IPC session; CLI and node substitutes are explicitly excluded')

def controls(base):
    findings = {}
    root=fixture(base,'controls-locks')
    a,b=Peer(root),Peer(root)
    profile(a)
    ok(a.sql('BEGIN EXCLUSIVE'))
    busy(b.sql('SELECT * FROM profiles',True))
    busy(b.sql("UPDATE app_metadata SET value='bad'"))
    ok(a.sql('COMMIT'))
    busy(b.sql('SELECT * FROM profiles',True))
    busy(b.sql("UPDATE app_metadata SET value='bad'"))
    snapshot(root)
    a.close()
    ok(b.sql('SELECT * FROM profiles',True))
    b.close()
    findings['idle_and_cross_commit_exclusive']='PASS'

    for mode in ('reader','writer','deferred'):
        root=fixture(base,'controls-'+mode)
        a,b=Peer(root),Peer(root)
        profile(a)
        sql={'reader':'BEGIN; SELECT * FROM profiles','writer':"BEGIN IMMEDIATE; UPDATE app_metadata SET value='new'",'deferred':'BEGIN DEFERRED'}[mode]
        ok(b.sql(sql))
        (ok if mode=='deferred' else busy)(a.sql('BEGIN EXCLUSIVE'))
        if mode=='deferred': ok(a.sql('ROLLBACK'))
        ok(b.sql('ROLLBACK'))
        a.close();b.close()
        findings[mode]='PASS'

    for locking in ('NORMAL','EXCLUSIVE'):
        root=fixture(base,'controls-'+locking)
        a,b=Peer(root),Peer(root);profile(a,locking)
        ok(a.sql('BEGIN EXCLUSIVE'));ok(a.sql('COMMIT'))
        (ok if locking=='NORMAL' else busy)(b.sql('BEGIN IMMEDIATE'))
        if locking=='NORMAL':ok(b.sql('ROLLBACK'))
        if locking=='EXCLUSIVE':
            a.action('raw_close')
            response=b.sql('BEGIN IMMEDIATE')
            findings['posix_raw_close_actual_result']=response
            if response['ok']:ok(b.sql('ROLLBACK'))
        a.close();b.close()
        findings['locking_'+locking]='PASS'

    root=fixture(base,'controls-busy')
    a,b=Peer(root),Peer(root)
    ok(a.sql('BEGIN EXCLUSIVE'))
    for timeout in (0,100,5000):
        ok(b.sql(f'PRAGMA busy_timeout={timeout}'))
        busy(b.sql('BEGIN EXCLUSIVE'))
    ok(a.sql('ROLLBACK'));a.close();b.close()
    findings['busy_timeout_distribution']='PASS'

    root=fixture(base,'controls-wal')
    a=Peer(root)
    ok(a.sql('PRAGMA journal_mode=WAL',True));ok(a.sql("UPDATE app_metadata SET value='wal-commit'"))
    b=Peer(root)
    ok(b.sql('BEGIN; SELECT * FROM app_metadata'))
    ok(a.sql('BEGIN EXCLUSIVE'));ok(a.sql('ROLLBACK'))
    snapshot(root);ok(b.sql('ROLLBACK'));b.close();a.close();snapshot(root)
    findings['wal_reader_exclusive_not_excluding_reader']='PASS'
    return findings

def main():
    global EXPECTED_RUNNER_SHA
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,default=REPO/'evidence/quiescence/experiments.json')
    parser.add_argument('--native',action='store_true')
    args=parser.parse_args()
    EXPECTED_RUNNER_SHA=sha(RUNNER) if args.native else None
    base=Path(tempfile.mkdtemp(prefix='pfc-quiescence-')).resolve()
    record('environment',platform=platform.platform(),uname=list(platform.uname()),controller_pid=os.getpid(),
           peer_sha256=sha(PEER),runner_sha256=sha(RUNNER) if args.native else None,
           source_sha256={str(p.relative_to(REPO)):sha(p) for p in [Path(__file__),REPO/'src-tauri/src/bin/quiescence_competitor.rs',REPO/'src-tauri/src/quiescence.rs',REPO/'migrations/004.sql',REPO/'migrations/v3-schema.json',REPO/'migrations/v4-schema.json'] if p.exists()},
           synthetic_root=str(base),scope='synthetic fixtures only; no Production access')
    result=dict(fixture_root=str(base),q_matrix={f'Q{i:02}':dict(status='NOT_RUN',reason='full approved scenario not yet verified') for i in range(1,19)})
    try:
        result['controls']=controls(base)
        if args.native:result['native']=native_experiments(base)
    except Exception as e:
        result['controller_error']=repr(e)
    finally:
        for p in PROCESSES:
            if p.p.poll() is None:p.kill()
        reconcile(result)
        result['events']=EVENTS
        args.output.parent.mkdir(parents=True,exist_ok=True)
        archive=args.output.parent/(args.output.stem+'-fixtures.tar.gz')
        allowed={'SYNTHETIC_ONLY','outcome.json','outcome.json.pending','consumed.json','permit.json','permit.claimed.json','manifest.json'}
        with tarfile.open(archive,'w:gz') as tar:
            for p in sorted(base.rglob('*')):
                if p.is_file() and ('.sqlite3' in p.name or p.name in allowed):
                    tar.add(p,arcname=str(p.relative_to(base)),recursive=False)
        result['preserved_fixtures']=dict(path=str(archive),sha256=sha(archive),scope='synthetic DB/sidecars and synthetic states only; no executable')
        args.output.write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k not in ('events','native')},indent=2))
    return bool(result.get('controller_error'))

if __name__=='__main__':raise SystemExit(main())
