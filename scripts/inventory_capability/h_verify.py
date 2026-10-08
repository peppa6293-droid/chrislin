"""Independently reconcile saved Phase A evidence. Never touches Production."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'evidence/inventory-capability'


def read(name):
    return json.loads((EVIDENCE / name).read_text())


def native(row):
    result = row['native']
    assert result['exit'] == 0
    raw = json.loads(result['stdout'])
    assert raw == result['parsed']
    return raw


r = read('r_independent_result.json')
assert r['conclusion'] == 'R_CAPABILITY_INSUFFICIENT'
assert all(r['observed_checks'].values())
assert all(p['returncode'] == 0 for p in r['cleanup'])
cases = {c['id']: c for c in r['cases']}
replace = cases['R7_replace']
assert replace['sample']['path'] == replace['after_replace']['path']
assert replace['sample']['path_file']['sha256'] != replace['after_replace']['path_file']['sha256']
assert replace['still_running'].startswith('target-fixture ')
assert cases['R8']['sample']['before']['start_usec'] == cases['R8']['after_exec']['before']['start_usec']

h = read('h_results_corrected.json')
assert h['capability'] == 'H_CAPABILITY_NOT_PROVABLE_WITH_CURRENT_APPROACH'
assert h['fixture_assertions_pass'] and all(h['fixture_assertions'].values())
for key in ['H1', 'H3', 'H4', 'H5']:
    c = h['cases'][key]
    n = native(c['held'])
    assert c['ready']['pid'] in n['path_query']['pids']
    assert n['fds']['target_identity_matches'] > 0
    # Independently check machine-framed lsof exact target inode + device.
    raw = c['held']['lsof']
    assert raw['exit'] == 0 and not raw['stderr']
    fields = raw['stdout'].replace('\n', '').split('\0')
    assert 'p' + str(c['ready']['pid']) in fields
    assert 'i' + str(c['identity']['ino']) in fields
    assert 'D' + hex(c['identity']['dev']) in fields
for key in ['H7', 'H8']:
    c = h['cases'][key]
    n = native(c['observation'])
    assert c['prior_identity']['ino'] != c['current_identity']['ino']
    assert c['truth']['ino'] == c['prior_identity']['ino']
    assert n['path_query']['pids'] == [] and n['fds']['target_identity_matches'] == 1
    assert c['observation']['lsof']['exit'] == 1
    assert not c['observation']['lsof']['stdout'] and not c['observation']['lsof']['stderr']
c = h['cases']['H9']; n = native(c['held'])
assert n['fds']['target_identity_matches'] == 0 and n['regions']['target_identity_matches'] > 0
assert c['truth']['mapping_alive']
n = native(h['cases']['H11']['observation'])
assert n['fds']['errno'] == 1 and n['regions']['terminal_errno'] == 1 and n['fileports']['errno'] == 1
assert h['cases']['H13']['observation']['exit'] == 1 and h['cases']['H13']['fact'] == 'UNKNOWN'

g = read('graph_independent_result.json')
assert g['conclusion'] == 'APP_GRAPH_CAPABILITY_PROVEN' and not g['fullAppInventoryCapabilityProven']
assert len(g['cases']) == 8 and all(c['passed'] for c in g['cases'])
for c in g['cases']:
    e = c['evidence']
    assert not e['appComplete']
    ids = [n['id'] for n in e['nodes']]
    assert len(ids) == len(set(ids))
    # Recompute transitive reverse reachability, including cyclic aliases.
    reachable = {n['id'] for n in e['nodes'] if n['productionLike']}
    while True:
        nxt = reachable | {edge['from'] for edge in e['edges'] if edge['to'] in reachable}
        if nxt == reachable: break
        reachable = nxt
    assert all(edge['reachesProductionLike'] == (edge['to'] in reachable) for edge in e['edges'])
assert len(g['cases'][0]['evidence']['nodes']) == 9
assert sum(e['kind']=='symlink' for e in g['cases'][0]['evidence']['edges']) == 1502

before, after = read('h_preservation_before.json'), read('h_preservation_after.json')
assert before['production'] == after['production']
assert before['app_data_names'] == after['app_data_names'] == ['personal-finance-console.sqlite3']
changed = [p for p,digest in before['tracked'].items() if after['tracked'].get(p) != digest]
assert changed == ['docs/CURRENT_PHASE.md'], changed
assert all(after['preexisting_reports'][p] == digest for p,digest in before['preexisting_reports'].items())
assert not (ROOT/'V012_V4_CUTOVER_INVENTORY_IMPLEMENTATION_REPORT.md').exists()

paths = list((ROOT/'scripts/inventory_capability').glob('*.py')) + list((ROOT/'scripts/inventory_capability').glob('*.c'))
paths += [p for p in EVIDENCE.iterdir() if p.is_file() and p.name != 'verification.json']
paths += [ROOT/'V012_V4_CUTOVER_INVENTORY_CAPABILITY_REPORT.md', ROOT/'docs/CURRENT_PHASE.md',
          ROOT/'V012_V4_CUTOVER_INVENTORY_GATE_DESIGN_REVIEW.md']
authorization = Path('/Users/linte/.codex/attachments/5cb565b3-653a-4abd-bf25-829e35b1b16c/已粘贴的文本.txt')
result = {'result':'PHASE_A_EVIDENCE_RECONCILED_NOT_GATE_PASS',
          'final_status':'PF_V012_V4_CUTOVER_INVENTORY_CAPABILITY_BLOCKED',
          'r_counterexamples_rechecked':True, 'h_raw_output_rechecked':True,
          'graph_reachability_independently_recomputed':True, 'production_fingerprints_unchanged':True,
          'preexisting_reports_unchanged':True, 'tracked_changes':changed,
          'authorization_sha256':hashlib.sha256(authorization.read_bytes()).hexdigest(),
          'sha256':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)}}
(EVIDENCE/'verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='sha256'},indent=2))
