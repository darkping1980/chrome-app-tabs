// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// v0.3.3 drag-to-add test with REAL mouse input (see docs/drag-drop-analysis.md).
// Isolated only: temp-profile Chrome (extension over CDP, DEV host), a test window built here, an isolated VS Code
// (--user-data-dir), Notepad with a temp file and, if installed, DBeaver with its own workspace (-newInstance -data).
// Focus: maximized Chrome. Do not use the PC while it runs.
// Usage: node tests/drag_test.mjs <workDir> [rounds=10] [apps=testwin,code,notepad,dbeaver]
import path from 'node:path';
import fs from 'node:fs';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { CODE, PROBE, launchChrome, sleep, probe, pj, waitFor, prepareTestExtension } from './lib.mjs';

const work = path.resolve(process.argv[2]);
const ROUNDS = Number(process.argv[3] || 10);
const APPS = (process.argv[4] || 'testwin,code,notepad,dbeaver').split(',');
fs.mkdirSync(work, { recursive: true });
const LOG = path.join(process.env.LOCALAPPDATA, 'ChromeAppTabs-dev', 'host.log');
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}
const rectOf = (h) => pj('info', h).rect;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ps = (c) => execFileSync('powershell', ['-NoProfile', '-c', c], { encoding: 'utf8' }).trim();

// leftovers of an aborted earlier run: only processes carrying our markers
ps("Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | ? { $_.CommandLine -like '*--user-data-dir=*scratchpad*chrome-profile*' -and $_.CommandLine -notlike '*--type=*' } | % { taskkill /pid $_.ProcessId | Out-Null }");
// isolated test programs of an earlier run: identified by their scratch work folder on the command line only
ps("Get-CimInstance Win32_Process | ? { $_.Name -in 'dbeaver.exe','testwin.exe','Code.exe' -and $_.CommandLine -like '*scratchpad*' -and $_.CommandLine -notlike '*--type=*' } | % { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }");
for (const w of pj('find', 'Notepad', 'APPTABS_NOTE')) probe('sysclose', w.hwnd);
await sleep(1000);

const mons = ps('Add-Type -A System.Windows.Forms;[Windows.Forms.Screen]::AllScreens|%{"$($_.Bounds.X),$($_.Bounds.Y),$($_.Bounds.Right),$($_.Bounds.Bottom)"}').split(/\r?\n/).map(l => l.split(',').map(Number));
const MON = mons.find(m => m[0] === 1920) || mons[0];             // test monitor (Chrome lives here)
const OTHER = mons.find(m => m[0] < 0) || null;                    // a monitor left of the primary, for cross-monitor drags
console.log('monitors', JSON.stringify(mons), 'test monitor', JSON.stringify(MON));

