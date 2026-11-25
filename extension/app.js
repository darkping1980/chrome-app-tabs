// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
const id = location.hash.slice(1);
const ZW = ['​', '‌', '‍', '⁠'];
const tokenFor = (i) => '⁣' + [...i].map(c => { const n = c.charCodeAt(0); return [6, 4, 2, 0].map(s => ZW[(n >> s) & 3]).join(''); }).join('');
const $ = (s) => document.querySelector(s);
const send = (m) => chrome.runtime.sendMessage(m).then(r => { if (!r.ok) throw new Error(r.error); return r.result; });

function render(b) {
  if (!b) { document.title = '연결 없음'; $('#name').textContent = '연결 정보가 없습니다'; $('#status').textContent = '이 탭은 닫아도 됩니다.'; return; }
  // the invisible token after the name is how the native host recognises this Chrome window (same encoding as background.js)
  document.title = b.name + tokenFor(b.id);
  $('#name').textContent = b.name;
  if (b.icon) { $('#fav').href = b.icon; $('#icon').src = b.icon; }
  $('#info').textContent = `${b.exe || ''} · pid ${b.pid}`;
  if (document.activeElement !== $('#rename')) $('#rename').value = b.name;
  $('#relink').hidden = !b.lost;
  $('#status').textContent = b.lost ? '프로그램 창을 찾을 수 없습니다.' : '이 탭이 활성화되면 연결된 프로그램 창이 이 영역에 표시됩니다.';
}

async function load() { render(((await chrome.storage.local.get('bindings')).bindings || {})[id]); }
chrome.storage.onChanged.addListener((c) => { if (c.bindings) render((c.bindings.newValue || {})[id]); });

// omnibox "peek": the host dropped the program behind Chrome; getting focus back (Esc / click) brings it back
chrome.runtime.onMessage.addListener((m) => { if (m.type === 'peeked' && m.app === id) document.body.classList.add('peeking'); });
function resume() {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return; // typing a new name here
  document.body.classList.remove('peeking');
  send({ type: 'resume', app: id }).catch(() => {});
}
window.addEventListener('focus', resume);
document.addEventListener('mousedown', (e) => { if (!e.target.closest('input,button,li')) resume(); });

$('#save').onclick = () => send({ type: 'rename', app: id, name: $('#rename').value });
$('#rename').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#save').click(); });
$('#off').onclick = async () => { const t = await chrome.tabs.getCurrent(); send({ type: 'disconnect', app: id, tabId: t.id }); };
$('#scan').onclick = async () => {
  const b = ((await chrome.storage.local.get('bindings')).bindings || {})[id];
  const wins = await send({ type: 'list', exeFilter: b.process || null });
  $('#cands').innerHTML = wins.length ? '' : '<li>창이 없습니다. 프로그램을 실행한 뒤 다시 시도하세요.</li>';
  for (const w of wins) {
    const li = document.createElement('li');
    li.textContent = `${w.title} (pid ${w.pid})`;
    li.onclick = () => send({ type: 'relink', app: id, win: w });
    $('#cands').appendChild(li);
  }
};
send({ type: 'commands' }).then(cmds => {
  $('#keys').textContent = cmds.filter(c => c.shortcut).map(c => `${c.shortcut} ${c.description}`).join(' · ') || '(지정 안 됨)';
}).catch(() => {});
load();
