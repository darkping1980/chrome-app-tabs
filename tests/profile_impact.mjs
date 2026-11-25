// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// Does installing, using and removing App Tabs change a Chrome profile beyond what Chrome itself changes?
// Runs only on a throw-away profile (and an isolated VS Code). Three sessions on the same profile:
//   A: seed a cookie + a site localStorage value, then close           -> snapshot S0
//   B: control session (open/close, no extension)                       -> snapshot S1
//   C: load extension, add VS Code tab, switch, disconnect, uninstall   -> snapshot S2
// Compared: cookies, localStorage, bookmarks file, Preferences / Secure Preferences keys, extension traces.
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { ROOT, CODE, launchChrome, sleep, probe, pj, waitFor, prepareTestExtension } from './lib.mjs';

const work = path.resolve(process.argv[2]);
const prof = path.join(work, 'chrome-profile');
const EXT_DIR = prepareTestExtension(work); // talks to the DEV host only
const EXT_ID = 'bahmlmpijalpgcnbnkgplggendgjhdlk';
const out = [];
const log = (ok, name, detail = '') => { out.push({ ok, name, detail }); console.log(`${ok === null ? 'INFO' : ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };

async function session(fn) {
  const { proc, cdp } = launchChrome(prof, 2000, 60, 1400, 900);
  await sleep(2500);
  try { return await fn(cdp, proc); }
  finally { await cdp.send('Browser.close').catch(() => proc.kill()); await new Promise(r => proc.on('exit', r)); await sleep(1500); }
}
async function pageSession(cdp, url) {
  const { targetId } = await cdp.send('Target.createTarget', { url });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await sleep(1500);
  return { targetId, sessionId };
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(prof, 'Default', f), 'utf8')); } catch { return null; } };
const hash = (f) => { try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(prof, 'Default', f))).digest('hex').slice(0, 12); } catch { return 'absent'; } };
function flatKeys(o, p = '', acc = {}) {
  if (o && typeof o === 'object' && !Array.isArray(o)) for (const k of Object.keys(o)) flatKeys(o[k], p ? p + '.' + k : k, acc);
  else acc[p] = JSON.stringify(o);
  return acc;
}
function diffKeys(a, b) {
  const fa = flatKeys(a || {}), fb = flatKeys(b || {}), ch = new Set();
  for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) if (fa[k] !== fb[k]) ch.add(k.split('.').slice(0, 2).join('.'));
  return [...ch].sort();
}
async function snapshot(label) {
  // read cookies/localStorage through Chrome itself (the DB files are locked/encrypted)
  const data = await session(async (cdp) => {
    const { cookies } = await cdp.send('Storage.getCookies');
    const { sessionId } = await pageSession(cdp, 'https://example.com/');
    const ls = await cdp.eval(sessionId, `localStorage.getItem('apptabs-probe')`).catch(e => 'ERR ' + e.message);
    return { cookies: cookies.filter(c => c.name.startsWith('apptabs')).map(c => `${c.domain}|${c.name}=${c.value}`).sort(), ls };
  });
  return { label, ...data, prefs: readJson('Preferences'), secure: readJson('Secure Preferences'), bookmarks: hash('Bookmarks') };
}

fs.rmSync(prof, { recursive: true, force: true });
// A: seed user data
await session(async (cdp) => {
  await cdp.send('Storage.setCookies', { cookies: [{ name: 'apptabs_login', value: 'seed-123', domain: 'example.com', path: '/', expires: Date.now() / 1000 + 86400 * 30 }] });
  const { sessionId } = await pageSession(cdp, 'https://example.com/');
  await cdp.eval(sessionId, `localStorage.setItem('apptabs-probe', 'seed-ls'), true`);
});
const S0 = await snapshot('S0 after seeding');
// B: control session
await session(async (cdp) => { await pageSession(cdp, 'https://example.com/'); await sleep(1000); });
const S1 = await snapshot('S1 after control session');
// C: App Tabs session
const vsData = path.join(work, 'vscode-data'); fs.mkdirSync(path.join(vsData, 'User'), { recursive: true });
fs.writeFileSync(path.join(vsData, 'User', 'settings.json'), '{"workbench.startupEditor":"none","security.workspace.trust.enabled":false,"window.restoreWindows":"none"}');
const ws = path.join(work, 'APPTABS_PI_WS'); fs.mkdirSync(ws, { recursive: true });
spawn(CODE, ['--user-data-dir', vsData, '--extensions-dir', path.join(work, 'vscode-ext'), '--new-window', ws], { detached: true, stdio: 'ignore' }).unref();
const code = (await waitFor(() => pj('find', 'Chrome_WidgetWin_1', 'APPTABS_PI_WS')[0], 30000, 300)).value;
await sleep(2500);
const codeBefore = pj('info', code.hwnd).rect;
await session(async (cdp) => {
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: EXT_DIR });
  await sleep(1500);
  const sw = (await cdp.send('Target.getTargets')).targetInfos.find(t => t.type === 'service_worker' && t.url.includes(id));
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
  const w = (await cdp.eval(sessionId, `call('list',{exeFilter:'Code'}).then(r=>r.windows)`)).find(x => x.hwnd === code.hwnd);
  const win = await cdp.eval(sessionId, `chrome.windows.getAll().then(w=>w[0].id)`);
  const a = await cdp.eval(sessionId, `handle({type:'add', win:${JSON.stringify(w)}, windowId:${win}})`);
  await sleep(1500);
  const shown = pj('at', Math.round((pj('info', code.hwnd).rect[0] + pj('info', code.hwnd).rect[2]) / 2), Math.round((pj('info', code.hwnd).rect[1] + pj('info', code.hwnd).rect[3]) / 2)).hwnd === code.hwnd;
  log(shown, 'C: VS Code shown in the app tab of the seeded profile');
  await pageSession(cdp, 'https://example.com/');           // switch to a web tab and back
  const tabs = await cdp.eval(sessionId, `chrome.tabs.query({}).then(t=>t.map(x=>({id:x.id,url:x.url})))`);
  const appTab = tabs.find(t => t.url.includes('app.html'));
  await cdp.eval(sessionId, `chrome.tabs.update(${appTab.id},{active:true}).then(()=>true)`); await sleep(800);
  await cdp.eval(sessionId, `handle({type:'disconnect', app:'${a.id}', tabId:${appTab.id}})`); await sleep(800);
  await cdp.send('Extensions.uninstall', { id });
  await sleep(1500);
});
const S2 = await snapshot('S2 after App Tabs install/use/uninstall');
log(JSON.stringify(pj('info', code.hwnd).rect) === JSON.stringify(codeBefore), 'C: VS Code back at its original placement', JSON.stringify(pj('info', code.hwnd).rect));
execFileSync('taskkill', ['/pid', String(code.pid)]);

// ---- compare ----
log(S0.cookies.length === 1 && JSON.stringify(S0.cookies) === JSON.stringify(S2.cookies), 'cookies unchanged', JSON.stringify(S2.cookies));
log(S0.ls === 'seed-ls' && S2.ls === 'seed-ls', 'site localStorage unchanged', `${S0.ls} -> ${S2.ls}`);
log(S0.bookmarks === S2.bookmarks, 'Bookmarks file unchanged', `${S0.bookmarks} -> ${S2.bookmarks}`);
const ctrl = new Set([...diffKeys(S0.prefs, S1.prefs), ...diffKeys(S0.secure, S1.secure)]);
const withExt = [...new Set([...diffKeys(S1.prefs, S2.prefs), ...diffKeys(S1.secure, S2.secure)])];
const extra = withExt.filter(k => !ctrl.has(k));
log(null, 'Preferences keys Chrome changes by itself (control session)', [...ctrl].join(', '));
log(null, 'Preferences keys changed in the App Tabs session', withExt.join(', '));
log(null, 'changed only in the App Tabs session', extra.join(', ') || '(none)');
// Chrome itself keeps an empty `extensions.settings.<id>: {}` placeholder (+ its integrity MACs) after an uninstall
const entry = ((S2.secure || {}).extensions || {}).settings?.[EXT_ID] ?? ((S2.prefs || {}).extensions || {}).settings?.[EXT_ID];
const isEmpty = entry === undefined || (typeof entry === 'object' && Object.keys(entry).length === 0);
log(isEmpty, 'no extension data left in Preferences after uninstall (only Chrome\'s empty placeholder, if any)', entry === undefined ? 'no entry' : JSON.stringify(entry));
const extDirs = ['Local Extension Settings', 'Extension State', 'Sync Extension Settings'].map(d => path.join(prof, 'Default', d, EXT_ID)).filter(d => fs.existsSync(d));
log(extDirs.length === 0, 'no extension storage folder left after uninstall', extDirs.join(', ') || 'none');
fs.writeFileSync(path.join(work, 'profile_impact.json'), JSON.stringify(out, null, 1));
console.log(`\n${out.filter(r => r.ok === true).length} passed, ${out.filter(r => r.ok === false).length} failed, ${out.filter(r => r.ok === null).length} info`);
process.exit(0);
