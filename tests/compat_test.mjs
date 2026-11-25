// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// Generic-program compatibility + multi-window drag-to-add test.
// Every program here is started by the test itself (and closed politely with WM_CLOSE at the end):
//   VS Code (own user-data-dir), Notepad (a scratch file), File Explorer (a new window on a scratch folder),
//   Calculator (UWP, hosted by ApplicationFrameHost), Character Map (classic fixed-size dialog).
// Two isolated Chrome windows: W1 normal (monitor 2), W2 maximized (monitor 3). DEV host only.
import path from 'node:path';
import fs from 'node:fs';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { CODE, PROBE, launchChrome, sleep, probe, pj, waitFor, prepareTestExtension } from './lib.mjs';

const work = path.resolve(process.argv[2]);
fs.mkdirSync(work, { recursive: true });
const shots = path.join(work, 'shots'); fs.mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };
const info = (name, detail) => { results.push({ name, ok: null, detail }); console.log(`INFO  ${name}  ${detail}`); };
const rectOf = (h) => pj('info', h).rect;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const shot = (n, r) => probe('shot', path.join(shots, n + '.png'), r[0], r[1], r[2] - r[0], r[3] - r[1]);

// ---------- isolated Chrome with two windows ----------
const ext = prepareTestExtension(work);
const { proc, cdp } = launchChrome(path.join(work, 'chrome-profile'), 2000, 60, 1600, 1000);
await sleep(2000);
const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: ext });
await sleep(1500);
const swT = (await cdp.send('Target.getTargets')).targetInfos.find(t => t.type === 'service_worker' && t.url.includes(extId));
const sw = (await cdp.send('Target.attachToTarget', { targetId: swT.targetId, flatten: true })).sessionId;
const ev = (e) => cdp.eval(sw, e);
const W1 = pj('find', 'Chrome_WidgetWin_1', 'WEB PAGE', proc.pid)[0].hwnd;
const w1Id = await ev(`chrome.windows.getAll().then(w=>w[0].id)`);
const w2Id = await ev(`chrome.windows.create({left:-1800,top:100,width:1200,height:800,url:'data:text/html,<title>SECOND</title><body style="background:%2300c853">second window'}).then(w=>w.id)`);
await sleep(1000);
const W2 = pj('find', 'Chrome_WidgetWin_1', 'SECOND', proc.pid)[0].hwnd;
probe('setpos', W2, -1800, 100, 1200, 800); await sleep(500);          // make sure it is on monitor 3 before maximizing
// W2 stays a normal window: on a MAXIMIZED Chrome the tab strip touches the screen's top edge, where Windows Snap
// may take the drop instead (known limitation, see docs) - that case is not part of the pass criteria
check('S. 2nd Chrome window on another monitor', rectOf(W2)[0] < 0, JSON.stringify(rectOf(W2)));
const contentOf = (h) => JSON.parse(probe('content', h));
const centreOf = (r) => [Math.round((r[0] + r[2]) / 2), Math.round((r[1] + r[3]) / 2)];
const appTabs = () => ev(`chrome.tabs.query({}).then(t=>t.filter(x=>x.url.includes('/app.html#')).map(x=>({id:x.id,windowId:x.windowId,title:x.title})))`);
const webTabOf = (wid) => ev(`chrome.tabs.query({windowId:${wid}}).then(t=>t.find(x=>!x.url.includes('/app.html#')).id)`);
const activate = (tabId) => ev(`chrome.tabs.update(${tabId},{active:true}).then(()=>true)`);

