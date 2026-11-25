// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// Focused drag-to-add check (isolated Chrome + isolated VS Code + DEV host). Prints the dev host's drag log.
import path from 'node:path';
import fs from 'node:fs';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { CODE, PROBE, launchChrome, sleep, probe, pj, waitFor, prepareTestExtension } from './lib.mjs';

const work = path.resolve(process.argv[2]);
const ext = prepareTestExtension(work);
const vsData = path.join(work, 'vscode-data'); fs.mkdirSync(path.join(vsData, 'User'), { recursive: true });
fs.writeFileSync(path.join(vsData, 'User', 'settings.json'), '{"workbench.startupEditor":"none","security.workspace.trust.enabled":false,"window.restoreWindows":"none","chat.disableAIFeatures":true,"workbench.tips.enabled":false}');
const ws = path.join(work, 'APPTABS_DQ_WS'); fs.mkdirSync(ws, { recursive: true });
spawn(CODE, ['--user-data-dir', vsData, '--extensions-dir', path.join(work, 'vscode-ext'), '--new-window', ws], { detached: true, stdio: 'ignore' }).unref();
const code = (await waitFor(() => pj('find', 'Chrome_WidgetWin_1', 'APPTABS_DQ_WS')[0], 30000, 300)).value;
await sleep(2500);
const { proc, cdp } = launchChrome(path.join(work, 'chrome-profile'), 2000, 60, 1600, 1000);
await sleep(2000);
const { id } = await cdp.send('Extensions.loadUnpacked', { path: ext });
await sleep(1500);
const sw = (await cdp.send('Target.getTargets')).targetInfos.find(t => t.type === 'service_worker' && t.url.includes(id));
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
const ev = (e) => cdp.eval(sessionId, e);
console.log('ping', JSON.stringify(await ev(`call('ping')`)));
const chrome = pj('find', 'Chrome_WidgetWin_1', 'WEB PAGE', proc.pid)[0].hwnd;
probe('setpos', code.hwnd, 2100, 300, 1400, 600); probe('focus', code.hwnd); await sleep(400); probe('keys', code.hwnd, 'esc'); await sleep(300);
const r = pj('info', code.hwnd).rect, c = pj('info', chrome).rect;
const from = [r[0] + 1050, r[1] + 15], to = [c[0] + 960, c[1] + 20];
const logFile = path.join(process.env.LOCALAPPDATA, 'ChromeAppTabs-dev', 'host.log');
const before = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').length : 0;
const samples = [];
const run = new Promise(res => execFile(PROBE, ['drag', from[0], from[1], to[0], to[1], 30, code.hwnd, 1200].map(String), (e, out) => res((out || '').trim())));
for (let i = 0; i < 20; i++) { samples.push(await ev(`call('stats')`)); await sleep(80); }
console.log('drag:', await run);
await sleep(1500);
console.log('highlight seen:', samples.some(s => s.highlight), 'dragging seen:', samples.some(s => s.dragging));
console.log('tabs:', JSON.stringify(await ev(`chrome.tabs.query({}).then(t=>t.map(x=>x.url.slice(0,60)))`)));
// after a drop: close the tab (program restored), then check that keyboard input still reaches the program
const t = (await ev(`chrome.tabs.query({}).then(t=>t.filter(x=>x.url.includes('/app.html#')).map(x=>x.id))`))[0];
if (t) await ev(`chrome.tabs.remove(${t})`);
await sleep(1200);
probe('focus', code.hwnd); await sleep(500);
console.log('fg', probe('fg'));
probe('keys', code.hwnd, 'ctrl+n'); await sleep(900);
probe('type', code.hwnd, 'kbcheck'); await sleep(800);
console.log('after Ctrl+N + typing ->', pj('info', code.hwnd).title);
console.log('--- dev host log');
console.log(fs.readFileSync(logFile, 'utf8').slice(before));
await cdp.send('Browser.close').catch(() => {});
execFileSync('taskkill', ['/pid', String(code.pid)]);
process.exit(0);
