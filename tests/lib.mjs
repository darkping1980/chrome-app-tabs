// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// Shared helpers for the e2e test: isolated Chrome (temp profile, CDP over pipe) + probe.exe.
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROBE = path.join(ROOT, 'tests', 'bin', 'probe.exe');
export const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
export const CODE = path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe');
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function probe(...args) {
  try { return execFileSync(PROBE, args.map(String), { encoding: 'utf8' }).trim(); }
  catch (e) { return (e.stdout || '').trim() || 'ERR ' + e.message; }
}
export const pj = (...a) => JSON.parse(probe(...a));

export class Cdp {
  constructor(proc) {
    this.proc = proc; this.seq = 0; this.pending = new Map(); this.buf = ''; this.listeners = [];
    proc.stdio[4].on('data', (d) => {
      this.buf += d.toString('utf8');
      let i;
      while ((i = this.buf.indexOf('\0')) >= 0) {
        const msg = JSON.parse(this.buf.slice(0, i)); this.buf = this.buf.slice(i + 1);
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id); this.pending.delete(msg.id);
          msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
        } else this.listeners.forEach(l => l(msg));
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error('cdp timeout ' + method)); }, 30000);
    });
  }
  async eval(sessionId, expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

export function launchChrome(profileDir, x, y, w, h) {
  fs.mkdirSync(profileDir, { recursive: true });
  const proc = spawn(CHROME, [
    `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    `--window-position=${x},${y}`, `--window-size=${w},${h}`,
    'data:text/html,<title>WEB PAGE</title><body style="background:%23ff00ff"><h1>web page tab</h1>'],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  return { proc, cdp: new Cdp(proc) };
}

export async function waitFor(fn, timeout = 5000, step = 50) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const v = await fn(); if (v) return { value: v, ms: Date.now() - t0 }; await sleep(step); }
  return { value: null, ms: Date.now() - t0 };
}

// A copy of the extension that talks to the DEV native host (tests\dev-host.ps1), never to the installed one.
export function prepareTestExtension(work) {
  const dst = path.join(work, 'extension-under-test');
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'extension'), dst, { recursive: true });
  const bg = path.join(dst, 'background.js');
  const src = fs.readFileSync(bg, 'utf8');
  const out = src.replace("const HOST = 'com.kbj.chrome_app_tabs';", "const HOST = 'com.kbj.chrome_app_tabs_dev';");
  if (out === src) throw new Error('HOST constant not found in background.js');
  fs.writeFileSync(bg, out);
  // global shortcuts are system-wide: the installed copy owns Ctrl+Shift+7/8/9, so the test copy uses 4/5/6
  const mf = path.join(dst, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const keys = { 'toggle-app': 'Ctrl+Shift+4', 'prev-tab': 'Ctrl+Shift+5', 'next-tab': 'Ctrl+Shift+6' };
  for (const [k, v] of Object.entries(keys)) m.commands[k].suggested_key.default = v;
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  return dst;
}