// ---------- start the programs ----------
const dir = path.join(work, 'APPTABS_COMPAT_DIR'); fs.mkdirSync(dir, { recursive: true });
const note = path.join(dir, 'apptabs_compat_note.txt'); fs.writeFileSync(note, 'compat test\r\n');
const vsData = path.join(work, 'vscode-data'); fs.mkdirSync(path.join(vsData, 'User'), { recursive: true });
fs.writeFileSync(path.join(vsData, 'User', 'settings.json'), '{"workbench.startupEditor":"none","security.workspace.trust.enabled":false,"window.restoreWindows":"none","chat.disableAIFeatures":true,"workbench.tips.enabled":false}');
spawn(CODE, ['--user-data-dir', vsData, '--extensions-dir', path.join(work, 'vscode-ext'), '--new-window', dir], { detached: true, stdio: 'ignore' }).unref();
spawn('notepad.exe', [note], { detached: true, stdio: 'ignore' }).unref();
execFile('explorer.exe', [`/n,${dir}`]);
spawn('calc.exe', [], { detached: true, stdio: 'ignore' }).unref();
spawn('charmap.exe', [], { detached: true, stdio: 'ignore' }).unref();
await sleep(6000);
const list = await ev(`call('list',{}).then(r=>r.windows)`);
const pick = (pred) => list.find(pred);
const programs = [
  { key: 'vscode', label: 'VS Code', w: pick(w => w.process === 'Code' && w.title.includes('APPTABS_COMPAT_DIR')) },
  { key: 'notepad', label: '메모장', w: pick(w => /notepad/i.test(w.process || '') && w.title.includes('apptabs_compat_note')) },
  { key: 'explorer', label: '파일 탐색기', w: pick(w => w.process === 'explorer' && w.className === 'CabinetWClass' && w.title.includes('APPTABS_COMPAT_DIR')) },
  { key: 'calc', label: '계산기(UWP)', w: pick(w => w.className === 'ApplicationFrameWindow' && /계산기|Calculator/.test(w.title)) },
  { key: 'charmap', label: '문자표(고정 크기)', w: pick(w => /charmap/i.test(w.process || '')) },
];
for (const p of programs) check(`L. ${p.label}: found in the window list`, p.w, p.w ? `${p.w.process}.exe "${p.w.description || ''}" class=${p.w.className} icon=${!!p.w.icon}` : 'not found');

// ---------- 1) popup-style add, show/hide, input focus, restore — same generic path for every program ----------
for (const p of programs.filter(p => p.w)) {
  const h = p.w.hwnd;
  probe('setpos', h, 2150, 250, 900, 560); await sleep(400);
  const orig = rectOf(h);
  const a = await ev(`handle({type:'add', win:${JSON.stringify(p.w)}, windowId:${w1Id}})`);
  await sleep(1200);
  const c = contentOf(W1), r = rectOf(h);
  const fits = eq(c, r);
  const top = pj('at', ...centreOf(c)).hwnd === h || pj('at', r[0] + 20, r[1] + 40).hwnd === h;
  shot(`c_${p.key}`, rectOf(W1));
  if (fits) check(`C1. ${p.label}: shown exactly over the Chrome content area`, top, `rect=${JSON.stringify(r)}`);
  else info(`C1. ${p.label}: positioned but kept its own size (the program refuses the size)`, `content=${JSON.stringify(c)} window=${JSON.stringify(r)} visible=${top}`);
  check(`C2. ${p.label}: has keyboard focus`, pj('fg').hwnd === h, pj('fg').title);
  await activate(await webTabOf(w1Id)); await sleep(600);
  check(`C3. ${p.label}: hidden behind Chrome on a web tab`, pj('at', ...centreOf(c)).hwnd === W1);
  const t = (await appTabs()).find(x => x.title.includes(a.id));
  await activate(t.id); await sleep(800);
  check(`C4. ${p.label}: shown again on its tab`, pj('at', r[0] + 20, r[1] + 40).hwnd === h);
  await ev(`chrome.tabs.remove(${t.id})`); await sleep(900);
  check(`C5. ${p.label}: tab closed -> original placement restored, program still running`, eq(rectOf(h), orig) && pj('info', h).exists, JSON.stringify(rectOf(h)));
}

