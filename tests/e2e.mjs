// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// End-to-end test of the PoC with REAL windows:
//   * an isolated Chrome (temp profile, extension loaded over CDP pipe)
//   * an isolated VS Code instance (its own --user-data-dir), never the user's own VS Code
// Usage: node tests/e2e.mjs <workDir>
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, execFileSync, execFile } from 'node:child_process';
import { ROOT, CODE, PROBE as PROBE_EXE, launchChrome, sleep, probe, pj, waitFor, prepareTestExtension } from './lib.mjs';

const work = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'apptabs-test'));
const shots = path.join(work, 'shots');
fs.mkdirSync(shots, { recursive: true });
const EXT_DIR = prepareTestExtension(work); // talks to the DEV host only
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rectOf = (h) => pj('info', h).rect;
const shot = (name, r) => probe('shot', path.join(shots, name + '.png'), r[0], r[1], r[2] - r[0], r[3] - r[1]);

// close isolated VS Code instances left over by an aborted earlier run (matched by our --user-data-dir marker only)
execFileSync('powershell', ['-NoProfile', '-c', "Get-CimInstance Win32_Process -Filter \"Name='Code.exe'\" | ? { $_.CommandLine -like '*scratchpad*vscode-data*' -and $_.CommandLine -notlike '*--type=*' } | % { taskkill /pid $_.ProcessId | Out-Null }"]);
// ...and isolated test Chromes (temp profile under the scratchpad, never the user's profile)
execFileSync('powershell', ['-NoProfile', '-c', "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | ? { $_.CommandLine -like '*--user-data-dir=*scratchpad*chrome-profile*' -and $_.CommandLine -notlike '*--type=*' } | % { taskkill /pid $_.ProcessId | Out-Null }"]);
await sleep(1500);
// ---------- isolated VS Code ----------
const ws = path.join(work, 'APPTABS_TEST_WS'); fs.mkdirSync(ws, { recursive: true });
fs.writeFileSync(path.join(ws, 'alpha.txt'), 'alpha file\n');
fs.writeFileSync(path.join(ws, 'beta.txt'), 'beta file\n');
const vsData = path.join(work, 'vscode-data');
fs.mkdirSync(path.join(vsData, 'User'), { recursive: true });
fs.writeFileSync(path.join(vsData, 'User', 'settings.json'), JSON.stringify({
  'workbench.startupEditor': 'none', 'security.workspace.trust.enabled': false, 'window.restoreWindows': 'none',
  'terminal.integrated.defaultProfile.windows': 'Command Prompt', 'update.mode': 'none', 'telemetry.telemetryLevel': 'off',
  'workbench.tips.enabled': false, 'chat.disableAIFeatures': true, 'files.hotExit': 'onExitAndWindowClose' }, null, 1));
function launchCode() {
  const p = spawn(CODE, ['--user-data-dir', vsData, '--extensions-dir', path.join(work, 'vscode-ext'), '--new-window', ws],
    { detached: true, stdio: 'ignore' });
  p.unref();
}
async function findCode() {
  const r = await waitFor(() => { const l = pj('find', 'Chrome_WidgetWin_1', 'APPTABS_TEST_WS'); return l.length ? l[0] : null; }, 30000, 300);
  return r.value;
}

launchCode();
let code = await findCode();
check('isolated VS Code started', code, code);
await sleep(2500);
probe('setpos', code.hwnd, 2100, 200, 1100, 700); // a known "original" placement
await sleep(500);
const codeOriginal = rectOf(code.hwnd);
const DIRTY_TEXT = 'unsaved-work-' + Date.now();
probe('focus', code.hwnd); await sleep(300);
probe('keys', code.hwnd, 'ctrl+n'); await sleep(800);
probe('type', code.hwnd, DIRTY_TEXT); await sleep(500);
const isDirtyTitle = (t) => t.startsWith('\u25cf') && t.includes(DIRTY_TEXT);
check('0. unsaved editor created in isolated VS Code (before attaching)', isDirtyTitle(pj('info', code.hwnd).title), pj('info', code.hwnd).title);

// ---------- isolated Chrome + extension ----------
const { proc, cdp } = launchChrome(path.join(work, 'chrome-profile'), 2000, 60, 1600, 1000);
await sleep(2000);
const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: EXT_DIR });
check('extension loaded into branded Chrome via CDP', extId === 'bahmlmpijalpgcnbnkgplggendgjhdlk', extId);
await sleep(1000);

