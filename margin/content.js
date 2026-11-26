// Margin — content script: selection toolbar, highlight anchoring, note card.
(() => {
  if (window.__marginNotesLoaded) return;
  window.__marginNotesLoaded = true;

  const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'];
  const SWATCH = { yellow: '#ffd43b', green: '#69db7c', blue: '#74c0fc', pink: '#f783ac', purple: '#b197fc' };
  const CTX = 40; // characters of context saved on each side of a highlight
  const MARK = 'margin-mark';
  const SKIP = 'script,style,noscript,textarea,template,select,svg,[contenteditable=""],[contenteditable="true"],#margin-notes-host';

  const normUrl = (u) => { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return u; } };
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const isWs = (c) => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f' || c === ' ';

  let pageKey = 'page:' + normUrl(location.href);
  let items = [];
  let alive = true; // false once the extension is reloaded/removed

  // ---------------------------------------------------------------- text index
  function buildIndex() {
    const nodes = [];
    const parts = [];
    let pos = 0;
    if (!document.body) return { nodes, text: '' };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || !n.nodeValue || p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push({ node: n, start: pos });
      parts.push(n.nodeValue);
      pos += n.nodeValue.length;
    }
    return { nodes, text: parts.join('') };
  }

  function rangeToOffsets(range, idx) {
    let start = -1, end = -1;
    for (const { node, start: ns } of idx.nodes) {
      if (!range.intersectsNode(node)) { if (start !== -1) break; continue; }
      const a = node === range.startContainer ? range.startOffset : 0;
      const b = node === range.endContainer ? range.endOffset : node.nodeValue.length;
      if (b > a) { if (start === -1) start = ns + a; end = ns + b; }
    }
    return start === -1 ? null : { start, end };
  }

  // ---------------------------------------------------------------- anchoring
  function ctxScore(actual, saved, fromEnd) {
    const n = Math.min(actual.length, saved.length);
    let s = 0;
    for (let i = 0; i < n; i++) {
      const a = fromEnd ? actual[actual.length - 1 - i] : actual[i];
      const b = fromEnd ? saved[saved.length - 1 - i] : saved[i];
      if (a !== b) break;
      s++;
    }
    return s;
  }

  function findBest(text, quote, prefix, suffix) {
    if (!quote) return -1;
    let best = -1, bestScore = -1;
    const max = prefix.length + suffix.length;
    for (let i = text.indexOf(quote); i !== -1; i = text.indexOf(quote, i + 1)) {
      const s = ctxScore(text.slice(Math.max(0, i - prefix.length), i), prefix, true) +
                ctxScore(text.slice(i + quote.length, i + quote.length + suffix.length), suffix, false);
      if (s > bestScore) { bestScore = s; best = i; if (s >= max) break; }
    }
    return best;
  }

  function normWithMap(s) {
    const out = [], map = [];
    let sp = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (isWs(c)) { if (sp) continue; sp = true; out.push(' '); }
      else { sp = false; out.push(c); }
      map.push(i);
    }
    return { out: out.join(''), map };
  }
  const normStr = (s) => (s || '').replace(/\s+/g, ' ');

  function locate(h, text, getNorm) {
    const i = findBest(text, h.quote, h.prefix || '', h.suffix || '');
    if (i !== -1) return { start: i, end: i + h.quote.length };
    // whitespace-tolerant fallback (page re-flowed or reformatted)
    const q = normStr(h.quote).trim();
    if (!q) return null;
    const norm = getNorm();
    const j = findBest(norm.out, q, normStr(h.prefix), normStr(h.suffix));
    if (j === -1) return null;
    return { start: norm.map[j], end: norm.map[j + q.length - 1] + 1 };
  }

  // ---------------------------------------------------------------- marks
  const marksFor = (id) => Array.from(document.querySelectorAll(`${MARK}[data-margin-id="${CSS.escape(id)}"]`));

  function styleMarks(h, marks) {
    marks.forEach((m, i) => {
      m.dataset.color = h.color || 'yellow';
      if (h.note) m.title = h.note; else m.removeAttribute('title');
      if (h.note && i === marks.length - 1) m.dataset.noteEnd = ''; else delete m.dataset.noteEnd;
    });
  }

  function wrapRange(start, end, h) {
    const idx = buildIndex();
    const targets = [];
    for (const { node, start: ns } of idx.nodes) {
      const ne = ns + node.nodeValue.length;
      if (ne <= start) continue;
      if (ns >= end) break;
      const a = Math.max(start, ns) - ns, b = Math.min(end, ne) - ns;
      if (b > a && node.nodeValue.slice(a, b).trim()) targets.push({ node, a, b });
    }
    const marks = [];
    for (const { node, a, b } of targets) {
      let n = node;
      if (b < n.nodeValue.length) n.splitText(b);
      if (a > 0) n = n.splitText(a);
      const m = document.createElement(MARK);
      m.dataset.marginId = h.id;
      n.parentNode.insertBefore(m, n);
      m.appendChild(n);
      marks.push(m);
    }
    styleMarks(h, marks);
    return marks;
  }

  function unwrapEl(m) {
    const p = m.parentNode;
    if (!p) return;
    while (m.firstChild) p.insertBefore(m.firstChild, m);
    p.removeChild(m);
  }

  // Bring the DOM in line with `items`: remove stale marks, restyle, anchor missing ones.
  function sync() {
    if (!document.body) return;
    const ids = new Set(items.map((h) => h.id));
    document.querySelectorAll(MARK).forEach((m) => { if (!ids.has(m.dataset.marginId)) unwrapEl(m); });
    let idx = null, norm = null;
    for (const h of items) {
      const existing = marksFor(h.id);
      if (existing.length) { styleMarks(h, existing); continue; }
      if (!idx) idx = buildIndex();
      const r = locate(h, idx.text, () => norm || (norm = normWithMap(idx.text)));
      if (r) wrapRange(r.start, r.end, h);
    }
    observer.takeRecords(); // ignore our own DOM changes
    render();
  }

  // Re-try when the page loads more content or re-renders (single-page apps etc.)
  let syncTimer = null;
  const observer = new MutationObserver(() => {
    if (!items.length) return;
    queueLayout();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { if (items.some((h) => !marksFor(h.id).length)) sync(); }, 700);
  });

  // ---------------------------------------------------------------- storage
  const SETTINGS = 'settings';
  let panelHidden = false;

  async function load() {
    try {
      const r = await chrome.storage.local.get([pageKey, SETTINGS]);
      items = (r[pageKey] && r[pageKey].items) || [];
      panelHidden = !!(r[SETTINGS] && r[SETTINGS].panelHidden);
    } catch { items = []; alive = false; }
    sync();
  }

  function save() {
    if (!alive) return;
    try {
      if (!items.length) { chrome.storage.local.remove(pageKey); return; }
      chrome.storage.local.set({
        [pageKey]: { url: normUrl(location.href), title: document.title || location.hostname, items, updated: Date.now() },
      });
    } catch { alive = false; }
  }

  function setPanelHidden(v) {
    panelHidden = v;
    render();
    try {
      chrome.storage.local.get(SETTINGS).then((r) =>
        chrome.storage.local.set({ [SETTINGS]: { ...(r[SETTINGS] || {}), panelHidden: v } }));
    } catch { alive = false; }
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[SETTINGS]) {
        const v = !!(changes[SETTINGS].newValue && changes[SETTINGS].newValue.panelHidden);
        if (v !== panelHidden) { panelHidden = v; render(); }
      }
      if (!changes[pageKey]) return;
      const nv = changes[pageKey].newValue;
      items = (nv && nv.items) || [];
      if (editingId && !items.some((h) => h.id === editingId)) { editingId = null; editTa = null; }
      sync();
    });
  } catch { alive = false; }

  // ---------------------------------------------------------------- UI (shadow DOM)
  let host, root, bar, panel, pill, pendingRange = null;
  let editingId = null, editTa = null, activeId = null;
  const cards = new Map(); // id -> card element
  const find = (id) => items.find((x) => x.id === id);
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  const CSS_UI = `
    :host { all: initial; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    * { box-sizing: border-box; font-family: inherit; }
    button { font: inherit; cursor: pointer; }

    /* selection toolbar */
    .bar { position: absolute; display: none; padding: 5px; gap: 4px; align-items: center; background: #1f1f23; color: #f1f1f3;
      border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.28); }
    .bar.show { display: flex; }
    .dot { width: 20px; height: 20px; border-radius: 50%; border: 2px solid transparent; padding: 0; }
    .dot:hover { transform: scale(1.12); }
    .dot.on { border-color: #1f1f23; box-shadow: 0 0 0 1px #fff inset; }
    .sep { width: 1px; height: 18px; background: rgba(255,255,255,.18); margin: 0 3px; }
    .bar .txt { background: transparent; color: inherit; border: 0; font-size: 13px; padding: 4px 8px; border-radius: 6px; white-space: nowrap; }
    .bar .txt:hover { background: rgba(255,255,255,.1); }

    /* side panel of note cards */
    .panel { position: fixed; top: 0; right: 4px; width: 320px; height: 100vh; pointer-events: none; overflow: hidden; }
    .nc { position: absolute; top: 0; left: 10px; right: 10px; pointer-events: auto; background: #fff; color: #1f1f23;
      border-radius: 12px; box-shadow: 0 2px 14px rgba(0,0,0,.11), 0 0 0 1px rgba(0,0,0,.06); }
    .nc:hover, .nc.editing { box-shadow: 0 4px 20px rgba(0,0,0,.16), 0 0 0 1px rgba(0,0,0,.08); }
    .nc.flash { box-shadow: 0 0 0 2px #e8590c, 0 4px 20px rgba(0,0,0,.16); }
    .hd { display: flex; align-items: center; gap: 8px; padding: 9px 8px 6px 14px; cursor: pointer; }
    .nc.collapsed .hd { padding-bottom: 9px; }
    .sw { width: 9px; height: 9px; border-radius: 50%; background: var(--c); flex: none; }
    .q { flex: 1; min-width: 0; font-size: 12.5px; color: #6b6b76; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ic { border: 0; background: none; width: 26px; height: 26px; border-radius: 7px; font-size: 17px; line-height: 1; color: #6b6b76; flex: none; }
    .ic:hover { background: #f1f1f3; color: #1f1f23; }
    .note { padding: 0 14px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 260px; overflow: auto; cursor: text; }
    .ft { display: flex; align-items: center; gap: 4px; padding: 8px 8px 9px 14px; font-size: 12px; color: #8a8a94; }
    .spacer { flex: 1; }
    .lnk { background: none; border: 0; color: #6b6b76; font-size: 12px; padding: 4px 7px; border-radius: 6px; }
    .lnk:hover { background: #f1f1f3; color: #1f1f23; }
    .lnk.danger:hover { color: #e03131; }
    .save { background: #1f1f23; color: #fff; border: 0; border-radius: 7px; padding: 5px 12px; font-size: 12.5px; font-weight: 600; }
    .save:hover { background: #000; }
    .ft .dot { width: 15px; height: 15px; }
    textarea { display: block; margin: 2px 12px 0; width: calc(100% - 24px); min-height: 76px; resize: vertical; outline: none;
      border: 1px solid #e3e3e8; border-radius: 9px; padding: 8px 10px; background: #f7f7f9; color: #1f1f23; font-size: 14px; line-height: 1.45; }
    textarea:focus { border-color: #74c0fc; background: #fff; }
    textarea::placeholder { color: #9a9aa5; }

    /* show / hide button */
    .pill { position: fixed; right: 16px; bottom: 16px; display: none; align-items: center; gap: 6px; background: #1f1f23; color: #fff;
      border: 0; border-radius: 999px; padding: 8px 14px; font-size: 13px; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
    .pill.show { display: flex; }
    .pill:hover { background: #000; }
  `;

  function ensureUI() {
    if (host) { if (!host.isConnected) document.documentElement.appendChild(host); return; }
    host = document.createElement('div');
    host.id = 'margin-notes-host';
    host.style.cssText = 'all:initial;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;';
    root = host.attachShadow({ mode: 'closed' });
    const style = mk('style'); style.textContent = CSS_UI;
    bar = mk('div', 'bar');
    panel = mk('div', 'panel');
    pill = mk('button', 'pill');
    root.append(style, bar, panel, pill);

    for (const c of COLORS) {
      const b = dot(c);
      b.title = 'Highlight';
      b.addEventListener('click', () => createFromRange(pendingRange, c, false));
      bar.appendChild(b);
    }
    bar.appendChild(mk('span', 'sep'));
    const noteBtn = mk('button', 'txt', '✎ Note');
    noteBtn.addEventListener('click', () => createFromRange(pendingRange, 'yellow', true));
    bar.appendChild(noteBtn);
    bar.addEventListener('mousedown', (e) => e.preventDefault()); // keep the page selection alive

    pill.addEventListener('click', () => {
      if (pill.dataset.mode === 'restore') expandAll();
      else setPanelHidden(!panelHidden);
    });
    // keep typing in notes from triggering the site's own keyboard shortcuts
    for (const t of ['keydown', 'keyup', 'keypress']) panel.addEventListener(t, (e) => e.stopPropagation());

    document.documentElement.appendChild(host);
  }

  function dot(c) {
    const b = mk('button', 'dot');
    b.dataset.c = c; b.style.background = SWATCH[c];
    b.setAttribute('aria-label', c);
    return b;
  }

  // ---------------------------------------------------------------- note cards
  const visibleNotes = () => items.filter((h) => ((h.note && !h.collapsed) || h.id === editingId) && marksFor(h.id).length);

  function render() {
    const shown = visibleNotes();
    if (!host && !shown.length && !items.some((h) => h.note)) return;
    ensureUI();
    const ids = new Set(shown.map((h) => h.id));
    for (const [id, el] of cards) if (!ids.has(id)) { el.remove(); cards.delete(id); }
    for (const h of shown) {
      let el = cards.get(h.id);
      if (!el) { el = mk('div', 'nc'); el.dataset.id = h.id; bindCard(el, h.id); panel.appendChild(el); cards.set(h.id, el); }
      el.style.setProperty('--c', SWATCH[h.color] || SWATCH.yellow);
      // while editing, never rebuild (it would reset the cursor); otherwise rebuild when content changes
      const sig = h.id === editingId ? 'editing' : JSON.stringify([h.note, !!h.collapsed, h.updated]);
      if (el.dataset.sig !== sig) { buildCard(el, h); el.dataset.sig = sig; }
      if (h.id === editingId) el.querySelectorAll('.ft .dot').forEach((d) => d.classList.toggle('on', d.dataset.c === h.color));
    }
    panel.style.display = panelHidden ? 'none' : 'block';
    const count = items.filter((h) => h.note).length;
    const label = `✎ Show ${count} note${count === 1 ? '' : 's'}`;
    pill.classList.toggle('show', count > 0 || !!editingId);
    if (panelHidden) {
      pill.dataset.mode = 'show'; pill.textContent = label; pill.title = 'Show your notes beside the page';
    } else if (!shown.length) {
      // every note is minimised: offer to bring them all back
      pill.dataset.mode = 'restore'; pill.textContent = label; pill.title = 'Show all minimised notes';
    } else {
      pill.dataset.mode = 'hide'; pill.textContent = 'Hide notes'; pill.title = 'Hide the notes panel';
    }
    layout();
  }

  function bindCard(el, id) {
    el.addEventListener('mouseenter', () => marksFor(id).forEach((m) => { m.dataset.active = ''; }));
    el.addEventListener('mouseleave', () => marksFor(id).forEach((m) => delete m.dataset.active));
  }

  function buildCard(el, h) {
    const editing = h.id === editingId;
    el.replaceChildren();
    el.classList.toggle('editing', editing);
    el.classList.toggle('collapsed', !!h.collapsed && !editing);

    const hd = mk('div', 'hd');
    const q = mk('span', 'q', `On “${h.quote.replace(/\s+/g, ' ')}”`);
    q.title = h.quote;
    hd.append(mk('span', 'sw'), q);
    if (!editing) {
      const min = mk('button', 'ic', '–');
      min.title = 'Minimise (click the highlight to see it again)';
      min.addEventListener('click', (e) => { e.stopPropagation(); toggleCollapsed(h.id); });
      hd.append(min);
    }
    hd.addEventListener('click', () => {
      const cur = find(h.id);
      if (cur) scrollToMark(h.id);
    });
    el.append(hd);

    if (editing) {
      const ta = mk('textarea');
      ta.value = h.note || '';
      ta.placeholder = 'Add a private note…';
      editTa = ta;
      let t = null;
      ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(flushDraft, 600); });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); finishEdit(); }
      });
      const ft = mk('div', 'ft');
      for (const c of COLORS) {
        const d = dot(c);
        d.title = 'Highlight colour';
        d.addEventListener('click', () => setColor(h.id, c));
        ft.append(d);
      }
      const del = mk('button', 'lnk danger', 'Delete');
      del.title = 'Remove this highlight and note';
      del.addEventListener('click', () => removeItem(h.id));
      const save = mk('button', 'save', 'Save');
      save.title = 'Save (Ctrl/⌘+Enter)';
      save.addEventListener('click', finishEdit);
      ft.append(mk('span', 'spacer'), del, save);
      el.append(ta, ft);
      setTimeout(() => { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
    } else if (!h.collapsed) {
      const note = mk('div', 'note', h.note);
      note.title = 'Click to edit';
      note.addEventListener('click', () => startEdit(h.id));
      const ft = mk('div', 'ft');
      ft.append(mk('span', null, new Date(h.updated || h.created).toLocaleDateString()), mk('span', 'spacer'));
      const edit = mk('button', 'lnk', 'Edit');
      edit.addEventListener('click', () => startEdit(h.id));
      const del = mk('button', 'lnk danger', 'Delete');
      del.title = 'Remove this highlight and note';
      del.addEventListener('click', () => removeItem(h.id));
      ft.append(edit, del);
      el.append(note, ft);
    }
  }

  function flushDraft() {
    const h = find(editingId);
    if (!h || !editTa || (h.note || '') === editTa.value) return;
    h.note = editTa.value;
    h.updated = Date.now();
    styleMarks(h, marksFor(h.id));
    save();
  }

  function startEdit(id) {
    if (editingId && editingId !== id) finishEdit();
    const h = find(id);
    if (!h) return;
    if (h.collapsed) { h.collapsed = false; save(); }
    if (panelHidden) setPanelHidden(false);
    editingId = id; activeId = id;
    render();
  }

  function finishEdit() {
    if (!editingId) return;
    const h = find(editingId);
    if (h && editTa) {
      const v = editTa.value.replace(/\s+$/, '');
      if ((h.note || '') !== v) { h.note = v; h.updated = Date.now(); styleMarks(h, marksFor(h.id)); }
    }
    editingId = null; editTa = null;
    save();
    render();
  }

  function toggleCollapsed(id) {
    const h = find(id);
    if (!h) return;
    h.collapsed = !h.collapsed;
    activeId = id;
    save();
    render();
  }

  function expandAll() {
    let changed = false;
    for (const h of items) if (h.collapsed) { h.collapsed = false; changed = true; }
    if (changed) save();
    render();
  }

  function setColor(id, c) {
    const h = find(id);
    if (!h) return;
    if (editTa && editingId === id) h.note = editTa.value;
    h.color = c; h.updated = Date.now();
    styleMarks(h, marksFor(h.id));
    save();
    render();
  }

  function removeItem(id) {
    if (editingId === id) { editingId = null; editTa = null; }
    items = items.filter((x) => x.id !== id);
    marksFor(id).forEach(unwrapEl);
    observer.takeRecords();
    save();
    render();
  }

  function scrollToMark(id) {
    const marks = marksFor(id);
    if (!marks.length) return false;
    activeId = id;
    marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    marks.forEach((x) => { x.dataset.flash = ''; });
    setTimeout(() => marks.forEach((x) => delete x.dataset.flash), 2000);
    return true;
  }

  // Show a highlight's card (opening the editor if it has no note yet).
  function focusNote(id, edit) {
    const h = find(id);
    if (!h) return;
    if (edit || !h.note) { startEdit(id); return; }
    if (panelHidden) setPanelHidden(false);
    if (h.collapsed) { h.collapsed = false; save(); }
    activeId = id;
    render();
    const el = cards.get(id);
    if (el) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200); }
  }

  // Line each card up with its highlight, nudging cards apart so they never overlap.
  let layoutQueued = false;
  function queueLayout() {
    if (layoutQueued || !panel) return;
    layoutQueued = true;
    requestAnimationFrame(() => { layoutQueued = false; layout(); });
  }

  function layout() {
    if (!panel || panelHidden) return;
    const list = [];
    for (const [id, el] of cards) {
      const m = marksFor(id)[0];
      if (!m) continue;
      list.push({ id, el, target: m.getBoundingClientRect().top - 10, h: el.offsetHeight });
    }
    if (!list.length) return;
    list.sort((a, b) => a.target - b.target);
    const GAP = 10;
    let ai = list.findIndex((e) => e.id === (editingId || activeId));
    if (ai < 0) ai = 0;
    list[ai].y = list[ai].target;
    for (let i = ai + 1; i < list.length; i++) list[i].y = Math.max(list[i].target, list[i - 1].y + list[i - 1].h + GAP);
    for (let i = ai - 1; i >= 0; i--) list[i].y = Math.min(list[i].target, list[i + 1].y - list[i].h - GAP);
    for (const e of list) e.el.style.transform = `translateY(${Math.round(e.y)}px)`;
  }

  window.addEventListener('scroll', queueLayout, { capture: true, passive: true });
  window.addEventListener('resize', queueLayout);
  if (window.ResizeObserver && document.body) new ResizeObserver(queueLayout).observe(document.body);

  // ---------------------------------------------------------------- selection toolbar
  function place(el, rect) {
    el.style.left = '0px'; el.style.top = '0px';
    const w = el.offsetWidth, hgt = el.offsetHeight;
    const vw = document.documentElement.clientWidth;
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, vw - w - 8));
    let top = rect.bottom + 8;
    if (top + hgt > window.innerHeight - 8 && rect.top - hgt - 8 > 8) top = rect.top - hgt - 8;
    el.style.left = left + window.scrollX + 'px';
    el.style.top = top + window.scrollY + 'px';
  }

  function hideBar() { if (bar) bar.classList.remove('show'); pendingRange = null; }

  function checkSelection() {
    if (!alive) return;
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !sel.toString().trim()) { hideBar(); return; }
    const range = sel.getRangeAt(0);
    const anc = range.commonAncestorContainer;
    const el = anc.nodeType === 1 ? anc : anc.parentElement;
    if (!el || el.closest('input,textarea,[contenteditable=""],[contenteditable="true"]')) { hideBar(); return; }
    const active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA)$/.test(active.tagName)) { hideBar(); return; }
    ensureUI();
    pendingRange = range.cloneRange();
    const rects = range.getClientRects();
    const r = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    bar.classList.add('show');
    place(bar, r);
  }

  function createFromRange(range, color, withNote) {
    if (!range) return;
    const idx = buildIndex();
    const off = rangeToOffsets(range, idx);
    hideBar();
    if (!off) return;
    let { start, end } = off;
    const t = idx.text;
    while (start < end && isWs(t[start])) start++;
    while (end > start && isWs(t[end - 1])) end--;
    if (end <= start) return;
    const now = Date.now();
    const h = {
      id: newId(), quote: t.slice(start, end),
      prefix: t.slice(Math.max(0, start - CTX), start), suffix: t.slice(end, end + CTX),
      note: '', color, created: now, updated: now,
    };
    const marks = wrapRange(start, end, h);
    observer.takeRecords();
    if (!marks.length) return;
    items.push(h);
    save();
    getSelection().removeAllRanges();
    if (withNote) startEdit(h.id);
  }

  // ---------------------------------------------------------------- page events
  const inUI = (e) => host && e.composedPath().includes(host);

  document.addEventListener('mouseup', (e) => { if (!inUI(e)) setTimeout(checkSelection, 0); }, true);
  document.addEventListener('keyup', (e) => { if (!inUI(e) && (e.shiftKey || e.key === 'Shift')) setTimeout(checkSelection, 0); }, true);
  document.addEventListener('selectionchange', () => {
    if (bar && bar.classList.contains('show') && getSelection().isCollapsed) hideBar();
  });
  document.addEventListener('mousedown', (e) => {
    if (inUI(e)) return;
    if (editingId) finishEdit();
    hideBar();
  }, true);

  document.addEventListener('click', (e) => {
    const m = e.target && e.target.closest && e.target.closest(MARK);
    if (!m) return;
    if (!getSelection().isCollapsed) return; // user was selecting text
    if (m.closest('a[href]') && !e.altKey) return; // let links work; Alt+click opens the note
    e.preventDefault();
    e.stopPropagation();
    focusNote(m.dataset.marginId, false);
  }, true);

  // messages from the popup / background
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === 'highlight-selection') {
      const sel = getSelection();
      if (sel.rangeCount && !sel.isCollapsed) { ensureUI(); createFromRange(sel.getRangeAt(0).cloneRange(), 'yellow', !!msg.note); }
    } else if (msg.type === 'scroll-to') {
      reply({ ok: scrollToMark(msg.id) });
    } else if (msg.type === 'status') {
      reply({ applied: items.filter((h) => marksFor(h.id).length).map((h) => h.id) });
    } else if (msg.type === 'open-note') {
      const ok = scrollToMark(msg.id);
      if (ok) setTimeout(() => focusNote(msg.id, true), 50);
      reply({ ok });
    }
  });

  // single-page apps change the URL without reloading
  setInterval(() => {
    const k = 'page:' + normUrl(location.href);
    if (k === pageKey) return;
    if (editingId) finishEdit();
    hideBar();
    document.querySelectorAll(MARK).forEach(unwrapEl);
    pageKey = k;
    items = [];
    activeId = null;
    render();
    load();
  }, 1000);

  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  load();
})();