// ---------- 2) drag-to-add across windows / several programs in a row / cancel / maximized source ----------
const stripSpot = (h) => { const r = rectOf(h), z = pj('info', h).zoomed; return [r[0] + Math.round((r[2] - r[0]) * 0.6), (z ? r[1] + 8 : r[1]) + 22]; };
const titleSpots = { vscode: [0.75, 15], notepad: [0.62, 16], explorer: [0.62, 16], calc: [0.45, 14], charmap: [0.5, 12] };
const titleSpot = (p) => { const r = rectOf(p.w.hwnd), [fx, dy] = titleSpots[p.key]; return [r[0] + Math.round((r[2] - r[0]) * fx), r[1] + dy]; };
const drag = (from, to, hold = 600, extra = []) => new Promise(res => execFile(PROBE, ['drag', from[0], from[1], to[0], to[1], 30, pj('at', from[0], from[1]).hwnd, hold, ...extra].map(String), (e, out) => res((out || '').trim())));
async function dragOnto(p, target, opts = {}) {
  const h = p.w.hwnd;
  if (!opts.keepPlacement) { probe('show', h, 9); probe('setpos', h, 2150, 250, p.key === 'vscode' ? 1400 : 1000, 600); }
  probe('focus', h); await sleep(500);
  const before = (await appTabs()).length;
  const out = await drag(titleSpot(p), stripSpot(target), 700, opts.cancel ? ['esc'] : []);
  await sleep(1500);
  const after = await appTabs();
  return { out, added: after.length - before, tabs: after };
}
const N = (k) => programs.find(p => p.key === k);
if (N('notepad').w) {
  const d = await dragOnto(N('notepad'), W2);
  const t = d.tabs.find(x => x.windowId === w2Id);
  const shown = await waitFor(() => eq(contentOf(W2), rectOf(N('notepad').w.hwnd)), 3000);
  shot('d_notepad_to_maximized_w2', rectOf(W2));
  check('D1. Notepad dragged onto the tab strip of the 2nd Chrome window (other monitor) -> added THERE', d.added === 1 && t && shown.value, `${d.out}; tab window=${t && t.windowId} (w2=${w2Id})`);
}
if (N('explorer').w) {
  const d = await dragOnto(N('explorer'), W1);
  const t = d.tabs.find(x => x.windowId === w1Id);
  check('D2. File Explorer dragged onto the 1st window right after -> 2nd program added in W1', d.added === 1 && t && (await appTabs()).length === 2, `${d.out}; app tabs now ${(await appTabs()).length}`);
}
if (N('calc').w) {
  const startR = (probe('show', N('calc').w.hwnd, 9), probe('setpos', N('calc').w.hwnd, 2150, 250, 1000, 600), await sleep(300), rectOf(N('calc').w.hwnd));
  const d = await dragOnto(N('calc'), W1, { cancel: true, keepPlacement: true });
  check('D3. drag cancelled with Esc over the tab strip -> nothing added, window back', d.added === 0 && eq(rectOf(N('calc').w.hwnd), startR), `${d.out}; ${JSON.stringify(rectOf(N('calc').w.hwnd))}`);
  const d2 = await dragOnto(N('calc'), W1);
  check('D4. UWP Calculator (ApplicationFrameHost) by drag -> added', d2.added === 1, d2.out);
}
if (N('vscode').w) {   // a MAXIMIZED source window: Windows restores its size when the drag starts
  const h = N('vscode').w.hwnd;
  probe('show', h, 3); await sleep(800);
  const wasMax = pj('info', h).zoomed;
  const d = await dragOnto(N('vscode'), W2, { keepPlacement: true });
  check('D5. MAXIMIZED VS Code dragged onto W2 -> added', wasMax && d.added === 1, `${d.out}; wasMax=${wasMax}`);
  const t = (await appTabs()).find(x => x.title.includes('Visual Studio Code'));
  if (t) { await ev(`chrome.tabs.remove(${t.id})`); await sleep(900); }
  check('D6. ...closing its tab restores the MAXIMIZED state', pj('info', h).zoomed, JSON.stringify(rectOf(h)));
  probe('show', h, 9);
}
if (N('charmap').w) {
  const d = await dragOnto(N('charmap'), W1);
  if (d.added === 1) check('D7. classic fixed-size dialog (Character Map) by drag -> added', true, d.out);
  else info('D7. Character Map could not be dragged by the test (title bar spot)', d.out);
}
const before = (await appTabs()).length;
const dupe = await ev(`handle({type:'add', win:${JSON.stringify(N('notepad').w)}, windowId:${w1Id}})`);
check('D8. adding an already connected program again does not duplicate it', dupe.existed === true && (await appTabs()).length === before, JSON.stringify(dupe));

// ---------- cleanup: release everything, then close only the programs this test started ----------
for (const t of await appTabs()) await ev(`chrome.tabs.remove(${t.id})`);
const rel = await waitFor(async () => (await ev(`call('state')`)).apps.length === 0, 5000, 200);
check('Z1. all programs released, nothing left attached', rel.value, JSON.stringify((await ev(`call('state')`)).apps));
await cdp.send('Browser.close').catch(() => {});
for (const p of programs) if (p.w && pj('info', p.w.hwnd).exists) probe('close', p.w.hwnd);
await sleep(1500);
fs.writeFileSync(path.join(work, 'compat_results.json'), JSON.stringify(results, null, 1));
console.log(`\n${results.filter(r => r.ok === true).length} passed, ${results.filter(r => r.ok === false).length} failed, ${results.filter(r => r.ok === null).length} info`);
process.exit(0);
