import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const out=import.meta.dirname;
const asset=resolve(out,'../../../../小钱家V3_WP-UI-VISUAL-01_设计参考资产');
const profile=await mkdtemp(resolve(tmpdir(),'xqj-independent-visual-'));
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--hide-scrollbars','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
let ws;
try {
 let port; for(let i=0;i<100;i++){try{port=(await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await new Promise(r=>setTimeout(r,50));}}
 const targets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
 ws=new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl);
 await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 let id=0; const pending=new Map(), exceptions=[];
 ws.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params);if(pending.has(m.id)){const x=pending.get(m.id);pending.delete(m.id);clearTimeout(x.timer);m.error?x.reject(m.error):x.resolve(m.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(new Error('timeout '+method));},10000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});
 const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 await send('Page.enable');await send('Runtime.enable');
 const open=async(page,state,width,height=844,review=false,panel='')=>{
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
  const u=pathToFileURL(resolve(asset,page==='fixed'?'fixed-v3-source.html':'index.html'));u.search=new URLSearchParams({state,...review?{view:'review'}:{},...panel?{panel}:{}}).toString();
  await send('Page.navigate',{url:u.href});
  for(let i=0;i<60;i++){if(await ev(`document.readyState==='complete' && window.visualReference?.state===${JSON.stringify(state)}`))break;await new Promise(r=>setTimeout(r,25));}
  await ev('document.fonts.ready'); return u.href;
 };
 const shot=async file=>{const x=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(resolve(out,file),Buffer.from(x.data,'base64'));};
 const click=async selector=>{const p=await ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});};
 const geom=()=>ev(`(()=>{const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}};return{viewport:{w:innerWidth,h:innerHeight},scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,content:box(document.querySelector('.content')),hero:document.querySelector('.hero')?box(document.querySelector('.hero')):null,chart:document.querySelector('.chart-card')?box(document.querySelector('.chart-card')):null,modules:[...document.querySelectorAll('.module')].map(e=>({title:e.querySelector('h3').textContent,...box(e),balance:box(e.querySelector('.balance-pill'))})),nav:document.querySelector('.bottom-nav')?box(document.querySelector('.bottom-nav')):null,dialog:document.querySelector('dialog')?.open?box(document.querySelector('dialog')):null,heroColumns:document.querySelector('.hero-grid')?getComputedStyle(document.querySelector('.hero-grid')).gridTemplateColumns:null}})()`);
 const result={generatedAt:new Date().toISOString(),asset,scope:'isolated reference only; independent audit; no product imports or persistence',cases:[],interaction:{},exceptions};
 for(const [page,state,w,h,review,panel,file] of [
 ['home','roomy',390,844,false,'','home-roomy-390-viewport.png'],
 ['home','overload',390,844,false,'','home-overload-390-viewport.png'],
 ['home','zero-burden',390,844,false,'','home-zero-burden-390-viewport.png'],
 ['home','roomy',980,900,false,'','home-roomy-980-viewport.png'],
 ['home','overload',1180,900,false,'','home-overload-1180-viewport.png'],
 ['home','roomy',1440,1050,false,'','home-roomy-1440-viewport.png'],
 ['fixed','normal',390,844,false,'','fixed-normal-390-viewport.png'],
 ['fixed','normal',390,844,false,'note','fixed-note-390-viewport.png'],
 ['fixed','normal',390,520,false,'note','fixed-note-390x520-viewport.png'],
 ['home','overload',390,844,true,'','home-review-390-viewport.png']]){
 const url=await open(page,state,w,h,review,panel);const observations=await geom();await shot(file);result.cases.push({page,state,url,file,...observations});}
 // Actual pointer interactions; values entered through browser's input events.
 await open('fixed','normal',390,844);
 const initialSummary=await ev("document.querySelector('.fixed-summary').innerText");
 await click('[data-pay]');
 result.interaction.defaultCollapsed=await ev("document.querySelector('[data-toggle-details]').getAttribute('aria-expanded')==='false'&&document.querySelector('.date-field').hidden&&document.querySelector('.note-field').hidden");
 await click('[data-toggle-details]');
 result.interaction.groupExpanded=await ev("!document.querySelector('.date-field').hidden&&!document.querySelector('.note-field').hidden");
 await click('.note-field input');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:4});
 await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:4});
 await send('Input.insertText',{text:'独立审核-保留测试'});
 const note=await ev("document.querySelector('.note-field input').value");
 await click('[data-toggle-details]');
 const collapsed=await ev("({text:document.querySelector('[data-toggle-details]').innerText,noteHidden:document.querySelector('.note-field').hidden})");
 await shot('payment-collapsed-edited-390.png');
 await click('[data-toggle-details]');
 result.interaction.collapsePreservesNote=await ev(`document.querySelector('.note-field input').value===${JSON.stringify(note)}`);
 result.interaction.editedNote=note;result.interaction.collapsedSummary=collapsed;
 result.interaction.collapsedSummaryIncludesNote=collapsed.text.includes(note);
 result.interaction.detailsControlTarget=await ev("({id:document.querySelector('[data-toggle-details]').getAttribute('aria-controls'),target:document.getElementById('payment-details').outerHTML})");
 await click('[data-close-sheet]');
 result.interaction.cancelCloses=await ev("!document.querySelector('dialog').open");
 result.interaction.cancelRestoresFocus=await ev("document.activeElement.matches('[data-pay]')");
 await click('[data-pay]');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 result.interaction.escCloses=await ev("!document.querySelector('dialog').open");
 await click('[data-pay]');await click('[data-confirm-preview]');
 result.interaction.confirmNoFinancialMutation=await ev(`!document.querySelector('dialog').open && document.querySelector('.fixed-summary').innerText===${JSON.stringify(initialSummary)}`);
 await open('fixed','error',1000,900);await click('[data-retry]');result.interaction.localRetry=await ev("!document.querySelector('[data-retry]')&&window.visualReference.state==='normal'");
 await open('home','overload',390,844,true);await click('[data-state="zero-burden"]');
 result.interaction.stateSelector=await ev("window.visualReference.state==='zero-burden'&&!document.querySelector('.content').innerText.includes('%')");
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await click('[data-state="roomy"]');
 result.interaction.reducedMotion=await ev("getComputedStyle(document.querySelector('#surplus-value')).animationName==='none'");
 // Additional boundary widths at unchanged device heights, no product interpretation.
 for(const w of [320,360,620,759,760,879,880,980,1000,1179,1180,1440]){
  await open('fixed','normal',w,844,false,'note');
  const check=await ev(`(()=>{const d=document.querySelector('dialog').getBoundingClientRect();const a=document.querySelector('[data-confirm-preview]').getBoundingClientRect();return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,dialog:{x:d.x,right:d.right,bottom:d.bottom,height:d.height,client:document.querySelector('dialog').clientHeight,scroll:document.querySelector('dialog').scrollHeight},noteWidth:document.querySelector('.note-field input').getBoundingClientRect().width,confirmVisible:a.top>=0&&a.bottom<=innerHeight,fieldsGrid:getComputedStyle(document.querySelector('.payment-fields')).gridTemplateColumns}})()`);
  result.cases.push({page:'fixed',state:'normal',panel:'expanded',boundaryCheck:check});
 }

 await open('fixed','normal',390,520,false,'note');
 result.interaction.shortHeight=await ev("(()=>{const d=document.querySelector('dialog'),b=document.querySelector('[data-confirm-preview]');return{viewport:innerHeight,dialogClient:d.clientHeight,dialogScroll:d.scrollHeight,confirmBefore:b.getBoundingClientRect().bottom};})()");
 await ev("document.querySelector('dialog').scrollTop=document.querySelector('dialog').scrollHeight");
 result.interaction.shortHeight.confirmAfterScroll=await ev("document.querySelector('[data-confirm-preview]').getBoundingClientRect().bottom");
 await shot('fixed-note-390x520-scrolled.png');
 await open('home','roomy',390,844);
 await ev('window.scrollTo(0,document.documentElement.scrollHeight)');
 result.interaction.homeEndClearOfNav=await ev("document.querySelector('.module:last-child').getBoundingClientRect().bottom<=document.querySelector('.bottom-nav').getBoundingClientRect().top");
 await shot('home-end-390-viewport.png');
 await open('home','balanced',1440,1050);
 result.interaction.copyAssertions=await ev(`(()=>{const f=window.visualReference.structureCopy;return [[13000,10400,'账单：不是，他怎么还剩钱？'],[13000,11700,'钱包：还活着，先别开香槟。'],[13000,13000,'工资：来过，爱过，没留过。'],[13000,14000,'工资：你们分赃怎么不带我商量？'],[13000,14300,'收入：我一个人打五个？'],[0,0,'收入：你不来？账单：那我也不来了。'],[0,3500,'收入：暂未出场。账单：戏份拉满。']].map(([income,fixed,expected])=>({income,fixed,expected,actual:f({income,fixed,debt:0}),pass:f({income,fixed,debt:0})===expected}))})()`);
 await writeFile(resolve(out,'runtime-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {ws?.close();chrome.kill('SIGTERM');}
