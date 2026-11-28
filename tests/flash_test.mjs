// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// Taskbar-flash test: how often does switching tabs make Windows flash a taskbar button, and does the program that
// is shown also have the keyboard focus? REAL mouse/keyboard input, isolated instances only, DEV host only:
//   temp-profile Chrome (extension over CDP), VS Code (--user-data-dir), DBeaver (-newInstance -data) and, if its
//   pid is given, an already started second SQL Developer instance (never the user's own window).
// WARNING (SQL Developer): no way was found to give a second SQL Developer its own settings folder
//   (SQLDEVELOPER_USER_DIR and an APPDATA override were both ignored). A second instance uses, and on start WRITES
//   (window layouts, ide.properties, system cache), the user's %APPDATA%\SQL Developer. Leave the pid out unless
//   that is acceptable, and end such an instance with taskkill /f (a normal exit would save its layout there too).
// Taskbar notifications are recorded by tests\bin\flashwatch.exe (shell hook, passive). Do not use the PC meanwhile.
// Usage: node tests/flash_test.mjs <workDir> <label> [rounds=3] [sqldevPid]
import path from 'node:path';
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { ROOT, CODE, launchChrome, sleep, probe, pj, waitFor, prepareTestExtension } from './lib.mjs';

const work = path.resolve(process.argv[2]);
const LABEL = process.argv[3] || 'run';
const ROUNDS = Number(process.argv[4] || 3);
const SQLDEV_PID = process.argv[5] ? Number(process.argv[5]) : 0;
fs.mkdirSync(work, { recursive: true });
const HOSTLOG = path.join(process.env.LOCALAPPDATA, 'ChromeAppTabs-dev', 'host.log');
const FLASHLOG = path.join(work, `flash-${LABEL}.tsv`);
const now = () => { const d = new Date(); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0'); };
const ps = (c) => { try { execFileSync('powershell', ['-NoProfile', '-c', c], { stdio: 'ignore' }); } catch { } };

// ---------- observer + log offsets ----------
fs.rmSync(FLASHLOG, { force: true });
const watcher = spawn(path.join(ROOT, 'tests', 'bin', 'flashwatch.exe'), [FLASHLOG], { detached: true, stdio: 'ignore' });
const hostLogStart = fs.existsSync(HOSTLOG) ? fs.statSync(HOSTLOG).size : 0;
await sleep(500);

// ---------- programs (isolated) ----------
const vsData = path.join(work, 'vscode-data'); fs.mkdirSync(path.join(vsData, 'User'), { recursive: true });
fs.writeFileSync(path.join(vsData, 'User', 'settings.json'), '{"workbench.startupEditor":"none","security.workspace.trust.enabled":false,"window.restoreWindows":"none","chat.disableAIFeatures":true,"workbench.tips.enabled":false,"update.mode":"none","telemetry.telemetryLevel":"off"}');
const ws = path.join(work, 'APPTABS_FLASH_WS'); fs.mkdirSync(ws, { recursive: true });
spawn(CODE, ['--user-data-dir', vsData, '--extensions-dir', path.join(work, 'vscode-ext'), '--new-window', ws], { detached: true, stdio: 'ignore' }).unref();
const DBEAVER = 'C:\\Program Files\\DBeaver\\dbeaver.exe';
const dws = path.join(work, 'dbeaver-ws'); fs.mkdirSync(dws, { recursive: true });
const dbp = spawn(DBEAVER, ['-newInstance', '-nosplash', '-data', dws], { detached: true, stdio: 'ignore' }); dbp.unref();
const code = (await waitFor(() => pj('find', 'Chrome_WidgetWin_1', 'APPTABS_FLASH_WS')[0], 40000, 300)).value;
const dbv = (await waitFor(() => pj('find', 'SWT_Window0', 'DBeaver', dbp.pid).find(x => x.pid === dbp.pid), 90000, 500)).value;
// a fresh DBeaver workspace opens the modal "Statistics collection" dialog (main window disabled until it is closed);
// close it in OUR instance so it cannot cover the program or take its activation during the measurement
if (dbv) {
  const dlg = (await waitFor(() => pj('find', '#32770', 'Statistics', dbp.pid).find(x => x.pid === dbp.pid), 30000, 500)).value;
  if (dlg) { probe('close', dlg.hwnd); await sleep(1500); console.log('closed DBeaver first-run dialog', dlg.hwnd, pj('find', '#32770', 'Statistics', dbp.pid).length ? '(still open)' : ''); }
}
const sqd = SQLDEV_PID ? pj('find', 'SunAwtFrame', 'Oracle SQL Developer', SQLDEV_PID).find(x => x.pid === SQLDEV_PID) : null;
const apps = [['code', code], ['dbeaver', dbv], ['sqldev', sqd]].filter(([, w]) => w).map(([name, w]) => ({ name, hwnd: w.hwnd }));
console.log('programs', JSON.stringify(apps));
await sleep(4000);

// ---------- isolated Chrome ----------
const ext = prepareTestExtension(work);
const { proc, cdp } = launchChrome(path.join(work, 'chrome-profile'), 2000, 60, 1600, 1000);
await sleep(2500);
const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: ext });
const swT = (await waitFor(async () => (await cdp.send('Target.getTargets')).targetInfos.find(t => t.type === 'service_worker' && t.url.includes(extId)), 10000, 200)).value;
const sw = (await cdp.send('Target.attachToTarget', { targetId: swT.targetId, flatten: true })).sessionId;
const ev = (e) => cdp.eval(sw, e);
const chrome = pj('find', 'Chrome_WidgetWin_1', 'WEB PAGE', proc.pid)[0].hwnd;
const winId = await ev(`chrome.windows.getAll().then(w=>w[0].id)`);
const list = await ev(`call('list',{}).then(r=>r.windows)`);
for (const a of apps) {
  const item = list.find(w => w.hwnd === a.hwnd);
  a.id = (await ev(`handle({type:'add', win:${JSON.stringify(item)}, windowId:${winId}})`)).id;
  await sleep(1500);
}
const names = { [chrome]: 'chrome' }; for (const a of apps) names[a.hwnd] = a.name;
const nm = (h) => names[h] || ('other:' + h);
const tabs = await ev(`chrome.tabs.query({windowId:${winId}}).then(t=>t.map(x=>x.url.includes('/app.html#')?x.url.split('#')[1]:'web'))`);
const expectOf = tabs.map(t => t === 'web' ? chrome : apps.find(a => a.id === t).hwnd); // tab index -> window that should be shown + focused
console.log('tabs', JSON.stringify(tabs.map((t, i) => nm(expectOf[i]))));
const activeIdx = () => ev(`chrome.tabs.query({windowId:${winId}}).then(t=>t.findIndex(x=>x.active))`);
const cr = pj('info', chrome).rect;
const centre = () => { const c = JSON.parse(probe('content', chrome)); return [Math.round((c[0] + c[2]) / 2), Math.round((c[1] + c[3]) / 2)]; };