// ---------- programs to drag ----------
const apps = [];
if (APPS.includes('testwin')) {
  const src = path.join(work, 'testwin.cs'), exe = path.join(work, 'testwin.exe');
  fs.writeFileSync(src, 'using System;using System.Windows.Forms;static class T{[System.Runtime.InteropServices.DllImport("user32.dll")]static extern bool SetProcessDpiAwarenessContext(IntPtr c);[STAThread]static void Main(){SetProcessDpiAwarenessContext(new IntPtr(-4));Application.Run(new Form{Text="APPTABS_DRAGTEST window",StartPosition=FormStartPosition.Manual,Left=2100,Top=400,Width=700,Height=450});}}');
  execFileSync(path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), ['/nologo', '/target:winexe', '/out:' + exe, '/r:System.Windows.Forms.dll', src]);
  const p = spawn(exe, [], { detached: true, stdio: 'ignore' }); p.unref();
  const w = (await waitFor(() => pj('find', '*', 'APPTABS_DRAGTEST')[0], 10000, 200)).value;
  if (w) apps.push({ name: 'testwin', hwnd: w.hwnd, pid: p.pid, grab: (r) => [r[0] + 200, r[1] + 15], size: [700, 450] });
}
// CODE honours APPTABS_CODE (see lib.mjs)
const CODE_EXE = CODE;
if (APPS.includes('code') && fs.existsSync(CODE_EXE)) {
  const ws = path.join(work, 'APPTABS_DRAG_WS'); fs.mkdirSync(ws, { recursive: true });
  const vsData = path.join(work, 'vscode-data'); fs.mkdirSync(path.join(vsData, 'User'), { recursive: true });
  fs.writeFileSync(path.join(vsData, 'User', 'settings.json'), '{"workbench.startupEditor":"none","security.workspace.trust.enabled":false,"window.restoreWindows":"none","chat.disableAIFeatures":true,"workbench.tips.enabled":false,"update.mode":"none","telemetry.telemetryLevel":"off"}');
  spawn(CODE_EXE, ['--user-data-dir', vsData, '--extensions-dir', path.join(work, 'vscode-ext'), '--new-window', ws], { detached: true, stdio: 'ignore' }).unref();
  const w = (await waitFor(() => pj('find', 'Chrome_WidgetWin_1', 'APPTABS_DRAG_WS')[0], 30000, 300)).value;
  if (w) { await sleep(2500); apps.push({ name: 'vscode', hwnd: w.hwnd, pid: w.pid, grab: (r) => [r[0] + Math.round((r[2] - r[0]) * 0.75), r[1] + 15], size: [1100, 650] }); }
}
if (APPS.includes('notepad')) {
  const f = path.join(work, 'APPTABS_NOTE.txt'); fs.writeFileSync(f, 'drag test\r\n');
  spawn('notepad.exe', [f], { detached: true, stdio: 'ignore' }).unref();
  const w = (await waitFor(() => pj('find', 'Notepad', 'APPTABS_NOTE')[0], 15000, 300)).value;
  // Windows 11 Notepad (WinUI title bar with tabs): injected input starts a move only from the thin caption strip of
  // the top-level window (y+8, WM_NCHITTEST = HTCAPTION); the WinUI drag area below it did not react to SendInput in
  // our tests (a real mouse works there). Known test limitation, see docs/drag-drop-analysis.md.
  if (w) apps.push({ name: 'notepad', hwnd: w.hwnd, pid: w.pid, grab: (r) => [r[2] - 260, r[1] + 8], size: [800, 500] });
}
const DBEAVER = 'C:\\Program Files\\DBeaver\\dbeaver.exe';
if (APPS.includes('dbeaver') && fs.existsSync(DBEAVER)) {
  const dws = path.join(work, 'dbeaver-ws'); fs.mkdirSync(dws, { recursive: true });
  const p = spawn(DBEAVER, ['-newInstance', '-nosplash', '-data', dws], { detached: true, stdio: 'ignore' }); p.unref();
  // only a window of OUR process: never the user's own DBeaver
  const w = (await waitFor(() => pj('find', 'SWT_Window0', 'DBeaver', p.pid).find(x => x.pid === p.pid), 60000, 500)).value;
  if (w) { await sleep(4000); apps.push({ name: 'dbeaver', hwnd: w.hwnd, pid: p.pid, grab: (r) => [r[0] + Math.round((r[2] - r[0]) * 0.5), r[1] + 15], size: [1100, 700] }); }
  else { console.log('DBeaver: isolated instance did not start, skipped'); try { process.kill(p.pid); } catch {} }
}
console.log('apps:', apps.map(a => a.name).join(', '));

