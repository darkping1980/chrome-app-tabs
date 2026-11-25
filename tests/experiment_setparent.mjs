// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// Method A experiment: re-parent an isolated VS Code window INTO an isolated Chrome window (SetParent, WS_CHILD)
// and observe rendering, hit-testing, input and responsiveness. Both apps are throw-away instances.
import path from 'node:path';
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { CODE, launchChrome, sleep, probe, pj, waitFor } from './lib.mjs';

const work = path.resolve(process.argv[2]);
const out = (k, v) => console.log(k.padEnd(34), typeof v === 'string' ? v : JSON.stringify(v));
const ws = path.join(work, 'APPTABS_SP_WS'); fs.mkdirSync(path.join(work, 'vsdata', 'User'), { recursive: true }); fs.mkdirSync(ws, { recursive: true });
fs.writeFileSync(path.join(work, 'vsdata', 'User', 'settings.json'), '{"workbench.startupEditor":"none","security.workspace.trust.enabled":false,"terminal.integrated.defaultProfile.windows":"Command Prompt"}');
spawn(CODE, ['--user-data-dir', path.join(work, 'vsdata'), '--extensions-dir', path.join(work, 'vsext'), '--new-window', ws], { detached: true, stdio: 'ignore' }).unref();
const code = (await waitFor(() => pj('find', 'Chrome_WidgetWin_1', 'APPTABS_SP_WS')[0], 30000, 300)).value;
await sleep(3000);
const { proc, cdp } = launchChrome(path.join(work, 'chrome'), 2000, 60, 1600, 1000);
await sleep(2500);
const chrome = pj('find', 'Chrome_WidgetWin_1', 'WEB PAGE', proc.pid)[0].hwnd;
const cr = pj('info', chrome).rect, content = JSON.parse(probe('content', chrome));
out('chrome / content', { cr, content });

// A1: child of Chrome's top-level frame, placed over the content area (client coordinates)
const x = content[0] - cr[0] - 8, y = content[1] - cr[1] - 8 + 8; // approx. client offset (8px frame on Win11)
out('SetParent(code, chrome)', probe('setparent', code.hwnd, chrome, content[0] - cr[0], content[1] - cr[1], content[2] - content[0], content[3] - content[1]));
await sleep(1500);
out('code parent rect (screen)', pj('info', code.hwnd).rect);
const mid = [Math.round((content[0] + content[2]) / 2), Math.round((content[1] + content[3]) / 2)];
out('hit-test at content centre', pj('at', ...mid));
out('responsive chrome', pj('responsive', chrome, 2000));
out('responsive code', pj('responsive', code.hwnd, 2000));
probe('shot', path.join(work, 'A1_child_of_chrome.png'), cr[0], cr[1], cr[2] - cr[0], cr[3] - cr[1]);
// keyboard: focus chrome frame then click into VS Code area and type into the terminal
probe('focus', chrome);
out('click into embedded VS Code', probe('click', mid[0], mid[1], chrome + ',' + code.hwnd));
await sleep(500);
out('foreground after click', pj('fg'));
// resize Chrome: does the embedded child follow? (it should not by itself: Chrome does not lay out foreign children)
probe('setpos', chrome, 2000, 60, 1300, 800); await sleep(800);
out('after Chrome resize: content', probe('content', chrome));
out('after Chrome resize: code rect', pj('info', code.hwnd).rect);
probe('shot', path.join(work, 'A1_after_resize.png'), 2000, 60, 1300, 800);
// switch tab inside Chrome (new tab) -> does Chrome hide the foreign child? (it has no idea it exists)
await cdp.send('Target.createTarget', { url: 'data:text/html,<body style="background:%2300ff00">second tab' });
await sleep(1000);
out('after Chrome tab switch: hit-test', pj('at', 2000 + 650, 60 + 400));
probe('shot', path.join(work, 'A1_after_tabswitch.png'), 2000, 60, 1300, 800);

// restore: back to a top-level window
out('SetParent(code, 0) restore', probe('setparent', code.hwnd, 0, 2100, 200, 1100, 700));
await sleep(800);
out('code after restore', pj('info', code.hwnd));
out('responsive code after restore', pj('responsive', code.hwnd, 2000));
await cdp.send('Browser.close').catch(() => {});
execFileSync('taskkill', ['/pid', String(code.pid)]);
process.exit(0);
