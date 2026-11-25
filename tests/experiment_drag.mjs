// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// v0.3 feasibility: (1) does an out-of-context WinEvent hook see a real title-bar drag of another process' window?
// (2) can UI Automation give Chrome's tab strip rectangle (cost, accuracy, with/without bookmarks bar, maximized)?
// Isolated temp-profile Chrome + isolated VS Code only. No extension, no native host involved.
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { ROOT, CODE, launchChrome, sleep, probe, pj, waitFor } from './lib.mjs';

const work = path.resolve(process.argv[2]);
const DP = path.join(ROOT, 'tests', 'bin', 'dragprobe.exe');
const vsData = path.join(work, 'vscode-data'); fs.mkdirSync(path.join(vsData, 'User'), { recursive: true });
fs.writeFileSync(path.join(vsData, 'User', 'settings.json'), '{"workbench.startupEditor":"none","security.workspace.trust.enabled":false,"window.restoreWindows":"none","chat.disableAIFeatures":true,"workbench.tips.enabled":false}');
const ws = path.join(work, 'APPTABS_DRAG_WS'); fs.mkdirSync(ws, { recursive: true });
spawn(CODE, ['--user-data-dir', vsData, '--extensions-dir', path.join(work, 'vscode-ext'), '--new-window', ws], { detached: true, stdio: 'ignore' }).unref();
const code = (await waitFor(() => pj('find', 'Chrome_WidgetWin_1', 'APPTABS_DRAG_WS')[0], 30000, 300)).value;
await sleep(2500);
probe('setpos', code.hwnd, 2100, 450, 1400, 500);

const { proc, cdp } = launchChrome(path.join(work, 'chrome-profile'), 2000, 60, 1500, 900);
await sleep(2500);
const chrome = pj('find', 'Chrome_WidgetWin_1', 'WEB PAGE', proc.pid)[0].hwnd;
await cdp.send('Target.createTarget', { url: 'data:text/html,<title>SECOND TAB</title>2' }); await sleep(800);
const run = (args) => new Promise(r => { const p = spawn(DP, args); let o = ''; p.stdout.on('data', d => o += d); p.on('exit', () => r(o.trim())); });

console.log('chrome window', JSON.stringify(pj('info', chrome).rect), 'content', probe('content', chrome));
console.log('UIA tab strip (normal):', await run(['uia', chrome]));
probe('show', chrome, 3); await sleep(800); // maximize
console.log('chrome window (max)', JSON.stringify(pj('info', chrome).rect), 'content', probe('content', chrome));
console.log('UIA tab strip (maximized):', await run(['uia', chrome]));
probe('show', chrome, 9); await sleep(800);

// drag VS Code by its title bar onto Chrome's tab strip while a WinEvent hook watches
const watcher = spawn(DP, ['watch', '12']); let wlog = ''; watcher.stdout.on('data', d => wlog += d);
await sleep(800);
probe('focus', code.hwnd); await sleep(500); probe('keys', code.hwnd, 'esc'); await sleep(500);
const cr = pj('info', code.hwnd).rect, ch = pj('info', chrome).rect;
const from = [cr[0] + 1050, cr[1] + 15];              // VS Code custom title bar: empty gap between command center and layout buttons
const to = [ch[0] + 900, ch[1] + 20];                  // Chrome tab strip, right of the tabs (empty part)
probe('shot', path.join(work, 'titlebar.png'), cr[0], cr[1], cr[2] - cr[0], 40);
console.log('fg before drag', probe('fg'), 'at from', probe('at', from[0], from[1]));
const dr = probe('drag', from[0], from[1], to[0], to[1], 40, code.hwnd);
await sleep(600);
console.log('drag:', dr, 'VS Code now', JSON.stringify(pj('info', code.hwnd).rect));
await new Promise(r => watcher.on('exit', r));
console.log(wlog.split('\n').filter(l => l.includes('MOVESIZE') && l.includes(String(code.hwnd)) || l.startsWith('ready')).join('\n'));
await cdp.send('Browser.close').catch(() => {});
const { execFileSync } = await import('node:child_process');
execFileSync('taskkill', ['/pid', String(code.pid)]);
process.exit(0);
