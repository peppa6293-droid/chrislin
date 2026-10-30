from pathlib import Path
import subprocess,time,sys,json
r=Path(__file__).resolve().parent
mode=sys.argv[1]
log=r/f'{mode}-console.log'
started=None
with log.open('wb') as f:
 p=subprocess.Popen(['xcrun','devicectl','device','process','launch','--device','00008140-001C55E91A40801C','--terminate-existing','--console','--environment-variables',json.dumps({'OS_ACTIVITY_DT_MODE':'enable','OS_ACTIVITY_MODE':'debug','CFLOG_FORCE_STDERR':'YES','NSUnbufferedIO':'YES'}),'com.personalfinance.console.smoke'],stdout=f,stderr=subprocess.STDOUT)
 backgrounded=False
 shown=set()
 events=[]
 start=time.monotonic()
 try:
  while time.monotonic()-start<120:
   s=log.read_text(errors='replace')
   if started is None and 'Launched application' in s:
    started=time.monotonic();print('LAUNCH_CONFIRMED',mode,flush=True)
   for line in s.splitlines():
    if 'tauri_plugin_notification' in line and line not in shown:
     shown.add(line);events.append({'elapsed':round(time.monotonic()-(started or start),3),'line':line});print(line,flush=True)
   if mode=='background' and not backgrounded and 'add id=2 error=none' in s:
    a=subprocess.run(['xcrun','devicectl','device','process','launch','--device','00008140-001C55E91A40801C','com.apple.Preferences'],capture_output=True,text=True,timeout=30)
    (r/'background-settings-launch.log').write_text(a.stdout+a.stderr)
    print('SETTINGS_LAUNCH_EXIT',a.returncode,flush=True)
    backgrounded=True
   if p.poll() is not None:
    print('APP_CONSOLE_EXIT',p.returncode,flush=True);break
   if started is not None and time.monotonic()-started>=95:break
   time.sleep(.5)
  v=subprocess.run(['xcrun','devicectl','device','info','processes','--device','00008140-001C55E91A40801C','--search','小钱家','--json-output',str(r/f'{mode}-processes.json')],capture_output=True,text=True,timeout=30)
  (r/f'{mode}-processes.log').write_text(v.stdout+v.stderr)
  (r/f'{mode}-notification-lines.log').write_text('\n'.join(line for line in log.read_text(errors='replace').splitlines() if 'tauri_plugin_notification' in line)+'\n')
  (r/f'{mode}-events.json').write_text(json.dumps(events,indent=2,ensure_ascii=False))
  print(v.stdout,flush=True)
  print('OBSERVATION_SECONDS',round(time.monotonic()-(started or start),1),'console_exit',p.poll(),flush=True)
 finally:
  if p.poll() is None:p.kill();p.wait()
