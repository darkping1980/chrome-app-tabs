// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
const $ = (s) => document.querySelector(s);
const send = (m) => chrome.runtime.sendMessage(m).then(r => { if (!r.ok) throw new Error(r.error); return r.result; });
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); kids.forEach(k => e.append(k)); return e; };

async function loadHost() {
  try {
    const r = await send({ type: 'ping' });
    $('#host').textContent = `호스트 v${r.version} 연결됨`; $('#host').className = 'badge ok';
    const mine = chrome.runtime.getManifest().version;
    if (r.version !== mine) { // files were updated on disk but this extension has not been reloaded yet
      $('#updateText').textContent = `(확장 v${mine} 실행 중, 설치된 버전 v${r.version})`;
      $('#updateNote').hidden = false;
    }
    return true;
  }
  catch (e) { $('#host').textContent = '호스트 연결 실패'; $('#host').className = 'badge bad'; $('#err').textContent = '네이티브 호스트에 연결할 수 없습니다: ' + e.message + '\ninstall\\install.ps1 을 실행했는지 확인하세요.'; return false; }
}

async function loadWindows() {
  const cur = await chrome.windows.getCurrent();
  const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  $('#win').innerHTML = '';
  wins.forEach((w, i) => {
    const t = (w.tabs.find(t => t.active) || {}).title || '';
    $('#win').add(new Option(`창 ${i + 1}: ${t.slice(0, 32)}${w.id === cur.id ? ' (현재)' : ''}`, w.id, false, w.id === cur.id));
  });
}

async function loadApps() {
  const apps = await send({ type: 'apps' });
  const ul = $('#apps'); ul.innerHTML = '';
  if (!apps.length) { ul.append(el('li', { className: 'empty', textContent: '아직 추가한 프로그램이 없습니다.' })); return apps; }
  for (const a of apps) {
    const img = el('img', { src: a.icon || '' });
    const name = el('input', { type: 'text', className: 'name', value: a.name, title: 'Enter로 이름 저장' });
    const save = () => { if (name.value.trim() && name.value.trim() !== a.name) send({ type: 'rename', app: a.id, name: name.value }).then(() => { a.name = name.value.trim(); }); };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { save(); name.blur(); } });
    name.addEventListener('change', save);
    const status = a.lost ? ['연결 끊김', 'bad'] : !a.tabId ? ['탭 없음', 'warn'] : a.tabActive ? ['표시 중', 'ok'] : ['대기', ''];
    const info = el('div', { className: 'p', textContent: `${a.process || ''}.exe · pid ${a.pid}` });
    const go = a.tabId || a.lost
      ? el('button', { textContent: '이동', disabled: !a.tabId, onclick: () => send({ type: 'focusTab', tabId: a.tabId }).then(() => window.close()) })
      : el('button', { textContent: '탭 다시 열기', onclick: () => send({ type: 'reopen', app: a.id, windowId: Number($('#win').value) }).then(() => window.close()) });
    const off = el('button', { textContent: '연결 해제', title: '탭을 닫고 프로그램을 원래 위치로 되돌립니다 (프로그램은 종료되지 않음)',
      onclick: () => send({ type: 'disconnect', app: a.id, tabId: a.tabId }).then(refreshAll) });
    ul.append(el('li', {}, img, el('div', { className: 'grow' }, name, info), el('span', { className: 'badge ' + status[1], textContent: status[0] }), go, off));
  }
  return apps;
}

async function loadCandidates(apps) {
  const ul = $('#candidates'); ul.innerHTML = '<li class="empty">불러오는 중…</li>';
  let wins;
  try { wins = await send({ type: 'list' }); }
  catch (e) { ul.innerHTML = ''; $('#err').textContent = e.message; return; }
  ul.innerHTML = '';
  const q = $('#q').value.trim().toLowerCase();
  if (q) wins = wins.filter(w => [w.title, w.process, w.description].some(s => (s || '').toLowerCase().includes(q)));
  const linked = new Set(apps.filter(a => !a.lost).map(a => a.hwnd));
  if (!wins.length) ul.append(el('li', { className: 'empty', textContent: '해당하는 실행 중인 창이 없습니다.' }));
  for (const w of wins) {
    const li = el('li', { className: linked.has(w.hwnd) ? 'linked' : '' },
      el('img', { src: w.icon || '' }),
      el('div', { className: 'grow' }, el('div', { className: 't', textContent: w.title }),
        el('div', { className: 'p', textContent: `${w.description ? w.description + ' · ' : ''}${w.process}.exe · pid ${w.pid}${linked.has(w.hwnd) ? ' · 이미 탭으로 연결됨' : ''}` })));
    li.onclick = async () => { await send({ type: 'add', win: w, windowId: Number($('#win').value) }); window.close(); };
    ul.append(li);
  }
}

async function loadSettings() {
  const s = await send({ type: 'getSettings' });
  $('#mode').value = s.mode; $('#peek').checked = !!s.peek; $('#dragAdd').checked = !!s.dragAdd;
  const cmds = await send({ type: 'commands' });
  $('#shortcuts').innerHTML = '';
  for (const c of cmds.filter(c => c.name !== '_execute_action'))
    $('#shortcuts').append(el('div', {}, el('kbd', { textContent: c.shortcut || '(지정 안 됨)' }), ' ' + c.description));
}

async function refreshAll() { const apps = await loadApps(); await loadCandidates(apps); }

$('#refresh').onclick = refreshAll;
let qTimer; $('#q').oninput = () => { clearTimeout(qTimer); qTimer = setTimeout(refreshAll, 200); };
$('#mode').onchange = () => send({ type: 'setSettings', settings: { mode: $('#mode').value } });
$('#peek').onchange = () => send({ type: 'setSettings', settings: { peek: $('#peek').checked } });
$('#dragAdd').onchange = () => send({ type: 'setSettings', settings: { dragAdd: $('#dragAdd').checked } });
$('#keys').onclick = () => send({ type: 'openShortcuts' });
$('#openExt').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });

(async () => {
  await loadWindows();
  await loadSettings();
  if (await loadHost()) await refreshAll(); else await loadApps();
})();
