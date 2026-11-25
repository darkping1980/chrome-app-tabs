// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// Smoke test: isolated Chrome loads the unpacked extension over CDP and reaches the native host.
import path from 'node:path';
import os from 'node:os';
import { ROOT, launchChrome, sleep, probe, prepareTestExtension } from './lib.mjs';

const work = process.argv[2] || path.join(os.tmpdir(), 'apptabs-test');
const extDir = process.argv[3] || prepareTestExtension(work); // default: dev copy -> dev host; or e.g. the installed copy
const { proc, cdp } = launchChrome(path.join(work, 'chrome-profile'), 2000, 80, 1500, 950);
try {
  await sleep(1500);
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extDir });
  console.log('extension id', id);
  await sleep(1000);
  const { targetInfos } = await cdp.send('Target.getTargets');
  const sw = targetInfos.find(t => t.type === 'service_worker' && t.url.includes(id));
  console.log('sw', sw && sw.url);
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
  console.log('ping', JSON.stringify(await cdp.eval(sessionId, `call('ping')`)));
  const list = await cdp.eval(sessionId, `call('list',{exeFilter:'Code'}).then(r=>r.windows.map(w=>({hwnd:w.hwnd,title:w.title,icon:!!w.icon})))`);
  console.log('list', JSON.stringify(list));
  console.log('chrome pid', proc.pid, probe('find', 'Chrome_WidgetWin_1', 'WEB PAGE'));
  const { pid } = await cdp.eval(sessionId, `call('ping')`);
  const { execFileSync } = await import('node:child_process');
  console.log('host exe', execFileSync('powershell', ['-NoProfile', '-c', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").ExecutablePath`], { encoding: 'utf8' }).trim());
  if (process.env.HOLD_MS) { console.log('holding'); await sleep(Number(process.env.HOLD_MS)); } // keep the host running for install/uninstall guard tests
} finally {
  await cdp.send('Browser.close').catch(() => proc.kill());
}
