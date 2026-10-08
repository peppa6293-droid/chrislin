"""Reproducible ordinary-user synthetic H capability evidence, not a gate.

Only generated fixtures are opened writable. Native/lsof observation is read-only.
All negatives remain UNKNOWN for the approved whole-host / lineage threat model.
"""
import argparse
import hashlib
import json
import ctypes
import os
from pathlib import Path
import platform
import selectors
import sqlite3
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]


def child(mode, path):
    # Controlled holder truth is communicated independently of collector output.
    if mode == 'sqlite':
        conn = sqlite3.connect(path)
        conn.execute('SELECT * FROM synthetic').fetchall()
        fd = None
    else:
        fd = os.open(path, os.O_RDONLY)
        if mode == 'mmap':
            # Python mmap duplicates an FD on this Python; use actual mmap(2)
            # so H9 really has a surviving mapping and zero numeric target FDs.
            libc = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
            libc.mmap.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int,
                                  ctypes.c_int, ctypes.c_int, ctypes.c_longlong]
            libc.mmap.restype = ctypes.c_void_p
            libc.munmap.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
            length = os.fstat(fd).st_size
            mapping = libc.mmap(None, length, 1, 1, fd, 0)
            if mapping == ctypes.c_void_p(-1).value:
                raise OSError(ctypes.get_errno(), 'mmap failed')
            os.close(fd)
            fd = None
    print(json.dumps({'ready': True, 'pid': os.getpid(), 'uid': os.getuid(), 'mode': mode}), flush=True)
    for line in sys.stdin:
        cmd = line.strip()
        if cmd == 'truth':
            if mode == 'mmap':
                print(json.dumps({'mapping_alive': True, 'first_byte': ctypes.string_at(mapping,1)[0]}), flush=True)
            elif fd is not None:
                s = os.fstat(fd)
                print(json.dumps({'fd_alive': True, 'dev': s.st_dev, 'ino': s.st_ino}), flush=True)
            else:
                print(json.dumps({'sqlite_alive': conn.execute('SELECT COUNT(*) FROM synthetic').fetchone()[0] == 1}), flush=True)
        elif cmd == 'close':
            if mode == 'sqlite': conn.close()
            elif mode == 'mmap': libc.munmap(mapping,length)
            elif fd is not None: os.close(fd)
            print(json.dumps({'closed': True}), flush=True)
            break


def run(argv, timeout=12):
    started = time.time_ns()
    try:
        p = subprocess.run(argv, capture_output=True, timeout=timeout)
        return {'argv': [str(a) for a in argv], 'exit': p.returncode,
                'stdout': p.stdout.decode(errors='backslashreplace'),
                'stderr': p.stderr.decode(errors='backslashreplace'),
                'start_ns': started, 'end_ns': time.time_ns()}
    except subprocess.TimeoutExpired as e:
        return {'argv': [str(a) for a in argv], 'timeout': True,
                'stdout': (e.stdout or b'').decode(errors='backslashreplace'),
                'stderr': (e.stderr or b'').decode(errors='backslashreplace'),
                'start_ns': started, 'end_ns': time.time_ns()}


def read_ready(p):
    with selectors.DefaultSelector() as sel:
        sel.register(p.stdout, selectors.EVENT_READ)
        if not sel.select(5): raise RuntimeError('fixture readiness timeout')
    return json.loads(p.stdout.readline())


def command(p, text):
    p.stdin.write(text + '\n'); p.stdin.flush()
    return read_ready(p)