async function swSession() {
  const r = await waitFor(async () => (await cdp.send('Target.getTargets')).targetInfos.find(t => t.type === 'service_worker' && t.url.includes(extId)), 10000, 200);
  if (!r.value) throw new Error('extension service worker not found');
  return (await cdp.send('Target.attachToTarget', { targetId: r.value.targetId, flatten: true })).sessionId;
}
let sw = await swSession();
const ev = (expr) => cdp.eval(sw, expr);
const pages = async () => (await cdp.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page');
const activate = (targetId) => cdp.send('Target.activateTarget', { targetId });

const chromeWin = pj('find', 'Chrome_WidgetWin_1', 'WEB PAGE', proc.pid)[0];
check('Chrome window found', chromeWin, chromeWin);
const chrome = chromeWin.hwnd;
const webTarget = (await pages()).find(t => t.url.startsWith('data:'));

// 1) discovery
const list = await ev(`call('list',{exeFilter:'Code'}).then(r=>r.windows)`);
const item = list.find(w => w.hwnd === code.hwnd);
check('1. host lists running VS Code windows (with icon)', item && item.icon && item.icon.startsWith('data:image/png'), `${list.length} Code windows`);
const all = await ev(`call('list',{}).then(r=>r.windows.map(w=>({p:w.process,d:w.description})))`);
check('1b. generic list: all programs, file description as name, browser itself excluded', all.length >= list.length && !all.some(w => /^chrome$/i.test(w.p || '')) && item.description,
  `${all.length} windows; e.g. ${item.process} -> "${item.description}"`);

// 2) add -> app tab created and shown
const winId = await ev(`chrome.windows.getAll().then(ws=>ws[0].id)`);
const added = await ev(`handle({type:'add', win:${JSON.stringify(item)}, windowId:${winId}})`);
const appTarget = await waitFor(async () => (await pages()).find(t => t.url.includes('app.html#' + added.id)), 5000);
check('2. app tab created', appTarget.value, appTarget.value && appTarget.value.title);
const placed = await waitFor(() => { const c = probe('content', chrome); const r = rectOf(code.hwnd); return eq(JSON.parse(c), r) ? r : null; }, 4000);
check('3. VS Code positioned exactly over Chrome content area', placed.value, `${JSON.stringify(placed.value)} after ${placed.ms}ms`);
check('3b. VS Code above Chrome in z-order', probe('above', code.hwnd, chrome) === 'true');
check('3c. VS Code has keyboard focus', pj('fg').hwnd === code.hwnd, pj('fg').title);
const tabTitle = (await pages()).find(t => t.url.includes('app.html')).title;
check('3d. tab named from the program file description', tabTitle.startsWith(item.description), tabTitle);
shot('01_app_tab_active', rectOf(chrome));

// 4) switch to web tab and back, repeatedly
const centre = () => { const c = JSON.parse(probe('content', chrome)) || rectOf(code.hwnd); return [Math.round((c[0] + c[2]) / 2), Math.round((c[1] + c[3]) / 2)]; };
await activate(webTarget.targetId);
const hid = await waitFor(() => pj('at', ...centre()).hwnd === chrome, 3000);
check('4. web tab -> Chrome page visible, VS Code behind', hid.value && probe('above', chrome, code.hwnd) === 'true', `${hid.ms}ms`);
shot('02_web_tab_active', rectOf(chrome));
const lat = []; let failures = 0;
for (let i = 0; i < 20; i++) {
  await activate(appTarget.value.targetId);
  const a = await waitFor(() => pj('at', ...centre()).hwnd === code.hwnd, 3000, 10);
  await activate(webTarget.targetId);
  const b = await waitFor(() => pj('at', ...centre()).hwnd === chrome, 3000, 10);
  if (!a.value || !b.value) failures++;
  lat.push(a.ms, b.ms);
}
lat.sort((x, y) => x - y);
check('5. 20x round-trip tab switching', failures === 0, `failures=${failures} median=${lat[lat.length >> 1]}ms p95=${lat[Math.floor(lat.length * .95)]}ms max=${lat[lat.length - 1]}ms`);

// 6) clicking Chrome's own tab strip while the app tab is active must keep VS Code on top
await activate(appTarget.value.targetId); await sleep(400);
const cr = rectOf(chrome);
const clk = probe('click', cr[2] - 400, cr[1] + 18, chrome);
await sleep(400);
check('6. click on Chrome tab strip keeps VS Code above Chrome', clk.startsWith('clicked') && probe('above', code.hwnd, chrome) === 'true' && pj('at', ...centre()).hwnd === code.hwnd && pj('at', cr[2] - 400, cr[1] + 18).hwnd === chrome, `${clk}; fg=${pj('fg').title}`);

// 6b) v0.2 omnibox peek: clicking the omnibox drops VS Code behind Chrome so the suggestion list is visible,
//     Esc / a click on the page (focus back to the page) brings it back
const omni = [cr[0] + 500, cr[1] + 62];
const peekCycle = async (n, label, resumeHow) => {
  probe('click', omni[0], omni[1], chrome);
  const pk = await waitFor(() => pj('at', ...centre()).hwnd === chrome && pj('fg').hwnd === chrome, 2000, 20);
  probe('type', chrome, 'example'); await sleep(900);
  const below = pj('at', omni[0], omni[1] + 60);
  if (n === 1) shot('07_omnibox_peek', rectOf(chrome));
  check(`6b${n}. omnibox focus -> VS Code temporarily hidden, suggestions visible`, pk.value && below.hwnd !== code.hwnd, `peek after ${pk.ms}ms; under suggestion row: ${below.hwnd === code.hwnd ? 'VS Code' : 'Chrome'}`);
  resumeHow();
  const rs = await waitFor(() => pj('at', ...centre()).hwnd === code.hwnd && pj('fg').hwnd === code.hwnd, 3000, 20);
  check(`6b${n}r. ${label} -> VS Code shown again with focus`, rs.value, `${rs.ms}ms; fg=${pj('fg').title}`);
};
await peekCycle(1, 'Esc', () => { probe('keys', chrome, 'esc'); probe('keys', chrome, 'esc'); });
await peekCycle(2, 'click on the page', () => { const c = centre(); probe('click', c[0], c[1], chrome); });
// with the option switched off the v0.1 behaviour remains (VS Code stays on top)
await ev(`handle({type:'setSettings', settings:{peek:false}})`);
probe('click', omni[0], omni[1], chrome); await sleep(800);
check('6b3. peek option off -> VS Code stays on top while omnibox focused', pj('at', ...centre()).hwnd === code.hwnd, pj('fg').title);
probe('keys', pj('fg').hwnd, 'esc'); probe('keys', pj('fg').hwnd, 'esc');
await ev(`handle({type:'setSettings', settings:{peek:true}})`);
await activate(webTarget.targetId); await sleep(300); await activate(appTarget.value.targetId); await sleep(600);
// 6c) Chrome's "⋮" menu (a separate popup window) must appear above VS Code
probe('click', cr[2] - 24, cr[1] + 62, chrome); await sleep(700);
const menuAt = pj('at', cr[2] - 120, cr[1] + 160);
shot('08_chrome_menu', rectOf(chrome));
check('6c. Chrome menu popup visible above VS Code', menuAt.hwnd !== code.hwnd && menuAt.hwnd !== chrome, `window under menu: ${menuAt.hwnd === code.hwnd ? 'VS Code' : menuAt.hwnd + ' ' + menuAt.title}`);
for (let i = 0; i < 3 && pj('at', cr[2] - 120, cr[1] + 160).hwnd !== code.hwnd; i++) { probe('keys', pj('fg').hwnd, 'esc'); await sleep(300); }

// 7) move / resize / maximize / restore / minimize
async function synced(label, settle = 2000) {
  const r = await waitFor(() => { const c = probe('content', chrome); return c !== 'null' && eq(JSON.parse(c), rectOf(code.hwnd)) && pj('at', ...centre()).hwnd === code.hwnd; }, settle);
  check(label, r.value, `${probe('content', chrome)} vs ${JSON.stringify(rectOf(code.hwnd))} (${r.ms}ms)`);
  if (!r.value) console.log('   diag chrome=', probe('info', chrome), ' code=', probe('info', code.hwnd), ' fg=', probe('fg'));
  if (process.env.STOP_AT && label.startsWith(process.env.STOP_AT)) { shot('diag_' + label.slice(0, 3), rectOf(chrome)); console.log('stop'); process.exit(0); }
}
probe('setpos', chrome, 2100, 100, 1400, 900); await synced('7a. Chrome moved/resized -> synced');
await ev(`chrome.windows.update(${winId},{left:2050,top:150,width:1300,height:800})`); await synced('7b. resize via chrome.windows.update -> synced');
{ // real mouse drag of the Chrome window by an empty spot of its tab strip; sample the overlay while dragging
  const w0 = rectOf(chrome); const from = [w0[2] - 300, w0[1] + 15];
  const samples = []; let sampling = true;
  const sampler = (async () => { while (sampling) { const c = probe('content', chrome), r = rectOf(code.hwnd); if (c !== 'null') { const cc = JSON.parse(c); samples.push(Math.max(Math.abs(cc[0] - r[0]), Math.abs(cc[1] - r[1]))); } await sleep(30); } })();
  const drag = (f) => new Promise(res => execFile(PROBE_EXE, ['drag', f[0], f[1], f[0] - 250, f[1] + 120, 40, chrome].map(String), (e, out) => res((out || '').trim())));
  let d = await drag(from), attempts = 1;
  if (eq(rectOf(chrome), w0)) { attempts++; await sleep(300); d = await drag([w0[0] + Math.round((w0[2] - w0[0]) * 0.6), w0[1] + 12]); }
  sampling = false; await sampler;
  const moved = !eq(rectOf(chrome), w0);
  check('7b1. mouse drag moved the Chrome window', moved, `${d}; attempts=${attempts}; ${JSON.stringify(w0)} -> ${JSON.stringify(rectOf(chrome))}`);
  await synced(`7b2. mouse drag of Chrome window -> synced (${d}, moved=${moved}, in-drag offset samples=${samples.length}, max ${Math.max(0, ...samples)}px)`);
}
await ev(`chrome.windows.update(${winId},{state:'maximized'})`); await sleep(500); await synced('7c. Chrome maximized -> synced');
shot('03_maximized', rectOf(chrome));
await ev(`chrome.windows.update(${winId},{state:'normal'})`); await sleep(500); await synced('7d. Chrome restored -> synced');
await ev(`chrome.windows.update(${winId},{state:'minimized'})`);
const mn = await waitFor(() => pj('info', code.hwnd).iconic, 3000);
check('7e. Chrome minimized -> VS Code minimized', mn.value, `${mn.ms}ms`);
await ev(`chrome.windows.update(${winId},{state:'normal', focused:true})`);
const un = await waitFor(() => !pj('info', code.hwnd).iconic, 3000);
await sleep(600);
check('7f. Chrome restored from minimize -> VS Code back on top', un.value && probe('above', code.hwnd, chrome) === 'true' && pj('at', ...centre()).hwnd === code.hwnd, `${un.ms}ms`);
await synced('7g. ...and position synced');

// 8) another monitor
const mons = execFileSync('powershell', ['-NoProfile', '-c', 'Add-Type -A System.Windows.Forms;[Windows.Forms.Screen]::AllScreens|%{"$($_.Bounds.X),$($_.Bounds.Y)"}'], { encoding: 'utf8' }).trim().split(/\r?\n/);
for (const m of mons) {
  const [mx, my] = m.split(',').map(Number);
  probe('setpos', chrome, mx + 80, my + 60, 1500, 900);
  await synced(`8. Chrome on monitor at ${mx},${my} -> synced (dpi ${pj('info', chrome).dpi})`);
}
probe('setpos', chrome, 2000, 60, 1600, 1000); await synced('8z. back on test monitor');

// 9) keyboard / mouse inside VS Code
await activate(webTarget.targetId); await sleep(300);
await activate(appTarget.value.targetId);
await waitFor(() => pj('fg').hwnd === code.hwnd, 2000);
const c9 = centre();
check('9a. mouse click inside the app tab area hits VS Code', probe('click', c9[0], c9[1], code.hwnd).startsWith('clicked') && pj('fg').hwnd === code.hwnd);
const kbFile = path.join(work, 'kb_test.txt'); try { fs.unlinkSync(kbFile); } catch {}
probe('keys', code.hwnd, 'ctrl+`'); await sleep(3500);
probe('type', code.hwnd, `echo apptabs-kb-ok> "${kbFile}"`); probe('keys', code.hwnd, 'enter');
const kb = await waitFor(() => fs.existsSync(kbFile) && fs.readFileSync(kbFile, 'utf8').includes('apptabs-kb-ok'), 6000, 200);
check('9b. terminal shortcut (Ctrl+`) + typing in VS Code terminal', kb.value);
shot('04_terminal', rectOf(chrome));
async function quickOpen(name) {
  probe('keys', code.hwnd, 'ctrl+p'); await sleep(700); probe('type', code.hwnd, name); await sleep(700); probe('keys', code.hwnd, 'enter');
  return (await waitFor(() => pj('info', code.hwnd).title.startsWith(name), 4000)).value;
}
check('9c. Ctrl+P quick open alpha.txt', await quickOpen('alpha.txt'), pj('info', code.hwnd).title);
check('9d. Ctrl+P quick open beta.txt', await quickOpen('beta.txt'), pj('info', code.hwnd).title);
probe('keys', code.hwnd, 'ctrl+pgup');
check('9e. Ctrl+PgUp switches VS Code file tab', (await waitFor(() => pj('info', code.hwnd).title.startsWith('alpha.txt'), 3000)).value, pj('info', code.hwnd).title);
probe('keys', code.hwnd, 'ctrl+o');
const dlg = await waitFor(() => { const l = pj('find', '#32770', '', code.pid); return l.length ? l[0] : null; }, 6000, 200);
check('9f. native file-open dialog appears (owned by VS Code)', dlg.value, dlg.value);
if (dlg.value) {
  check('9g. dialog is above VS Code', probe('above', dlg.value.hwnd, code.hwnd) === 'true');
  shot('05_file_dialog', rectOf(chrome));
  if (pj('fg').hwnd === dlg.value.hwnd) probe('keys', dlg.value.hwnd, 'esc');
  await waitFor(() => pj('find', '#32770', '', code.pid).length === 0, 3000);
}
// Ctrl+Tab inside VS Code goes to VS Code, not to Chrome (known limitation, recorded as info)
const tabsBefore = await ev(`chrome.tabs.query({active:true}).then(t=>t[0].url)`);
await waitFor(() => pj('fg').hwnd === code.hwnd, 1000);
probe('keys', code.hwnd, 'ctrl+pgdn'); await sleep(500);
const tabsAfter = await ev(`chrome.tabs.query({active:true}).then(t=>t[0].url)`);
check('9h. (info) Chrome tab shortcuts are captured by VS Code while it has focus', tabsBefore === tabsAfter, 'Chrome active tab unchanged');

// 9s) v0.2 global shortcuts (chrome.commands, "global": true) while the program has focus
const cmds = await ev(`chrome.commands.getAll()`);
check('9s0. shortcuts registered', ['toggle-app', 'prev-tab', 'next-tab'].every(n => (cmds.find(c => c.name === n) || {}).shortcut),
  cmds.filter(c => c.shortcut).map(c => `${c.name}=${c.shortcut}`).join(', '));
await activate(appTarget.value.targetId); await waitFor(() => pj('fg').hwnd === code.hwnd, 2000);
const titleBefore = pj('info', code.hwnd).title;
const activeUrl = () => ev(`chrome.tabs.query({active:true, windowId:${winId}}).then(t=>t[0].url)`);
async function viaShortcut(label, keys, from, wantApp) {
  if (pj('fg').hwnd !== from) { check(label, false, 'precondition: wrong foreground ' + pj('fg').title); return; }
  probe('keys', from, keys);
  const r = await waitFor(async () => {
    const isApp = (await activeUrl()).includes('/app.html#');
    const vis = pj('at', ...centre()).hwnd, fg = pj('fg').hwnd;
    return isApp === wantApp && (wantApp ? vis === code.hwnd && fg === code.hwnd : vis === chrome && fg === chrome);
  }, 3000, 30);
  check(label, r.value, `${r.ms}ms; fg=${pj('fg').title}`);
}
await viaShortcut('9s1. toggle shortcut (test copy: Ctrl+Shift+4) in VS Code -> previous web tab, Chrome focused', 'ctrl+shift+4', code.hwnd, false);
await viaShortcut('9s2. toggle shortcut in Chrome -> back to the VS Code tab, VS Code focused', 'ctrl+shift+4', chrome, true);
await viaShortcut('9s3. next-tab shortcut (test copy: Ctrl+Shift+6) in VS Code -> next tab', 'ctrl+shift+6', code.hwnd, false);
await viaShortcut('9s4. prev-tab shortcut (test copy: Ctrl+Shift+5) in Chrome -> previous tab (VS Code)', 'ctrl+shift+5', chrome, true);
check('9s5. shortcuts did not change VS Code editor state', pj('info', code.hwnd).title === titleBefore, pj('info', code.hwnd).title);

// 10) second Chrome window; move the app tab there
const win2 = await ev(`chrome.windows.create({left:-1800,top:100,width:1400,height:900,url:'data:text/html,<title>SECOND</title>second'}).then(w=>w.id)`);
await sleep(1000);
const chrome2 = pj('find', 'Chrome_WidgetWin_1', 'SECOND', proc.pid)[0].hwnd;
const appTabId = await ev(`chrome.tabs.query({url:'${'chrome-extension://' + extId}/app.html'}).then(t=>t[0].id)`);
await ev(`chrome.tabs.move(${appTabId},{windowId:${win2},index:-1}).then(()=>chrome.tabs.update(${appTabId},{active:true}))`);
const mv = await waitFor(() => eq(JSON.parse(probe('content', chrome2)), rectOf(code.hwnd)), 4000);
check('10. app tab moved to 2nd Chrome window (other monitor) -> VS Code follows', mv.value, `${mv.ms}ms`);
shot('06_second_window', rectOf(chrome2));
await ev(`chrome.tabs.move(${appTabId},{windowId:${winId},index:-1}).then(()=>chrome.tabs.update(${appTabId},{active:true}))`);
await synced('10b. moved back to first window');
await ev(`chrome.windows.remove(${win2})`);

// 11) rename
await ev(`handle({type:'rename', app:'${added.id}', name:'My Editor'})`);
const rn = await waitFor(async () => (await pages()).find(t => t.url.includes('app.html')).title.startsWith('My Editor'), 3000);
check('11. rename tab', rn.value);

// 11b) management UI: open the real popup page and read what it shows
const popT = await cdp.send('Target.createTarget', { url: `chrome-extension://${extId}/popup.html` });
const popS = (await cdp.send('Target.attachToTarget', { targetId: popT.targetId, flatten: true })).sessionId;
const ui = await waitFor(async () => {
  const v = await cdp.eval(popS, `document.readyState === 'complete' && !!document.querySelector('#host')`) && await cdp.eval(popS, `({host: document.querySelector('#host').textContent, apps: [...document.querySelectorAll('#apps li input.name')].map(i=>i.value),
     badges: [...document.querySelectorAll('#apps .badge')].map(b=>b.textContent), cands: document.querySelectorAll('#candidates li:not(.empty)').length,
     linked: document.querySelectorAll('#candidates li.linked').length, keys: [...document.querySelectorAll('#shortcuts kbd')].map(k=>k.textContent)})`);
  return v && v.host.includes('연결됨') && v.cands > 0 ? v : null;
}, 6000, 200);
check('11b. popup lists connected app (name, status), candidates and shortcuts', ui.value && ui.value.apps[0] === 'My Editor' && ui.value.linked === 1 && ui.value.keys.length === 3, JSON.stringify(ui.value));
// filter the candidate list to the test windows so the screenshot holds no other window titles
await cdp.eval(popS, `(()=>{const q=document.querySelector('#q'); q.value='APPTABS'; q.dispatchEvent(new Event('input')); return true})()`);
const flt = await waitFor(async () => { const n = await cdp.eval(popS, `[...document.querySelectorAll('#candidates li .t')].map(e=>e.textContent)`); return n.length && n.every(t => t.includes('APPTABS')) ? n : null; }, 3000, 100);
check('11b2. popup search filters candidates', flt.value, JSON.stringify(flt.value));
shot('09_popup_tab', rectOf(chrome));
// rename through the popup's input (Enter)
await cdp.eval(popS, `(()=>{const i=document.querySelector('#apps input.name'); i.value='Editor 2'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); return true})()`);
const rn2 = await waitFor(async () => (await pages()).find(t => t.url.includes('app.html')).title.startsWith('Editor 2'), 3000);
check('11c. rename from popup updates the tab title', rn2.value);

// 12) disconnect button in the popup: tab closed, VS Code restored and still running
await cdp.eval(popS, `[...document.querySelectorAll('#apps button')].find(b=>b.textContent==='연결 해제').click(), true`);
const rs = await waitFor(async () => eq(rectOf(code.hwnd), codeOriginal) && !(await pages()).some(t => t.url.includes('app.html')), 4000);
check('12. popup "연결 해제" -> tab closed, VS Code restored to original placement, still running', rs.value && pj('info', code.hwnd).exists, JSON.stringify(rectOf(code.hwnd)));
const leftBindings = await ev(`getBindings().then(b=>Object.keys(b).length)`);
check('12a. binding removed from storage', leftBindings === 0, `${leftBindings} left`);
await cdp.send('Target.closeTarget', { targetId: popT.targetId });

// helper to (re)add the app tab
async function addTab() {
  const it = (await ev(`call('list',{exeFilter:'Code'}).then(r=>r.windows)`)).find(w => w.title.includes('APPTABS_TEST_WS'));
  const a = await ev(`handle({type:'add', win:${JSON.stringify(it)}, windowId:${winId}})`);
  await synced('   (re-added app tab synced)');
  return a;
}

// 12b) closing the app tab directly
let a1 = await addTab();
await ev(`chrome.tabs.query({}).then(ts=>chrome.tabs.remove(ts.find(t=>t.url.includes('app.html#${a1.id}')).id))`);
const rs2 = await waitFor(() => eq(rectOf(code.hwnd), codeOriginal), 3000);
check('12b. app tab closed -> VS Code restored, still running', rs2.value && pj('info', code.hwnd).exists, `${rs2.ms}ms`);

// 12c) typing a URL into the app tab (navigating away) turns it into a web tab and releases the program
a1 = await addTab();
const navTab = await ev(`chrome.tabs.query({}).then(ts=>ts.find(t=>t.url.includes('app.html#${a1.id}')).id)`);
{ // the real user flow: click the omnibox (VS Code peeks away), type an address, Enter
  const w = rectOf(chrome);
  probe('click', w[0] + 500, w[1] + 62, chrome);
  await waitFor(() => pj('fg').hwnd === chrome && pj('at', ...centre()).hwnd === chrome, 2000, 20);
  probe('type', chrome, 'about:blank'); probe('keys', chrome, 'enter');
}
const nv = await waitFor(async () => eq(rectOf(code.hwnd), codeOriginal) && (await ev(`getBindings().then(b=>!b['${a1.id}'])`)), 4000);
check('12c. URL typed into the app tab omnibox -> tab becomes a web tab, VS Code released and restored', nv.value,
  `${nv.ms}ms; tab url=${await ev(`chrome.tabs.get(${navTab}).then(t=>t.url)`)}; code=${JSON.stringify(rectOf(code.hwnd))}`);
if (!nv.value) console.log('   diag', JSON.stringify(await ev(`Promise.all([getBindings(), sessionGet('tabApp',{}), sessionGet('activeApp',{}), call('state')])`)));
await ev(`chrome.tabs.remove(${navTab})`);

// D) v0.3 drag-to-add: drag VS Code by its title bar onto the Chrome tab strip
const appTabsCount = async () => (await pages()).filter(t => t.url.includes('/app.html#')).length;
const bindingCount = () => ev(`getBindings().then(b=>Object.keys(b).length)`);
const titleSpot = () => { const r = rectOf(code.hwnd); return [r[0] + Math.round((r[2] - r[0]) * 0.75), r[1] + 15]; }; // empty part of VS Code's title bar
const stripSpot = () => { const r = rectOf(chrome); return [r[0] + Math.round((r[2] - r[0]) * 0.6), r[1] + 20]; };   // empty part of Chrome's tab strip
async function dragVia(from, to, holdMs, during) {
  let seen = [];
  const run = new Promise(res => execFile(PROBE_EXE, ['drag', from[0], from[1], to[0], to[1], 30, code.hwnd, holdMs].map(String), (e, out) => res((out || '').trim())));
  const t0 = Date.now();
  while (Date.now() - t0 < 600 + 30 * 16 + holdMs - 150) { seen.push(await ev(`call('stats')`)); if (during) await during(seen[seen.length - 1]); await sleep(60); }
  const out = await run; await sleep(400);
  return { out, seen };
}
probe('setpos', code.hwnd, 2100, 200, 1400, 700); probe('focus', code.hwnd); await sleep(500);
const preDrag = rectOf(code.hwnd);
const cpu0 = (await ev(`call('stats')`)).cpuMs;
let shotTaken = false;
const d1 = await dragVia(titleSpot(), stripSpot(), 1200, async (st) => { if (st.highlight && !shotTaken) { shotTaken = true; shot('10_drag_highlight', rectOf(chrome)); } });
const cpu1 = (await ev(`call('stats')`)).cpuMs;
check('D1a. dragging over the tab strip shows the drop highlight', d1.seen.some(s => s.highlight) && d1.seen.some(s => s.dragging), `${d1.out}; highlight in ${d1.seen.filter(s => s.highlight).length}/${d1.seen.length} samples; host CPU during drag ${(cpu1 - cpu0).toFixed(0)}ms`);
const dropTab = await waitFor(async () => (await appTabsCount()) === 1, 4000);
await synced('D1b. release on the tab strip -> program added as a tab and shown in the content area', 4000);
check('D1c. exactly one tab / binding created', dropTab.value && (await bindingCount()) === 1, `tabs=${await appTabsCount()} bindings=${await bindingCount()}`);
const dropTabTitle = (await pages()).find(t => t.url.includes('/app.html#')).title;
check('D1d. dropped tab named from the program description', dropTabTitle.startsWith(item.description), dropTabTitle);

// D2) duplicates: an attached program is not a drop source; adding the same window again focuses the existing tab
const d2 = await dragVia(titleSpot(), stripSpot(), 600);
await sleep(600);
check('D2a. dragging an already attached program shows no highlight and adds nothing', !d2.seen.some(s => s.highlight) && (await appTabsCount()) === 1 && (await bindingCount()) === 1, `tabs=${await appTabsCount()}`);
await synced('D2b. ...and the overlay snaps it back into the content area', 3000);
const again = await ev(`call('list',{}).then(r=>r.windows.find(w=>w.hwnd===${code.hwnd})).then(w=>handle({type:'add', win:w, windowId:${winId}}))`);
check('D2c. popup-style add of the same window -> existing tab reused', again.existed === true && (await appTabsCount()) === 1, JSON.stringify(again));

// D3) closing that tab restores the placement from BEFORE the drag (not the drop position)
await ev(`chrome.tabs.query({}).then(ts=>chrome.tabs.remove(ts.find(t=>t.url.includes('/app.html#')).id))`);
const back = await waitFor(() => eq(rectOf(code.hwnd), preDrag), 3000);
check('D3. tab of a dropped program closed -> restored to its pre-drag placement', back.value, `${JSON.stringify(rectOf(code.hwnd))} vs ${JSON.stringify(preDrag)}`);

// D4) releasing outside the tab strip (over the page area) is an ordinary window move
probe('focus', code.hwnd); await sleep(300);
const cA = rectOf(chrome), pageSpot = [cA[0] + 700, cA[1] + 500];
const d4 = await dragVia(titleSpot(), pageSpot, 400);
await sleep(500);
const movedTo = rectOf(code.hwnd);
check('D4. release outside the tab strip -> normal move, nothing added', !d4.seen.some(s => s.highlight) && (await appTabsCount()) === 0 && !eq(movedTo, preDrag) && movedTo[2] - movedTo[0] === preDrag[2] - preDrag[0], `${JSON.stringify(preDrag)} -> ${JSON.stringify(movedTo)}`);
probe('setpos', code.hwnd, 2100, 200, 1400, 700); probe('focus', code.hwnd); await sleep(400);

// D5) the option off -> no highlight, no tab, ordinary move
await ev(`handle({type:'setSettings', settings:{dragAdd:false}})`);
const d5 = await dragVia(titleSpot(), stripSpot(), 600);
await sleep(600);
check('D5. drag-to-add disabled -> no highlight, no tab, window just moved', !d5.seen.some(s => s.highlight) && (await appTabsCount()) === 0, `tabs=${await appTabsCount()}`);
await ev(`handle({type:'setSettings', settings:{dragAdd:true}})`);
probe('setpos', code.hwnd, 2100, 200, 1400, 700); probe('focus', code.hwnd); await sleep(400);

// D6) Windows Snap still works: drag to the top edge of the monitor -> maximized by Windows, nothing added
const mon2 = mons.map(m => m.split(',').map(Number)).find(([x]) => x === 1920) || [1920, 0];
// top edge away from the corners: Windows maximizes (a corner would open Snap Assist and leave its picker on screen)
const d6 = await dragVia(titleSpot(), [mon2[0] + 1700, mon2[1] + 1], 900);
// a plain move never changes the size; maximized or a snap layout (half/quarter) means Snap acted
const snapped = await waitFor(() => { const i = pj('info', code.hwnd); return i.zoomed || (i.rect[2] - i.rect[0]) !== 1400 || (i.rect[3] - i.rect[1]) !== 700; }, 2000);
check('D6. drag to the screen top edge -> Windows Snap acts as usual, nothing added', snapped.value && (await appTabsCount()) === 0 && !d6.seen[d6.seen.length - 1].highlight, `zoomed=${pj('info', code.hwnd).zoomed} rect=${JSON.stringify(rectOf(code.hwnd))}; highlight while passing the strip: ${d6.seen.some(s => s.highlight)}`);
probe('show', code.hwnd, 9); await sleep(400); probe('setpos', code.hwnd, 2100, 200, 1400, 700); await sleep(400);
check('D7. no binding left behind by the drag scenarios', (await bindingCount()) === 0);
// D8) host CPU for one complete drop-drag, measured without the test's own polling
probe('focus', code.hwnd); await sleep(400);
const c8a = await ev(`call('stats')`);
await new Promise(res => execFile(PROBE_EXE, ['drag', ...titleSpot(), ...stripSpot(), 30, code.hwnd, 600].map(String), () => res()));
await waitFor(async () => (await appTabsCount()) === 1, 4000);
const c8b = await ev(`call('stats')`);
check('D8. host CPU for one drop-drag (no test polling)', (await appTabsCount()) === 1, `${(c8b.cpuMs - c8a.cpuMs).toFixed(0)}ms CPU (includes adding the tab), WS ${c8b.workingSetMB.toFixed(1)}MB`);
await ev(`chrome.tabs.query({}).then(ts=>chrome.tabs.remove(ts.find(t=>t.url.includes('/app.html#')).id))`);
await waitFor(async () => (await bindingCount()) === 0, 3000);
probe('setpos', code.hwnd, 2100, 200, 1100, 700); await sleep(400); // back to the placement the later steps expect

// 13) host killed -> watchdog restores
let a2 = await addTab();
const hostPid = (await ev(`call('ping')`)).pid;
execFileSync('taskkill', ['/f', '/pid', String(hostPid)]);
const wd = await waitFor(() => eq(rectOf(code.hwnd), codeOriginal), 4000);
check('13. host process killed -> watchdog restored VS Code', wd.value, `${wd.ms}ms`);
await activate(webTarget.targetId); await sleep(300);
const t13 = (await pages()).find(t => t.url.includes('app.html'));
await activate(t13.targetId);
await synced('13b. extension reconnects to a new host on next activation', 4000);

// 13c) the unsaved editor created at the start is still there and still dirty
probe('focus', code.hwnd); await waitFor(() => pj('fg').hwnd === code.hwnd, 2000);
let dirtyOk = false;
// find the unsaved editor by name with Quick Open (works whether keyboard focus is in the editor or the terminal)
probe('keys', code.hwnd, 'ctrl+p'); await sleep(700); probe('type', code.hwnd, DIRTY_TEXT); await sleep(800); probe('keys', code.hwnd, 'enter');
dirtyOk = (await waitFor(() => isDirtyTitle(pj('info', code.hwnd).title), 3000)).value;
const seenTitles = [];
if (!dirtyOk) shot('diag_13c', rectOf(code.hwnd));
check('13c. unsaved VS Code editor intact after all attach/detach/crash cycles', dirtyOk, pj('info', code.hwnd).title + ' | cycled: ' + seenTitles.join(' > ') + ' | fg=' + pj('fg').title);

// 14) program closed -> tab marked lost; relaunch + relink
execFileSync('taskkill', ['/pid', String(code.pid)]);
const lost = await waitFor(async () => (await ev(`getBindings()`))[a2.id]?.lost, 8000, 300);
check('14a. VS Code closed -> tab reports "lost"', lost.value, `${lost.ms}ms`);
await activate(webTarget.targetId);
launchCode(); code = await findCode(); await sleep(3000);
probe('setpos', code.hwnd, 2100, 200, 1100, 700); await sleep(300);
const it2 = (await ev(`call('list',{exeFilter:'Code'}).then(r=>r.windows)`)).find(w => w.hwnd === code.hwnd);
await ev(`handle({type:'relink', app:'${a2.id}', win:${JSON.stringify(it2)}})`);
await activate(t13.targetId);
await synced('14b. relaunched VS Code relinked to the same tab', 4000);

// 15) resource usage of the host while idle and while dragging
const s0 = await ev(`call('stats')`); await sleep(10000); const s1 = await ev(`call('stats')`);
check('15a. host CPU while idle (10s)', true, `${(s1.cpuMs - s0.cpuMs).toFixed(0)}ms CPU, WS ${s1.workingSetMB.toFixed(1)}MB`);
const t0 = Date.now();
for (let i = 0; i < 100; i++) probe('setpos', chrome, 2000 + (i % 20) * 5, 60 + (i % 10) * 5, 1600, 1000);
const s2 = await ev(`call('stats')`);
check('15b. host CPU during 100 Chrome moves', true, `${(s2.cpuMs - s1.cpuMs).toFixed(0)}ms CPU over ${Date.now() - t0}ms, repositions +${s2.repositions - s1.repositions}`);
await synced('15c. synced after burst');

// 16) extension removed while running (same teardown as disable: pages closed, native port dropped) -> host restores
let how = 'Extensions.uninstall';
try { await cdp.send('Extensions.uninstall', { id: extId }); }
catch (e) { how = 'runtime.reload (' + e.message.slice(0, 60) + ')'; await ev(`setTimeout(()=>chrome.runtime.reload(),100), true`).catch(() => {}); }
const rl = await waitFor(() => eq(rectOf(code.hwnd), [2100, 200, 3200, 900]), 5000);
check('16. extension removed/disabled -> VS Code restored', rl.value, `${how}; ${JSON.stringify(rectOf(code.hwnd))} ${rl.ms}ms`);
await sleep(1000);
await cdp.send('Extensions.loadUnpacked', { path: EXT_DIR });
await sleep(1500);
sw = await swSession();
const it3 = (await ev(`call('list',{exeFilter:'Code'}).then(r=>r.windows)`)).find(w => w.hwnd === code.hwnd);
await ev(`chrome.windows.getAll().then(w=>handle({type:'add', win:${JSON.stringify(it3)}, windowId:w[0].id}))`);
await synced('17a. app tab after reload synced');
execFileSync('taskkill', ['/f', '/pid', String(proc.pid)]); // browser process only, like a crash
const ck = await waitFor(() => eq(rectOf(code.hwnd), [2100, 200, 3200, 900]), 6000);
check('17b. Chrome killed -> VS Code restored, still running', ck.value && pj('info', code.hwnd).exists, `${ck.ms}ms`);

// cleanup: close isolated VS Code
execFileSync('taskkill', ['/pid', String(code.pid)]);
fs.writeFileSync(path.join(work, 'results.json'), JSON.stringify(results, null, 1));
console.log(`\n${results.filter(r => r.ok).length}/${results.length} passed`);
process.exit(0);
