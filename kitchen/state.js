/* Shared session logic for the daily recipe app and the week planner.
   Classic script in the browser (window.KitchenState) and CommonJS in tests.
   User progress stays in this object. Recipe definitions live in JSON files. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.KitchenState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RECIPE_SCHEMA = 'kitchen.recipe-session';
  const PLANNER_SCHEMA = 'kitchen.planner-session';
  const SCHEMA_VERSION = 1;
  const RECIPE_STORAGE_KEY = 'kitchen.recipe.session.v1';
  const PLANNER_STORAGE_KEY = 'kitchen.planner.session.v1';
  const NOTE_MAX = 20000;
  const TIMER_MAX_MS = 12 * 60 * 60 * 1000;
  const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const SESSION_RE = /^ks_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TASK_ID_RE = /^(?:[a-z0-9][a-z0-9-]{0,63}|ct_[0-9a-f]{12})$/;
  const ITEM_KEY_RE = /^[a-z0-9][a-z0-9|._-]{0,140}$/;
  const PANTRY_VALUES = ['unsure', 'have', 'need'];
  const PHASES = ['prep', 'cooking', 'done'];
  const DAY_STATUS = ['planned', 'prepping', 'cooked'];

  function newSessionId() {
    const uuid = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : fallbackUuid();
    return 'ks_' + uuid;
  }

  function newTaskId() {
    const uuid = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : fallbackUuid();
    return 'ct_' + uuid.replace(/-/g, '').slice(0, 12);
  }

  function fallbackUuid() {
    const bytes = new Uint8Array(16);
    if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function parseSessionJson(text) {
    if (typeof text !== 'string') throw new Error('Session file must be text.');
    if (text.length > 1500000) throw new Error('Session file is too large.');
    return JSON.parse(text, function (key, value) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const clean = {};
        for (const k of Object.keys(value)) {
          if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
          clean[k] = value[k];
        }
        return clean;
      }
      return value;
    });
  }

  function fail(errors) {
    return { ok: false, errors: errors, value: null };
  }

  function isIso(value) {
    if (typeof value !== 'string' || value.length < 16 || value.length > 40) return false;
    const time = Date.parse(value);
    return Number.isFinite(time);
  }

  function isId(value) {
    return typeof value === 'string' && ID_RE.test(value);
  }

  function emptyRecipeSession(sessionId, now) {
    return {
      schema: RECIPE_SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      sessionId: sessionId,
      updatedAt: (now || new Date()).toISOString(),
      recipes: {}
    };
  }

  function emptyPlannerSession(sessionId, now) {
    return {
      schema: PLANNER_SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      sessionId: sessionId,
      updatedAt: (now || new Date()).toISOString(),
      viewWeekId: null,
      selectedDate: null,
      weeks: {},
      pantry: {},
      groceryChecked: {}
    };
  }

  function boolMap(raw, label, errors) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(label + ' must be an object.');
      return out;
    }
    const keys = Object.keys(raw);
    if (keys.length > 200) errors.push(label + ' has too many entries.');
    keys.forEach(function (key) {
      if (!isId(key)) {
        errors.push(label + ' has an invalid id.');
        return;
      }
      const item = raw[key];
      if (!item || typeof item !== 'object' || typeof item.checked !== 'boolean') {
        errors.push(label + '.' + key + '.checked must be true or false.');
        return;
      }
      out[key] = { checked: item.checked };
    });
    return out;
  }

  function validateTimer(id, raw, errors) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push('Timer ' + id + ' must be an object.');
      return null;
    }
    if (['idle', 'running', 'paused', 'done'].indexOf(raw.status) === -1) errors.push('Timer ' + id + ' has an invalid status.');
    if (typeof raw.label !== 'string' || raw.label.length < 1 || raw.label.length > 80) errors.push('Timer ' + id + ' needs a short label.');
    if (!isId(raw.stepId)) errors.push('Timer ' + id + ' has an invalid step.');
    if (!Number.isFinite(raw.durationMs) || raw.durationMs < 1000 || raw.durationMs > TIMER_MAX_MS) errors.push('Timer ' + id + ' has an invalid duration.');
    if (!Number.isFinite(raw.remainingMs) || raw.remainingMs < 0 || raw.remainingMs > TIMER_MAX_MS) errors.push('Timer ' + id + ' has an invalid remaining time.');
    const endOk = raw.endAt == null || (Number.isFinite(raw.endAt) && raw.endAt > 1e12 && raw.endAt < 4e12);
    if (!endOk) errors.push('Timer ' + id + ' has an invalid end timestamp.');
    if (raw.status === 'running' && typeof raw.endAt !== 'number') errors.push('Timer ' + id + ' is running without an end timestamp.');
    if ((raw.status === 'paused' || raw.status === 'idle') && raw.endAt != null) errors.push('Timer ' + id + ' should not have an end timestamp while ' + raw.status + '.');
    if (raw.status === 'done' && raw.remainingMs !== 0) errors.push('Timer ' + id + ' is marked done but still has time left.');
    if (!isIso(raw.updatedAt)) errors.push('Timer ' + id + ' needs an updatedAt time.');
    if (!isId(id)) errors.push('Timer id is invalid.');
    return {
      id: id,
      stepId: raw.stepId,
      label: raw.label,
      durationMs: raw.durationMs,
      status: raw.status,
      endAt: raw.endAt == null ? null : raw.endAt,
      remainingMs: raw.remainingMs,
      updatedAt: raw.updatedAt
    };
  }

  function validateRecipeEntry(id, raw, errors) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(id + ' must be an object.');
      return null;
    }
    if (raw.recipeId !== id) errors.push(id + '.recipeId must match its key.');
    if (!Number.isInteger(raw.recipeVersion) || raw.recipeVersion < 1 || raw.recipeVersion > 999) errors.push(id + '.recipeVersion must be an integer.');
    if (!Number.isInteger(raw.portions) || raw.portions < 1 || raw.portions > 24) errors.push(id + '.portions must be from 1 to 24.');
    if (PHASES.indexOf(raw.phase) === -1) errors.push(id + '.phase must be prep, cooking, or done.');
    if (typeof raw.cookingMode !== 'boolean') errors.push(id + '.cookingMode must be true or false.');
    if (!(raw.cookingStepId == null || isId(raw.cookingStepId))) errors.push(id + '.cookingStepId is invalid.');
    if (typeof raw.notes !== 'string' || raw.notes.length > NOTE_MAX) errors.push(id + '.notes must be text up to 20000 characters.');
    if (!isIso(raw.updatedAt)) errors.push(id + '.updatedAt must be a date.');
    const ingredients = boolMap(raw.ingredients, id + '.ingredients', errors);
    const steps = boolMap(raw.steps, id + '.steps', errors);
    const timers = {};
    if (!raw.timers || typeof raw.timers !== 'object' || Array.isArray(raw.timers)) errors.push(id + '.timers must be an object.');
    else {
      Object.keys(raw.timers).forEach(function (timerId) {
        if (!isId(timerId)) {
          errors.push(id + ' has an invalid timer id.');
          return;
        }
        const clean = validateTimer(timerId, raw.timers[timerId], errors);
        if (clean) timers[timerId] = clean;
      });
    }
    return {
      recipeId: id,
      recipeVersion: raw.recipeVersion,
      portions: raw.portions,
      phase: raw.phase,
      cookingMode: raw.cookingMode,
      cookingStepId: raw.cookingStepId || null,
      notes: raw.notes,
      ingredients: ingredients,
      steps: steps,
      timers: timers,
      updatedAt: raw.updatedAt
    };
  }

  function validateRecipeSession(data) {
    const errors = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) return fail(['Session must be a JSON object.']);
    if (data.schema === PLANNER_SCHEMA) return fail(['This file is a week-planner session. Open it in the week planner.']);
    if (data.schema !== RECIPE_SCHEMA) errors.push('schema must be kitchen.recipe-session.');
    if (data.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion must be 1.');
    if (typeof data.sessionId !== 'string' || !SESSION_RE.test(data.sessionId)) errors.push('sessionId must be a stable ks_ id.');
    if (!isIso(data.updatedAt)) errors.push('updatedAt must be a date.');
    if (!data.recipes || typeof data.recipes !== 'object' || Array.isArray(data.recipes)) errors.push('recipes must be an object.');
    if (errors.length) return fail(errors);
    const recipes = {};
    const ids = Object.keys(data.recipes);
    if (ids.length > 100) errors.push('Too many recipe records.');
    ids.forEach(function (id) {
      if (!isId(id)) {
        errors.push('Invalid recipe id.');
        return;
      }
      const entry = validateRecipeEntry(id, data.recipes[id], errors);
      if (entry) recipes[id] = entry;
    });
    if (errors.length) return fail(errors);
    return {
      ok: true,
      errors: [],
      value: {
        schema: RECIPE_SCHEMA,
        schemaVersion: SCHEMA_VERSION,
        sessionId: data.sessionId,
        updatedAt: data.updatedAt,
        recipes: recipes
      }
    };
  }

  function validateCustomTasks(raw, errors, label) {
    if (!Array.isArray(raw)) {
      errors.push(label + ' must be a list.');
      return [];
    }
    if (raw.length > 30) errors.push(label + ' has too many tasks.');
    const out = [];
    raw.forEach(function (task) {
      if (!task || typeof task !== 'object') {
        errors.push(label + ' has an invalid task.');
        return;
      }
      if (typeof task.id !== 'string' || !TASK_ID_RE.test(task.id)) errors.push(label + ' has an invalid task id.');
      if (typeof task.label !== 'string' || task.label.trim().length < 1 || task.label.length > 160) errors.push(label + ' has an invalid task label.');
      if (typeof task.checked !== 'boolean') errors.push(label + ' checked must be true or false.');
      out.push({ id: task.id, label: task.label, checked: task.checked });
    });
    return out;
  }

  function validateDay(date, raw, errors) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(date + ' must be an object.');
      return null;
    }
    if (!(raw.plannedRecipeId == null || isId(raw.plannedRecipeId))) errors.push(date + ' has an invalid planned recipe.');
    if (!(raw.overrideRecipeId == null || isId(raw.overrideRecipeId))) errors.push(date + ' has an invalid swap.');
    if (!Number.isInteger(raw.servings) || raw.servings < 1 || raw.servings > 24) errors.push(date + ' servings must be from 1 to 24.');
    if (typeof raw.notes !== 'string' || raw.notes.length > NOTE_MAX) errors.push(date + ' notes must be text up to 20000 characters.');
    if (typeof raw.favorite !== 'boolean') errors.push(date + ' favorite must be true or false.');
    if (!(raw.rating == null || (Number.isInteger(raw.rating) && raw.rating >= 1 && raw.rating <= 5))) errors.push(date + ' rating must be empty or 1 to 5.');
    if (!(raw.cookedAt == null || isIso(raw.cookedAt))) errors.push(date + ' cookedAt must be empty or a date.');
    if (DAY_STATUS.indexOf(raw.status) === -1) errors.push(date + ' status is invalid.');
    const tasks = boolMap(raw.tasks, date + '.tasks', errors);
    const customTasks = validateCustomTasks(raw.customTasks, errors, date + ' tasks');
    return {
      plannedRecipeId: raw.plannedRecipeId || null,
      overrideRecipeId: raw.overrideRecipeId || null,
      servings: raw.servings,
      notes: raw.notes,
      favorite: raw.favorite,
      rating: raw.rating == null ? null : raw.rating,
      cookedAt: raw.cookedAt || null,
      status: raw.status,
      tasks: tasks,
      customTasks: customTasks
    };
  }

  function validatePlannerSession(data) {
    const errors = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) return fail(['Session must be a JSON object.']);
    if (data.schema === RECIPE_SCHEMA) return fail(['This file is a recipe session. Open it in the daily recipe app.']);
    if (data.schema !== PLANNER_SCHEMA) errors.push('schema must be kitchen.planner-session.');
    if (data.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion must be 1.');
    if (typeof data.sessionId !== 'string' || !SESSION_RE.test(data.sessionId)) errors.push('sessionId must be a stable ks_ id.');
    if (!isIso(data.updatedAt)) errors.push('updatedAt must be a date.');
    if (!(data.viewWeekId == null || DATE_RE.test(data.viewWeekId))) errors.push('viewWeekId must be empty or a date.');
    if (!(data.selectedDate == null || DATE_RE.test(data.selectedDate))) errors.push('selectedDate must be empty or a date.');
    if (!data.weeks || typeof data.weeks !== 'object' || Array.isArray(data.weeks)) errors.push('weeks must be an object.');
    if (!data.pantry || typeof data.pantry !== 'object' || Array.isArray(data.pantry)) errors.push('pantry must be an object.');
    if (!data.groceryChecked || typeof data.groceryChecked !== 'object' || Array.isArray(data.groceryChecked)) errors.push('groceryChecked must be an object.');
    if (errors.length) return fail(errors);

    const weeks = {};
    Object.keys(data.weeks).forEach(function (weekId) {
      if (!DATE_RE.test(weekId)) {
        errors.push('Invalid week id.');
        return;
      }
      const rawWeek = data.weeks[weekId];
      if (!rawWeek || typeof rawWeek !== 'object' || Array.isArray(rawWeek)) {
        errors.push(weekId + ' must be an object.');
        return;
      }
      if (typeof rawWeek.notes !== 'string' || rawWeek.notes.length > NOTE_MAX) errors.push(weekId + ' notes must be text up to 20000 characters.');
      if (!rawWeek.days || typeof rawWeek.days !== 'object' || Array.isArray(rawWeek.days)) {
        errors.push(weekId + ' days must be an object.');
        return;
      }
      const days = {};
      Object.keys(rawWeek.days).forEach(function (date) {
        if (!DATE_RE.test(date)) {
          errors.push(weekId + ' has an invalid day.');
          return;
        }
        const day = validateDay(date, rawWeek.days[date], errors);
        if (day) days[date] = day;
      });
      weeks[weekId] = { notes: rawWeek.notes, days: days };
    });

    const pantry = {};
    Object.keys(data.pantry).forEach(function (key) {
      if (!ITEM_KEY_RE.test(key)) {
        errors.push('Invalid pantry key.');
        return;
      }
      if (PANTRY_VALUES.indexOf(data.pantry[key]) === -1) errors.push('Pantry status for ' + key + ' must be unsure, have, or need.');
      pantry[key] = data.pantry[key];
    });

    const groceryChecked = {};
    Object.keys(data.groceryChecked).forEach(function (weekId) {
      if (!DATE_RE.test(weekId)) {
        errors.push('Invalid grocery week.');
        return;
      }
      const raw = data.groceryChecked[weekId];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        errors.push('Grocery checks for ' + weekId + ' must be an object.');
        return;
      }
      const bucket = {};
      Object.keys(raw).forEach(function (key) {
        if (!ITEM_KEY_RE.test(key)) {
          errors.push('Invalid grocery item key.');
          return;
        }
        if (typeof raw[key] !== 'boolean') errors.push('Grocery check for ' + key + ' must be true or false.');
        bucket[key] = raw[key];
      });
      groceryChecked[weekId] = bucket;
    });

    if (errors.length) return fail(errors);
    return {
      ok: true,
      errors: [],
      value: {
        schema: PLANNER_SCHEMA,
        schemaVersion: SCHEMA_VERSION,
        sessionId: data.sessionId,
        updatedAt: data.updatedAt,
        viewWeekId: data.viewWeekId || null,
        selectedDate: data.selectedDate || null,
        weeks: weeks,
        pantry: pantry,
        groceryChecked: groceryChecked
      }
    };
  }

  function timerRemaining(timer, now) {
    if (!timer) return 0;
    if (timer.status === 'running' && typeof timer.endAt === 'number') return Math.max(0, timer.endAt - now);
    if (timer.status === 'paused' || timer.status === 'idle') return Math.max(0, timer.remainingMs || 0);
    return 0;
  }

  function syncTimer(timer, now) {
    const next = Object.assign({}, timer);
    if (next.status === 'running') {
      const left = timerRemaining(next, now);
      next.remainingMs = left;
      if (left <= 0) {
        next.status = 'done';
        next.remainingMs = 0;
        next.updatedAt = new Date(now).toISOString();
      }
    }
    return next;
  }

  function startTimer(timer, now) {
    return Object.assign({}, timer, {
      status: 'running',
      endAt: now + timer.durationMs,
      remainingMs: timer.durationMs,
      updatedAt: new Date(now).toISOString()
    });
  }

  function pauseTimer(timer, now) {
    const left = timerRemaining(timer, now);
    if (left <= 0) {
      return Object.assign({}, timer, {
        status: 'done',
        endAt: typeof timer.endAt === 'number' ? timer.endAt : now,
        remainingMs: 0,
        updatedAt: new Date(now).toISOString()
      });
    }
    return Object.assign({}, timer, {
      status: 'paused',
      endAt: null,
      remainingMs: left,
      updatedAt: new Date(now).toISOString()
    });
  }

  function resumeTimer(timer, now) {
    const left = timer.status === 'paused' ? timer.remainingMs : timerRemaining(timer, now);
    if (left <= 0) {
      return Object.assign({}, timer, {
        status: 'done',
        remainingMs: 0,
        updatedAt: new Date(now).toISOString()
      });
    }
    return Object.assign({}, timer, {
      status: 'running',
      endAt: now + left,
      remainingMs: left,
      updatedAt: new Date(now).toISOString()
    });
  }

  function resetTimer(timer, now) {
    return Object.assign({}, timer, {
      status: 'idle',
      endAt: null,
      remainingMs: timer.durationMs,
      updatedAt: new Date(now).toISOString()
    });
  }

  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours) return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
    return minutes + ':' + String(seconds).padStart(2, '0');
  }

  function formatQty(n) {
    if (n == null || !Number.isFinite(n)) return '';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    const whole = Math.floor(abs + 1e-8);
    const frac = abs - whole;
    const table = [[0.25, '1/4'], [1 / 3, '1/3'], [0.5, '1/2'], [2 / 3, '2/3'], [0.75, '3/4']];
    let piece = '';
    for (let i = 0; i < table.length; i++) {
      if (Math.abs(frac - table[i][0]) < 0.045) {
        piece = table[i][1];
        break;
      }
    }
    if (!piece) {
      const rounded = Math.round(abs * 100) / 100;
      return sign + String(rounded);
    }
    if (whole && piece) return sign + whole + ' ' + piece;
    return sign + piece;
  }

  function scaleAmount(amount, baseServings, portions) {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
    if (!baseServings) return amount;
    return amount * (portions / baseServings);
  }

  function formatIngredient(ing, portions, baseServings) {
    const scale = ing.scalable === false || !baseServings ? 1 : portions / baseServings;
    let qty = '';
    if (typeof ing.amount === 'number') {
      const min = ing.amount * scale;
      if (ing.amountMax == null) qty = formatQty(min);
      else qty = formatQty(min) + '–' + formatQty(ing.amountMax * scale);
      if (ing.unit) qty += ' ' + ing.unit;
    }
    return {
      qty: qty,
      name: ing.name,
      note: ing.note || '',
      optional: ing.group === 'kids-starch'
    };
  }

  function ingredientBucket(group) {
    if (group === 'kids-starch' || group === 'kids') return 'kids-starch';
    if (group === 'pantry') return 'pantry';
    if (group === 'on-hand') return 'on-hand';
    return 'shop';
  }

  function aggregateGrocery(week, recipesById, dayStates) {
    const buckets = { shop: new Map(), pantry: new Map(), 'kids-starch': new Map(), 'on-hand': new Map() };
    const unscaled = [];
    (week.days || []).forEach(function (day) {
      const state = (dayStates && dayStates[day.date]) || {};
      const recipeId = state.overrideRecipeId || day.recipeId;
      const recipe = recipesById[recipeId];
      if (!recipe) return;
      const servings = state.servings || day.servings || recipe.servings;
      const scale = recipe.servings ? servings / recipe.servings : 1;
      (recipe.ingredients || []).forEach(function (ing) {
        const group = ingredientBucket(ing.group);
        if (ing.scalable === false || typeof ing.amount !== 'number' || !ing.unit) {
          unscaled.push({
            key: 'plain|' + recipe.id + '|' + ing.id,
            group: group,
            name: ing.name,
            detail: ing.note || '',
            recipeId: recipe.id
          });
          return;
        }
        const groceryKey = ing.groceryKey || ing.id;
        const key = groceryKey + '|' + ing.unit + '|' + group;
        const current = buckets[group].get(key) || {
          key: key,
          group: group,
          groceryKey: groceryKey,
          name: ing.groceryName || ing.name,
          unit: ing.unit,
          amount: 0,
          amountMax: 0,
          hasMax: false
        };
        const factor = ing.scalable === false ? 1 : scale;
        current.amount += ing.amount * factor;
        if (ing.amountMax != null) {
          current.amountMax += ing.amountMax * factor;
          current.hasMax = true;
        } else current.amountMax += ing.amount * factor;
        buckets[group].set(key, current);
      });
    });
    function pack(map) {
      return Array.from(map.values()).map(function (item) {
        const ranged = item.hasMax && Math.abs(item.amount - item.amountMax) > 0.02;
        const qty = ranged ? formatQty(item.amount) + '–' + formatQty(item.amountMax) : formatQty(item.amount);
        return Object.assign({}, item, { label: (qty + ' ' + item.unit + ' ' + item.name).trim() });
      }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    }
    return {
      shop: pack(buckets.shop),
      pantry: pack(buckets.pantry),
      kidsStarch: pack(buckets['kids-starch']),
      onHand: pack(buckets['on-hand']),
      unscaled: unscaled
    };
  }

  function easternISODate(date) {
    const value = date || new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(value);
    function piece(type) {
      const found = parts.find(function (part) { return part.type === type; });
      return found ? found.value : '';
    }
    return piece('year') + '-' + piece('month') + '-' + piece('day');
  }

  function weekContaining(iso, weeksDoc) {
    const weeks = (weeksDoc && weeksDoc.weeks) || [];
    for (let i = 0; i < weeks.length; i++) {
      const week = weeks[i];
      if (iso >= week.startsOn && iso <= week.endsOn) return week;
    }
    return null;
  }

  function defaultWeekId(weeksDoc, iso) {
    const today = iso || easternISODate(new Date());
    const weeks = (weeksDoc && weeksDoc.weeks) || [];
    const containing = weekContaining(today, weeksDoc);
    if (containing) return containing.id;
    let best = weeks[0];
    let bestDistance = Infinity;
    weeks.forEach(function (week) {
      const distance = Math.abs(Date.parse(week.startsOn) - Date.parse(today));
      if (distance < bestDistance) { best = week; bestDistance = distance; }
    });
    return best ? best.id : sundayOf(today);
  }

  function grocerySections(week) {
    if (!week || !Array.isArray(week.grocery)) return [];
    return week.grocery.map(function (section) {
      const id = String(section.id || '');
      const sectionPantry = section.pantry === true;
      return {
        id: id,
        title: section.title || '',
        pantry: sectionPantry,
        items: (section.items || []).map(function (item) {
          const itemId = String(item.id || '');
          return {
            id: itemId,
            label: String(item.label || ''),
            pantry: sectionPantry || item.pantry === true,
            key: 'list|' + id + '|' + itemId
          };
        })
      };
    });
  }

  function localISODate(date) {
    const value = date || new Date();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return value.getFullYear() + '-' + month + '-' + day;
  }

  function addDays(iso, days) {
    const parts = iso.split('-').map(Number);
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function sundayOf(iso) {
    const parts = iso.split('-').map(Number);
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    date.setUTCDate(date.getUTCDate() - date.getUTCDay());
    return date.toISOString().slice(0, 10);
  }

  function weekdayName(iso) {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  }

  function formatLong(iso) {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
    });
  }

  function recipeIdForDate(iso, schedule, weeksDoc) {
    const scheduled = schedule && schedule.days && schedule.days[iso] && schedule.days[iso].recipeId;
    if (scheduled) return scheduled;
    const weeks = (weeksDoc && weeksDoc.weeks) || [];
    for (let i = 0; i < weeks.length; i++) {
      const days = weeks[i].days || [];
      for (let j = 0; j < days.length; j++) {
        if (days[j].date === iso && days[j].recipeId) return days[j].recipeId;
      }
    }
    return null;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function idleTimer(recipeStep, def, now) {
    return {
      id: def.id,
      stepId: recipeStep.id,
      label: def.label,
      durationMs: def.seconds * 1000,
      status: 'idle',
      endAt: null,
      remainingMs: def.seconds * 1000,
      updatedAt: now.toISOString()
    };
  }

  function alignRecipeState(entry, recipe, now) {
    const stamp = (now || new Date()).toISOString();
    recipe.ingredients.forEach(function (ing) {
      if (!entry.ingredients[ing.id]) entry.ingredients[ing.id] = { checked: false };
    });
    recipe.steps.forEach(function (step) {
      if (!entry.steps[step.id]) entry.steps[step.id] = { checked: false };
      (step.timers || []).forEach(function (def) {
        if (!entry.timers[def.id]) entry.timers[def.id] = idleTimer(step, def, now || new Date());
      });
    });
    if (!entry.cookingStepId && recipe.steps[0]) entry.cookingStepId = recipe.steps[0].id;
    entry.updatedAt = entry.updatedAt || stamp;
    return entry;
  }

  function ensureRecipeState(session, recipe, now) {
    const stamp = now || new Date();
    if (!session.recipes[recipe.id]) {
      const timers = {};
      recipe.steps.forEach(function (step) {
        (step.timers || []).forEach(function (def) {
          timers[def.id] = idleTimer(step, def, stamp);
        });
      });
      session.recipes[recipe.id] = {
        recipeId: recipe.id,
        recipeVersion: recipe.version,
        portions: recipe.servings,
        phase: 'prep',
        cookingMode: false,
        cookingStepId: recipe.steps[0] ? recipe.steps[0].id : null,
        notes: '',
        ingredients: {},
        steps: {},
        timers: timers,
        updatedAt: stamp.toISOString()
      };
    }
    alignRecipeState(session.recipes[recipe.id], recipe, stamp);
    return session.recipes[recipe.id];
  }

  function ensurePlannerDay(session, week, day, recipe) {
    if (!session.weeks[week.id]) session.weeks[week.id] = { notes: '', days: {} };
    const bucket = session.weeks[week.id];
    if (!bucket.days[day.date]) {
      bucket.days[day.date] = {
        plannedRecipeId: day.recipeId,
        overrideRecipeId: null,
        servings: day.servings || (recipe ? recipe.servings : 6),
        notes: '',
        favorite: false,
        rating: null,
        cookedAt: null,
        status: 'planned',
        tasks: {},
        customTasks: []
      };
    }
    const state = bucket.days[day.date];
    state.plannedRecipeId = day.recipeId;
    if (recipe && recipe.tasks) {
      recipe.tasks.forEach(function (task) {
        if (!state.tasks[task.id]) state.tasks[task.id] = { checked: false };
      });
    }
    return state;
  }

  function effectiveRecipeId(day, state) {
    if (state && state.overrideRecipeId) return state.overrideRecipeId;
    return day.recipeId;
  }

  return {
    RECIPE_SCHEMA: RECIPE_SCHEMA,
    PLANNER_SCHEMA: PLANNER_SCHEMA,
    SCHEMA_VERSION: SCHEMA_VERSION,
    RECIPE_STORAGE_KEY: RECIPE_STORAGE_KEY,
    PLANNER_STORAGE_KEY: PLANNER_STORAGE_KEY,
    NOTE_MAX: NOTE_MAX,
    newSessionId: newSessionId,
    newTaskId: newTaskId,
    parseSessionJson: parseSessionJson,
    emptyRecipeSession: emptyRecipeSession,
    emptyPlannerSession: emptyPlannerSession,
    validateRecipeSession: validateRecipeSession,
    validatePlannerSession: validatePlannerSession,
    timerRemaining: timerRemaining,
    syncTimer: syncTimer,
    startTimer: startTimer,
    pauseTimer: pauseTimer,
    resumeTimer: resumeTimer,
    resetTimer: resetTimer,
    formatClock: formatClock,
    formatQty: formatQty,
    scaleAmount: scaleAmount,
    formatIngredient: formatIngredient,
    aggregateGrocery: aggregateGrocery,
    easternISODate: easternISODate,
    weekContaining: weekContaining,
    defaultWeekId: defaultWeekId,
    grocerySections: grocerySections,
    localISODate: localISODate,
    addDays: addDays,
    sundayOf: sundayOf,
    weekdayName: weekdayName,
    formatLong: formatLong,
    recipeIdForDate: recipeIdForDate,
    esc: esc,
    alignRecipeState: alignRecipeState,
    ensureRecipeState: ensureRecipeState,
    ensurePlannerDay: ensurePlannerDay,
    effectiveRecipeId: effectiveRecipeId
  };
});
