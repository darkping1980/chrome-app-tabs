// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// App Tabs - service worker.
// Chrome side only knows tabs; all window work is done by the native host (AppTabsHost.exe).
const HOST = 'com.kbj.chrome_app_tabs';
const APP_PAGE = chrome.runtime.getURL('app.html');
const DEFAULT_SETTINGS = { mode: 'zorder', peek: true, dragAdd: true };

let port = null;
let seq = 0;
const pending = new Map();

function connect() {
  if (port) return port;
  port = chrome.runtime.connectNative(HOST); // an open native port also keeps this MV3 worker alive
  port.onMessage.addListener(onHostMessage);
  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
    console.warn('[AppTabs] host disconnected', err);
    port = null;
    for (const p of pending.values()) p.reject(new Error('host disconnected: ' + err));
    pending.clear();
  });
  // a fresh host process starts with defaults: push the user's settings first
  getSettings().then(s => port && port.postMessage({ id: ++seq, cmd: 'setOptions', mode: s.mode, peek: String(s.peek), dragAdd: String(s.dragAdd) }));
  return port;
}

function call(cmd, args = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    try { connect().postMessage({ id, cmd, ...args }); } catch (e) { pending.delete(id); reject(e); return; }
    setTimeout(() => { if (pending.delete(id)) reject(new Error('host timeout: ' + cmd)); }, 8000);
  });
}

async function onHostMessage(m) {
  if (m.reply !== undefined) {
    const p = pending.get(m.reply);
    if (!p) return;
    pending.delete(m.reply);
    m.ok ? p.resolve(m) : p.reject(new Error(m.error));
    return;
  }
  if (m.evt === 'lost') await updateBinding(m.app, { lost: true });            // the external window was closed
  if (m.evt === 'peek') chrome.runtime.sendMessage({ type: 'peeked', app: m.app }).catch(() => {}); // app page shows a hint
  if (m.evt === 'dropAdd') onDropAdd(m).catch(e => console.warn('[AppTabs] dropAdd', e));
}

// a program window was dropped on a Chrome tab strip (detected by the host). Find that Chrome window among
// ours by its title (= active tab title) and bounds; a window of another profile/browser is simply ignored.
async function onDropAdd(m) {
  if (!(await getSettings()).dragAdd) return;
  const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  const title = m.chromeTitle || '';
  const cands = wins.filter(w => { const t = (w.tabs.find(t => t.active) || {}).title; return t && title.startsWith(t); });
  if (!cands.length) return;
  const [l, t, w, h] = m.chromeRectDip || [0, 0, 0, 0];
  const dist = (x) => Math.abs(x.left - l) + Math.abs(x.top - t) + Math.abs(x.width - w) + Math.abs(x.height - h);
  cands.sort((a, b) => dist(a) - dist(b));
  await handle({ type: 'add', win: m.win, windowId: cands[0].id }); // same path as the popup (duplicate check included)
}

// ---------- storage ----------
async function getSettings() { return { ...DEFAULT_SETTINGS, ...((await chrome.storage.local.get('settings')).settings || {}) }; }
async function getBindings() { return (await chrome.storage.local.get('bindings')).bindings || {}; }
async function updateBinding(id, patch) {
  const b = await getBindings();
  if (!b[id]) return null;
  b[id] = { ...b[id], ...patch };
  await chrome.storage.local.set({ bindings: b });
  return b[id];
}
async function removeBinding(id) { const b = await getBindings(); delete b[id]; await chrome.storage.local.set({ bindings: b }); }
async function sessionGet(k, d) { return (await chrome.storage.session.get(k))[k] ?? d; }
async function sessionSet(k, v) { await chrome.storage.session.set({ [k]: v }); }

function appIdFromUrl(url) {
  if (!url || !url.startsWith(APP_PAGE)) return null;
  return new URL(url).hash.slice(1) || null;
}
// Appended to the tab title; the host finds the Chrome HWND by this token in the window title.
// Encoded with zero-width characters so the tab shows only the program name (must match app.js).
const ZW = ['​', '‌', '‍', '⁠'];
const tokenFor = (id) => '⁣' + [...id].map(c => { const n = c.charCodeAt(0); return [6, 4, 2, 0].map(s => ZW[(n >> s) & 3]).join(''); }).join('');

// chrome-extension:// is not a valid match-pattern scheme for tabs.query({url}), so filter by hand
const appTabs = async () => (await chrome.tabs.query({})).filter(t => appIdFromUrl(t.url || t.pendingUrl));

