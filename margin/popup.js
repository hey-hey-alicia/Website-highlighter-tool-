const normUrl = (u) => { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return u; } };
const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

$('#all').addEventListener('click', () => { chrome.tabs.create({ url: chrome.runtime.getURL('notes.html') }); window.close(); });

(async () => {
  const list = $('#list');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !/^(https?|file):/.test(tab.url)) {
    list.append(el('div', 'empty', 'Highlights work on regular web pages (not browser settings or the extension store).'));
    return;
  }
  const key = 'page:' + normUrl(tab.url);

  let applied = null;
  try { applied = new Set((await chrome.tabs.sendMessage(tab.id, { type: 'status' })).applied); } catch { applied = null; }

  async function render() {
    const data = (await chrome.storage.local.get(key))[key];
    const items = (data && data.items) || [];
    $('#count').textContent = items.length ? `· ${items.length}` : '';
    list.replaceChildren();
    if (applied === null) {
      list.append(el('div', 'empty', 'Reload this tab to start highlighting here (pages opened before installing need a refresh).'));
    }
    if (!items.length) {
      if (applied !== null) list.append(el('div', 'empty', 'No highlights on this page yet. Select some text to start.'));
      return;
    }
    for (const h of items) {
      const it = el('div', 'item');
      it.style.setProperty('--c', `var(--${h.color || 'yellow'})`);
      it.append(el('div', 'quote', h.quote));
      if (h.note) it.append(el('div', 'note', h.note));
      const meta = el('div', 'meta');
      meta.append(el('span', null, new Date(h.updated || h.created).toLocaleDateString()));
      if (applied && !applied.has(h.id)) meta.append(el('span', 'missing', 'not found on page'));
      meta.append(el('span', 'spacer'));
      if (applied && applied.has(h.id)) {
        const edit = el('button', 'link', 'Edit note');
        edit.onclick = async () => { await chrome.tabs.sendMessage(tab.id, { type: 'open-note', id: h.id }); window.close(); };
        const jump = el('button', 'link', 'Jump to');
        jump.onclick = async () => { await chrome.tabs.sendMessage(tab.id, { type: 'scroll-to', id: h.id }); window.close(); };
        meta.append(jump, edit);
      }
      const del = el('button', 'link danger', 'Delete');
      del.onclick = async () => {
        const cur = (await chrome.storage.local.get(key))[key];
        if (!cur) return;
        cur.items = cur.items.filter((x) => x.id !== h.id);
        if (cur.items.length) await chrome.storage.local.set({ [key]: cur });
        else await chrome.storage.local.remove(key);
        render();
      };
      meta.append(del);
      it.append(meta);
      list.append(it);
    }
  }
  render();
})();
