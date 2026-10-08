"""Read bytes/stat only; never opens SQLite or launches any installed app."""
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
DB = pathlib.Path('/Users/linte/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3')
APP = pathlib.Path('/Applications/Personal Finance Console.app')

def fingerprint(path):
    before = path.stat()
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    after = path.stat()
    return dict(sha256=digest, size=after.st_size, dev=after.st_dev, inode=after.st_ino,
                mtime_ns=after.st_mtime_ns, mode=after.st_mode,
                stable=(before.st_ino, before.st_size, before.st_mtime_ns) ==
                       (after.st_ino, after.st_size, after.st_mtime_ns))

paths = [DB, APP / 'Contents/Info.plist', APP / 'Contents/MacOS/personal-finance-console']
tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
result = dict(observed_ns=time.time_ns(), uid=os.getuid(),
              production={str(p): fingerprint(p) for p in paths},
              app_data_names=sorted(p.name for p in DB.parent.iterdir()),
              tracked={p: fingerprint(ROOT / p)['sha256'] for p in tracked if p and (ROOT / p).is_file()},
              preexisting_reports={p.name: fingerprint(p)['sha256'] for p in ROOT.glob('V012*md')})
out = ROOT / 'evidence/inventory-capability' / sys.argv[1]
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(dict(output=str(out), production=result['production'], app_data_names=result['app_data_names']), indent=2))
