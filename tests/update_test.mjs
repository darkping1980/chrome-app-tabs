// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// Install / update / rollback / uninstall test of the release package, fully sandboxed:
//   * install root under the work dir (NOT %LOCALAPPDATA%\ChromeAppTabs), test-only host name
//     com.kbj.chrome_app_tabs_upd, isolated temp-profile Chrome, isolated VS Code.
//   * v0.2.0 is built from its git tag. The only change made to it: its data folder name
//     (v0.2.0 always used %LOCALAPPDATA%\ChromeAppTabs, which belongs to the user's real installation).
// Usage: node tests/update_test.mjs <workDir> <path to ChromeAppTabs-vX.zip>
import path from 'node:path';
import fs from 'node:fs';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { ROOT, CODE, launchChrome, sleep, probe, pj, waitFor } from './lib.mjs';

const work = path.resolve(process.argv[2]);
const zip03 = path.resolve(process.argv[3]);
const R = path.join(work, 'install-root');
const H = 'com.kbj.chrome_app_tabs_upd';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };
const ps = (file, ...args) => {
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const readVer = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^﻿/, '')).version;
const hostVer = () => { try { return execFileSync(path.join(R, 'app', 'AppTabsHost.exe'), ['--version'], { encoding: 'utf8' }).trim(); } catch { return null; } };
const reg = () => { const r = spawnSync('reg', ['query', `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${H}`, '/ve'], { encoding: 'utf8' }); return r.status === 0 ? (r.stdout.match(/REG_SZ\s+(.+)/) || [])[1]?.trim() : null; };

// close isolated instances left by an aborted earlier run (matched by scratchpad markers only), then start clean
execFileSync('powershell', ['-NoProfile', '-c', "Get-CimInstance Win32_Process | ? { ($_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*--user-data-dir=*scratchpad*chrome-profile*' -and $_.CommandLine -notlike '*--type=*') -or ($_.Name -eq 'Code.exe' -and $_.CommandLine -like '*scratchpad*vscode-data*' -and $_.CommandLine -notlike '*--type=*') } | % { taskkill /pid $_.ProcessId | Out-Null }; Get-CimInstance Win32_Process -Filter \"Name='AppTabsHost.exe'\" | ? { $_.ExecutablePath -like '*scratchpad*install-root*' } | % { Stop-Process -Id $_.ProcessId -Force }"]);
await sleep(1500);
if (!H.endsWith('_upd')) throw new Error('refusing to touch a non-test host key');
spawnSync('reg', ['delete', ['HKCU', 'Software', 'Google', 'Chrome', 'NativeMessagingHosts', H].join('\\'), '/f']);
fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });

// ---------- packages ----------
const src02 = path.join(work, 'v0.2.0-src'); fs.mkdirSync(src02);
execFileSync('bash', ['-c', `git -C "${ROOT.replace(/\\/g, '/')}" archive v0.2.0 extension host | tar -x -C "${src02.replace(/\\/g, '/')}"`]);
const cs = path.join(src02, 'host', 'AppTabsHost.cs');
{ // SAFETY: the old host must never use the real data folder (it would restore windows of the user's installation)
  const before = fs.readFileSync(cs, 'utf8'), after = before.replace('"ChromeAppTabs");', '"ChromeAppTabs-updtest");');
  if (after === before || after.includes('"ChromeAppTabs");')) { console.error('ABORT: could not isolate the v0.2.0 data folder'); process.exit(2); }
  fs.writeFileSync(cs, after);
}
const b02 = ps(path.join(src02, 'host', 'build.ps1'));
const pkg02 = path.join(work, 'pkg02'); fs.mkdirSync(path.join(pkg02, 'app'), { recursive: true });
fs.copyFileSync(path.join(src02, 'host', 'bin', 'AppTabsHost.exe'), path.join(pkg02, 'app', 'AppTabsHost.exe'));
fs.cpSync(path.join(src02, 'extension'), path.join(pkg02, 'app', 'extension'), { recursive: true });
for (const f of ['setup.ps1', 'uninstall.ps1', 'check.ps1']) fs.copyFileSync(path.join(ROOT, 'install', f), path.join(pkg02, f));
check('P1. v0.2.0 package built from git tag (data folder isolated)', b02.code === 0 && readVer(path.join(pkg02, 'app', 'extension')) === '0.2.0', b02.out.trim().split('\n').pop());
const pkg03Parent = path.join(work, 'pkg03'); fs.mkdirSync(pkg03Parent);
const ex = ps(path.join(ROOT, 'tests', 'expand-zip.ps1'), zip03, pkg03Parent);
const pkg03 = path.join(pkg03Parent, fs.readdirSync(pkg03Parent)[0]);
check('P2. v0.3.0 release zip extracted', ex.code === 0 && readVer(path.join(pkg03, 'app', 'extension')) === '0.3.0', pkg03);