def start(mode, path):
    p = subprocess.Popen([sys.executable, __file__, '--holder', mode, str(path)],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return p, read_ready(p)


def stop(p):
    if p.poll() is None:
        p.stdin.close()
        try: p.wait(timeout=3)
        except subprocess.TimeoutExpired:
            p.terminate(); p.wait(timeout=3)


def identity(p):
    s = p.stat()
    return {'dev': s.st_dev, 'ino': s.st_ino, 'size': s.st_size}


def classify_lsof(obs):
    # This probe deliberately has no global-coverage mechanism.
    if obs.get('timeout') or obs.get('stderr') or obs.get('exit') != 0:
        return 'UNKNOWN'
    return 'PRESENT' if '\x00i' in obs['stdout'] else 'UNKNOWN'


def observe(native, path, pid, old):
    a = run([str(native), str(path), str(pid), str(old['dev']), str(old['ino'])])
    if a.get('exit') == 0: a['parsed'] = json.loads(a['stdout'])
    b = run(['/usr/sbin/lsof', '-nP', '+w', '-F0pcfDins', '--', str(path)])
    return {'native': a, 'lsof': b, 'lsof_fact': classify_lsof(b),
            'global_absence': 'UNKNOWN'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--output', default='h_results.json')
    args = ap.parse_args()
    results = {'schema': 'phase-a-h-evidence-v1', 'uid': os.getuid(), 'platform': platform.platform(),
               'start_ns': time.time_ns(), 'cases': {}, 'production_access': False}
    with tempfile.TemporaryDirectory(prefix='pf-inventory-h-') as td:
        root = Path(td)
        native = root / 'h-native'
        results['compile'] = run(['/usr/bin/clang', '-Wall', '-Wextra', '-o', str(native),
                                 str(ROOT / 'scripts/inventory_capability/h_native.c')])
        assert results['compile']['exit'] == 0, results['compile']
        db = root / 'synthetic.sqlite3'
        with sqlite3.connect(db) as conn:
            conn.execute('CREATE TABLE synthetic (value TEXT)')
            conn.execute("INSERT INTO synthetic VALUES ('fixture-only')")
        conn.close()  # SQLite context manager commits; it does not close.
        old = identity(db)
        p, ready = start('sqlite', db)
        try:
            results['cases']['H1'] = {'ready': ready, 'identity': old, 'held': observe(native,db,p.pid,old), 'truth':command(p,'truth')}
            closed = command(p,'close'); p.wait(timeout=3)
            results['cases']['H2'] = {'closed':closed,'observation':observe(native,db,os.getpid(),old), 'fact':'UNKNOWN',
                                      'scope_note':'controlled holder closed; no whole-host absence proof'}
        finally: stop(p)
        for key, suffix in [('H3','-wal'),('H4','-shm'),('H5','-journal')]:
            path = root / ('synthetic.sqlite3'+suffix)
            path.write_bytes(b'isolated-sidecar-reference' * 256)
            old = identity(path); p, ready = start('fd', path)
            try: results['cases'][key] = {'ready':ready,'identity':old,'held':observe(native,path,p.pid,old),'truth':command(p,'truth')}
            finally: stop(p)
        for key, method in [('H6','hardlink'),('H6_symlink','symlink'),('H7','rename'),('H8','unlink')]:
            path = root / (key + '.sqlite3'); path.write_bytes(b'fixture-old-vnode'*1024)
            old = identity(path); alias = root / (key + '-alias')
            if method == 'hardlink': os.link(path,alias)
            elif method == 'symlink': alias.symlink_to(path)
            p, ready = start('fd',alias if method in ('hardlink','symlink') else path)
            try:
                if method == 'rename': path.rename(alias)
                if method == 'unlink': path.unlink()
                if method in ('rename','unlink'): path.write_bytes(b'new-unrelated-vnode'*1024)
                row = {'ready':ready,'prior_identity':old,'current_identity':identity(path),
                       'observation':observe(native,path,p.pid,old),'truth':command(p,'truth')}
                if method == 'rename': row['known_renamed_path_query']=observe(native,alias,p.pid,old)
                if method in ('rename','unlink'):
                    row['first_observation_lineage_fact']='UNKNOWN: oracle old identity comes from fixture creator, not first-time collector'
                results['cases'][key]=row
            finally: stop(p)
        path = root / 'mmap.sqlite3'; path.write_bytes(b'M' * 8192); old=identity(path)
        p,ready=start('mmap',path)
        try: results['cases']['H9']={'ready':ready,'identity':old,'held':observe(native,path,p.pid,old),'truth':command(p,'truth'),
                                    'fileport_reference_coverage':'NOT_PROVEN'}
        finally: stop(p)
        results['cases']['H10']={'different_process_same_ordinary_uid':'TESTED by all positive holder cases',
                                'different_uid':'NOT_TESTED: no account switch/elevation authorized or performed'}
        results['cases']['H11']={'protected_pid':1,'observation':observe(native,db,1,identity(db)),
                                'fact':'UNKNOWN','root_holder_fixture':'NOT_CREATED'}
        fault_inputs=[{'exit':0,'stdout':'p123\x00i456\x00','stderr':'injected warning'},
                      {'exit':2,'stdout':'','stderr':'injected error'},
                      {'exit':0,'stdout':'','stderr':''},
                      {'exit':0,'stdout':'p123\x00n/truncated','stderr':''}]
        timeout=run([sys.executable,'-c','import time; time.sleep(2)'],timeout=0.05)
        results['cases']['H12']={'injected_not_host_failures':[{'input':x,'fact':classify_lsof(x)} for x in fault_inputs],
                                'real_tool_timeout':timeout,'timeout_fact':classify_lsof(timeout)}
        empty=run(['/usr/sbin/lsof','-nP','+w','-F0pcfDins','--',str(db)])
        results['cases']['H13']={'observation':empty,'fact':classify_lsof(empty)}
        # Direct fixture checks never turn negative whole-host observations into proof.
        checks={}
        for k in ['H1','H3','H4','H5']:
            row=results['cases'][k]; obs=row['held']; pid=row['ready']['pid']
            checks[k+'_holder_seen']=pid in obs['native']['parsed']['path_query']['pids']
        for k in ['H6','H6_symlink']:
            row=results['cases'][k]
            checks[k+'_identity_seen']=row['observation']['native']['parsed']['fds']['target_identity_matches']>0
        for k in ['H7','H8']:
            row=results['cases'][k]
            checks[k+'_old_vnode_held']=row['truth']['ino']==row['prior_identity']['ino']
            checks[k+'_current_namespace_misses_holder']=row['ready']['pid'] not in row['observation']['native']['parsed']['path_query']['pids']
        checks['H9_mapping_truth']=results['cases']['H9']['truth']['mapping_alive']
        checks['H9_no_numeric_target_fd']=results['cases']['H9']['held']['native']['parsed']['fds']['target_identity_matches']==0
        checks['H9_mapping_seen']=results['cases']['H9']['held']['native']['parsed']['regions']['target_identity_matches']>0
        checks['H12_all_unknown']=all(x['fact']=='UNKNOWN' for x in results['cases']['H12']['injected_not_host_failures']) and classify_lsof(timeout)=='UNKNOWN'
        checks['H13_never_absence']=results['cases']['H13']['fact']=='UNKNOWN'
        checks['H13_exit1_empty_observed']=empty.get('exit')==1 and not empty['stdout'] and not empty['stderr']
        results['fixture_assertions']=checks
        results['fixture_assertions_pass']=all(checks.values())
    results['end_ns']=time.time_ns()
    results['capability']='H_CAPABILITY_NOT_PROVABLE_WITH_CURRENT_APPROACH'
    results['blockers']=['BLOCKED_TARGET_LINEAGE_UNKNOWN','PROTECTED_PID_REFERENCE_COVERAGE_UNKNOWN',
                         'FILEPORT_REFERENCE_COVERAGE_NOT_PROVEN','SNAPSHOT_RACE_PROTECTION_NOT_IMPLEMENTED']
    results['source_sha256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in
                             [Path(__file__),ROOT/'scripts/inventory_capability/h_native.c']}
    out=ROOT/'evidence/inventory-capability'/args.output
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps({'output':str(out),'capability':results['capability'],'assertions':results['fixture_assertions']},indent=2))
    if not results['fixture_assertions_pass']: sys.exit(1)


if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='--holder': child(sys.argv[2],sys.argv[3])
    else: main()