// ---------- isolated Chrome + extension (DEV host) ----------
const { proc, cdp } = launchChrome(path.join(work, 'chrome-profile'), MON[0] + 80, MON[1] + 60, 1600, 950);
await sleep(2000);
const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: prepareTestExtension(work) });
await sleep(1200);
const swT = (await waitFor(async () => (await cdp.send('Target.getTargets')).targetInfos.find(t => t.type === 'service_worker' && t.url.includes(extId)), 10000, 200)).value;
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: swT.targetId, flatten: true });
const ev = (e) => cdp.eval(sessionId, e);
const ping = await ev(`call('ping')`);
check('DEV host connected', ping.version === '0.3.3', JSON.stringify(ping));
const chrome = pj('find', 'Chrome_WidgetWin_1', 'WEB PAGE', proc.pid)[0].hwnd;
// tab events seen by the extension, to diagnose a failed attempt
await ev(`self.__tev=[];const T=()=>Date.now()%1e6;chrome.tabs.onCreated.addListener(t=>__tev.push('created '+t.id+' @'+T()));chrome.tabs.onRemoved.addListener(i=>__tev.push('removed '+i+' @'+T()));chrome.tabs.onActivated.addListener(a=>__tev.push('activated '+a.tabId+' @'+T()));true`);
const pages = async () => (await cdp.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page');
const webTarget = (await pages()).find(t => t.url.startsWith('data:'));
// a page with a large ARIA tablist (the element v0.3.2 mistook for the tab strip)
const tl = await cdp.send('Target.createTarget', { url: 'data:text/html,<title>TABLIST PAGE</title><body style="margin:0"><div style="height:60px">header</div><div role="tablist" style="height:700px;background:%23dde"><div role="tab" aria-selected="true">Tab A</div><div role="tab">Tab B</div></div>' });
await sleep(800);
await cdp.send('Target.activateTarget', { targetId: webTarget.targetId }); await sleep(400);

const appTabs = async () => (await pages()).filter(t => t.url.includes('/app.html#'));
const bindings = () => ev(`getBindings().then(b=>Object.keys(b).length)`);
async function closeAppTabs() {
  await ev(`chrome.tabs.query({}).then(ts=>Promise.all(ts.filter(t=>t.url.includes('/app.html#')).map(t=>chrome.tabs.remove(t.id))))`);
  await waitFor(async () => (await bindings()) === 0, 4000);
}
function chromeState(max) {
  const i = pj('info', chrome);
  if (max && !i.zoomed) { probe('show', chrome, 3); }
  if (!max && i.zoomed) { probe('show', chrome, 9); }
  if (!max) probe('setpos', chrome, MON[0] + 80, MON[1] + 60, 1600, 950);
}
function geo() {
  const r = rectOf(chrome), c = JSON.parse(probe('content', chrome)), z = pj('info', chrome).zoomed;
  const top = z ? MON[1] : r[1], x = r[0] + Math.round((r[2] - r[0]) * 0.62);
  return { r, c, top, strip: [x, top + 20], toolbar: [x, c[1] - 18], page: [x, c[1] + 300], zoomed: z };
}
let logPos = 0;
const logSince = () => { const s = fs.existsSync(LOG) ? fs.readFileSync(LOG) : Buffer.alloc(0); const out = s.subarray(logPos).toString('utf8'); logPos = s.length; return out; };
const dragPath = (app, pts, stepMs, hold, esc) => new Promise(res => execFile(PROBE,
  ['dragpath', stepMs, hold, app.hwnd, ...pts.flat(), ...(esc ? ['esc'] : [])].map(String), (e, out) => res((out || '').trim())));

async function prep(app, at) {
  const i = pj('info', app.hwnd);
  if (i.zoomed || i.iconic) { probe('show', app.hwnd, 9); await sleep(350); }
  probe('setpos', app.hwnd, at[0], at[1], app.size[0], app.size[1]);
  probe('focus', app.hwnd); await sleep(350);
  // some title bars (WinUI, e.g. Windows 11 Notepad) use the first click on an inactive window only to activate it
  if (pj('fg').hwnd !== app.hwnd) { const g = app.grab(rectOf(app.hwnd)); await dragPath(app, [g, g], 0, 40); await sleep(300); }
}
// one drag: returns { added, highlight, out, log, restored }
async function attempt(app, pts, { stepMs = 12, hold = 250, esc = false, close = true, keep = false } = {}) {
  if (!keep && (await bindings()) > 0) await closeAppTabs(); // every attempt starts with no program tab
  await ev(`__tev.length=0`);
  logSince();
  const before = rectOf(app.hwnd), t0 = Date.now(), b0 = await bindings();
  const seen = []; let done = false;
  const run = dragPath(app, pts, stepMs, hold, esc).then(o => { done = true; return o; });
  while (!done) { seen.push(await ev(`call('stats')`)); await sleep(40); }
  const out = await run;
  const added = (await waitFor(async () => (await bindings()) > b0, 3000, 100)).value;
  await sleep(150);
  const log = logSince() + '\n tabs: ' + (await ev(`__tev.join(', ')`));
  let restored = null;
  if (added && close) {
    await closeAppTabs();
    restored = (await waitFor(() => eq(rectOf(app.hwnd), before), 3000, 100)).value;
  }
  return { added: !!added, highlight: seen.some(s => s.highlight), out, log, before, restored, ms: Date.now() - t0 };
}
const brief = (r) => `out=${r.out} highlight=${r.highlight}` + (r.restored === null ? '' : ` restored=${r.restored}`);
const dropLine = (r) => (r.log.split(/\r?\n/).filter(l => / drag (start|end) | attach | detach |tabs:/.test(l)).map(l => l.replace(/^\S+ \[\d+\] /, '')).join(' | ')).slice(0, 700);
// Snap Assist (the window picker Windows shows after snapping) takes the focus: dismiss it with Esc, but only when
// the foreground window really belongs to the shell, so no key ever reaches one of the user's programs
async function dismissSnapAssist() {
  const fg = pj('fg'); if (!fg.hwnd) return;
  const pid = pj('info', fg.hwnd).pid;
  if (ps(`(Get-Process -Id ${pid}).ProcessName`) === 'explorer') { probe('keys', fg.hwnd, 'esc'); await sleep(300); }
}
const homeOf = (i) => [MON[0] + 200 + 60 * (i % 3), MON[1] + 420];

// ================= scenarios =================
let rate = { max: { ok: 0, n: 0 }, normal: { ok: 0, n: 0 } };
for (const [ai, app] of apps.entries()) {
  console.log(`\n===== ${app.name} =====`);
  const home = homeOf(ai);
  chromeState(true); await sleep(900);
  let g = geo();
  check(`${app.name}: Chrome maximized on the test monitor`, g.zoomed, JSON.stringify(g.r));

  // M1 slow drag onto the maximized tab strip (+ restore after closing the tab)
  await prep(app, home); let r = await attempt(app, [app.grab(rectOf(app.hwnd)), [g.strip[0], g.strip[1] + 250], g.strip], { stepMs: 16, hold: 350 });
  check(`${app.name} M1 maximized Chrome, slow drag onto the tab strip -> added; tab closed -> original rect`, r.added && r.highlight && r.restored, brief(r) + ' ' + (r.added ? '' : dropLine(r)));
  // M2 fast flick (no pause, ~12 px steps without delay, release immediately)
  await prep(app, home); r = await attempt(app, [app.grab(rectOf(app.hwnd)), g.strip], { stepMs: 2, hold: 0 });
  check(`${app.name} M2 maximized Chrome, fast flick onto the tab strip -> added`, r.added && r.restored, brief(r) + ' ' + dropLine(r));
  // M3 toolbar / address bar row
  await prep(app, home); r = await attempt(app, [app.grab(rectOf(app.hwnd)), g.toolbar], { stepMs: 8, hold: 200 });
  check(`${app.name} M3 maximized Chrome, drop on the address bar row -> added`, r.added && r.restored, brief(r) + ' ' + (r.added ? '' : dropLine(r)));
  // M4 page area: ordinary move
  await prep(app, home); r = await attempt(app, [app.grab(rectOf(app.hwnd)), g.page], { stepMs: 8, hold: 200 });
  check(`${app.name} M4 drop on the web page -> nothing added, plain move`, !r.added && !r.highlight && !eq(rectOf(app.hwnd), r.before), brief(r));
  // M5 Esc while over the strip
  await prep(app, home); r = await attempt(app, [app.grab(rectOf(app.hwnd)), g.strip], { stepMs: 8, hold: 300, esc: true });
  await sleep(300);
  check(`${app.name} M5 Esc over the tab strip -> cancelled, window back`, !r.added && eq(rectOf(app.hwnd), r.before), brief(r) + ' now ' + JSON.stringify(rectOf(app.hwnd)));
  // M6 page with an ARIA tablist active
  await cdp.send('Target.activateTarget', { targetId: tl.targetId }); await sleep(600); g = geo();
  await prep(app, home); r = await attempt(app, [app.grab(rectOf(app.hwnd)), g.strip], { stepMs: 8, hold: 250 });
  check(`${app.name} M6 tablist web page active: drop on the tab strip -> added`, r.added && r.restored, brief(r) + ' ' + (r.added ? '' : dropLine(r)));
  await prep(app, home); r = await attempt(app, [app.grab(rectOf(app.hwnd)), [g.strip[0], g.c[1] + 250]], { stepMs: 8, hold: 250 });
  check(`${app.name} M6b tablist web page active: drop on the page's tablist -> nothing added`, !r.added && !r.highlight, brief(r));
  await cdp.send('Target.activateTarget', { targetId: webTarget.targetId }); await sleep(500); g = geo();
  // M7 the screen's top edge first (Windows Snap territory), then down onto the strip and release
  await prep(app, home); r = await attempt(app, [app.grab(rectOf(app.hwnd)), [g.strip[0], MON[1] + 1], [g.strip[0], MON[1] + 1], g.strip], { stepMs: 16, hold: 400, close: true });
  await dismissSnapAssist(); const i7 = pj('info', app.hwnd);
  check(`${app.name} M7 touched the top edge, released on the strip -> not added (Snap bar area), never both`, !r.added, brief(r) + ` zoomed=${i7.zoomed} rect=${JSON.stringify(i7.rect)}`);
  // M8 snapped source window (Win+Left), dragged onto the strip; closing the tab must put it back where it was snapped
  await prep(app, home); probe('keys', app.hwnd, 'win+left'); await sleep(900); await dismissSnapAssist();
  probe('focus', app.hwnd); await sleep(300);
  const snappedRect = rectOf(app.hwnd);
  r = await attempt(app, [app.grab(snappedRect), [g.strip[0], g.strip[1] + 200], g.strip], { stepMs: 16, hold: 350 });
  check(`${app.name} M8 snapped window dragged onto the strip -> added; tab closed -> back at its snapped rect`, r.added && r.restored, `snapped=${JSON.stringify(snappedRect)} now=${JSON.stringify(rectOf(app.hwnd))} ` + brief(r) + ' ' + (r.added ? '' : dropLine(r)));
  if (pj('info', app.hwnd).zoomed) probe('show', app.hwnd, 9);
  // M9 resize from the top edge up into the strip: never a drop
  await prep(app, home);
  { const rr = rectOf(app.hwnd); r = await attempt(app, [[rr[0] + 120, rr[1] + 2], [rr[0] + 120, g.strip[1]]], { stepMs: 12, hold: 300 }); }
  check(`${app.name} M9 resize by the top edge into the strip -> nothing added`, !r.added, brief(r) + ' ' + dropLine(r));
  // M10 repeated drops, maximized Chrome, alternating speed and release point (strip / toolbar)
  for (let i = 0; i < ROUNDS; i++) {
    await prep(app, homeOf(i));
    const tgt = i % 2 ? g.toolbar : [g.strip[0] - 150 + 40 * (i % 5), g.strip[1] - 6 + 4 * (i % 4)];
    r = await attempt(app, [app.grab(rectOf(app.hwnd)), tgt], { stepMs: i % 3 === 0 ? 2 : 10, hold: i % 3 === 0 ? 0 : 150 });
    rate.max.n++; if (r.added && r.restored) rate.max.ok++; else console.log(`   round ${i} failed: ${brief(r)} ${dropLine(r)}`);
  }
  // N1 Chrome not maximized
  chromeState(false); await sleep(800); g = geo();
  for (let i = 0; i < Math.max(3, ROUNDS / 2); i++) {
    await prep(app, [MON[0] + 300, MON[1] + 520]);
    r = await attempt(app, [app.grab(rectOf(app.hwnd)), i % 2 ? g.toolbar : g.strip], { stepMs: i % 2 ? 2 : 12, hold: i % 2 ? 0 : 200 });
    rate.normal.n++; if (r.added && r.restored) rate.normal.ok++; else console.log(`   normal round ${i} failed: ${brief(r)} ${dropLine(r)}`);
  }
  console.log(`   ${app.name}: maximized ${rate.max.ok}/${rate.max.n}, normal ${rate.normal.ok}/${rate.normal.n} (cumulative)`);
  probe('show', app.hwnd, 7); await sleep(300); // minimized (no activation): never in the way of the next program's drags
}
// (each app is minimized after its scenarios, see below)
check(`maximized Chrome success rate ${rate.max.ok}/${rate.max.n}`, rate.max.ok === rate.max.n);
check(`normal Chrome success rate ${rate.normal.ok}/${rate.normal.n}`, rate.normal.ok === rate.normal.n);

// X1 cross-monitor: from the monitor left of the primary to the maximized Chrome on the test monitor
if (OTHER && apps.length) {
  const app = apps[0]; chromeState(true); await sleep(800); const g = geo();
  await prep(app, [OTHER[0] + 300, OTHER[1] + 400]);
  const r = await attempt(app, [app.grab(rectOf(app.hwnd)), [OTHER[0] + 1500, OTHER[1] + 600], [MON[0] + 600, MON[1] + 600], g.strip], { stepMs: 6, hold: 300 });
  check('X1 cross-monitor drag (left monitor -> maximized Chrome on the right monitor) -> added, restored on the left monitor', r.added && r.restored, brief(r) + ' ' + (r.added ? '' : dropLine(r)));
}
// X2 already attached program: no second tab
if (apps.length) {
  const app = apps[0]; const g = geo();
  await prep(app, homeOf(0)); let r = await attempt(app, [app.grab(rectOf(app.hwnd)), g.strip], { stepMs: 10, hold: 250, close: false });
  await sleep(800);
  const rr = rectOf(app.hwnd);
  const r2 = await attempt(app, [app.grab(rr), [g.strip[0] + 100, g.strip[1]]], { stepMs: 10, hold: 250, close: false, keep: true });
  check('X2 dragging an already attached program adds no second tab', r.added && !r2.added && (await appTabs()).length === 1 && (await bindings()) === 1, `tabs=${(await appTabs()).length}`);
  await closeAppTabs();
}
check('no binding left behind', (await bindings()) === 0);

// ---------- cleanup (isolated processes only) ----------
const passed = results.filter(r => r.ok).length;
console.log(`\nRESULT ${passed}/${results.length} passed`);
fs.writeFileSync(path.join(work, 'drag-results.json'), JSON.stringify({ results, rate }, null, 1));
await cdp.send('Browser.close').catch(() => {});
// isolated instances only (temp workspace / profile): DBeaver ignores a polite close request while busy, so it is ended
for (const a of apps) { try { if (a.name === 'notepad') probe('sysclose', a.hwnd); else execFileSync('taskkill', ['/pid', String(a.pid), '/t', '/f']); } catch {} }
process.exit(0);
