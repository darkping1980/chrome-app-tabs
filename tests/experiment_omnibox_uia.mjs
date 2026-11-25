// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// Experiment: what does an out-of-process UIA focus listener see when the user clicks Chrome's omnibox,
// presses Esc, and clicks back into the page? (isolated temp-profile Chrome only)
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, launchChrome, sleep, probe, pj } from './lib.mjs';

const work = path.resolve(process.argv[2]);
const { proc, cdp } = launchChrome(path.join(work, 'chrome'), 2000, 60, 1600, 1000);
await sleep(2500);
const chrome = pj('find', 'Chrome_WidgetWin_1', 'WEB PAGE', proc.pid)[0].hwnd;
const cr = pj('info', chrome).rect;
console.log('chrome pid', proc.pid, 'hwnd', chrome);
const uia = spawn(path.join(ROOT, 'tests', 'bin', 'uiafocus.exe'), ['25']);
let log = '';
uia.stdout.on('data', d => { log += d; });
await sleep(2000);
const step = async (name, fn) => { console.log('--', name, Date.now() % 100000); fn(); await sleep(1500); };
await step('focus chrome', () => probe('focus', chrome));
await step('click page', () => probe('click', cr[0] + 800, cr[1] + 500, chrome));
await step('click omnibox', () => probe('click', cr[0] + 500, cr[1] + 62, chrome));
await step('type', () => probe('type', chrome, 'exam'));
await step('esc esc', () => { probe('keys', chrome, 'esc'); probe('keys', chrome, 'esc'); });
await step('ctrl+l', () => probe('keys', chrome, 'ctrl+l'));
await step('click page again', () => probe('click', cr[0] + 800, cr[1] + 500, chrome));
await step('alt+d', () => probe('keys', chrome, 'alt+d'));
await step('f6', () => probe('keys', chrome, 'tab'));
await sleep(1000);
uia.kill();
console.log(log.split('\n').filter(l => l.includes('\t' + proc.pid + '\t') || l.startsWith('ready') || l.startsWith('err')).join('\n'));
console.log('(other-process focus lines omitted:', log.split('\n').filter(l => l && !l.includes('\t' + proc.pid + '\t')).length, ')');
await cdp.send('Browser.close').catch(() => {});
process.exit(0);
