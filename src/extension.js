
const vscode = require('vscode');
const cp = require('child_process');
const path = require('path');

const PY_CANDIDATES_WIN = ['py -3', 'py', 'python', 'python3'];
const PY_CANDIDATES_UNIX = ['python3', 'python'];
const THEMES = ['dark','light','classroom'];
const STORAGE_KEYS = { THEME:'tirotir.theme', PRESENTATION:'tirotir.presentation' };

function splitCmd(cmdStr){ const p=cmdStr.split(/\s+/); return {cmd:p[0], args:p.slice(1)};}
async function trySpawn(cmd,args,opts){return new Promise((res,rej)=>{let c;try{c=cp.spawn(cmd,args,opts);}catch(e){return rej(e);}c.on('error',rej);c.on('spawn',()=>res(c));});}
async function findPythonExecutable(cwd,env){const isWin=process.platform==='win32';const cands=(isWin?PY_CANDIDATES_WIN:PY_CANDIDATES_UNIX).map(splitCmd);for(const c of cands){try{await trySpawn(c.cmd,[...c.args,'--version'],{cwd,env});return c;}catch{}}throw new Error('No Python interpreter found.');}

function getTheme(ctx){const s=ctx.globalState.get(STORAGE_KEYS.THEME);return THEMES.includes(s)?s:'dark';}
function setTheme(ctx,t){ctx.globalState.update(STORAGE_KEYS.THEME,t);}
function cycleTheme(ctx){const t=getTheme(ctx);const i=THEMES.indexOf(t);const n=THEMES[(i+1)%THEMES.length];setTheme(ctx,n);vscode.window.setStatusBarMessage(`Tirotir theme: ${n}`,1500);return n;}
function themeCssVars(theme,pres){if(theme==='light'){return`--bg:#fff;--fg:#111;--muted:#6b7280;--border:#e5e7eb;--accent:#0ea5e9;--fz:${pres?'28px':'16px'};`;}else if(theme==='classroom'){return`--bg:#000;--fg:#fff;--muted:#9ca3af;--border:#374151;--accent:#22d3ee;--fz:${pres?'32px':'18px'};`;}return`--bg:#0f172a;--fg:#e6edf3;--muted:#9fb0c7;--border:#22304a;--accent:#22d3ee;--fz:${pres?'28px':'16px'};`;}
function getPresentation(ctx){return !!ctx.globalState.get(STORAGE_KEYS.PRESENTATION);}
function togglePresentation(ctx){const c=getPresentation(ctx);ctx.globalState.update(STORAGE_KEYS.PRESENTATION,!c);vscode.window.setStatusBarMessage('Presentation Mode: '+(!c?'ON':'OFF'),1500);return !c;}