// ---------- 1. fresh install of v0.2.0 ----------
let r = ps(path.join(pkg02, 'setup.ps1'), '-InstallRoot', R, '-HostName', H, '-Yes');
check('I1. fresh install (v0.2.0)', r.code === 0 && hostVer() === '0.2.0' && reg() === path.join(R, 'app', `${H}.json`), `exit=${r.code} host=${hostVer()} reg=${reg()}`);

// isolated VS Code + Chrome using the INSTALLED extension folder
const vsData = path.join(work, 'vscode-data'); fs.mkdirSync(path.join(vsData, 'User'), { recursive: true });
fs.writeFileSync(path.join(vsData, 'User', 'settings.json'), '{"workbench.startupEditor":"none","security.workspace.trust.enabled":false,"window.restoreWindows":"none","chat.disableAIFeatures":true}');
const ws = path.join(work, 'APPTABS_UPD_WS'); fs.mkdirSync(ws);
spawn(CODE, ['--user-data-dir', vsData, '--extensions-dir', path.join(work, 'vscode-ext'), '--new-window', ws], { detached: true, stdio: 'ignore' }).unref();
const code = (await waitFor(() => pj('find', 'Chrome_WidgetWin_1', 'APPTABS_UPD_WS')[0], 30000, 300)).value;
await sleep(2500);
probe('setpos', code.hwnd, 2150, 250, 1000, 600); await sleep(300);
const codeOriginal = pj('info', code.hwnd).rect;
const { proc, cdp } = launchChrome(path.join(work, 'chrome-profile'), 2000, 60, 1600, 1000);
await sleep(2000);
const extDir = path.join(R, 'app', 'extension');
let { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: extDir });
const swSession = async () => {
  const t = await waitFor(async () => (await cdp.send('Target.getTargets')).targetInfos.find(x => x.type === 'service_worker' && x.url.includes(extId)), 10000, 200);
  return (await cdp.send('Target.attachToTarget', { targetId: t.value.targetId, flatten: true })).sessionId;
};
let sw = await swSession();
const ev = (e) => cdp.eval(sw, e);
const chrome = pj('find', 'Chrome_WidgetWin_1', 'WEB PAGE', proc.pid)[0].hwnd;
const content = () => JSON.parse(probe('content', chrome));
const shown = async () => (await waitFor(() => { const c = content(); const x = pj('info', code.hwnd).rect; return c && JSON.stringify(c) === JSON.stringify(x); }, 4000)).value;
check('I2. installed v0.2.0 extension talks to its host', (await ev(`call('ping')`)).version === '0.2.0');
await ev(`handle({type:'setSettings', settings:{peek:false, mode:'zorder'}})`);
const win = (await ev(`call('list',{}).then(r=>r.windows)`)).find(w => w.hwnd === code.hwnd);
const added = await ev(`chrome.windows.getAll().then(ws=>handle({type:'add', win:${JSON.stringify(win)}, windowId:ws[0].id}))`);
await ev(`handle({type:'rename', app:'${added.id}', name:'My Code'})`);
check('I3. v0.2.0: VS Code added as a tab and shown', await shown());

// ---------- 2. update to v0.3.0 while the host is running ----------
const hostPidsBefore = execFileSync('powershell', ['-NoProfile', '-c', `(Get-CimInstance Win32_Process -Filter "Name='AppTabsHost.exe'" | ? { $_.ExecutablePath -like '${R}*' }).ProcessId -join ','`], { encoding: 'utf8' }).trim();
r = ps(path.join(pkg03, 'setup.ps1'), '-InstallRoot', R, '-HostName', H, '-Yes');
const backups = fs.existsSync(path.join(R, 'backup')) ? fs.readdirSync(path.join(R, 'backup')) : [];
check('U1. update 0.2.0 -> 0.3.0 with the host running (only App Tabs host stopped)', r.code === 0 && /업데이트 0\.2\.0 -> 0\.3\.0/.test(r.out) && hostVer() === '0.3.0' && readVer(extDir) === '0.3.0',
  `exit=${r.code}; stopped host pids ${hostPidsBefore}; host=${hostVer()} ext=${readVer(extDir)}`);
