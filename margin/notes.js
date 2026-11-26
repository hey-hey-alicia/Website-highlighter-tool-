const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let pages = []; // [{key, url, title, items, updated}]
let notice = '';

async function loadAll() {
  const all = await chrome.storage.local.get(null);
  pages = Object.entries(all)
    .filter(([k, v]) => k.startsWith('page:') && v && Array.isArray(v.items) && v.items.length)
    .map(([key, v]) => ({ key, ...v, updated: v.updated || Math.max(...v.items.map((i) => i.updated || 0)) }))
    .sort((a, b) => b.updated - a.updated);
  render();
}

// Link that makes Chrome scroll to the passage (text fragment), even before the extension re-highlights it.
function fragmentLink(url, quote) {
  const enc = (s) => encodeURIComponent(s).replace(/-/g, '%2D').replace(/,/g, '%2C');
  const q = quote.replace(/\s+/g, ' ').trim();
  const words = q.split(' ');
  const frag = words.length <= 8 ? enc(q) : enc(words.slice(0, 4).join(' ')) + ',' + enc(words.slice(-4).join(' '));
  return url + '#:~:text=' + frag;
}

function autosize(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }

async function updateItem(key, id, patch) {
  const cur = (await chrome.storage.local.get(key))[key];
  if (!cur) return;
  if (patch === null) cur.items = cur.items.filter((x) => x.id !== id);
  else cur.items = cur.items.map((x) => (x.id === id ? { ...x, ...patch, updated: Date.now() } : x));
  cur.updated = Date.now();
  if (cur.items.length) await chrome.storage.local.set({ [key]: cur });
  else await chrome.storage.local.remove(key);
}

function render() {
  const q = $('#q').value.trim().toLowerCase();
  const box = $('#pages');
  box.replaceChildren();
  let shownItems = 0, shownPages = 0;
  const total = pages.reduce((n, p) => n + p.items.length, 0);

  for (const p of pages) {
    const pageHit = !q || (p.title || '').toLowerCase().includes(q) || p.url.toLowerCase().includes(q);
    const items = pageHit ? p.items : p.items.filter((h) => (h.quote + ' ' + (h.note || '')).toLowerCase().includes(q));
    if (!items.length) continue;
    shownPages++; shownItems += items.length;

    const sec = el('section', 'page');
    const h2 = el('h2'); const a = el('a', null, p.title || p.url); a.href = p.url; a.target = '_blank'; h2.append(a);
    sec.append(h2, el('div', 'url', p.url));
    const list = el('div', 'items');
    for (const h of items) {
      const it = el('div', 'item');
      it.style.setProperty('--c', `var(--${h.color || 'yellow'})`);
      const quote = el('div', 'quote'); const qa = el('a', null, h.quote);
      qa.href = fragmentLink(p.url, h.quote); qa.target = '_blank'; quote.append(qa);
      const note = el('textarea', 'note'); note.rows = 1; note.value = h.note || ''; note.placeholder = 'Add a note…';
      const meta = el('div', 'meta');
      const status = el('span');
      meta.append(el('span', null, new Date(h.updated || h.created).toLocaleString()), status, el('span', 'spacer'));
      const del = el('button', 'link danger', 'Delete');
      del.onclick = async () => { await updateItem(p.key, h.id, null); };
      meta.append(del);
      note.addEventListener('input', () => autosize(note));
      note.addEventListener('change', async () => {
        await updateItem(p.key, h.id, { note: note.value });
        status.textContent = 'Saved'; status.className = 'saved';
        setTimeout(() => { status.textContent = ''; }, 1500);
      });
      it.append(quote, note, meta);
      list.append(it);
      requestAnimationFrame(() => autosize(note));
    }
    sec.append(list);
    box.append(sec);
  }
  $('#stats').textContent = notice || (q
    ? `${shownItems} match${shownItems === 1 ? '' : 'es'} on ${shownPages} page${shownPages === 1 ? '' : 's'}`
    : `${total} highlight${total === 1 ? '' : 's'} on ${pages.length} page${pages.length === 1 ? '' : 's'}`);
  if (!shownItems) box.append(el('div', 'empty', q ? 'Nothing matches that search.' : 'No highlights yet. Select text on any web page to start.'));
}

$('#q').addEventListener('input', () => { notice = ''; render(); });

$('#export').addEventListener('click', async () => {
  const all = await chrome.storage.local.get(null);
  const data = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith('page:')));
  const blob = new Blob([JSON.stringify({ app: 'margin-notes', version: 1, exported: new Date().toISOString(), pages: data }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `margin-notes-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

$('#import').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  let parsed;
  try { parsed = JSON.parse(await f.text()); } catch { notice = 'That file isn’t a valid Margin backup.'; render(); return; }
  const incoming = (parsed && parsed.pages) || {};
  const existing = await chrome.storage.local.get(Object.keys(incoming));
  const out = {};
  let added = 0;
  for (const [key, page] of Object.entries(incoming)) {
    if (!key.startsWith('page:') || !page || !Array.isArray(page.items)) continue;
    const cur = existing[key] || { url: page.url, title: page.title, items: [] };
    const byId = new Map(cur.items.map((h) => [h.id, h]));
    for (const h of page.items) {
      const mine = byId.get(h.id);
      if (!mine) added++;
      if (!mine || (h.updated || 0) > (mine.updated || 0)) byId.set(h.id, h);
    }
    out[key] = { ...cur, title: cur.title || page.title, items: [...byId.values()], updated: Date.now() };
  }
  notice = `Imported ${added} new highlight${added === 1 ? '' : 's'}.`;
  await chrome.storage.local.set(out);
  render();
});

chrome.storage.onChanged.addListener((_c, area) => { if (area === 'local' && !document.activeElement.matches('textarea')) loadAll(); });
loadAll();
