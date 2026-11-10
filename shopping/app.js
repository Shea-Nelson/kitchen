(function () {
  'use strict';
  const K = window.KitchenState;
  const S = window.KitchenShopping;
  const $ = id => document.getElementById(id);
  let catalog = {};
  let weeksDoc = { weeks: [] };
  let listDoc = { weeks: {} };
  let store = S.emptyStore();
  let weekId = '';
  let list = null;
  let recovery = '';

  function announce(text) { $('live').textContent = ''; setTimeout(function () { $('live').textContent = text; }, 30); }

  function bucket() {
    if (!store.weeks[weekId]) store.weeks[weekId] = { checked: {}, added: [] };
    return store.weeks[weekId];
  }

  function load() {
    const raw = localStorage.getItem(S.STORAGE_KEY);
    try { store = S.readStore(raw); }
    catch (error) {
      localStorage.setItem(S.STORAGE_KEY + '.unreadable', raw);
      recovery = 'The saved checks on this device could not be read, so the list starts fresh. A copy is kept under ' + S.STORAGE_KEY + '.unreadable.';
      store = S.emptyStore();
    }
    if (!store.prefs) store.prefs = { hideChecked: false };
  }

  function save() { localStorage.setItem(S.STORAGE_KEY, JSON.stringify(store)); }

  function allRows() {
    const b = bucket();
    const rows = [];
    list.sections.forEach(function (s) { s.items.forEach(function (i) { rows.push(i.checkKey); }); });
    b.added.forEach(function (a) { rows.push('m|' + a.id); });
    return rows;
  }

  function counts() {
    const b = bucket();
    const rows = allRows();
    const done = rows.filter(function (k) { return b.checked[k]; }).length;
    return { done: done, total: rows.length };
  }

  function itemHtml(item, b) {
    const on = !!b.checked[item.checkKey];
    const id = 'c-' + item.checkKey.replace(/[^a-z0-9-]/gi, '-');
    const forLine = item.for && item.for.length ? '<span class="for">' + item.for.map(function (f) { return '<span>' + K.esc(f) + '</span>'; }).join('') + '</span>' : '';
    const note = item.note ? '<span class="note">' + K.esc(item.note) + '</span>' : '';
    const remove = item.manual ? '<button type="button" class="btn-quiet rm" data-act="remove" data-id="' + K.esc(item.manualId) + '" aria-label="Remove ' + K.esc(item.name) + '">Remove</button>' : '';
    return '<li class="item' + (on ? ' on' : '') + '"><input type="checkbox" id="' + id + '" data-key="' + K.esc(item.checkKey) + '"' + (on ? ' checked' : '') + '>' +
      '<label for="' + id + '"><span class="box" aria-hidden="true"></span><span class="what"><span class="name">' + K.esc(item.name) + '</span>' +
      (item.qty ? '<span class="amt">' + K.esc(item.qty) + '</span>' : '') + forLine + note + '</span></label>' + remove + '</li>';
  }

  function sectionHtml(section, b) {
    const manual = b.added.filter(function (a) { return a.section === section.id; }).map(manualItem);
    const items = section.items.concat(manual);
    if (!items.length) return '';
    const left = items.filter(function (i) { return !b.checked[i.checkKey]; }).length;
    const hid = store.prefs.hideChecked && left === 0;
    return '<section class="aisle' + (hid ? ' all-done' : '') + '" aria-labelledby="h-' + section.id + '"><div class="aisle-head"><h2 id="h-' + section.id + '">' + K.esc(section.title) + '</h2><span class="left">' + (left ? left + ' left' : 'Done') + '</span></div>' +
      (section.hint ? '<p class="hint">' + K.esc(section.hint) + '</p>' : '') +
      '<ul class="items">' + items.map(function (i) { return itemHtml(i, b); }).join('') + '</ul></section>';
  }

  function manualItem(a) {
    return { checkKey: 'm|' + a.id, name: a.label, qty: '', for: ['Added by hand'], note: '', manual: true, manualId: a.id };
  }

  function sectionOptions() {
    const ids = (listDoc.sections || []).map(function (s) { return s; });
    return ids.map(function (s) { return '<option value="' + K.esc(s.id) + '"' + (s.id === 'other' ? ' selected' : '') + '>' + K.esc(s.title) + '</option>'; }).join('');
  }

  function render() {
    const b = bucket();
    const c = counts();
    const pct = c.total ? Math.round(100 * c.done / c.total) : 0;
    const known = new Set(list.sections.map(function (s) { return s.id; }));
    const orphanSections = (listDoc.sections || []).filter(function (s) {
      return !known.has(s.id) && b.added.some(function (a) { return a.section === s.id; });
    }).map(function (s) { return { id: s.id, title: s.title, hint: '', items: [] }; });
    const looseSections = b.added.filter(function (a) { return !(listDoc.sections || []).some(function (s) { return s.id === a.section; }); }).length
      ? [{ id: 'added', title: 'Added by hand', hint: '', items: [] }] : [];
    const ordered = (listDoc.sections || []).map(function (s) {
      return list.sections.find(function (x) { return x.id === s.id; }) || orphanSections.find(function (x) { return x.id === s.id; });
    }).filter(Boolean).concat(looseSections);
    const onHand = list.onHand.length
      ? '<p class="on-hand"><strong>Already on hand, not listed:</strong> ' + list.onHand.map(function (o) { return K.esc(o.name) + ' (' + K.esc(o.for) + ')'; }).join('; ') + '.</p>' : '';
    $('app').innerHTML =
      (recovery ? '<div class="banner" role="alert">' + K.esc(recovery) + '</div>' : '') +
      '<section class="shop-head"><p class="kicker">' + K.esc(list.title) + '</p><h1>Shopping list</h1>' +
      '<p class="lede">' + K.esc(list.note) + '</p>' +
      (list.dinners.length ? '<p class="dinners"><span class="sr">Dinners on this list: </span>' + list.dinners.map(function (d) { return '<span>' + K.esc(d) + '</span>'; }).join('') + '</p>' : '') +
      onHand +
      '<div class="progress" role="group" aria-label="Progress"><div class="count-row"><div class="count"><strong id="done">' + c.done + '</strong> of <span id="total">' + c.total + '</span> in the cart</div>' +
        '<button type="button" class="btn-ghost toggle no-print" data-act="hide" aria-pressed="' + !!store.prefs.hideChecked + '"><span class="dot" aria-hidden="true"></span>Hide checked</button></div>' +
        '<div class="bar" aria-hidden="true"><span style="width:' + pct + '%"></span></div></div>' +
      '<div class="tools no-print">' +
        '<button type="button" class="btn-ghost" data-act="copy" aria-label="Copy the list as plain text">Copy</button>' +
        (navigator.share ? '<button type="button" class="btn-ghost" data-act="share" aria-label="Share the list as plain text">Share</button>' : '') +
        '<button type="button" class="btn-ghost" data-act="print">Print</button>' +
      '</div></section>' +
      '<div class="aisles' + (store.prefs.hideChecked ? ' hide-checked' : '') + '">' + ordered.map(function (s) { return sectionHtml(s, b); }).join('') + '</div>' +
      '<form class="add no-print" id="addForm"><label for="newItem" class="add-label">Add an item</label><div class="add-row"><input id="newItem" type="text" maxlength="120" autocomplete="off" placeholder="Paper towels, coffee…" enterkeyhint="done"><label class="sr" for="newSection">Store section</label><select id="newSection">' + sectionOptions() + '</select><button type="submit" class="btn">Add</button></div></form>' +
      '<div class="reset-row no-print"><button type="button" class="btn-danger" data-act="clear"' + (c.done ? '' : ' disabled') + '>Clear checked</button><span class="meta">Unchecks everything for this week. Added items stay.</span></div>' +
      '<details class="banner device-note no-print"><summary>Checks stay on this device</summary><p>Your checks and added items are saved in this browser for this week only. They do not sync to another phone. Use Copy list or Share to send the list to someone else.</p></details>';
  }

  function updateCounts() {
    const c = counts();
    $('done').textContent = c.done;
    const bar = document.querySelector('.bar span');
    if (bar) bar.style.width = (c.total ? Math.round(100 * c.done / c.total) : 0) + '%';
    const clear = document.querySelector('[data-act="clear"]');
    if (clear) clear.disabled = !c.done;
    document.querySelectorAll('.aisle').forEach(function (sec) {
      const left = sec.querySelectorAll('.item:not(.on)').length;
      sec.querySelector('.left').textContent = left ? left + ' left' : 'Done';
      sec.classList.toggle('all-done', !!store.prefs.hideChecked && left === 0);
    });
  }

  function textCopy() { return S.plainText(list, bucket().checked, bucket().added); }

  function ask(title, body, okLabel) {
    $('gateTitle').textContent = title;
    $('gateBody').textContent = body;
    $('gateOk').textContent = okLabel;
    const info = okLabel === 'Done';
    $('gateOk').className = info ? 'btn' : 'btn-danger';
    $('gateCancel').hidden = info;
    $('gate').showModal();
    return new Promise(function (resolve) {
      $('gate').addEventListener('close', function () { resolve($('gate').returnValue === 'ok'); }, { once: true });
    });
  }

  async function copy() {
    const text = textCopy();
    try { await navigator.clipboard.writeText(text); announce('List copied as plain text.'); flash('copy', 'Copied'); }
    catch (e) {
      await ask('Copy this list', text, 'Done');
    }
  }

  function flash(act, label) {
    const btn = document.querySelector('[data-act="' + act + '"]');
    if (!btn) return;
    const was = btn.textContent;
    btn.textContent = label;
    setTimeout(function () { btn.textContent = was; }, 1600);
  }

  async function onClick(event) {
    const btn = event.target.closest('button');
    if (!btn || !btn.dataset.act) return;
    const act = btn.dataset.act;
    if (act === 'copy') copy();
    if (act === 'share') {
      try { await navigator.share({ title: 'Shopping list', text: textCopy() }); } catch (e) { /* cancelled */ }
    }
    if (act === 'print') window.print();
    if (act === 'hide') {
      store.prefs.hideChecked = !store.prefs.hideChecked;
      save(); render();
      announce(store.prefs.hideChecked ? 'Checked items hidden.' : 'Checked items shown.');
    }
    if (act === 'clear') {
      const c = counts();
      const ok = await ask('Clear ' + c.done + ' checked item' + (c.done === 1 ? '' : 's') + '?', 'Every item goes back to unchecked for this week. Items you added by hand stay on the list.', 'Clear checked');
      if (!ok) return;
      bucket().checked = {};
      save(); render();
      announce('Checks cleared.');
    }
    if (act === 'remove') {
      const b = bucket();
      const item = b.added.find(function (a) { return a.id === btn.dataset.id; });
      b.added = b.added.filter(function (a) { return a.id !== btn.dataset.id; });
      delete b.checked['m|' + btn.dataset.id];
      save(); render();
      announce((item ? item.label : 'Item') + ' removed.');
    }
  }

  function onChange(event) {
    const input = event.target;
    if (input.type !== 'checkbox' || !input.dataset.key) return;
    const b = bucket();
    if (input.checked) b.checked[input.dataset.key] = true;
    else delete b.checked[input.dataset.key];
    input.closest('.item').classList.toggle('on', input.checked);
    save();
    updateCounts();
  }

  function onSubmit(event) {
    if (event.target.id !== 'addForm') return;
    event.preventDefault();
    const label = ($('newItem').value || '').trim().slice(0, 120);
    if (!label) { $('newItem').focus(); return; }
    const section = $('newSection').value || 'other';
    bucket().added.push({ id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), label: label, section: section });
    save(); render();
    $('newSection').value = section;
    $('newItem').focus();
    announce(label + ' added.');
  }

  function pickWeek() {
    const today = K.easternISODate(new Date());
    const params = new URLSearchParams(location.search);
    const asked = params.get('week');
    const have = (weeksDoc.weeks || []).filter(function (w) { return listDoc.weeks && listDoc.weeks[w.id]; });
    if (asked && have.some(function (w) { return w.id === asked; })) return asked;
    const current = K.weekContaining(today, { weeks: have });
    if (current) return current.id;
    const id = K.defaultWeekId({ weeks: have.length ? have : weeksDoc.weeks }, today);
    return id;
  }

  async function boot() {
    const responses = await Promise.all([
      fetch('../recipes/data/recipes.json', { cache: 'no-cache' }),
      fetch('../planner/data/weeks.json', { cache: 'no-cache' }),
      fetch('data/lists.json', { cache: 'no-cache' })
    ]);
    if (responses.some(function (r) { return !r.ok; })) throw new Error('load');
    const recipesDoc = await responses[0].json();
    weeksDoc = await responses[1].json();
    listDoc = await responses[2].json();
    recipesDoc.recipes.forEach(function (r) { catalog[r.id] = r; });
    load();
    weekId = pickWeek();
    const week = (weeksDoc.weeks || []).find(function (w) { return w.id === weekId; });
    if (!week) {
      $('app').innerHTML = '<section class="shop-head"><h1>Shopping list</h1><p class="lede">No week is published yet, so there is nothing to shop for. The list fills in from the meal plan.</p></section>';
      return;
    }
    list = S.buildList(week, catalog, listDoc);
    render();
    document.body.addEventListener('click', onClick);
    document.body.addEventListener('change', onChange);
    document.body.addEventListener('submit', onSubmit);
    window.addEventListener('storage', function (e) {
      if (e.key !== S.STORAGE_KEY) return;
      load(); render();
    });
  }

  boot().catch(function () {
    $('app').innerHTML = '<p class="banner" role="alert">The shopping list could not be loaded. Check the connection and reopen this page.</p>';
  });
})();