check('U2. same extension folder and registry path kept, backup of 0.2.0 made', reg() === path.join(R, 'app', `${H}.json`) && backups.some(b => b.startsWith('app-0.2.0-')), backups.join(','));
const back = await waitFor(() => JSON.stringify(pj('info', code.hwnd).rect) === JSON.stringify(codeOriginal), 4000);
check('U3. VS Code restored (not closed) when the old host was stopped', back.value && pj('info', code.hwnd).exists, JSON.stringify(pj('info', code.hwnd).rect));
check('U4. setup told the user to press reload once', /새로고침\(↻\)/.test(r.out));

// the old (still loaded) 0.2.0 extension keeps working with the new 0.3.0 host until it is reloaded
await sleep(500);
const appTab = (await cdp.send('Target.getTargets')).targetInfos.find(t => t.type === 'page' && t.url.includes('/app.html#'));
const webTab = (await cdp.send('Target.getTargets')).targetInfos.find(t => t.type === 'page' && t.url.startsWith('data:'));
await cdp.send('Target.activateTarget', { targetId: webTab.targetId }); await sleep(400);
await cdp.send('Target.activateTarget', { targetId: appTab.targetId });
check('U5. before reload: old extension + new host still work', await shown() && (await ev(`call('ping')`)).version === '0.3.0');