// ---------- tab positions from UI Automation of the isolated Chrome (no clicks needed) ----------
const uia = execFileSync('powershell', ['-NoProfile', '-c',
  `Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes; $e=[Windows.Automation.AutomationElement]::FromHandle([IntPtr]${chrome}); ` +
  `$c=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::TabItem); ` +
  `$e.FindAll([Windows.Automation.TreeScope]::Descendants,$c) | % { $r=$_.Current.BoundingRectangle; '{0},{1}' -f [int]($r.X+$r.Width/2),[int]($r.Y+$r.Height/2) }`], { encoding: 'utf8' })
  .trim().split(/\r?\n/).map(l => l.split(',').map(Number)).filter(p => p.length === 2 && p[1] < cr[1] + 60);
const xs = {}; uia.slice(0, tabs.length).forEach((p, i) => xs[i] = p[0]);
const stripY = uia.length ? uia[0][1] : cr[1] + 22;
console.log('tab centres', JSON.stringify(xs), 'y', stripY);
if (uia.length !== tabs.length) { console.log('UIA found', uia.length, 'tab items for', tabs.length, 'tabs: mouse phase may be skipped'); }
await ev(`chrome.tabs.query({windowId:${winId}}).then(t=>chrome.tabs.update(t[0].id,{active:true}))`); await sleep(1200);

// ---------- scenario helpers ----------
const steps = [], marks = [];
const mark = (phase) => { marks.push({ phase, at: now() }); console.log('--', phase, now()); };
async function record(phase, how, want) {
  await sleep(900); // KeepAbove retries (up to 180 ms) and peek settle
  const idx = await activeIdx(), c = centre();
  const vis = pj('at', c[0], c[1]).hwnd, fg = pj('fg').hwnd;
  const exp = want !== undefined ? want : expectOf[idx];
  const s = { phase, how, at: now(), tab: idx, expect: nm(exp), visible: nm(vis), fg: nm(fg),
    ok: vis === exp && fg === exp, hiddenFocus: fg !== vis && apps.some(a => a.hwnd === fg) };
  steps.push(s);
  console.log(`${s.ok ? 'ok ' : 'BAD'} ${phase} ${how} tab=${idx} expect=${s.expect} visible=${s.visible} fg=${s.fg}${s.hiddenFocus ? ' HIDDEN-FOCUS' : ''}`);
  return s;
}

