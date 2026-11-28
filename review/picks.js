/* Pure logic for the weekly meal-plan review page: which week to open,
   what a pick looks like, and the email text. Classic script in the browser
   (window.KitchenReview) and CommonJS in tests. No network calls. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.KitchenReview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'kitchen.review.v1';
  const SWAP_MAX = 200;
  const NOTES_MAX = 1000;
  const GROCERY_NAME_MAX = 80;
  const GROCERY_QTY_MAX = 40;
  const GROCERY_SECTION_MAX = 40;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /* Inbox addresses are assembled here so they are not sitting in the page
     markup as plain text. They are still readable in this file. */
  const RECIPIENTS = {
    to: ['shea-nelson-arphs8', 'mail.grokbot.com'].join('@'),
    cc: ['nicole.nelson', 'mail.grokbot.com'].join('@')
  };

  function parts(iso) {
    const p = iso.split('-').map(Number);
    return { y: p[0], m: p[1], d: p[2], dow: new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() };
  }
  function shortDate(iso) { const p = parts(iso); return MONTHS[p.m - 1] + ' ' + p.d; }
  function longDate(iso) { const p = parts(iso); return MONTHS[p.m - 1] + ' ' + p.d + ', ' + p.y; }
  function dayLabel(iso) { const p = parts(iso); return DOWS[p.dow] + ' ' + shortDate(iso); }

  /* The upcoming week: the first week that starts after today. When no later
     week exists yet, the week that contains today; otherwise the latest week. */
  function defaultReviewWeekId(weeksDoc, todayIso) {
    const weeks = (weeksDoc && weeksDoc.weeks) || [];
    if (!weeks.length) return null;
    const sorted = weeks.slice().sort(function (a, b) { return a.startsOn < b.startsOn ? -1 : 1; });
    const upcoming = sorted.find(function (w) { return w.startsOn > todayIso; });
    if (upcoming) return upcoming.id;
    const current = sorted.find(function (w) { return todayIso >= w.startsOn && todayIso <= w.endsOn; });
    return (current || sorted[sorted.length - 1]).id;
  }

  function pickWeek(weeksDoc, requested, todayIso) {
    const weeks = (weeksDoc && weeksDoc.weeks) || [];
    const wanted = typeof requested === 'string' && DATE_RE.test(requested) ? requested : '';
    const found = wanted && weeks.find(function (w) { return w.id === wanted || w.startsOn === wanted; });
    if (found) return found;
    const id = defaultReviewWeekId(weeksDoc, todayIso);
    return weeks.find(function (w) { return w.id === id; }) || null;
  }

  function neighbours(weeksDoc, week) {
    const sorted = ((weeksDoc && weeksDoc.weeks) || []).slice().sort(function (a, b) { return a.startsOn < b.startsOn ? -1 : 1; });
    const i = sorted.findIndex(function (w) { return w.id === week.id; });
    return { prev: i > 0 ? sorted[i - 1] : null, next: i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null };
  }

  function clean(value, max) {
    return String(value == null ? '' : value).replace(/\r/g, '').slice(0, max);
  }

  function oneLine(value, max) {
    return clean(value, max).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '/').trim();
  }

  function peekLabel(item) {
    return String(item && item.label || '').split(' \u2014 ')[0].trim();
  }

  /* Structured grocery list for the review page. groceryPeek stays a simple
     string list of the buy-sections (no pantry) for older callers. */
  function groceryCatalog(week) {
    return ((week && week.grocery) || []).map(function (s) {
      return {
        id: s.id || '',
        title: s.title,
        pantry: Boolean(s.pantry),
        items: (s.items || []).map(function (it) {
          return { id: it.id || '', label: peekLabel(it) };
        }).filter(function (it) { return it.label; })
      };
    }).filter(function (s) { return s.items.length; });
  }

  function groceryPeek(week) {
    return groceryCatalog(week).filter(function (s) { return !s.pantry; }).map(function (s) {
      return { title: s.title, items: s.items.map(function (it) { return it.label; }) };
    });
  }

  function catalogLabels(week) {
    const map = {};
    groceryCatalog(week).forEach(function (section) {
      section.items.forEach(function (it) {
        map[it.label.toLowerCase()] = it.label;
      });
    });
    return map;
  }

  function normalizeGrocery(raw, week) {
    const src = raw && raw.grocery && typeof raw.grocery === 'object' ? raw.grocery : {};
    const known = catalogLabels(week);
    const removed = [];
    const seen = {};
    (Array.isArray(src.removed) ? src.removed : []).forEach(function (item) {
      const label = oneLine(typeof item === 'string' ? item : item && item.label, SWAP_MAX);
      const canon = label && known[label.toLowerCase()];
      if (canon && !seen[canon.toLowerCase()]) { seen[canon.toLowerCase()] = true; removed.push(canon); }
    });
    const added = [];
    (Array.isArray(src.added) ? src.added : []).forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      const name = oneLine(item.name, GROCERY_NAME_MAX);
      if (!name) return;
      added.push({
        name: name,
        qty: oneLine(item.qty, GROCERY_QTY_MAX),
        section: oneLine(item.section, GROCERY_SECTION_MAX)
      });
    });
    return { removed: removed, added: added };
  }

  function hasGroceryEdits(picks) {
    const g = picks && picks.grocery;
    return Boolean(g && ((g.removed && g.removed.length) || (g.added && g.added.length)));
  }

  function normalize(raw, week) {
    const out = { days: {}, notes: '' };
    const src = raw && typeof raw === 'object' ? raw : {};
    (week.days || []).forEach(function (day) {
      const d = src.days && src.days[day.date];
      const vote = d && (d.vote === 'approve' || d.vote === 'change') ? d.vote : '';
      out.days[day.date] = { vote: vote, swap: vote === 'change' ? clean(d.swap, SWAP_MAX).replace(/\s*\n\s*/g, ' ') : '' };
    });
    out.notes = clean(src.notes, NOTES_MAX);
    out.grocery = normalizeGrocery(src, week);
    return out;
  }

  function counts(week, picks) {
    const c = { approve: 0, change: 0, open: 0, total: (week.days || []).length };
    (week.days || []).forEach(function (day) {
      const v = picks.days[day.date] && picks.days[day.date].vote;
      if (v === 'approve') c.approve++; else if (v === 'change') c.change++; else c.open++;
    });
    return c;
  }

  function hasAnything(week, picks) {
    const c = counts(week, picks);
    return c.approve + c.change > 0 || picks.notes.trim() !== '' || hasGroceryEdits(picks);
  }

  function subject(week) {
    return 'Meal plan picks: week of ' + longDate(week.startsOn);
  }

  function dinnerName(day) {
    return day.title || 'No dinner';
  }

  const SURPRISE_SWAP = 'surprise me';
  const DISLIKES = [
    { id: 'seafood', label: 'no seafood', pattern: /shrimp|salmon|scampi|seafood|\bfish\b/i },
    { id: 'swiss', label: 'no Swiss cheese (Nicole)', pattern: /\bswiss\b/i }
  ];
  const SURPRISE_ALIASES = [
    'surprise me',
    'scorpy, you choose',
    'not sure - scorpy, you choose',
    'not sure, scorpy, you choose'
  ];

  function recipeList(recipesDoc) {
    if (!recipesDoc) return [];
    if (Array.isArray(recipesDoc.recipes)) return recipesDoc.recipes;
    if (Array.isArray(recipesDoc)) return recipesDoc;
    return [];
  }

  function isSurpriseSwap(value) {
    const s = String(value == null ? '' : value).trim().toLowerCase()
      .replace(/[\u2014\u2013]/g, '-').replace(/\s+/g, ' ');
    if (!s) return false;
    return SURPRISE_ALIASES.indexOf(s) !== -1;
  }

  function swapText(pick) {
    if (!pick || pick.vote !== 'change') return '';
    if (isSurpriseSwap(pick.swap)) return SURPRISE_SWAP;
    return String(pick.swap || '').trim();
  }

  function isDinnerRecipe(recipe) {
    return Boolean(recipe && recipe.id && recipe.title && !recipe.section);
  }

  function recipeBlob(recipe) {
    return [recipe.id, recipe.title, recipe.summary, recipe.style, JSON.stringify(recipe.ingredients || [])].join(' ');
  }

  function isAvoidedDinner(recipe) {
    const blob = recipeBlob(recipe);
    if (/thanksgiving/i.test(recipe.id + ' ' + recipe.title)) return true;
    return DISLIKES.some(function (d) { return d.pattern.test(blob); });
  }

  /* Family-friendly keto dinners from the cookbook (and past weeks, since
     those recipes live in the same file). Skips breakfasts, this week's
     dinners, seafood (shrimp was removed; later weeks dropped fish), and
     holiday-only cards like the Thanksgiving turkey. */
  function suggestionPool(recipesDoc, week) {
    const usedIds = {};
    const usedTitles = {};
    (week && week.days || []).forEach(function (day) {
      if (day.recipeId) usedIds[day.recipeId] = true;
      const title = String(day.title || '').trim().toLowerCase();
      if (title) usedTitles[title] = true;
    });
    return recipeList(recipesDoc).filter(function (recipe) {
      if (!isDinnerRecipe(recipe) || isAvoidedDinner(recipe)) return false;
      if (usedIds[recipe.id]) return false;
      if (usedTitles[String(recipe.title || '').trim().toLowerCase()]) return false;
      return true;
    }).sort(function (a, b) { return a.title < b.title ? -1 : a.title > b.title ? 1 : 0; });
  }

  function suggestionsFor(recipesDoc, week, opts) {
    const size = opts && opts.size ? opts.size : 4;
    const offset = opts && opts.offset ? opts.offset : 0;
    const extra = {};
    ((opts && opts.excludeTitles) || []).forEach(function (t) {
      const key = String(t || '').trim().toLowerCase();
      if (key) extra[key] = true;
    });
    const pool = suggestionPool(recipesDoc, week).filter(function (recipe) {
      return !extra[String(recipe.title || '').trim().toLowerCase()];
    });
    if (!pool.length || size < 1) return [];
    const start = ((offset % pool.length) + pool.length) % pool.length;
    const count = Math.min(size, pool.length);
    const out = [];
    for (let i = 0; i < count; i++) out.push(pool[(start + i) % pool.length]);
    return out;
  }

  function pickLine(day, pick) {
    if (pick.vote === 'approve') return 'APPROVE';
    if (pick.vote === 'change') {
      const swap = swapText(pick);
      return swap ? 'CHANGE: ' + swap : 'CHANGE: (no suggestion; please offer options)';
    }
    return 'NO PICK YET';
  }

  function body(week, picks, pageUrl) {
    const lines = [];
    lines.push('Meal plan picks for ' + week.title);
    lines.push('');
    (week.days || []).forEach(function (day) {
      lines.push(dayLabel(day.date) + ' - ' + dinnerName(day) + ': ' + pickLine(day, picks.days[day.date]));
    });
    lines.push('');
    lines.push('Notes: ' + (picks.notes.trim() ? picks.notes.trim().replace(/\n+/g, '\n       ') : '(none)'));
    if (hasGroceryEdits(picks)) {
      lines.push('');
      lines.push('Grocery list changes:');
      (picks.grocery.removed || []).forEach(function (label) { lines.push('- Leave off: ' + label); });
      (picks.grocery.added || []).forEach(function (item) {
        let line = '- Add: ' + item.name;
        if (item.qty) line += ', ' + item.qty;
        if (item.section) line += ' (' + item.section + ')';
        lines.push(line);
      });
    }
    lines.push('');
    lines.push('--- machine-readable (please leave as is) ---');
    lines.push('WEEK: ' + week.id);
    (week.days || []).forEach(function (day) {
      const p = picks.days[day.date];
      lines.push('DAY ' + day.date + ' | ' + dinnerName(day) + ' | ' + (p.vote ? p.vote.toUpperCase() : 'NONE') + ' | ' + swapText(p));
    });
    if (hasGroceryEdits(picks)) {
      (picks.grocery.removed || []).forEach(function (label) { lines.push('GROCERY REMOVE | ' + label); });
      (picks.grocery.added || []).forEach(function (item) {
        lines.push('GROCERY ADD | ' + item.name + ' | ' + (item.qty || '') + ' | ' + (item.section || ''));
      });
    }
    lines.push('NOTES-JSON: ' + JSON.stringify(picks.notes.trim()));
    lines.push('--- end ---');
    if (pageUrl) { lines.push(''); lines.push('Review page: ' + pageUrl); }
    return lines.join('\n');
  }

  function mailto(week, picks, pageUrl) {
    return 'mailto:' + RECIPIENTS.to +
      '?cc=' + encodeURIComponent(RECIPIENTS.cc) +
      '&subject=' + encodeURIComponent(subject(week)) +
      '&body=' + encodeURIComponent(body(week, picks, pageUrl));
  }

  /* Turn the machine-readable block (or a whole email body) back into picks.
     CHANGE | surprise me means Nicole asked Scorpy to choose a dinner. */
  function parsePicksBody(text) {
    const src = String(text == null ? '' : text);
    const out = { weekId: null, days: {}, notes: '', grocery: { removed: [], added: [] }, ok: false };
    const week = src.match(/^WEEK:\s*(\d{4}-\d{2}-\d{2})\s*$/m);
    if (week) out.weekId = week[1];
    const dayRe = /^DAY (\d{4}-\d{2}-\d{2}) \| (.*) \| (APPROVE|CHANGE|NONE) \| (.*)$/gm;
    let m;
    while ((m = dayRe.exec(src))) {
      const vote = m[3] === 'NONE' ? '' : m[3].toLowerCase();
      let swap = vote === 'change' ? clean(m[4], SWAP_MAX).replace(/\s*\n\s*/g, ' ') : '';
      if (isSurpriseSwap(swap)) swap = SURPRISE_SWAP;
      out.days[m[1]] = { vote: vote, swap: swap, dinner: m[2] };
    }
    const remRe = /^GROCERY REMOVE \| (.*)$/gm;
    while ((m = remRe.exec(src))) {
      const label = oneLine(m[1], SWAP_MAX);
      if (label) out.grocery.removed.push(label);
    }
    const addRe = /^GROCERY ADD \| ([^|]*) \| ([^|]*) \| (.*)$/gm;
    while ((m = addRe.exec(src))) {
      const name = oneLine(m[1], GROCERY_NAME_MAX);
      if (!name) continue;
      out.grocery.added.push({ name: name, qty: oneLine(m[2], GROCERY_QTY_MAX), section: oneLine(m[3], GROCERY_SECTION_MAX) });
    }
    const notesLine = src.match(/^NOTES-JSON:\s*(.*)$/m);
    if (notesLine) {
      try { out.notes = String(JSON.parse(notesLine[1]) || ''); } catch (e) { out.notes = ''; }
    }
    out.ok = Boolean(out.weekId);
    return out;
  }

  return {
    STORAGE_KEY: STORAGE_KEY, SWAP_MAX: SWAP_MAX, NOTES_MAX: NOTES_MAX, RECIPIENTS: RECIPIENTS,
    GROCERY_NAME_MAX: GROCERY_NAME_MAX, GROCERY_QTY_MAX: GROCERY_QTY_MAX, GROCERY_SECTION_MAX: GROCERY_SECTION_MAX,
    SURPRISE_SWAP: SURPRISE_SWAP, DISLIKES: DISLIKES,
    defaultReviewWeekId: defaultReviewWeekId, pickWeek: pickWeek, neighbours: neighbours,
    normalize: normalize, counts: counts, hasAnything: hasAnything, hasGroceryEdits: hasGroceryEdits,
    subject: subject, body: body, mailto: mailto, groceryPeek: groceryPeek, groceryCatalog: groceryCatalog,
    shortDate: shortDate, longDate: longDate, dayLabel: dayLabel,
    isSurpriseSwap: isSurpriseSwap, swapText: swapText,
    suggestionPool: suggestionPool, suggestionsFor: suggestionsFor,
    parsePicksBody: parsePicksBody
  };
});
