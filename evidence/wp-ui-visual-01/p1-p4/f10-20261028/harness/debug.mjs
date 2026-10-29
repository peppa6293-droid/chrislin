import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const profile = await mkdtemp(resolve(tmpdir(), "xqj-dbg-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new","--disable-gpu","--no-first-run","--remote-debugging-port=0",
  `--user-data-dir=${profile}`,"about:blank"], { stdio: "ignore" });
let port;
for (let i=0;i<160;i++){ try { port=(await readFile(resolve(profile,"DevToolsActivePort"),"utf8")).split("\n")[0]; break; } catch { await new Promise(r=>setTimeout(r,50)); } }
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
const socket = new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl);
await new Promise((res,rej)=>{socket.addEventListener("open",res,{once:true});socket.addEventListener("error",rej,{once:true});});
let seq=0; const waiting=new Map(); const logs=[];
socket.addEventListener("message",({data})=>{const m=JSON.parse(data);
 if(m.method==="Runtime.exceptionThrown") logs.push("EXC "+JSON.stringify(m.params.exceptionDetails).slice(0,2000));
 if(m.method==="Runtime.consoleAPICalled") logs.push("LOG "+m.params.args.map(a=>a.value??a.description).join(" ").slice(0,800));
 if(m.id&&waiting.has(m.id)){const w=waiting.get(m.id);waiting.delete(m.id);m.error?w.rej(new Error(m.error.message)):w.res(m.result);}});
const send=(method,params={})=>new Promise((res,rej)=>{const id=++seq;waiting.set(id,{res,rej});socket.send(JSON.stringify({id,method,params}));});
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride",{width:390,height:1200,deviceScaleFactor:1,mobile:true});
const url = pathToFileURL(resolve("dist/index.html")); url.search="?view=home&state=roomy";
await send("Page.navigate",{url:url.href});
await new Promise(r=>setTimeout(r,1500));
const ev = async e => (await send("Runtime.evaluate",{expression:e,returnByValue:true})).result.value;
console.log("html length", await ev("document.body.innerHTML.length"));
console.log("body", (await ev("document.body.innerHTML"))?.slice(0,600));
console.log("cards", await ev("document.querySelectorAll('.v2-card').length"));
console.log("ringrows", await ev("document.querySelectorAll('.v2-ring-row').length"));
console.log("logs", logs);
socket.close(); chrome.kill("SIGKILL");