// M) mouse clicks on the tab strip
mark('mouse');
const order = [1, 0, 2, 0, 3, 1, 2, 3].filter(i => i < tabs.length && xs[i] !== undefined);
for (let r = 0; r < ROUNDS; r++) for (const i of order) {
  const res = probe('click', xs[i], stripY, chrome);
  if (!res.startsWith('clicked')) { console.log('click skipped', res); continue; }
  await record('mouse', 'click tab ' + i);
}
// K) global shortcuts of the test copy: Ctrl+Shift+6 = next tab, Ctrl+Shift+4 = toggle
mark('shortcut');
for (let r = 0; r < ROUNDS; r++) {
  for (let k = 0; k < tabs.length; k++) {
    const fg = pj('fg').hwnd; if (!names[fg]) { console.log('shortcut skipped: foreground is', fg); continue; }
    probe('keys', fg, 'ctrl+shift+6'); await record('shortcut', 'next');
  }
  for (let k = 0; k < 2; k++) {
    const fg = pj('fg').hwnd; if (!names[fg]) continue;
    probe('keys', fg, 'ctrl+shift+4'); await record('shortcut', 'toggle');
  }
}
// R) quick cycling with the next-tab shortcut (passing through program tabs within ~0.35 s, as in real use), ending
//    on the web tab, then 10 s without input: a taskbar button that keeps flashing / stays highlighted shows here
mark('rapid');
await ev(`chrome.tabs.query({windowId:${winId}}).then(t=>chrome.tabs.update(t[0].id,{active:true}))`); await sleep(300);
probe('focus', chrome); await sleep(1200);
let presses = 0;
for (let k = 0; k < tabs.length * 2; k++) {
  const fg = pj('fg').hwnd;
  if (probe('keys', names[fg] ? fg : chrome, 'ctrl+shift+6') === '') presses++;
  await sleep(350);
}
await record('rapid', `after ${presses} quick next-tab presses`);
mark('quiet');
await sleep(10000);
const shots = path.join(work, 'shots'); fs.mkdirSync(shots, { recursive: true });
probe('shot', path.join(shots, `taskbar-${LABEL}-after-rapid-primary.png`), 0, 1080 - 48, 1920, 48);
probe('shot', path.join(shots, `taskbar-${LABEL}-after-rapid-chrome-monitor.png`), 1920, 1440 - 48, 2560, 48);
// P) omnibox peek on each program tab: click the omnibox (program steps back), then Esc / click on the page
mark('peek');
const omni = [cr[0] + 500, cr[1] + 62];
for (const a of apps) {
  const i = expectOf.indexOf(a.hwnd);
  await ev(`chrome.tabs.query({windowId:${winId}}).then(t=>chrome.tabs.update(t[${i}].id,{active:true}))`); await sleep(1500);
  for (const back of ['esc', 'click']) {
    probe('click', omni[0], omni[1], chrome);
    await record('peek', a.name + ' omnibox', chrome);
    if (back === 'esc') probe('keys', chrome, 'esc');
    else { const c = centre(); probe('click', c[0], c[1], chrome); }
    await record('peek', a.name + ' resume ' + back);
  }
}
mark('end');
await sleep(1500);

// taskbar pictures (primary monitor + the monitor Chrome is on), for a visual check
probe('shot', path.join(shots, `taskbar-${LABEL}-primary.png`), 0, 1080 - 48, 1920, 48);
probe('shot', path.join(shots, `taskbar-${LABEL}-chrome-monitor.png`), 1920, 1440 - 48, 2560, 48);
const stats = await ev(`call('stats')`);

// ---------- clean up (isolated instances only) ----------
for (const a of apps) await ev(`handle({type:'disconnect', app:'${a.id}'})`).catch(() => { });
await sleep(1500);
try { proc.kill(); } catch { }
ps(`Get-CimInstance Win32_Process | ? { $_.Name -in 'dbeaver.exe','Code.exe' -and $_.CommandLine -like '*${path.basename(work)}*' -and $_.CommandLine -notlike '*--type=*' } | % { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`);
await sleep(1500);
try { process.kill(watcher.pid); } catch { }