// ---------- 3. "reload" the unpacked extension (CDP loadUnpacked on the same path = reload) ----------
const re = await cdp.send('Extensions.loadUnpacked', { path: extDir });
await sleep(2000);
extId = re.id; sw = await swSession();
const s3 = await ev(`Promise.all([getSettings(), getBindings(), chrome.runtime.getManifest().version])`);
check('U6. after reload: same extension ID, version 0.3.0', re.id === 'bahmlmpijalpgcnbnkgplggendgjhdlk' && s3[2] === '0.3.0', `${re.id} v${s3[2]}`);
check('U7. user settings kept across the update', s3[0].peek === false && s3[0].dragAdd === true, JSON.stringify(s3[0]));
check('U8. connection info kept across the update', s3[1][added.id] && s3[1][added.id].name === 'My Code', JSON.stringify(Object.values(s3[1]).map(b => b.name)));
// open the popup page; reopen the tab if the reload closed it
const tabsNow = (await cdp.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page' && t.url.includes('/app.html#'));
const popT = await cdp.send('Target.createTarget', { url: `chrome-extension://${extId}/popup.html` });
const popS = (await cdp.send('Target.attachToTarget', { targetId: popT.targetId, flatten: true })).sessionId;
await waitFor(async () => (await cdp.eval(popS, `document.querySelector('#host') && document.querySelector('#host').textContent`) || '').includes('연결됨'), 6000, 200);
const pv = await cdp.eval(popS, `({note: !document.querySelector('#updateNote').hidden, btns: [...document.querySelectorAll('#apps button')].map(b=>b.textContent)})`);
check('U9. popup: no update notice when extension and host match', pv.note === false, JSON.stringify(pv));
if (!tabsNow.length) {
  await cdp.eval(popS, `[...document.querySelectorAll('#apps button')].find(b=>b.textContent==='탭 다시 열기').click(), true`);
  check('U10. reload closed the app tab -> "탭 다시 열기" reconnects VS Code', await shown(), 'tab was closed by the reload');
} else {
  await cdp.send('Target.activateTarget', { targetId: tabsNow[0].targetId });
  check('U10. app tab survived the reload and reconnects', await shown(), 'tab kept');
}
await cdp.send('Target.closeTarget', { targetId: popT.targetId }).catch(() => {});

// update notice: simulate "files updated on disk, extension not reloaded yet" with an older manifest version
const mf = path.join(extDir, 'manifest.json'); const mfOrig = fs.readFileSync(mf, 'utf8');
fs.writeFileSync(mf, mfOrig.replace('"version": "0.3.0"', '"version": "0.2.9"'));
await cdp.send('Extensions.loadUnpacked', { path: extDir }); await sleep(2000); sw = await swSession();
const pop2 = await cdp.send('Target.createTarget', { url: `chrome-extension://${extId}/popup.html` });
const pop2S = (await cdp.send('Target.attachToTarget', { targetId: pop2.targetId, flatten: true })).sessionId;
const note = await waitFor(async () => cdp.eval(pop2S, `document.querySelector('#updateNote') && !document.querySelector('#updateNote').hidden ? document.querySelector('#updateNote').innerText : null`), 6000, 200);
check('U11. popup shows the reload notice when host and extension versions differ', note.value && note.value.includes('새로고침'), (note.value || '').replace(/\s+/g, ' ').slice(0, 90));
await cdp.send('Target.closeTarget', { targetId: pop2.targetId }).catch(() => {});
fs.writeFileSync(mf, mfOrig);
await cdp.send('Extensions.loadUnpacked', { path: extDir }); await sleep(1500);

// ---------- 4. downgrade guard, rollback on failure, package integrity ----------
r = ps(path.join(pkg02, 'setup.ps1'), '-InstallRoot', R, '-HostName', H, '-Yes');
check('F1. installing an older package is refused without -AllowDowngrade', r.code !== 0 && hostVer() === '0.3.0', `exit=${r.code}`);
r = ps(path.join(pkg02, 'setup.ps1'), '-InstallRoot', R, '-HostName', H, '-Yes', '-AllowDowngrade');
check('F2. explicit downgrade to 0.2.0 works', r.code === 0 && hostVer() === '0.2.0' && readVer(extDir) === '0.2.0', `exit=${r.code}`);
r = ps(path.join(pkg03, 'setup.ps1'), '-InstallRoot', R, '-HostName', H, '-Yes', '-SimulateFailure');
check('F3. update that fails midway -> previous version (0.2.0) restored automatically', r.code !== 0 && /복구/.test(r.out) && hostVer() === '0.2.0' && readVer(extDir) === '0.2.0' && reg() === path.join(R, 'app', `${H}.json`),
  `exit=${r.code}; host=${hostVer()} ext=${readVer(extDir)} reg ok=${reg() === path.join(R, 'app', `${H}.json`)}`);
const bad = path.join(work, 'pkg03-corrupt'); fs.cpSync(pkg03, bad, { recursive: true });
fs.appendFileSync(path.join(bad, 'app', 'extension', 'popup.js'), '\n// tampered\n');
r = ps(path.join(bad, 'setup.ps1'), '-InstallRoot', R, '-HostName', H, '-Yes');
check('F4. corrupted package is rejected before anything changes', r.code !== 0 && /손상/.test(r.out) && hostVer() === '0.2.0', `exit=${r.code}`);
r = ps(path.join(pkg03, 'setup.ps1'), '-InstallRoot', R, '-HostName', H, '-Yes');
check('F5. update 0.2.0 -> 0.3.0 again succeeds', r.code === 0 && hostVer() === '0.3.0', `exit=${r.code}`);
r = ps(path.join(pkg03, 'check.ps1'), '-InstallRoot', R, '-HostName', H);
check('F6. check.ps1 after update: all OK', r.code === 0, r.out.trim().split('\n').pop());

// ---------- 5. uninstall ----------
r = ps(path.join(pkg03, 'uninstall.ps1'), '-InstallRoot', R, '-HostName', H, '-StopHost', '-Purge');
check('X1. uninstall: registry key and install folder removed', r.code === 0 && reg() === null && !fs.existsSync(R), `exit=${r.code}`);
check('X2. VS Code still running at its original placement', pj('info', code.hwnd).exists && JSON.stringify(pj('info', code.hwnd).rect) === JSON.stringify(codeOriginal), JSON.stringify(pj('info', code.hwnd).rect));

await cdp.send('Browser.close').catch(() => {});
execFileSync('taskkill', ['/pid', String(code.pid)]);
fs.writeFileSync(path.join(work, 'update_results.json'), JSON.stringify(results, null, 1));
console.log(`\n${results.filter(x => x.ok).length}/${results.length} passed`);
process.exit(0);