async function ensureAttached(b) {
  if (!b || b.lost) return false;
  try { await call('attach', { app: b.id, hwnd: b.hwnd, token: tokenFor(b.id) }); }
  catch (e) {
    if (/window not found/.test(e.message)) { await updateBinding(b.id, { lost: true }); return false; } // e.g. after a reboot
    throw e;
  }
  return true;
}

// ---------- tab switching ----------
async function onTabActive(tabId, windowId) {
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return; }
  const id = appIdFromUrl(tab.url || tab.pendingUrl);
  const active = await sessionGet('activeApp', {});
  const prev = active[windowId];
  if (prev && prev !== id) await call('deactivate', { app: prev }).catch(e => console.warn(e));
  active[windowId] = id || null;
  await sessionSet('activeApp', active);
  if (id) {
    const b = (await getBindings())[id];
    if (await ensureAttached(b).catch(e => { console.warn(e); return false; }))
      await call('activate', { app: id }).catch(e => console.warn(e));
  }
}

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => { pushHistory(tabId, windowId); onTabActive(tabId, windowId); });

// recently used tabs per window (most recent last), for the "toggle" shortcut
async function pushHistory(tabId, windowId) {
  const h = await sessionGet('history', {});
  const l = (h[windowId] || []).filter(id => id !== tabId);
  l.push(tabId); h[windowId] = l.slice(-30);
  await sessionSet('history', h);
}

// remember tabId -> appId so we can detach on close (the tab URL is gone by then)
async function rememberTab(tab) {
  const id = appIdFromUrl(tab.url || tab.pendingUrl);
  const map = await sessionGet('tabApp', {});
  if (id) map[tab.id] = id; else delete map[tab.id];
  await sessionSet('tabApp', map);
}
chrome.tabs.onCreated.addListener(rememberTab);

// release the program: restore its original placement (never closes it)
async function release(tabId, windowId) {
  const map = await sessionGet('tabApp', {});
  const id = map[tabId];
  if (!id) return;
  delete map[tabId];
  await sessionSet('tabApp', map);
  if (windowId !== undefined) {
    const active = await sessionGet('activeApp', {});
    if (active[windowId] === id) { active[windowId] = null; await sessionSet('activeApp', active); }
  }
  await call('detach', { app: id }).catch(e => console.warn(e));
  await removeBinding(id);
}

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!info.url) { if (info.status === 'complete') rememberTab(tab); return; }
  const map = await sessionGet('tabApp', {});
  // the user typed a URL into the app tab's omnibox: the tab became a normal web tab
  if (map[tabId] && appIdFromUrl(info.url) !== map[tabId]) await release(tabId, tab.windowId);
  await rememberTab(tab);
});

chrome.tabs.onRemoved.addListener((tabId, { windowId }) => release(tabId, windowId));

// a tab dragged to another Chrome window: forget it in the old window
chrome.tabs.onDetached.addListener(async (tabId, { oldWindowId }) => {
  const map = await sessionGet('tabApp', {});
  const active = await sessionGet('activeApp', {});
  if (map[tabId] && active[oldWindowId] === map[tabId]) {
    active[oldWindowId] = null; await sessionSet('activeApp', active);
    await call('deactivate', { app: map[tabId] }).catch(() => {});
  }
});

// ---------- keyboard shortcuts (work even while the external program has focus: "global") ----------
async function goToTab(win, tab) {
  if (!tab) return;
  await chrome.tabs.update(tab.id, { active: true });
  // a web tab needs Chrome itself focused; an app tab gets the program focused by the host
  if (!appIdFromUrl(tab.url)) await chrome.windows.update(win.id, { focused: true });
}
async function switchTab(delta) {
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  const tabs = await chrome.tabs.query({ windowId: win.id });
  if (tabs.length < 2) return;
  const cur = tabs.findIndex(t => t.active);
  await goToTab(win, tabs[(cur + delta + tabs.length) % tabs.length]);
}
// app tab -> most recent web tab; web tab -> most recent app tab (or the first one) in the same window
async function toggleApp() {
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  const tabs = await chrome.tabs.query({ windowId: win.id });
  const cur = tabs.find(t => t.active);
  const wantApp = !appIdFromUrl(cur && cur.url);
  const hist = ((await sessionGet('history', {}))[win.id] || []).slice().reverse();
  const byId = new Map(tabs.map(t => [t.id, t]));
  const fits = (t) => t && t.id !== cur.id && !!appIdFromUrl(t.url) === wantApp;
  let target = hist.map(id => byId.get(id)).find(fits) || tabs.find(fits);
  await goToTab(win, target);
}
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'toggle-app') toggleApp();
  if (cmd === 'prev-tab') switchTab(-1);
  if (cmd === 'next-tab') switchTab(1);
});

