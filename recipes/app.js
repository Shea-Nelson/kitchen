(function () {
  'use strict';
  const K = window.KitchenState;
  const Art = window.KitchenArt;
  const $ = id => document.getElementById(id);
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  let catalog = {};
  let order = [];
  let schedule = { days: {} };
  let weeksDoc = { weeks: [] };
  let session = null;
  let activeId = '';
  let activeDate = '';
  let viewWeekId = '';
  let recovery = '';
  let notice = '';
  let tickHandle = 0;

  function announce(text) {
    $('live').textContent = text;
  }

  function easternToday() {
    return K.easternISODate(new Date());
  }

  function allowedLink(url) {
    return /^https:\/\/(commons\.wikimedia\.org|creativecommons\.org)\//.test(url || '');
  }

  function creditHtml(photo) {
    const license = photo.licenseUrl && allowedLink(photo.licenseUrl)
      ? '<a href="' + K.esc(photo.licenseUrl) + '">' + K.esc(photo.license) + '</a>'
      : K.esc(photo.license || '');
    const source = allowedLink(photo.sourceUrl) ? ' · <a href="' + K.esc(photo.sourceUrl) + '">Source</a>' : '';
    return K.esc(photo.author || '') + (license ? ' · ' + license : '') + source;
  }

  function weekById(id) {
    return (weeksDoc.weeks || []).find(function (week) { return week.id === id; }) || null;
  }

  function viewStart() {
    const week = weekById(viewWeekId);
    if (week) return week.startsOn;
    if (viewWeekId && DATE_RE.test(viewWeekId)) return K.sundayOf(viewWeekId);
    return K.sundayOf(easternToday());
  }

  function viewDates() {
    const start = viewStart();
    return Array.from({ length: 7 }, function (_, index) { return K.addDays(start, index); });
  }

  function entry() {
    return activeId ? session.recipes[activeId] : null;
  }

  function recipe() {
    return activeId ? catalog[activeId] : null;
  }

  function scrollToNode(node) {
    if (!node) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }

  function replaceUrl() {
    const url = new URL(location.href);
    if (activeDate) url.searchParams.set('date', activeDate);
    else url.searchParams.delete('date');
    if (activeId) url.searchParams.set('recipe', activeId);
    else url.searchParams.delete('recipe');
    history.replaceState(null, '', url);
  }

  function persist() {
    const now = new Date();
    const current = entry();
    if (current) current.updatedAt = now.toISOString();
    session.updatedAt = now.toISOString();
    const text = JSON.stringify(session, null, 2);
    localStorage.setItem(K.RECIPE_STORAGE_KEY, text);
    const stamp = $('savedAt');
    if (stamp) stamp.textContent = 'Saved on this device at ' + now.toLocaleString() + '. Not sent anywhere.';
    const preview = $('jsonPreview');
    if (preview && document.activeElement !== preview) preview.value = text;
  }

  function loadSession() {
    const raw = localStorage.getItem(K.RECIPE_STORAGE_KEY);
    if (!raw) return K.emptyRecipeSession(K.newSessionId());
    try {
      const result = K.validateRecipeSession(K.parseSessionJson(raw));
      if (!result.ok) throw new Error(result.errors.join('\n'));
      return result.value;
    } catch (error) {
      localStorage.setItem(K.RECIPE_STORAGE_KEY + '.unreadable', raw);
      recovery = 'The saved recipe session on this device could not be read. A copy remains under the local key kitchen.recipe.session.v1.unreadable. A new session was started.\n' + error.message;
      return K.emptyRecipeSession(K.newSessionId());
    }
  }

  function syncAll() {
    const now = Date.now();
    let finished = [];
    Object.keys(session.recipes).forEach(function (id) {
      const bucket = session.recipes[id].timers;
      Object.keys(bucket).forEach(function (timerId) {
        const before = bucket[timerId].status;
        const next = K.syncTimer(bucket[timerId], now);
        bucket[timerId] = next;
        if (before !== 'done' && next.status === 'done') finished.push(next.label);
      });
    });
    return finished;
  }

  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = beep.ctx || new Ctx();
      beep.ctx = ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 740;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.start(t);
      osc.stop(t + 0.3);
    } catch (e) { /* sound is optional */ }
    try { if (navigator.vibrate) navigator.vibrate(180); } catch (e) { /* optional */ }
  }

  function paintProgress() {
    const node = $('progress');
    const rec = recipe();
    const state = entry();
    if (!node || !rec || !state) return;
    const ingredients = rec.ingredients.filter(item => state.ingredients[item.id] && state.ingredients[item.id].checked).length;
    const steps = rec.steps.filter(step => state.steps[step.id] && state.steps[step.id].checked).length;
    node.textContent = ingredients + ' of ' + rec.ingredients.length + ' ingredients checked · ' + steps + ' of ' + rec.steps.length + ' steps checked';
  }

  function paintQtys() {
    const rec = recipe();
    const state = entry();
    if (!rec || !state) return;
    rec.ingredients.forEach(function (ing) {
      const node = document.querySelector('[data-qty="' + ing.id + '"]');
      if (!node) return;
      node.textContent = K.formatIngredient(ing, state.portions, rec.servings).qty;
    });
  }

  function paintTimer(id) {
    const state = entry();
    if (!state) return;
    const timer = state.timers[id];
    if (!timer) return;
    const box = document.querySelector('.timerbox[data-timer="' + id + '"]');
    if (!box) return;
    box.querySelector('[data-readout]').textContent = K.formatClock(K.timerRemaining(timer, Date.now()));
    const toggle = box.querySelector('[data-act="toggle"]');
    const label = timer.status === 'running' ? 'Pause' : (timer.status === 'paused' ? 'Resume' : 'Start');
    toggle.textContent = label;
    toggle.setAttribute('aria-label', label + ' ' + timer.label + ' timer');
  }

  function paintTimers() {
    if (!entry()) return;
    Object.keys(entry().timers).forEach(paintTimer);
  }

  function paintDock() {
    const dock = $('dock');
    const cards = [];
    Object.keys(session.recipes).forEach(function (recipeId) {
      const bucket = session.recipes[recipeId].timers;
      Object.keys(bucket).forEach(function (id) {
        const timer = bucket[id];
        if (timer.status === 'idle') return;
        const left = K.formatClock(K.timerRemaining(timer, Date.now()));
        const name = (catalog[recipeId] ? catalog[recipeId].title : recipeId) + ' · ' + timer.label;
        const action = timer.status === 'running' ? 'Pause' : (timer.status === 'paused' ? 'Resume' : 'Reset');
        cards.push('<article><button type="button" data-act="jump" data-recipe="' + K.esc(recipeId) + '" data-step="' + K.esc(timer.stepId) + '">' + K.esc(name) + '</button><span class="clock">' + left + '</span><button type="button" data-act="dock-toggle" data-recipe="' + K.esc(recipeId) + '" data-id="' + K.esc(id) + '">' + action + '</button></article>');
      });
    });
    dock.innerHTML = cards.join('');
    const show = cards.length > 0;
    dock.hidden = !show;
    document.body.classList.toggle('has-dock', show);
  }

  function markStep() {
    const state = entry();
    const id = state ? state.cookingStepId : '';
    document.querySelectorAll('.step').forEach(function (node) {
      node.classList.toggle('on', node.dataset.step === id);
    });
  }

  async function requestWake() {
    try {
      if (navigator.wakeLock && entry() && entry().cookingMode) requestWake.lock = await navigator.wakeLock.request('screen');
    } catch (e) { /* wake lock is optional */ }
  }

  function releaseWake() {
    if (requestWake.lock) {
      requestWake.lock.release().catch(function () {});
      requestWake.lock = null;
    }
  }

  function weekBarHtml() {
    const start = viewStart();
    const end = K.addDays(start, 6);
    const planDate = activeDate || easternToday();
    return '<div class="week-bar row"><button type="button" class="btn-quiet" data-act="prev-week">Previous week</button><strong>' + K.esc(K.formatLong(start)) + ' – ' + K.esc(K.formatLong(end)) + '</strong><button type="button" class="btn-quiet" data-act="next-week">Next week</button><button type="button" class="btn herb" data-act="today">Today</button><a class="btn-quiet" href="../planner/?date=' + encodeURIComponent(planDate) + '">This day on the plan</a></div>';
  }

  function renderTabs() {
    const slot = $('day-tabs');
    if (!slot) return;
    const today = easternToday();
    const dates = viewDates();
    slot.innerHTML = '<div class="day-tabs" role="tablist" aria-label="Days this week">' + dates.map(function (date) {
      const id = K.recipeIdForDate(date, schedule, weeksDoc);
      const name = id && catalog[id] ? catalog[id].title : 'No dinner';
      const selected = date === activeDate;
      const dow = date === today ? 'Today' : K.weekdayName(date).slice(0, 3);
      return '<button type="button" role="tab" class="' + (date === today ? 'is-today' : '') + '" data-act="day" data-date="' + date + '" aria-selected="' + selected + '" aria-label="' + K.esc(K.formatLong(date) + '. ' + name) + '"><span class="dow">' + K.esc(dow) + '</span><span class="dom">' + Number(date.slice(8)) + '</span></button>';
    }).join('') + '</div>';
  }

  function mealStripHtml() {
    if (!activeDate) return '';
    let day = null;
    (weeksDoc.weeks || []).some(function (week) {
      day = (week.days || []).find(function (item) { return item.date === activeDate; }) || null;
      return !!day;
    });
    if (!day || (!day.breakfast && !day.lunch)) return '';
    const dinner = day.dinnerNote || day.title || '';
    return '<div class="meal-strip"><div class="meal"><b>Breakfast</b><span>' + K.esc(day.breakfast || '') + '</span></div><div class="meal"><b>Lunch</b><span>' + K.esc(day.lunch || '') + '</span></div><div class="meal"><b>Dinner</b><span>' + K.esc(dinner) + '</span></div></div>';
  }

  function alsoHtml() {
    const listed = {};
    viewDates().forEach(function (date) {
      const id = K.recipeIdForDate(date, schedule, weeksDoc);
      if (id) listed[id] = true;
    });
    const extras = order.filter(function (id) { return !listed[id]; });
    if (!extras.length) return '';
    return '<section class="card also-saved"><h2>Also saved</h2><p class="meta">These recipes are not dinners on the days shown above.</p><div class="also">' + extras.map(function (id) {
      return '<button type="button" data-act="open" data-recipe="' + K.esc(id) + '"' + (id === activeId ? ' aria-current="true"' : '') + '>' + K.esc(catalog[id].title) + '</button>';
    }).join('') + '</div></section>';
  }

  function todayLine() {
    const today = easternToday();
    const todayId = K.recipeIdForDate(today, schedule, weeksDoc);
    const todayName = todayId && catalog[todayId] ? catalog[todayId].title : '';
    if (activeDate === today && activeId && activeId === todayId) return 'Today · ' + K.formatLong(today);
    if (activeDate === today && !activeId) return 'Today · ' + K.formatLong(today) + '. No dinner.';
    if (todayName && activeId !== todayId) return 'Browsing the cookbook. Today is ' + todayName + '.';
    if (!todayId) return 'Nothing is scheduled for ' + K.formatLong(today) + '.';
    return 'Today · ' + K.formatLong(today);
  }

  function deviceNote() {
    return '<details class="banner device-note"><summary>Saved on this phone only</summary><p>Download the session JSON and share that file if Scorpy should read your checks, notes, or timers. Keeping them here does not sync another device, and this public page cannot store them for you.</p></details>';
  }

  function renderRest() {
    document.body.classList.remove('cooking');
    document.title = 'No dinner · Family kitchen';
    const dayName = activeDate ? K.formatLong(activeDate) : 'This day';
    $('app').innerHTML =
      (recovery ? '<div class="banner" role="alert">' + K.esc(recovery) + '</div>' : '') +
      (notice ? '<div class="banner" role="status">' + K.esc(notice) + '</div>' : '') +
      deviceNote() +
      weekBarHtml() +
      '<p class="kicker" id="todayLine">' + K.esc(todayLine()) + '</p>' +
      '<section class="card"><h2>' + K.esc(dayName) + '</h2><p>No dinner is planned. This page does not fill the day with a guessed recipe.</p></section>' +
      mealStripHtml() +
      alsoHtml() +
      savePanel();
    paintDock();
  }

  function render() {
    renderTabs();
    const rec = recipe();
    const state = entry();
    if (!rec || !state) {
      renderRest();
      return;
    }
    document.body.classList.toggle('cooking', !!state.cookingMode);
    document.title = rec.title + ' · Family kitchen';
    const versionNote = state.recipeVersion !== rec.version
      ? '<p class="meta">The cookbook copy is version ' + rec.version + '. Your checks are from version ' + state.recipeVersion + ' and were kept.</p>'
      : '';
    const ingredients = rec.ingredients.map(function (ing) {
      const line = K.formatIngredient(ing, state.portions, rec.servings);
      const checked = state.ingredients[ing.id] && state.ingredients[ing.id].checked;
      let extra = '';
      if (ing.group === 'kids-starch') extra = ' Optional kid starch.';
      if (ing.group === 'kids') extra = ' For the kids.';
      const noteText = (line.note || '') + extra;
      const note = noteText ? '<span class="note">' + K.esc(noteText) + '</span>' : '';
      return '<label class="check' + (checked ? ' on' : '') + '"><input type="checkbox" data-kind="ingredient" data-id="' + K.esc(ing.id) + '"' + (checked ? ' checked' : '') + '><span><span class="qty" data-qty="' + K.esc(ing.id) + '">' + K.esc(line.qty) + '</span> ' + K.esc(ing.name) + note + '</span></label>';
    }).join('');
    const steps = rec.steps.map(function (step, index) {
      const checked = state.steps[step.id] && state.steps[step.id].checked;
      const timers = (step.timers || []).map(function (def) {
        const timer = state.timers[def.id];
        const clock = K.formatClock(K.timerRemaining(timer, Date.now()));
        const label = timer.status === 'running' ? 'Pause' : (timer.status === 'paused' ? 'Resume' : 'Start');
        return '<div class="timerbox" data-timer="' + K.esc(def.id) + '"><div class="readout" data-readout role="timer">' + clock + '</div><p class="meta">' + K.esc(def.label) + (def.note ? ' · ' + K.esc(def.note) : '') + '</p><div class="row"><button type="button" class="btn" data-act="toggle" data-id="' + K.esc(def.id) + '" aria-label="' + K.esc(label + ' ' + def.label + ' timer') + '">' + label + '</button><button type="button" class="btn-quiet" data-act="timer-reset" data-id="' + K.esc(def.id) + '">Reset</button></div></div>';
      }).join('');
      return '<article class="step' + (state.cookingStepId === step.id ? ' on' : '') + '" data-step="' + K.esc(step.id) + '" id="step-' + K.esc(step.id) + '"><label class="check' + (checked ? ' on' : '') + '"><input type="checkbox" data-kind="step" data-id="' + K.esc(step.id) + '"' + (checked ? ' checked' : '') + '><span><span class="step-no">Step ' + (index + 1) + '.</span> ' + K.esc(step.text) + '</span></label>' + timers + '</article>';
    }).join('');
    $('app').innerHTML =
      (recovery ? '<div class="banner" role="alert">' + K.esc(recovery) + '</div>' : '') +
      (notice ? '<div class="banner" role="status">' + K.esc(notice) + '</div>' : '') +
      deviceNote() +
      weekBarHtml() +
      '<p class="kicker" id="todayLine">' + K.esc(todayLine()) + '</p>' +
      '<section class="hero"><div class="frame"><img src="' + K.esc(rec.photo.src) + '" alt="' + K.esc(rec.photo.alt) + '"></div><div class="title-block"><h1>' + K.esc(rec.title) + '</h1><p class="lede">' + K.esc(rec.summary) + '</p>' +
      (rec.safety ? '<p class="safety">' + K.esc(rec.safety) + '</p>' : '') +
      (rec.kidSide ? '<p class="kid-side">' + K.esc(rec.kidSide) + '</p>' : '') +
      '<p class="tag">' + K.esc(rec.style) + '</p></div></section>' +
      '<p class="caption">' + K.esc(rec.photo.caption) + '</p><p class="credit">Image: ' + creditHtml(rec.photo) + (rec.photo.changes ? ' ' + K.esc(rec.photo.changes) : '') + '</p>' +
      mealStripHtml() +
      '<div class="intro-grid"><div>' + Art.illustration(rec.illustration) + '</div><div><p>' + K.esc(rec.authoring) + '</p><p class="meta">' + K.esc(rec.servingsNote) + '</p>' + versionNote + '</div></div>' +
      '<div class="row phase" role="group" aria-label="Cooking progress"><button type="button" class="btn-quiet" data-phase="prep" aria-pressed="' + (state.phase === 'prep') + '">Prep</button><button type="button" class="btn-quiet" data-phase="cooking" aria-pressed="' + (state.phase === 'cooking') + '">Cooking</button><button type="button" class="btn-quiet" data-phase="done" aria-pressed="' + (state.phase === 'done') + '">Done</button><button type="button" class="btn herb" data-act="cook" aria-pressed="' + state.cookingMode + '">' + (state.cookingMode ? 'Exit cooking mode' : 'Cooking mode') + '</button><button type="button" class="btn-quiet" data-act="today">Today</button></div>' +
      '<p id="progress" class="meta"></p>' +
      '<div class="cook-nav row"><button type="button" class="btn-quiet" data-act="prev">Previous step</button><button type="button" class="btn" data-act="next">Next step</button><button type="button" class="btn-quiet" data-act="cook">Exit</button></div>' +
      '<div class="layout"><section class="card" id="ingredients"><h2>Ingredients</h2><div class="row"><span class="stepper" role="group" aria-label="Portions"><button type="button" id="portions-dec" aria-label="Fewer portions">−</button><input id="portions" inputmode="numeric" aria-label="Number of portions" value="' + state.portions + '"><button type="button" id="portions-inc" aria-label="More portions">+</button></span><span class="meta">Scaled from ' + rec.servings + '.</span></div>' + ingredients + '</section><section class="card" id="steps"><h2>Steps</h2>' + steps + '</section></div>' +
      '<section class="card"><h2>Notes</h2><label class="field">Recipe notes<textarea id="notes" maxlength="' + K.NOTE_MAX + '"></textarea></label><p class="meta">Notes stay in the session file on this device.</p></section>' +
      alsoHtml() +
      savePanel();
    const notes = $('notes');
    notes.value = state.notes;
    paintProgress();
    paintDock();
    if (state.cookingMode) requestWake();
  }

  function savePanel() {
    return '<section class="card save-panel"><h2>Session file</h2><p class="meta">Session <span id="sessionId">' + K.esc(session.sessionId) + '</span></p><p id="savedAt" class="meta"></p><div class="row"><button type="button" class="btn" data-act="export">Download session JSON</button><button type="button" class="btn-quiet" data-act="import">Load session JSON</button><button type="button" class="btn-quiet" data-act="copy">Copy JSON</button><button type="button" class="btn-danger" data-act="reset">Reset this device</button></div><p class="meta">Schema kitchen.recipe-session version 1. Running timers store an end timestamp. Scorpy can read this file only after you send it. The week plan uses a different file and does not share these notes.</p><details><summary>View saved JSON</summary><textarea id="jsonPreview" readonly aria-label="Saved recipe session JSON"></textarea></details></section>';
  }

  function openDay(date, updateUrl) {
    const week = K.weekContaining(date, weeksDoc);
    viewWeekId = week ? week.id : K.sundayOf(date);
    activeDate = date;
    const id = K.recipeIdForDate(date, schedule, weeksDoc);
    activeId = id && catalog[id] ? id : '';
    if (activeId) K.ensureRecipeState(session, catalog[activeId], new Date());
    if (updateUrl) replaceUrl();
    render();
    persist();
  }

  function openSaved(id, updateUrl) {
    if (!catalog[id]) return;
    activeId = id;
    K.ensureRecipeState(session, catalog[id], new Date());
    const match = viewDates().find(function (date) { return K.recipeIdForDate(date, schedule, weeksDoc) === id; });
    activeDate = match || '';
    if (updateUrl) replaceUrl();
    render();
    persist();
  }

  function shiftWeek(delta) {
    const start = K.addDays(viewStart(), delta);
    openDay(start, true);
  }

  function setPortions(next) {
    const value = Math.min(24, Math.max(1, next));
    entry().portions = value;
    const input = $('portions');
    if (input) input.value = String(value);
    paintQtys();
    persist();
  }

  function moveStep(delta) {
    const steps = recipe().steps;
    const index = Math.max(0, steps.findIndex(step => step.id === entry().cookingStepId));
    const next = steps[Math.min(steps.length - 1, Math.max(0, index + delta))];
    if (!next) return;
    entry().cookingStepId = next.id;
    markStep();
    persist();
    scrollToNode(document.getElementById('step-' + next.id));
  }

  function setCooking(on) {
    const state = entry();
    if (!state) return;
    state.cookingMode = on;
    if (on && state.phase === 'prep') state.phase = 'cooking';
    document.body.classList.toggle('cooking', on);
    document.querySelectorAll('[data-act="cook"]').forEach(function (node) {
      if (node.classList.contains('herb') || node.classList.contains('btn')) node.textContent = on ? 'Exit cooking mode' : 'Cooking mode';
      node.setAttribute('aria-pressed', String(on));
    });
    if (on) requestWake(); else releaseWake();
    persist();
  }

  function ask(title, body, okLabel) {
    $('gateTitle').textContent = title;
    $('gateBody').textContent = body;
    $('gateOk').hidden = !okLabel;
    if (okLabel) $('gateOk').textContent = okLabel;
    $('gateCancel').textContent = okLabel ? 'Cancel' : 'Close';
    $('gate').showModal();
    return new Promise(function (resolve) {
      $('gate').addEventListener('close', function () { resolve($('gate').returnValue === 'ok'); }, { once: true });
    });
  }

  function download() {
    syncAll();
    persist();
    const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'kitchen-recipe-session-' + session.sessionId + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    announce('Session JSON downloaded. It stays on this device until you share the file.');
  }

  async function copyJson() {
    syncAll();
    persist();
    const text = JSON.stringify(session, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      announce('Session JSON copied.');
    } catch (e) {
      const preview = $('jsonPreview');
      if (preview) {
        preview.parentElement.open = true;
        preview.focus();
        preview.select();
      }
      announce('Clipboard is unavailable. The JSON box is selected so you can copy it.');
    }
  }

  async function importFile(file) {
    const text = await file.text();
    let result;
    try { result = K.validateRecipeSession(K.parseSessionJson(text)); }
    catch (error) { result = { ok: false, errors: [error.message] }; }
    if (!result.ok) {
      await ask('That file was not loaded', result.errors.join('\n'));
      return;
    }
    const ok = await ask('Replace this device’s recipe session?', 'Checks, notes, timers, and the session id will be replaced with the file. The week plan is not changed.', 'Replace');
    if (!ok) return;
    session = result.value;
    order.forEach(function (id) { K.ensureRecipeState(session, catalog[id], new Date()); });
    const finished = syncAll();
    if (finished.length) beep();
    if (activeId && !catalog[activeId]) activeId = '';
    if (activeId) K.ensureRecipeState(session, catalog[activeId], new Date());
    recovery = '';
    render();
    persist();
    announce('Recipe session loaded.');
  }

  async function resetSession() {
    const ok = await ask('Reset recipe progress on this device?', 'Checks, notes, timers, and the session id will be cleared. Download a backup first if you want to keep them. This does not change the week plan or the cookbook.', 'Reset');
    if (!ok) return;
    session = K.emptyRecipeSession(K.newSessionId());
    order.forEach(function (id) { K.ensureRecipeState(session, catalog[id], new Date()); });
    recovery = '';
    notice = '';
    openDay(easternToday(), true);
    announce('Recipe session reset on this device.');
  }

  function onClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    const act = button.dataset.act;
    if (act === 'day') openDay(button.dataset.date, true);
    if (act === 'open') openSaved(button.dataset.recipe, true);
    if (act === 'today') openDay(easternToday(), true);
    if (act === 'prev-week') shiftWeek(-7);
    if (act === 'next-week') shiftWeek(7);
    if (act === 'export') download();
    if (act === 'import') $('file').click();
    if (act === 'copy') copyJson();
    if (act === 'reset') resetSession();
    if (act === 'jump') {
      openSaved(button.dataset.recipe, true);
      if (entry()) {
        entry().cookingStepId = button.dataset.step;
        markStep();
        scrollToNode(document.getElementById('step-' + button.dataset.step));
        persist();
      }
    }
    if (act === 'dock-toggle') {
      const recipeId = button.dataset.recipe;
      const bucket = session.recipes[recipeId];
      if (bucket && bucket.timers[button.dataset.id]) {
        const timer = bucket.timers[button.dataset.id];
        const now = Date.now();
        let next;
        if (timer.status === 'running') next = K.pauseTimer(timer, now);
        else if (timer.status === 'paused') next = K.resumeTimer(timer, now);
        else next = K.resetTimer(timer, now);
        bucket.timers[button.dataset.id] = next;
        persist();
        if (recipeId === activeId) paintTimer(button.dataset.id);
        paintDock();
      }
    }
    if (!entry()) return;
    if (act === 'cook') setCooking(!entry().cookingMode);
    if (act === 'next') moveStep(1);
    if (act === 'prev') moveStep(-1);
    if (button.dataset.phase) {
      entry().phase = button.dataset.phase;
      document.querySelectorAll('[data-phase]').forEach(function (node) {
        node.setAttribute('aria-pressed', String(node.dataset.phase === entry().phase));
      });
      persist();
    }
    if (act === 'toggle') {
      const id = button.dataset.id;
      const timer = entry().timers[id];
      const now = Date.now();
      entry().timers[id] = timer.status === 'running' ? K.pauseTimer(timer, now) : (timer.status === 'paused' ? K.resumeTimer(timer, now) : K.startTimer(timer, now));
      persist();
      paintTimer(id);
      paintDock();
    }
    if (act === 'timer-reset') {
      const id = button.dataset.id;
      entry().timers[id] = K.resetTimer(entry().timers[id], Date.now());
      persist();
      paintTimer(id);
      paintDock();
    }
    if (button.id === 'portions-dec') setPortions(entry().portions - 1);
    if (button.id === 'portions-inc') setPortions(entry().portions + 1);
  }

  function onChange(event) {
    const input = event.target;
    if (!entry()) return;
    if (input.dataset.kind === 'ingredient' || input.dataset.kind === 'step') {
      const bucket = input.dataset.kind === 'ingredient' ? entry().ingredients : entry().steps;
      bucket[input.dataset.id].checked = input.checked;
      input.closest('.check').classList.toggle('on', input.checked);
      persist();
      paintProgress();
    }
  }

  function onInput(event) {
    if (!entry()) return;
    if (event.target.id === 'notes') {
      entry().notes = event.target.value.slice(0, K.NOTE_MAX);
      persist();
    }
    if (event.target.id === 'portions') {
      const value = parseInt(event.target.value, 10);
      if (Number.isInteger(value)) setPortions(value);
    }
  }

  function tick() {
    const finished = syncAll();
    paintTimers();
    paintDock();
    if (finished.length) {
      finished.forEach(function (label) { announce(label + ' timer finished'); });
      beep();
      persist();
    }
  }

  async function boot() {
    const responses = await Promise.all([
      fetch('data/recipes.json', { cache: 'no-cache' }),
      fetch('data/schedule.json', { cache: 'no-cache' }),
      fetch('../planner/data/weeks.json', { cache: 'no-cache' })
    ]);
    if (responses.some(response => !response.ok)) throw new Error('cookbook');
    const recipesDoc = await responses[0].json();
    schedule = await responses[1].json();
    weeksDoc = await responses[2].json();
    order = recipesDoc.recipes.map(function (item) { return item.id; });
    catalog = {};
    recipesDoc.recipes.forEach(function (item) { catalog[item.id] = item; });
    session = loadSession();
    order.forEach(function (id) { K.ensureRecipeState(session, catalog[id], new Date()); });
    const params = new URLSearchParams(location.search);
    const requestedDate = params.get('date');
    const requested = params.get('recipe');
    const today = easternToday();
    if (requested && !catalog[requested]) notice = 'That dinner is not in the cookbook.';
    if (requestedDate && DATE_RE.test(requestedDate)) {
      const week = K.weekContaining(requestedDate, weeksDoc);
      viewWeekId = week ? week.id : K.sundayOf(requestedDate);
      const fromDate = K.recipeIdForDate(requestedDate, schedule, weeksDoc);
      if (requested && catalog[requested] && requested !== fromDate) {
        activeId = requested;
        const match = viewDates().find(function (date) { return K.recipeIdForDate(date, schedule, weeksDoc) === requested; });
        activeDate = match || '';
      } else {
        activeDate = requestedDate;
        activeId = fromDate && catalog[fromDate] ? fromDate : '';
      }
    } else if (requested && catalog[requested]) {
      activeId = requested;
      let foundWeek = null;
      let foundDate = '';
      (weeksDoc.weeks || []).forEach(function (week) {
        (week.days || []).forEach(function (day) {
          if (!foundWeek && day.recipeId === requested) {
            foundWeek = week;
            foundDate = day.date;
          }
        });
      });
      if (!foundDate) {
        Object.keys(schedule.days || {}).forEach(function (date) {
          if (!foundDate && schedule.days[date].recipeId === requested) foundDate = date;
        });
      }
      if (foundWeek) viewWeekId = foundWeek.id;
      else viewWeekId = K.defaultWeekId(weeksDoc, today);
      activeDate = foundDate && viewDates().indexOf(foundDate) !== -1 ? foundDate : '';
    } else {
      const week = K.weekContaining(today, weeksDoc);
      viewWeekId = week ? week.id : K.defaultWeekId(weeksDoc, today);
      const scheduled = K.recipeIdForDate(today, schedule, weeksDoc);
      if (week || (scheduled && viewDates().indexOf(today) !== -1)) {
        activeDate = today;
        activeId = scheduled && catalog[scheduled] ? scheduled : '';
      } else if (scheduled && catalog[scheduled]) {
        activeId = scheduled;
        activeDate = '';
      } else {
        activeDate = viewStart();
        activeId = '';
      }
    }
    if (activeId) K.ensureRecipeState(session, catalog[activeId], new Date());
    const finished = syncAll();
    render();
    persist();
    if (finished.length) {
      beep();
      announce(finished.join(', ') + ' finished while the page was closed');
    }
    document.body.addEventListener('click', onClick);
    document.body.addEventListener('change', onChange);
    document.body.addEventListener('input', onInput);
    $('file').addEventListener('change', function () {
      const file = $('file').files && $('file').files[0];
      $('file').value = '';
      if (file) importFile(file);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && entry() && entry().cookingMode && !$('gate').open) setCooking(false);
    });
    document.addEventListener('visibilitychange', function () {
      const finishedNow = syncAll();
      paintTimers();
      paintDock();
      if (finishedNow.length) {
        beep();
        announce(finishedNow.join(', ') + ' timer finished');
      }
      persist();
      if (document.visibilityState === 'visible' && entry() && entry().cookingMode) requestWake();
    });
    window.addEventListener('pageshow', function () { syncAll(); paintTimers(); paintDock(); persist(); });
    tickHandle = setInterval(tick, 500);
  }

  boot().catch(function () {
    $('app').innerHTML = '<p class="banner" role="alert">The cookbook could not be loaded. Check the connection and reopen this page.</p>';
  });
})();
