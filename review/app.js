/* Week review page. Reads planner/data/weeks.json and recipes/data/recipes.json,
   keeps picks in localStorage on this device, and builds a mailto link or a
   copyable text. Nothing is sent anywhere by this script. */
(function () {
  'use strict';
  const R = window.KitchenReview;
  const K = window.KitchenState;
  const app = document.getElementById('app');
  const dock = document.getElementById('dock');
  const dockCount = document.getElementById('dock-count');
  const sendLink = document.getElementById('send');
  const copyBtn = document.getElementById('copy');
  const live = document.getElementById('live');
  const gate = document.getElementById('gate');

  const ICON = {
    up: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>',
    down: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>',
    plate: '<svg viewBox="0 0 64 64" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="32" cy="32" r="22"/><circle cx="32" cy="32" r="13"/></svg>'
  };

  let weeksDoc = null;
  let recipesDoc = null;
  let recipes = {};
  let week = null;
  let picks = null;
  const ideasState = {};

  function esc(v) { return K.esc(v); }
  function say(text) { live.textContent = ''; setTimeout(function () { live.textContent = text; }, 30); }

  function load() {
    try { return JSON.parse(localStorage.getItem(R.STORAGE_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  let saveFailed = false;
  function save() {
    const all = load();
    all[week.id] = picks;
    try { localStorage.setItem(R.STORAGE_KEY, JSON.stringify(all)); saveFailed = false; } catch (e) { saveFailed = true; }
  }

  function pageUrl() {
    return location.origin + location.pathname + '?week=' + encodeURIComponent(week.id);
  }

  function cardHtml(day) {
    const recipe = day.recipeId ? recipes[day.recipeId] : null;
    const label = R.dayLabel(day.date);
    const name = day.title || 'No dinner';
    const blurb = recipe && recipe.summary ? recipe.summary : (day.dinnerNote || '');
    const photo = recipe && recipe.photo && recipe.photo.src
      ? '<img class="thumb" src="../recipes/' + esc(recipe.photo.src) + '" alt="' + esc(recipe.photo.alt || '') + '" loading="lazy" width="640" height="320">'
      : '<div class="thumb thumb-none">' + ICON.plate + '</div>';
    const link = day.recipeId
      ? '<a class="recipe-link" href="../recipes/?date=' + encodeURIComponent(day.date) + '&amp;recipe=' + encodeURIComponent(day.recipeId) + '">See the recipe<span class="sr"> for ' + esc(name) + '</span></a>'
      : '';
    const extra = [];
    if (day.dinnerNote && recipe) extra.push('<div class="meal-line"><dt>Dinner notes</dt><dd>' + esc(day.dinnerNote) + '</dd></div>');
    if (day.breakfast) extra.push('<div class="meal-line"><dt>Breakfast</dt><dd>' + esc(day.breakfast) + '</dd></div>');
    if (day.lunch) extra.push('<div class="meal-line"><dt>Lunch</dt><dd>' + esc(day.lunch) + '</dd></div>');
    const id = 'd' + day.date;
    return '<article class="rv-day" data-date="' + esc(day.date) + '" aria-labelledby="' + id + '-h">' +
      photo +
      '<div class="rv-day-body">' +
      '<p class="kicker">' + esc(label) + '</p>' +
      '<h2 id="' + id + '-h">' + esc(name) + '</h2>' +
      (blurb ? '<p class="blurb">' + esc(blurb) + '</p>' : '') +
      link +
      (extra.length ? '<details class="more"><summary>Breakfast, lunch &amp; notes</summary><dl>' + extra.join('') + '</dl></details>' : '') +
      '<div class="votes" role="group" aria-label="Your pick for ' + esc(label) + ' dinner">' +
      '<button type="button" class="vote up" data-vote="approve" aria-pressed="false">' + ICON.up + '<span>Love it</span></button>' +
      '<button type="button" class="vote down" data-vote="change" aria-pressed="false">' + ICON.down + '<span>Change it</span></button>' +
      '</div>' +
      '<div class="swap" hidden>' +
      '<label for="' + id + '-swap">Swap for…</label>' +
      '<input id="' + id + '-swap" type="text" maxlength="' + R.SWAP_MAX + '" autocomplete="off" enterkeyhint="done" placeholder="What would you like instead?">' +
      '<button type="button" class="suggest-toggle" aria-expanded="false" aria-controls="' + id + '-ideas">I don’t know, suggest something</button>' +
      '<div class="ideas" id="' + id + '-ideas" hidden>' +
      '<p class="ideas-lead" id="' + id + '-ideas-h" tabindex="-1">A few dinners from our kitchen. The adults stay keto; the kids can have sides.</p>' +
      '<div class="chips" role="group" aria-labelledby="' + id + '-ideas-h"></div>' +
      '<div class="ideas-actions">' +
      '<button type="button" class="ideas-more">Show me others</button>' +
      '<button type="button" class="ideas-surprise" aria-pressed="false">Not sure — Scorpy, you choose</button>' +
      '</div></div></div>' +
      '</div></article>';
  }

  function peekHtml() {
    const sections = R.groceryPeek(week);
    const total = sections.reduce(function (n, s) { return n + s.items.length; }, 0);
    if (!total) return '';
    const body = sections.map(function (s) {
      return '<h3>' + esc(s.title) + '</h3><ul>' + s.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>';
    }).join('');
    return '<details class="peek"><summary>Grocery list peek <span class="count">' + total + ' items</span></summary>' + body +
      '<p class="peek-foot">Pantry staples are on the full list. <a href="../shopping/?week=' + encodeURIComponent(week.startsOn) + '">Open the full grocery list</a></p></details>';
  }

  function weekNav() {
    const n = R.neighbours(weeksDoc, week);
    const prev = n.prev ? '<a href="?week=' + esc(n.prev.id) + '" rel="prev">&larr; Week of ' + esc(R.shortDate(n.prev.startsOn)) + '</a>' : '<span></span>';
    const next = n.next ? '<a href="?week=' + esc(n.next.id) + '" rel="next">Week of ' + esc(R.shortDate(n.next.startsOn)) + ' &rarr;</a>' : '<span></span>';
    return '<nav class="week-nav" aria-label="Other weeks">' + prev + next + '</nav>';
  }

  function render() {
    document.title = 'Review the week of ' + R.shortDate(week.startsOn) + ' · Family kitchen';
    app.innerHTML =
      '<section class="intro-block">' +
      '<p class="kicker">Meal plan review</p>' +
      '<h1>' + esc(week.title.replace(/, \d{4}$/, '')) + '</h1>' +
      '<p class="lede">Give each dinner a thumbs-up, or a thumbs-down with a swap idea. If you are not sure, you can ask for a few ideas. Your picks save on this phone as you go, then one tap sends them.</p>' +
      weekNav() +
      '</section>' +
      '<div class="rv-days">' + week.days.map(cardHtml).join('') + '</div>' +
      peekHtml() +
      '<section class="notes-block"><label for="notes">Anything else about the week?</label>' +
      '<textarea id="notes" rows="4" maxlength="' + R.NOTES_MAX + '" placeholder="Allergies, guests, a night to eat out, anything at all."></textarea></section>' +
      '<section class="send-block" id="send-help"><h2>Send your picks</h2>' +
      '<p>“Send my picks” opens a ready-to-go email in your mail app. Look it over and press send there. If nothing opens, tap “Copy my picks” and paste it into a message to Giles.</p>' +
      '<details class="preview"><summary>See exactly what will be sent</summary><pre id="preview" tabindex="0"></pre></details>' +
      '<p class="fine">Picks stay on this device. This page has no tracking and sends nothing by itself. <button type="button" class="btn-quiet" id="clear">Clear my picks</button></p>' +
      '<p class="fine" id="save-warning" role="status"></p>' +
      '</section>';
    dock.hidden = false;
    paint();
    wire();
  }

  function otherSwapTitles(exceptDate) {
    const titles = [];
    week.days.forEach(function (day) {
      if (day.date === exceptDate) return;
      const swap = picks.days[day.date] && picks.days[day.date].swap;
      if (swap && swap.trim() && !R.isSurpriseSwap(swap)) titles.push(swap);
    });
    return titles;
  }

  function paintIdeas(card, day) {
    const state = ideasState[day.date] || { open: false, offset: 0 };
    const toggle = card.querySelector('.suggest-toggle');
    const panel = card.querySelector('.ideas');
    toggle.setAttribute('aria-expanded', String(Boolean(state.open)));
    panel.hidden = !state.open;
    const p = picks.days[day.date];
    const surprise = card.querySelector('.ideas-surprise');
    surprise.setAttribute('aria-pressed', String(R.isSurpriseSwap(p.swap)));
    const chips = card.querySelector('.chips');
    if (!state.open) { chips.innerHTML = ''; return; }
    const list = R.suggestionsFor(recipesDoc, week, { size: 4, offset: state.offset, excludeTitles: otherSwapTitles(day.date) });
    chips.innerHTML = list.map(function (recipe) {
      const pressed = p.swap.trim().toLowerCase() === recipe.title.trim().toLowerCase();
      return '<button type="button" class="chip" data-title="' + esc(recipe.title) + '" aria-pressed="' + String(pressed) + '">' + esc(recipe.title) + '</button>';
    }).join('');
  }

  function paint() {
    week.days.forEach(function (day) {
      const card = app.querySelector('.rv-day[data-date="' + day.date + '"]');
      const p = picks.days[day.date];
      card.dataset.vote = p.vote || '';
      card.querySelectorAll('.vote').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.dataset.vote === p.vote));
      });
      const swap = card.querySelector('.swap');
      swap.hidden = p.vote !== 'change';
      const input = swap.querySelector('input');
      const shown = R.isSurpriseSwap(p.swap) ? '' : p.swap;
      if (input !== document.activeElement && input.value !== shown) input.value = shown;
      input.placeholder = R.isSurpriseSwap(p.swap) ? 'Scorpy will choose a dinner' : 'What would you like instead?';
      paintIdeas(card, day);
    });
    const notes = document.getElementById('notes');
    if (notes !== document.activeElement && notes.value !== picks.notes) notes.value = picks.notes;
    summary();
  }

  function summary() {
    const c = R.counts(week, picks);
    const done = c.approve + c.change;
    let text = done + ' of ' + c.total + ' picked';
    if (c.change) text += ' · ' + c.change + (c.change === 1 ? ' change' : ' changes');
    dockCount.textContent = text;
    const ready = R.hasAnything(week, picks);
    sendLink.setAttribute('aria-disabled', String(!ready));
    sendLink.classList.toggle('is-off', !ready);
    sendLink.href = ready ? R.mailto(week, picks, pageUrl()) : '#send-help';
    const pre = document.getElementById('preview');
    if (pre) pre.textContent = R.subject(week) + '\n\n' + R.body(week, picks, pageUrl());
    const warn = document.getElementById('save-warning');
    if (warn) warn.textContent = saveFailed ? 'This browser would not save your picks. Send or copy them before you leave.' : '';
  }

  function changed() { picks = R.normalize(picks, week); save(); summary(); }

  function stateFor(date) {
    if (!ideasState[date]) ideasState[date] = { open: false, offset: 0 };
    return ideasState[date];
  }

  function wire() {
    app.querySelectorAll('.vote').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const date = btn.closest('.rv-day').dataset.date;
        const p = picks.days[date];
        p.vote = p.vote === btn.dataset.vote ? '' : btn.dataset.vote;
        if (p.vote !== 'change') { p.swap = ''; ideasState[date] = { open: false, offset: (ideasState[date] && ideasState[date].offset) || 0 }; }
        save(); paint();
        say(R.dayLabel(date) + ': ' + (p.vote === 'approve' ? 'love it' : p.vote === 'change' ? 'change it' : 'cleared'));
        if (p.vote === 'change') btn.closest('.rv-day').querySelector('.swap input').focus({ preventScroll: true });
      });
    });
    app.querySelectorAll('.swap input').forEach(function (input) {
      input.addEventListener('input', function () {
        picks.days[input.closest('.rv-day').dataset.date].swap = input.value;
        changed();
        paintIdeas(input.closest('.rv-day'), week.days.find(function (d) { return d.date === input.closest('.rv-day').dataset.date; }));
      });
    });
    app.addEventListener('click', function (e) {
      const card = e.target.closest('.rv-day');
      if (!card) return;
      const date = card.dataset.date;
      const day = week.days.find(function (d) { return d.date === date; });
      const p = picks.days[date];
      if (e.target.closest('.suggest-toggle')) {
        const state = stateFor(date);
        state.open = !state.open;
        paintIdeas(card, day);
        say(state.open ? 'Here are a few dinner ideas.' : 'Suggestions hidden.');
        if (state.open) card.querySelector('.ideas-lead').focus({ preventScroll: true });
        return;
      }
      if (e.target.closest('.ideas-more')) {
        const state = stateFor(date);
        state.open = true;
        state.offset += 4;
        paintIdeas(card, day);
        const names = Array.prototype.map.call(card.querySelectorAll('.chip'), function (c) { return c.textContent; }).join(', ');
        say(names ? 'Other ideas: ' + names : 'No other ideas right now.');
        return;
      }
      const chip = e.target.closest('.chip');
      if (chip) {
        p.swap = chip.dataset.title;
        save(); paint();
        say(R.dayLabel(date) + ': swap for ' + chip.dataset.title);
        return;
      }
      if (e.target.closest('.ideas-surprise')) {
        p.swap = p.swap && R.isSurpriseSwap(p.swap) ? '' : R.SURPRISE_SWAP;
        save(); paint();
        say(R.dayLabel(date) + (R.isSurpriseSwap(p.swap) ? ': Scorpy will choose' : ': surprise-me cleared'));
      }
    });
    document.getElementById('notes').addEventListener('input', function (e) {
      picks.notes = e.target.value;
      changed();
    });
    document.getElementById('clear').addEventListener('click', function () { gate.showModal(); });
  }

  gate.addEventListener('close', function () {
    if (gate.returnValue === 'ok') {
      picks = R.normalize({}, week); save(); paint(); say('Picks cleared');
    }
    gate.returnValue = '';
  });

  sendLink.addEventListener('click', function (e) {
    if (sendLink.getAttribute('aria-disabled') === 'true') {
      e.preventDefault();
      say('Pick at least one dinner or add a note first.');
      document.getElementById('send-help').scrollIntoView({ block: 'center' });
    }
  });

  copyBtn.addEventListener('click', function () {
    if (!R.hasAnything(week, picks)) { say('Pick at least one dinner or add a note first.'); return; }
    const text = R.subject(week) + '\n\n' + R.body(week, picks, pageUrl());
    function done() { copyBtn.textContent = 'Copied'; say('Your picks are copied.'); setTimeout(function () { copyBtn.textContent = 'Copy my picks'; }, 2200); }
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) done(); else say('Could not copy. Open "See exactly what will be sent" and copy it by hand.');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  });

  function fail(message) {
    app.innerHTML = '<section class="intro-block"><h1>Couldn’t load the week</h1><p class="lede">' + esc(message) + ' Try again in a moment, or open the <a href="../planner/">Plan page</a>.</p></section>';
    dock.hidden = true;
  }

  Promise.all([
    fetch('../planner/data/weeks.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('weeks ' + r.status); return r.json(); }),
    fetch('../recipes/data/recipes.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('recipes ' + r.status); return r.json(); })
  ]).then(function (docs) {
    weeksDoc = docs[0];
    recipesDoc = docs[1];
    docs[1].recipes.forEach(function (r) { recipes[r.id] = r; });
    const requested = new URLSearchParams(location.search).get('week');
    week = R.pickWeek(weeksDoc, requested, K.easternISODate(new Date()));
    if (!week) return fail('No weeks are planned yet.');
    picks = R.normalize(load()[week.id], week);
    render();
  }).catch(function () { fail('The plan data did not load.'); });
})();