// ---------- messages from popup / app page ----------
async function handle(msg, sender = {}) {
  switch (msg.type) {
    case 'list': return (await call('list', { exeFilter: msg.exeFilter || null })).windows;
    case 'add': {
      const w = msg.win;
      const all = await getBindings();
      // one tab per program window: focus the existing tab instead of creating a second one
      const existing = Object.values(all).find(b => b.hwnd === w.hwnd && !b.lost);
      if (existing) {
        const t = (await appTabs()).find(t => appIdFromUrl(t.url) === existing.id);
        if (t) { await chrome.tabs.update(t.id, { active: true }); await chrome.windows.update(t.windowId, { focused: true }); return { id: existing.id, tabId: t.id, existed: true }; }
      }
      const id = Math.random().toString(36).slice(2, 8);
      const b = { id, hwnd: w.hwnd, pid: w.pid, exe: w.exe, process: w.process, title: w.title, icon: w.icon,
                  name: (msg.name || w.description || w.process || 'App').slice(0, 60), lost: false, added: Date.now() };
      all[id] = b; await chrome.storage.local.set({ bindings: all });
      const tab = await chrome.tabs.create({ url: APP_PAGE + '#' + id, windowId: msg.windowId, active: true });
      return { id, tabId: tab.id };
    }
    case 'apps': { // bindings joined with their tabs, for the management UI
      const all = await getBindings();
      const tabs = await appTabs();
      return Object.values(all).map(b => {
        const t = tabs.find(t => appIdFromUrl(t.url) === b.id);
        return { ...b, tabId: t ? t.id : null, windowId: t ? t.windowId : null, tabActive: t ? t.active : false };
      });
    }
    case 'reopen': { // the binding survived but its tab is gone (e.g. closed by an extension reload after an update)
      const b = (await getBindings())[msg.app];
      if (!b) throw new Error('unknown app');
      const tab = await chrome.tabs.create({ url: APP_PAGE + '#' + b.id, windowId: msg.windowId, active: true });
      return { tabId: tab.id };
    }
    case 'focusTab': {
      const t = await chrome.tabs.get(msg.tabId);
      await chrome.tabs.update(t.id, { active: true });
      await chrome.windows.update(t.windowId, { focused: true });
      return true;
    }
    case 'disconnect': { // close the tab; release() restores the program
      if (msg.tabId) await chrome.tabs.remove(msg.tabId);
      else { await call('detach', { app: msg.app }).catch(() => {}); await removeBinding(msg.app); }
      return true;
    }
    case 'relink': { // program was restarted: point the tab at a new window
      const b = await updateBinding(msg.app, { hwnd: msg.win.hwnd, pid: msg.win.pid, title: msg.win.title, lost: false });
      await ensureAttached(b);
      if (sender.tab && sender.tab.active) await call('activate', { app: msg.app });
      return true;
    }
    case 'rename': return updateBinding(msg.app, { name: (msg.name || '').trim().slice(0, 60) || 'App' });
    case 'resume': // the app tab page got focus back (Esc in omnibox, click on the page)
      if (sender.tab && sender.tab.active) await call('resume', { app: msg.app }).catch(() => {});
      return true;
    case 'getSettings': return getSettings();
    case 'setSettings': {
      const s = { ...(await getSettings()), ...msg.settings };
      await chrome.storage.local.set({ settings: s });
      await call('setOptions', { mode: s.mode, peek: String(s.peek), dragAdd: String(s.dragAdd) });
      return s;
    }
    case 'openShortcuts': return chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    case 'commands': return chrome.commands.getAll();
    case 'stats': return call('stats');
    case 'ping': return call('ping');
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'peeked') return; // broadcast for app pages only
  handle(msg, sender).then(r => sendResponse({ ok: true, result: r }), e => sendResponse({ ok: false, error: String(e.message || e) }));
  return true;
});

// on worker start (browser start, extension reload): connect and re-sync visible app tabs
(async () => {
  try { await call('ping'); } catch (e) { console.warn('[AppTabs] host not available', e); return; }
  const tabs = await appTabs();
  const map = {};
  for (const t of tabs) map[t.id] = appIdFromUrl(t.url);
  await sessionSet('tabApp', map);
  for (const t of tabs) if (t.active) await onTabActive(t.id, t.windowId);
})();
