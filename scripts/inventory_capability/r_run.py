#!/usr/bin/env python3
"""Reproducible ordinary-user R1-R8 capability proof. Never reads Production.

Compiles two synthetic executables and probe into a fresh temporary directory.
Only explicitly created child processes are stopped. Does not infer running bytes
from on-disk hash or claim an all-PID coverage proof from controlled fixtures.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import selectors
import shutil
import subprocess
import tempfile
import time


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    result = {'contract': 'PKG-R-1008', 'uid': os.getuid(), 'os': platform.platform(),
              'started_ns': time.time_ns(), 'cases': [], 'no_production_access': True}
    processes = []
    with tempfile.TemporaryDirectory(prefix='pf-r-capability-') as directory:
        root = Path(directory)
        probe, target, other = (root / p for p in ('probe', 'target', 'other'))
        for output, file, flags in ((probe, 'r_native.c', []), (target, 'r_fixture.c', []),
                                    (other, 'r_fixture.c', ['-DMARKER="non-target-fixture"'])):
            subprocess.run(['xcrun', 'clang', '-Wall', '-Wextra', *flags,
                            str(source / file), '-o', str(output)], check=True, capture_output=True)
        result['build'] = {'target_sha256': sha(target), 'other_sha256': sha(other),
                           'source_sha256': {name: sha(source / name) for name in
                                            ('r_native.c', 'r_fixture.c', 'r_run.py')}}

        def line(p):
            with selectors.DefaultSelector() as s:
                s.register(p.stdout, selectors.EVENT_READ)
                if not s.select(5):
                    raise RuntimeError('fixture handshake timeout')
                return p.stdout.readline().strip()

        def launch(path, argv0=None):
            p = subprocess.Popen([argv0 or str(path)], executable=str(path), stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            processes.append(p)
            return p, line(p)

        def file_identity(path):
            try:
                st = os.stat(path)
                return {'realpath': os.path.realpath(path), 'dev': st.st_dev, 'ino': st.st_ino,
                        'sha256': sha(path), 'running_image_binding': 'NOT_PROVEN_BY_PATH_HASH'}
            except OSError as e:
                return {'error': str(e), 'errno': e.errno}

        def sample(pid):
            data = json.loads(subprocess.run([str(probe), str(pid)], check=True,
                                            capture_output=True, text=True, timeout=5).stdout)
            data['observed_ns'] = time.time_ns()
            data['path_file'] = file_identity(data['path']) if data['path'] else None
            data['start_stable_within_sample'] = (data['before'] == data['after'] and
                data['before']['bytes'] == data['bsd_expected_size'])
            return data

        def case(id, description, path, argv0=None):
            p, handshake = launch(path, argv0)
            row = {'id': id, 'description': description, 'launched_path': str(path),
                   'handshake': handshake, 'launch_file': file_identity(path), 'sample': sample(p.pid)}
            result['cases'].append(row)
            return p, row

        try:
            case('R1', 'expected executable', target)
            renamed = root / 'innocent-renamed'
            shutil.copy2(target, renamed)
            p, row = case('R2', 'rename after launch', renamed)
            moved = root / 'moved-after-launch'
            renamed.rename(moved)
            row['after_rename'] = sample(p.pid)
            symlink = root / 'symbolic-launch'; symlink.symlink_to(target)
            case('R3', 'symlink launch', symlink)
            hardlink = root / 'hardlink-launch'; os.link(target, hardlink)
            case('R4', 'hardlink launch', hardlink)
            copied = root / 'copied-launch'; shutil.copy2(target, copied)
            case('R5', 'same-hash different inode', copied)
            case('R6', 'target with benign argv0', target, 'ordinary-benign-name')
            case('R6_inverse', 'non-target with target-like argv0', other, 'personal-finance-console')
            deleted = root / 'deleted-image'; shutil.copy2(target, deleted)
            p, row = case('R7_unlink', 'unlink executable while process alive', deleted)
            deleted.unlink()
            row['after_unlink'] = sample(p.pid)
            p.stdin.write('ping\n'); p.stdin.flush(); row['still_running'] = line(p)
            replaced = root / 'replaced-image'; shutil.copy2(target, replaced)
            p, row = case('R7_replace', 'replace pathname with non-target while old process alive', replaced)
            incoming = root / 'replacement'; shutil.copy2(other, incoming); os.replace(incoming, replaced)
            row['after_replace'] = sample(p.pid)
            p.stdin.write('ping\n'); p.stdin.flush(); row['still_running'] = line(p)
            p, row = case('R8', 'stable PID/start across exec demonstrates exec-blind identity', target)
            row['repeat'] = sample(p.pid)
            p.stdin.write('exec ' + str(other) + '\n'); p.stdin.flush()
            row['after_exec_handshake'] = line(p)
            row['after_exec'] = sample(p.pid)
            row['start_identity_unchanged_across_exec'] = all(
                row['sample']['before'][k] == row['after_exec']['before'][k]
                for k in ('pid', 'start_sec', 'start_usec'))
            row['pid_reuse'] = 'NOT_FORCED: start tuple helps reuse detection, no reuse coverage claimed'
            result['pid1_readonly_boundary'] = sample(1)
            by_id = {x['id']: x for x in result['cases']}
            known_hash = result['build']['target_sha256']
            result['observed_checks'] = {
                'R1_expected_path_hash_matches': by_id['R1']['sample']['path_file']['sha256'] == known_hash,
                'R2_rename_path_updates': by_id['R2']['after_rename']['path'].endswith('/moved-after-launch'),
                'R3_symlink_resolves': by_id['R3']['sample']['path'] == by_id['R1']['sample']['path'],
                'R4_hardlink_same_inode': by_id['R4']['sample']['path_file']['ino'] == by_id['R1']['sample']['path_file']['ino'],
                'R5_copy_same_hash_different_inode': by_id['R5']['sample']['path_file']['sha256'] == known_hash and by_id['R5']['sample']['path_file']['ino'] != by_id['R1']['sample']['path_file']['ino'],
                'R6_argv0_does_not_spoof_native_path': by_id['R6']['sample']['path'] == by_id['R1']['sample']['path'] and by_id['R6_inverse']['sample']['path'].endswith('/other'),
                'R7_unlinked_path_unavailable_while_alive': by_id['R7_unlink']['after_unlink']['path_result'] == 0 and by_id['R7_unlink']['still_running'].startswith('target-fixture '),
                'R7_replacement_path_hash_is_wrong_running_image': by_id['R7_replace']['after_replace']['path_file']['sha256'] == result['build']['other_sha256'] and by_id['R7_replace']['still_running'].startswith('target-fixture '),
                'R8_exec_preserves_start': row['start_identity_unchanged_across_exec'] and row['after_exec_handshake'].startswith('non-target-fixture '),
                'R8_stable_repeat_before_exec': row['sample']['before'] == row['repeat']['before'],
            }
            result['fixture_expected_behavior_observed'] = all(result['observed_checks'].values())
            result['conclusion'] = 'R_CAPABILITY_INSUFFICIENT'
            result['missing_facts'] = [
                'Kernel-bound main running-image vnode/bytes identity not established by proc_pidpath + BSD info + path stat/hash.',
                'PID/start survives exec on tested host; neither double sampling nor stable PID/start provides an exec generation or continuous race guarantee.',
                'All-PID coverage and protected/other-user executable identity not established by same-user fixtures or PID1 path observation.'
            ]
            result['scope'] = 'Controlled ordinary-user fixtures plus PID1 read-only path/start observation; no lsof txt, no installed-app scan.'
        finally:
            result['cleanup'] = []
            for p in processes:
                if p.poll() is None:
                    p.stdin.close()
                    try:
                        p.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        p.terminate(); p.wait(timeout=3)
                result['cleanup'].append({'pid': p.pid, 'returncode': p.returncode})
    result['ended_ns'] = time.time_ns()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'conclusion': result['conclusion'], 'cases': len(result['cases']),
                      'output': str(args.output), 'all_children_exited': all(x['returncode'] is not None for x in result['cleanup'])}))


if __name__ == '__main__':
    main()