// ---------- analysis ----------
const ours = new Set([chrome, ...apps.map(a => a.hwnd)].map(String));
const phaseOf = (t) => { let p = 'setup'; for (const m of marks) if (m.at <= t) p = m.phase; return p; };
const fl = fs.readFileSync(FLASHLOG, 'utf8').split(/\r?\n/).filter(Boolean).map(l => { const [at, kind, hwnd, pid, proc_, title] = l.split('\t'); return { at, kind, hwnd, proc: proc_, title }; });
const hostLines = fs.readFileSync(HOSTLOG, 'utf8').slice(hostLogStart).split(/\r?\n/).filter(l => / fg /.test(l));
const ms = (t) => { const [h, m, s] = t.split(':'); return ((+h * 60 + +m) * 60 + +s) * 1000; };
// the log line is written when the call ends; it covers [end - elapsed, end]
const fgCalls = hostLines.map(l => { const m = l.match(/^(\S+) \[\d+\] fg (\S+) target=(\d+) before=(\d+) after=(\d+).* (\d+)ms$/); return m && { at: m[1], how: m[2], target: m[3], before: m[4], after: m[5], start: ms(m[1]) - +m[6], end: ms(m[1]), refusedFirst: / r1=False/.test(l), mismatch: / MISMATCH/.test(l), line: l }; }).filter(Boolean);
const flashes = fl.filter(e => e.kind === 'FLASH' && ours.has(e.hwnd));
for (const f of flashes) {
  f.phase = phaseOf(f.at);
  const t = ms(f.at), c = fgCalls.find(c => c.target === f.hwnd && t >= c.start - 5 && t <= c.end + 5);
  f.cause = c ? `inside ForceForeground (${c.how}, first call ${c.refusedFirst ? 'refused' : 'accepted'})` : 'outside any ForceForeground call';
  f.clearedBy = (fl.find(e => (e.kind === 'ACTIVATED' || e.kind === 'RUDEACTIVATED') && e.hwnd === f.hwnd && ms(e.at) >= t) || {}).at || null;
}
// windows whose button was still flashing / highlighted at the end of the quiet period (flashed, not activated since)
const quietStart = ms((marks.find(m => m.phase === 'quiet') || {}).at || '99:00:00.000'), quietEnd = ms((marks.find(m => m.phase === 'peek') || {}).at || '99:00:00.000');
const highlightedAfterQuiet = [...ours].filter(h => {
  const last = fl.filter(e => e.hwnd === h && ms(e.at) <= quietEnd && (e.kind === 'FLASH' || e.kind === 'ACTIVATED' || e.kind === 'RUDEACTIVATED')).pop();
  return last && last.kind === 'FLASH';
}).map(h => nm(Number(h)));
const flashesInQuiet = flashes.filter(f => ms(f.at) >= quietStart && ms(f.at) <= quietEnd);
const count = (arr, key) => arr.reduce((o, x) => (o[x[key]] = (o[x[key]] || 0) + 1, o), {});
const measured = fgCalls.filter(c => phaseOf(c.at) !== 'setup' && phaseOf(c.at) !== 'end');
const summary = {
  label: LABEL, rounds: ROUNDS, programs: apps.map(a => a.name), switches: steps.length,
  flashes: { total: flashes.filter(f => f.phase !== 'setup').length, byPhase: count(flashes.filter(f => f.phase !== 'setup'), 'phase'), byWindow: count(flashes.filter(f => f.phase !== 'setup').map(f => ({ w: nm(Number(f.hwnd)) })), 'w'),
    byCause: count(flashes.filter(f => f.phase !== 'setup'), 'cause'), neverCleared: flashes.filter(f => !f.clearedBy).map(f => `${f.at} ${nm(Number(f.hwnd))} (${f.phase})`),
    setupPhase: flashes.filter(f => f.phase === 'setup').length, otherWindows: fl.filter(e => e.kind === 'FLASH' && !ours.has(e.hwnd)).length,
    duringQuiet10s: count(flashesInQuiet.map(f => ({ w: nm(Number(f.hwnd)) })), 'w'), highlightedAfterQuiet },
  foreground: { calls: measured.length, byStep: count(measured, 'how'), firstCallRefused: measured.filter(c => c.refusedFirst).length,
    refusedAndFlashed: measured.filter(c => c.refusedFirst && flashes.some(f => f.hwnd === c.target && ms(f.at) >= c.start - 5 && ms(f.at) <= c.end + 5)).length,
    acceptedButFlashed: measured.filter(c => !c.refusedFirst && flashes.some(f => f.hwnd === c.target && ms(f.at) >= c.start - 5 && ms(f.at) <= c.end + 5)).length,
    mismatchRightAfterCall: measured.filter(c => c.mismatch).length },
  steps: { ok: steps.filter(s => s.ok).length, bad: steps.filter(s => !s.ok).map(s => `${s.phase}/${s.how}: expect ${s.expect} visible ${s.visible} fg ${s.fg}`), hiddenFocus: steps.filter(s => s.hiddenFocus).length },
  hostStats: stats.foreground,
};
fs.writeFileSync(path.join(work, `flash-${LABEL}.json`), JSON.stringify({ summary, steps, flashes, fgCalls }, null, 1));
console.log(JSON.stringify(summary, null, 1));
process.exit(0);