async function runProcessInView(ctx,title,args,opts){
  const outChan=vscode.window.createOutputChannel('Tirotir Output');outChan.clear();outChan.show(true);
  const theme=getTheme(ctx),pres=getPresentation(ctx),cssVars=themeCssVars(theme,pres);
  const panel=vscode.window.createWebviewPanel('rtlCleanRun',title,vscode.ViewColumn.Beside,{enableScripts:true,retainContextWhenHidden:true});
  const html=`<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"><style>
:root{${cssVars}}body{background:var(--bg);color:var(--fg);font-family:Consolas,'Courier New',monospace;margin:0;display:flex;flex-direction:column;height:100vh;}
header{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);background:rgba(0,0,0,.15);}
header .title{font-weight:700;}header .spacer{flex:1}
button.icon{border:1px solid var(--border);background:transparent;color:var(--fg);padding:4px 10px;border-radius:8px;cursor:pointer;}
#scroll{flex:1;overflow:auto;padding:12px;}pre{white-space:pre-wrap;word-break:break-word;margin:0;line-height:1.8;font-size:var(--fz);}
footer{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--border);background:rgba(0,0,0,.15);}
textarea#stdin{flex:1;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--fg);direction:rtl;height:56px;}
</style></head><body><header><span class="title">Tirotir Shell</span><span class="spacer"></span><button class="icon" id="closeBtn">✖ Close</button></header><div id="scroll"><pre id="out"></pre></div><footer><textarea id="stdin" placeholder="Enter = Send • Shift+Enter = New line"></textarea></footer>
<script>const vs=acquireVsCodeApi(),out=document.getElementById('out'),scr=document.getElementById('scroll'),inp=document.getElementById('stdin');
function sb(){scr.scrollTop=scr.scrollHeight;}document.getElementById('closeBtn').onclick=()=>vs.postMessage({type:'closeRequest'});
window.addEventListener('message',e=>{const m=e.data;if(m.type==='appendOut'){out.textContent+=m.data;sb();}else if(m.type==='close'){inp.disabled=true;inp.placeholder='Program finished.';}});
inp.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();vs.postMessage({type:'stdin',data:inp.value+'\\n'});inp.value='';}});
</script></body></html>`;
  panel.webview.html=html;
  const child=cp.spawn(args[0],args.slice(1),opts);
  child.stdout.on('data',d=>{const s=d.toString('utf8');panel.webview.postMessage({type:'appendOut',data:s});outChan.append(s);});
  child.stderr.on('data',d=>outChan.appendLine('[stderr] '+d.toString('utf8')));
  child.on('close',()=>panel.webview.postMessage({type:'close'}));
  panel.webview.onDidReceiveMessage(m=>{if(m.type==='closeRequest'){try{child.kill();}catch{}panel.dispose();}if(m.type==='stdin'){try{child.stdin.write(m.data);}catch{}outChan.append(`[stdin] ${m.data}`);}});
  panel.onDidDispose(()=>{try{child.kill();}catch{}});
}

async function runUtf8Clean(ctx){const e=vscode.window.activeTextEditor;if(!e)return vscode.window.showErrorMessage('Open a file first');const f=e.document.fileName;await e.document.save();
const env=Object.assign({},process.env,{PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'});let py;try{py=await findPythonExecutable(path.dirname(f),env);}catch(err){return vscode.window.showErrorMessage(err.message);}
const args=[py.cmd,...py.args,f];const opts={env,cwd:path.dirname(f),windowsHide:true};await runProcessInView(ctx,'Tirotir Shell',args,opts);}

async function runStepTrace(ctx){const e=vscode.window.activeTextEditor;if(!e)return vscode.window.showErrorMessage('Open a file first');const f=e.document.fileName;await e.document.save();
const env=Object.assign({},process.env,{PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'});let py;try{py=await findPythonExecutable(path.dirname(f),env);}catch(err){return vscode.window.showErrorMessage(err.message);}
const args=[py.cmd,...py.args,'-m','trace','--trace',f];const opts={env,cwd:path.dirname(f),windowsHide:true};await runProcessInView(ctx,'Tirotir Step Trace (Preview)',args,opts);}

function createStatusBar(ctx){
  const run=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left,100);run.text='$(play) Tirotir Shell';run.tooltip='Run with Tirotir Shell';run.command='tirotir.runUtf8Clean';run.show();ctx.subscriptions.push(run);
  const theme=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left,99);theme.text='$(color-mode) Theme';theme.tooltip='Switch Theme';theme.command='tirotir.switchTheme';theme.show();ctx.subscriptions.push(theme);
  const pres=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left,98);pres.text='$(screen-full) Presentation';pres.tooltip='Toggle Presentation Mode';pres.command='tirotir.togglePresentation';pres.show();ctx.subscriptions.push(pres);
}

function activate(ctx){createStatusBar(ctx);ctx.subscriptions.push(
  vscode.commands.registerCommand('tirotir.runUtf8Clean',()=>runUtf8Clean(ctx)),
  vscode.commands.registerCommand('tirotir.switchTheme',()=>cycleTheme(ctx)),
  vscode.commands.registerCommand('tirotir.togglePresentation',()=>togglePresentation(ctx)),
  vscode.commands.registerCommand('tirotir.runStepTrace',()=>runStepTrace(ctx))
);}
function deactivate(){}
module.exports={activate,deactivate};
