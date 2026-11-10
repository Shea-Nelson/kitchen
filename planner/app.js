(function () {
  'use strict';
  const K = window.KitchenState;
  const $ = id => document.getElementById(id);
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  let catalog = {};
  let weeksDoc = { weeks: [] };
  let session = null;
  let recovery = '';

  function announce(text) { $('live').textContent = text; }

  function easternToday() { return K.easternISODate(new Date()); }

  function scrollToNode(node, immediate) {
    if (!node) return;
    const reduce = immediate || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    node.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
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

  function publishedWeek(id) {
    return (weeksDoc.weeks || []).find(function (week) { return week.id === id; }) || null;
  }

  function defaultWeekId() {
    return K.defaultWeekId(weeksDoc, easternToday());
  }

  function viewSunday() {
    return K.sundayOf(session.viewWeekId || defaultWeekId());
  }

  function loadSession() {
    const raw = localStorage.getItem(K.PLANNER_STORAGE_KEY);
    if (!raw) return K.emptyPlannerSession(K.newSessionId());
    try {
      const result = K.validatePlannerSession(K.parseSessionJson(raw));
      if (!result.ok) throw new Error(result.errors.join('\n'));
      return result.value;
    } catch (error) {
      localStorage.setItem(K.PLANNER_STORAGE_KEY + '.unreadable', raw);
      recovery = 'The saved week session on this device could not be read. A copy remains under the local key kitchen.planner.session.v1.unreadable. A new session was started.\n' + error.message;
      return K.emptyPlannerSession(K.newSessionId());
    }
  }

  function persist() {
    const now = new Date();
    session.updatedAt = now.toISOString();
    const text = JSON.stringify(session, null, 2);
    localStorage.setItem(K.PLANNER_STORAGE_KEY, text);
    const stamp = $('savedAt');
    if (stamp) stamp.textContent = 'Saved on this device at ' + now.toLocaleString() + '. Not sent anywhere.';
    const preview = $('jsonPreview');
    if (preview && document.activeElement !== preview) preview.value = text;
  }

  function dayRecord(week, date) {
    return ((week && week.days) || []).find(function (day) { return day.date === date; }) || null;
  }

  function stateFor(date, create) {
    const sunday = viewSunday();
    const week = publishedWeek(sunday);
    const record = dayRecord(week, date);
    if (!session.weeks[sunday]) {
      if (!create && !record) return null;
      session.weeks[sunday] = { notes: '', days: {} };
    }
    const bucket = session.weeks[sunday];
    if (!bucket.days[date]) {
      if (!create && !record) return null;
      const recipe = record && record.recipeId ? catalog[record.recipeId] : null;
      bucket.days[date] = {
        plannedRecipeId: record && record.recipeId ? record.recipeId : null,
        overrideRecipeId: null,
        servings: record ? record.servings : 6,
        notes: '',
        favorite: false,
        rating: null,
        cookedAt: null,
        status: 'planned',
        tasks: {},
        customTasks: []
      };
      if (recipe) recipe.tasks.forEach(function (task) { bucket.days[date].tasks[task.id] = { checked: false }; });
    } else if (record) {
      bucket.days[date].plannedRecipeId = record.recipeId || null;
      const recipeId = K.effectiveRecipeId(record, bucket.days[date]);
      const recipe = catalog[recipeId];
      if (recipe) recipe.tasks.forEach(function (task) {
        if (!bucket.days[date].tasks[task.id]) bucket.days[date].tasks[task.id] = { checked: false };
      });
    }
    return bucket.days[date];
  }

  function photoSrc(recipe) {
    return '../recipes/' + recipe.photo.src;
  }

  function checkedCount(state, recipe) {
    if (!recipe) return { done: 0, total: 0 };
    const total = recipe.tasks.length + state.customTasks.length;
    const done = recipe.tasks.filter(function (task) { return state.tasks[task.id] && state.tasks[task.id].checked; }).length
      + state.customTasks.filter(function (task) { return task.checked; }).length;
    return { done: done, total: total };
  }

  function renderTabs(dates, week) {
    const slot = $('day-tabs');
    if (!slot) return;
    const today = easternToday();
    slot.innerHTML = '<div class="day-tabs" role="tablist" aria-label="Days this week">' + dates.map(function (date) {
      const record = dayRecord(week, date);
      const selected = session.selectedDate === date;
      const dow = date === today ? 'Today' : K.weekdayName(date).slice(0, 3);
      const name = record ? record.title : 'Nothing planned';
      return '<button type="button" role="tab" class="' + (date === today ? 'is-today' : '') + '" data-act="select" data-date="' + date + '" aria-selected="' + selected + '" aria-label="' + K.esc(K.formatLong(date) + '. ' + name) + '"><span class="dow">' + K.esc(dow) + '</span><span class="dom">' + Number(date.slice(8)) + '</span></button>';
    }).join('') + '</div>';
  }

  function render() {
    const sunday = viewSunday();
    session.viewWeekId = sunday;
    const week = publishedWeek(sunday);
    const dates = Array.from({ length: 7 }, function (_, index) { return K.addDays(sunday, index); });
    if (!session.selectedDate || dates.indexOf(session.selectedDate) === -1) {
      const today = easternToday();
      session.selectedDate = dates.indexOf(today) !== -1 ? today : dates[0];
    }
    dates.forEach(function (date) { if (dayRecord(week, date)) stateFor(date, true); });
    renderTabs(dates, week);
    const today = easternToday();
    const todayInside = today >= sunday && today <= K.addDays(sunday, 6);
    let intro = week
      ? week.title + '. ' + (weeksDoc.household || '')
      : 'No meals are published for ' + K.formatLong(sunday) + ' through ' + K.formatLong(K.addDays(sunday, 6)) + '. Empty days are not filled with guessed dinners.';
    if (week && !todayInside) intro = 'Showing the published week of ' + week.title + '. Today is ' + K.formatLong(today) + '.';
    $('app').innerHTML =
      (recovery ? '<div class="banner" role="alert">' + K.esc(recovery) + '</div>' : '') +
      '<details class="banner device-note"><summary>Saved on this phone only</summary><p>Download the planner JSON and share that file if Scorpy should read your checks, swaps, notes, or ratings. Keeping them here does not sync another device, and this public page cannot store them for you.</p></details>' +
      '<div class="week-bar row"><button type="button" class="btn-quiet" data-act="prev-week">Previous week</button><strong>' + K.esc(K.formatLong(sunday)) + ' – ' + K.esc(K.formatLong(K.addDays(sunday, 6))) + '</strong><button type="button" class="btn-quiet" data-act="next-week">Next week</button><button type="button" class="btn herb" data-act="published">This week</button></div>' +
      printRoster(dates, week) +
      detailHtml(sunday, week) +
      '<p class="intro">' + K.esc(intro) + '</p>' +
      groceryHtml(sunday, week) +
      historyHtml() +
      savePanel();
    const dayNotes = $('day-notes');
    if (dayNotes) dayNotes.value = (stateFor(session.selectedDate, false) || {}).notes || '';
    const weekNotes = $('week-notes');
    if (weekNotes) weekNotes.value = (session.weeks[sunday] && session.weeks[sunday].notes) || '';
    const preview = $('jsonPreview');
    if (preview) preview.value = JSON.stringify(session, null, 2);
    const stamp = $('savedAt');
    if (stamp) stamp.textContent = 'Saved on this device at ' + new Date(session.updatedAt).toLocaleString() + '. Not sent anywhere.';
  }

  function mealBlock(record) {
    if (!record) return '';
    return '<div class="meal-strip"><div class="meal"><b>Breakfast</b><span>' + K.esc(record.breakfast || 'Not listed') + '</span></div><div class="meal"><b>Lunch</b><span>' + K.esc(record.lunch || 'Not listed') + '</span></div><div class="meal"><b>Dinner</b><span>' + K.esc(record.dinnerNote || record.title || '') + '</span></div></div>';
  }

  function printRoster(dates, week) {
    const lines = dates.map(function (date) {
      const record = dayRecord(week, date);
      if (!record) return '<li>' + K.esc(K.formatLong(date)) + ': nothing planned</li>';
      return '<li><strong>' + K.esc(K.formatLong(date)) + '</strong> Breakfast: ' + K.esc(record.breakfast || '') + '. Lunch: ' + K.esc(record.lunch || '') + '. Dinner: ' + K.esc(record.dinnerNote || record.title || '') + '</li>';
    }).join('');
    return '<section class="print-only"><h1>' + K.esc(week ? week.title : 'Week plan') + '</h1><ul>' + lines + '</ul></section>';
  }

  function detailHtml(sunday, week) {
    const date = session.selectedDate;
    const record = dayRecord(week, date);
    const state = stateFor(date, false);
    if (!record || !state) {
      return '<section class="card day-detail' + (date === easternToday() ? ' is-today' : '') + '" id="day-detail"><h2>' + K.esc(K.formatLong(date)) + '</h2><p>Nothing is planned. The week file has no dinner for this date, so this page does not invent one.</p><label class="field">Note for this date<textarea id="day-notes" maxlength="' + K.NOTE_MAX + '"></textarea></label></section>';
    }
    const recipeId = K.effectiveRecipeId(record, state);
    const recipe = recipeId ? catalog[recipeId] : null;
    const cookHref = '../recipes/?date=' + encodeURIComponent(date) + (recipeId ? '&recipe=' + encodeURIComponent(recipeId) : '');
    const cook = recipe
      ? '<a class="cook-launch" href="' + cookHref + '">Cook ' + K.esc(recipe.title) + '</a>'
      : '<a class="btn-quiet" href="' + cookHref + '">Open this day in recipes</a>';
    const options = Object.keys(catalog).map(function (id) {
      return '<option value="' + K.esc(id) + '"' + (id === recipeId ? ' selected' : '') + '>' + K.esc(catalog[id].title) + '</option>';
    }).join('');
    const tasks = (recipe ? recipe.tasks : []).map(function (task) {
      const checked = state.tasks[task.id] && state.tasks[task.id].checked;
      return '<label class="check' + (checked ? ' on' : '') + '"><input type="checkbox" data-kind="task" data-id="' + K.esc(task.id) + '"' + (checked ? ' checked' : '') + '><span>' + K.esc(task.label) + '</span></label>';
    }).join('');
    const custom = state.customTasks.map(function (task) {
      return '<label class="check' + (task.checked ? ' on' : '') + '"><input type="checkbox" data-kind="custom" data-id="' + K.esc(task.id) + '"' + (task.checked ? ' checked' : '') + '><span>' + K.esc(task.label) + '</span></label><button type="button" class="btn-quiet" data-act="remove-task" data-id="' + K.esc(task.id) + '">Remove</button>';
    }).join('');
    const stars = [1, 2, 3, 4, 5].map(function (score) {
      return '<button type="button" data-act="rate" data-score="' + score + '" aria-pressed="' + (state.rating === score) + '" aria-label="' + score + ' star' + (score > 1 ? 's' : '') + '">' + score + '</button>';
    }).join('');
    const swapNote = state.overrideRecipeId ? '<p class="meta">The published plan says ' + K.esc(record.title) + '.</p>' : '';
    const swap = recipe ? '<label class="field">Dinner<select id="swap">' + options + '</select></label>' + swapNote + '<label class="field">Servings<input id="servings" inputmode="numeric" value="' + state.servings + '"></label>' : '';
    const counts = recipe ? checkedCount(state, recipe) : { done: 0, total: 0 };
    const heading = recipe
      ? '<h2><a href="' + cookHref + '">' + K.esc(recipe.title) + '</a></h2>'
      : '<h2>' + K.esc(record.title) + '</h2>';
    return '<section class="card day-detail' + (date === easternToday() ? ' is-today' : '') + '" id="day-detail"><p class="kicker">' + K.esc(K.formatLong(date)) + (date === easternToday() ? ' · today' : '') + '</p>' + heading +
      cook + mealBlock(record) +
      (counts.total ? '<p class="meta">' + counts.done + ' of ' + counts.total + ' prep tasks</p>' : '') +
      (recipe ? '<div class="frame"><img src="' + K.esc(photoSrc(recipe)) + '" alt="' + K.esc(recipe.photo.alt) + '"></div><p class="caption">' + K.esc(recipe.photo.caption) + '</p><p class="credit">Image: ' + creditHtml(recipe.photo) + '</p><p class="meta">' + K.esc(recipe.summary) + '</p>' + (recipe.safety ? '<p class="safety">' + K.esc(recipe.safety) + '</p>' : '') : '<p>' + K.esc(record.dinnerNote || 'No dinner is planned.') + '</p>') +
      swap +
      '<div class="row"><button type="button" class="btn-quiet" data-act="favorite" aria-pressed="' + state.favorite + '">' + (state.favorite ? 'Favorited' : 'Favorite') + '</button><button type="button" class="btn" data-act="cooked">' + (state.cookedAt ? 'Clear cooked mark' : 'Mark cooked') + '</button></div>' +
      '<div class="stars row" role="group" aria-label="Rating">' + stars + '</div>' +
      (recipe ? '<h3 class="group-label">Prep tasks</h3>' + tasks : '') + custom +
      '<div class="row"><input id="new-task" type="text" maxlength="160" placeholder="Add a prep task" aria-label="New prep task"><button type="button" class="btn-quiet" data-act="add-task">Add task</button></div>' +
      '<label class="field">Notes for this dinner<textarea id="day-notes" maxlength="' + K.NOTE_MAX + '"></textarea></label></section>';
  }

  function pantrySelect(key) {
    const value = session.pantry[key] || 'unsure';
    return '<label class="meta">Pantry <select data-pantry="' + K.esc(key) + '"><option value="unsure"' + (value === 'unsure' ? ' selected' : '') + '>Not sure</option><option value="have"' + (value === 'have' ? ' selected' : '') + '>In the pantry</option><option value="need"' + (value === 'need' ? ' selected' : '') + '>Need to buy</option></select></label>';
  }

  function curatedGrocery(sunday, week) {
    const sections = K.grocerySections(week);
    if (!session.groceryChecked[sunday]) session.groceryChecked[sunday] = {};
    const checks = session.groceryChecked[sunday];
    const swapped = (week.days || []).some(function (day) {
      const state = session.weeks[sunday] && session.weeks[sunday].days[day.date];
      return state && state.overrideRecipeId;
    });
    const body = sections.map(function (section) {
      const rows = section.items.map(function (item) {
        const checked = !!checks[item.key];
        const pantry = item.pantry ? pantrySelect(item.key) : '';
        return '<label class="check' + (checked ? ' on' : '') + '"><input type="checkbox" data-kind="grocery" data-key="' + K.esc(item.key) + '"' + (checked ? ' checked' : '') + '><span>' + K.esc(item.label) + '</span></label>' + pantry;
      }).join('');
      return '<h3 class="group-label">' + K.esc(section.title) + '</h3>' + rows;
    }).join('');
    return '<section class="card grocery-block" id="grocery"><div class="row"><h2>Grocery list</h2><button type="button" class="btn-quiet no-print" data-act="print">Print list</button></div><p class="meta">' + K.esc(week.groceryNote || 'Nothing here orders food.') + '</p>' +
      '<p class="no-print"><a href="../shopping/?week=' + encodeURIComponent(sunday) + '">Open the Shopping page</a> for big check boxes, items you add, and a copy to share.</p>' +
      (swapped ? '<p class="meta">A dinner on this phone is swapped. This is still the published list, not the swap. Open that recipe before you shop for it.</p>' : '') +
      body + '<label class="field">Notes for the week<textarea id="week-notes" maxlength="' + K.NOTE_MAX + '"></textarea></label></section>';
  }

  function groceryHtml(sunday, week) {
    if (!week) return '<section class="card" id="grocery"><h2>Grocery list</h2><p>No published plan for this week, so there is no grocery list to build. This checklist never orders food.</p></section>';
    if (K.grocerySections(week).length) return curatedGrocery(sunday, week);
    const dayStates = {};
    (session.weeks[sunday] ? Object.keys(session.weeks[sunday].days) : []).forEach(function (date) {
      const state = session.weeks[sunday].days[date];
      dayStates[date] = { overrideRecipeId: state.overrideRecipeId, servings: state.servings };
    });
    const list = K.aggregateGrocery(week, catalog, dayStates);
    if (!session.groceryChecked[sunday]) session.groceryChecked[sunday] = {};
    const checks = session.groceryChecked[sunday];
    function rows(items, kind) {
      return items.map(function (item) {
        const checked = !!checks[item.key];
        const pantry = kind === 'pantry'
          ? '<label class="meta">Pantry <select data-pantry="' + K.esc(item.groceryKey) + '"><option value="unsure"' + ((session.pantry[item.groceryKey] || 'unsure') === 'unsure' ? ' selected' : '') + '>Not sure</option><option value="have"' + (session.pantry[item.groceryKey] === 'have' ? ' selected' : '') + '>In the pantry</option><option value="need"' + (session.pantry[item.groceryKey] === 'need' ? ' selected' : '') + '>Need to buy</option></select></label>'
          : '';
        return '<label class="check' + (checked ? ' on' : '') + '"><input type="checkbox" data-kind="grocery" data-key="' + K.esc(item.key) + '"' + (checked ? ' checked' : '') + '><span>' + K.esc(item.label) + '</span></label>' + pantry;
      }).join('');
    }
    const plain = list.unscaled.map(function (item) {
      const checked = !!checks[item.key];
      return '<label class="check' + (checked ? ' on' : '') + '"><input type="checkbox" data-kind="grocery" data-key="' + K.esc(item.key) + '"' + (checked ? ' checked' : '') + '><span>' + K.esc(item.name) + (item.detail ? ' · ' + K.esc(item.detail) : '') + '</span></label>';
    }).join('');
    return '<section class="card grocery-block" id="grocery"><h2>Grocery checklist</h2><p class="meta">Amounts add up only when the cookbook lists a number and the same unit. Optional kid starch stays in its own list. Nothing here orders food.</p><h3 class="group-label">Shop</h3>' + (rows(list.shop, 'shop') || '<p>No numbered shop items.</p>') + '<h3 class="group-label">Pantry</h3>' + (rows(list.pantry, 'pantry') || '<p>No pantry items.</p>') + '<h3 class="group-label">Optional starch for kids</h3>' + (rows(list.kidsStarch, 'kids') || '<p>No optional starch on this plan.</p>') + (plain ? '<h3 class="group-label">Listed without a sum</h3>' + plain : '') + '<label class="field">Notes for the week<textarea id="week-notes" maxlength="' + K.NOTE_MAX + '"></textarea></label></section>';
  }

  function historyHtml() {
    const rows = [];
    Object.keys(session.weeks).forEach(function (weekId) {
      const days = session.weeks[weekId].days || {};
      Object.keys(days).forEach(function (date) {
        const day = days[date];
        if (!day.cookedAt && !day.favorite && !day.rating) return;
        const recipe = catalog[day.overrideRecipeId || day.plannedRecipeId];
        rows.push({ date: date, day: day, title: recipe ? recipe.title : 'Dinner' });
      });
    });
    rows.sort(function (a, b) { return (b.day.cookedAt || '').localeCompare(a.day.cookedAt || '') || b.date.localeCompare(a.date); });
    const body = rows.length ? rows.map(function (row) {
      const bits = [K.formatLong(row.date), row.title];
      if (row.day.cookedAt) bits.push('cooked ' + new Date(row.day.cookedAt).toLocaleString());
      if (row.day.favorite) bits.push('favorite');
      if (row.day.rating) bits.push(row.day.rating + ' of 5');
      return '<li>' + K.esc(bits.join(' · ')) + '</li>';
    }).join('') : '<li>Nothing is marked cooked, favorited, or rated yet.</li>';
    return '<section class="card"><h2>Cook history</h2><ul>' + body + '</ul><p class="meta">This list is read from the day records in the session file. It is not a second copy.</p></section>';
  }

  function savePanel() {
    return '<section class="card save-panel"><h2>Session file</h2><p class="meta">Session <span id="sessionId">' + K.esc(session.sessionId) + '</span></p><p id="savedAt" class="meta"></p><div class="row"><button type="button" class="btn" data-act="export">Download planner JSON</button><button type="button" class="btn-quiet" data-act="import">Load planner JSON</button><button type="button" class="btn-quiet" data-act="copy">Copy JSON</button><button type="button" class="btn-danger" data-act="reset">Reset this device</button></div><p class="meta">Schema kitchen.planner-session version 1. The daily recipe app keeps a separate file. Scorpy can read this one only after you send it.</p><details><summary>View saved JSON</summary><textarea id="jsonPreview" readonly aria-label="Saved planner session JSON"></textarea></details></section>';
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
    persist();
    const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'kitchen-planner-session-' + session.sessionId + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    announce('Planner JSON downloaded. It stays on this device until you share the file.');
  }

  async function copyJson() {
    persist();
    const text = JSON.stringify(session, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      announce('Planner JSON copied.');
    } catch (e) {
      const preview = $('jsonPreview');
      if (preview) { preview.parentElement.open = true; preview.focus(); preview.select(); }
      announce('Clipboard is unavailable. The JSON box is selected so you can copy it.');
    }
  }

  async function importFile(file) {
    const text = await file.text();
    let result;
    try { result = K.validatePlannerSession(K.parseSessionJson(text)); }
    catch (error) { result = { ok: false, errors: [error.message] }; }
    if (!result.ok) {
      await ask('That file was not loaded', result.errors.join('\n'));
      return;
    }
    const ok = await ask('Replace this device’s week session?', 'Checks, swaps, notes, ratings, and the session id will be replaced with the file. The daily recipe session is not changed.', 'Replace');
    if (!ok) return;
    session = result.value;
    recovery = '';
    if (!session.viewWeekId) session.viewWeekId = defaultWeekId();
    render();
    persist();
    announce('Planner session loaded.');
  }

  async function resetSession() {
    const ok = await ask('Reset the week plan on this device?', 'Checks, swaps, notes, ratings, and the session id will be cleared. Download a backup first if you want to keep them. The cookbook and the daily recipe session stay as they are.', 'Reset');
    if (!ok) return;
    session = K.emptyPlannerSession(K.newSessionId());
    session.viewWeekId = defaultWeekId();
    recovery = '';
    render();
    persist();
    announce('Week session reset on this device.');
  }

  function onClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    const act = button.dataset.act;
    if (act === 'select') {
      session.selectedDate = button.dataset.date;
      const url = new URL(location.href);
      url.searchParams.set('date', session.selectedDate);
      history.replaceState(null, '', url);
      render();
      persist();
      scrollToNode($('day-detail'));
    }
    if (act === 'prev-week' || act === 'next-week') {
      session.viewWeekId = K.addDays(viewSunday(), act === 'next-week' ? 7 : -7);
      session.selectedDate = session.viewWeekId;
      const url = new URL(location.href);
      url.searchParams.set('date', session.selectedDate);
      history.replaceState(null, '', url);
      render();
      persist();
    }
    if (act === 'published') {
      session.viewWeekId = defaultWeekId();
      session.selectedDate = easternToday();
      const url = new URL(location.href);
      url.searchParams.delete('date');
      history.replaceState(null, '', url);
      render();
      persist();
    }
    if (act === 'print') window.print();
    if (act === 'favorite') {
      const state = stateFor(session.selectedDate, true);
      state.favorite = !state.favorite;
      render();
      persist();
    }
    if (act === 'cooked') {
      const state = stateFor(session.selectedDate, true);
      if (state.cookedAt) {
        state.cookedAt = null;
        if (state.status === 'cooked') state.status = 'planned';
      } else {
        state.cookedAt = new Date().toISOString();
        state.status = 'cooked';
      }
      render();
      persist();
    }
    if (act === 'rate') {
      const state = stateFor(session.selectedDate, true);
      const score = Number(button.dataset.score);
      state.rating = state.rating === score ? null : score;
      render();
      persist();
    }
    if (act === 'add-task') {
      const input = $('new-task');
      const label = (input.value || '').trim();
      if (!label) return;
      const state = stateFor(session.selectedDate, true);
      state.customTasks.push({ id: K.newTaskId(), label: label.slice(0, 160), checked: false });
      render();
      persist();
    }
    if (act === 'remove-task') {
      const state = stateFor(session.selectedDate, true);
      state.customTasks = state.customTasks.filter(function (task) { return task.id !== button.dataset.id; });
      render();
      persist();
    }
    if (act === 'export') download();
    if (act === 'import') $('file').click();
    if (act === 'copy') copyJson();
    if (act === 'reset') resetSession();
  }

  function onChange(event) {
    const input = event.target;
    if (input.dataset.kind === 'task' || input.dataset.kind === 'custom' || input.dataset.kind === 'grocery') {
      const state = stateFor(session.selectedDate, true);
      if (input.dataset.kind === 'task') state.tasks[input.dataset.id].checked = input.checked;
      if (input.dataset.kind === 'custom') {
        const task = state.customTasks.find(function (item) { return item.id === input.dataset.id; });
        if (task) task.checked = input.checked;
      }
      if (input.dataset.kind === 'grocery') {
        const sunday = viewSunday();
        if (!session.groceryChecked[sunday]) session.groceryChecked[sunday] = {};
        session.groceryChecked[sunday][input.dataset.key] = input.checked;
      }
      input.closest('.check').classList.toggle('on', input.checked);
      persist();
    }
    if (input.id === 'swap') {
      const state = stateFor(session.selectedDate, true);
      state.overrideRecipeId = input.value === state.plannedRecipeId ? null : input.value;
      const recipe = catalog[input.value];
      if (recipe) recipe.tasks.forEach(function (task) {
        if (!state.tasks[task.id]) state.tasks[task.id] = { checked: false };
      });
      render();
      persist();
    }
    if (input.dataset.pantry) {
      session.pantry[input.dataset.pantry] = input.value;
      persist();
    }
    if (input.id === 'servings') {
      const value = parseInt(input.value, 10);
      if (!Number.isInteger(value)) return;
      stateFor(session.selectedDate, true).servings = Math.min(24, Math.max(1, value));
      render();
      persist();
    }
  }

  function onInput(event) {
    if (event.target.id === 'day-notes') {
      stateFor(session.selectedDate, true).notes = event.target.value.slice(0, K.NOTE_MAX);
      persist();
    }
    if (event.target.id === 'week-notes') {
      const sunday = viewSunday();
      if (!session.weeks[sunday]) session.weeks[sunday] = { notes: '', days: {} };
      session.weeks[sunday].notes = event.target.value.slice(0, K.NOTE_MAX);
      persist();
    }
  }

  async function boot() {
    const responses = await Promise.all([
      fetch('../recipes/data/recipes.json', { cache: 'no-cache' }),
      fetch('data/weeks.json', { cache: 'no-cache' })
    ]);
    if (responses.some(function (response) { return !response.ok; })) throw new Error('plan');
    const recipesDoc = await responses[0].json();
    weeksDoc = await responses[1].json();
    recipesDoc.recipes.forEach(function (item) { catalog[item.id] = item; });
    session = loadSession();
    const params = new URLSearchParams(location.search);
    const requested = params.get('date');
    if (requested && DATE_RE.test(requested)) {
      const containing = K.weekContaining(requested, weeksDoc);
      session.viewWeekId = containing ? containing.id : K.sundayOf(requested);
      session.selectedDate = requested;
    } else {
      session.viewWeekId = defaultWeekId();
      session.selectedDate = easternToday();
    }
    render();
    persist();
    if (location.hash === '#grocery') scrollToNode($('grocery'), true);
    document.body.addEventListener('click', onClick);
    document.body.addEventListener('change', onChange);
    document.body.addEventListener('input', onInput);
    $('file').addEventListener('change', function () {
      const file = $('file').files && $('file').files[0];
      $('file').value = '';
      if (file) importFile(file);
    });
  }

  boot().catch(function () {
    $('app').innerHTML = '<p class="banner" role="alert">The week plan could not be loaded. Check the connection and reopen this page.</p>';
  });
})();
