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

  function normalize(raw, week) {
    const out = { days: {}, notes: '' };
    const src = raw && typeof raw === 'object' ? raw : {};
    (week.days || []).forEach(function (day) {
      const d = src.days && src.days[day.date];
      const vote = d && (d.vote === 'approve' || d.vote === 'change') ? d.vote : '';
      out.days[day.date] = { vote: vote, swap: vote === 'change' ? clean(d.swap, SWAP_MAX).replace(/\s*\n\s*/g, ' ') : '' };
    });
    out.notes = clean(src.notes, NOTES_MAX);
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
    return c.approve + c.change > 0 || picks.notes.trim() !== '';
  }

  function subject(week) {
    return 'Meal plan picks: week of ' + longDate(week.startsOn);
  }

  function dinnerName(day) {
    return day.title || 'No dinner';
  }

  const SURPRISE_SWAP = 'surprise me';
  const AVOID_RE = /shrimp|salmon|scampi|seafood|\bfish\b/i;
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

  function isAvoidedDinner(recipe) {
    const blob = [recipe.id, recipe.title, recipe.summary, recipe.style].join(' ');
    return AVOID_RE.test(blob) || /thanksgiving/i.test(recipe.id + ' ' + recipe.title);
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
    lines.push('');
    lines.push('--- machine-readable (please leave as is) ---');
    lines.push('WEEK: ' + week.id);
    (week.days || []).forEach(function (day) {
      const p = picks.days[day.date];
      lines.push('DAY ' + day.date + ' | ' + dinnerName(day) + ' | ' + (p.vote ? p.vote.toUpperCase() : 'NONE') + ' | ' + swapText(p));
    });
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

  /* Grocery peek: the week's written list, with the long notes trimmed. */
  function groceryPeek(week) {
    const sections = (week.grocery || []).filter(function (s) { return !s.pantry; });
    return sections.map(function (s) {
      return {
        title: s.title,
        items: (s.items || []).map(function (it) { return String(it.label || '').split(' \u2014 ')[0]; })
      };
    });
  }

  /* Turn the machine-readable block (or a whole email body) back into picks.
     CHANGE | surprise me means Nicole asked Scorpy to choose a dinner. */
  function parsePicksBody(text) {
    const src = String(text == null ? '' : text);
    const out = { weekId: null, days: {}, notes: '', ok: false };
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
    const notesLine = src.match(/^NOTES-JSON:\s*(.*)$/m);
    if (notesLine) {
      try { out.notes = String(JSON.parse(notesLine[1]) || ''); } catch (e) { out.notes = ''; }
    }
    out.ok = Boolean(out.weekId);
    return out;
  }

  return {
    STORAGE_KEY: STORAGE_KEY, SWAP_MAX: SWAP_MAX, NOTES_MAX: NOTES_MAX, RECIPIENTS: RECIPIENTS,
    SURPRISE_SWAP: SURPRISE_SWAP,
    defaultReviewWeekId: defaultReviewWeekId, pickWeek: pickWeek, neighbours: neighbours,
    normalize: normalize, counts: counts, hasAnything: hasAnything,
    subject: subject, body: body, mailto: mailto, groceryPeek: groceryPeek,
    shortDate: shortDate, longDate: longDate, dayLabel: dayLabel,
    isSurpriseSwap: isSurpriseSwap, swapText: swapText,
    suggestionPool: suggestionPool, suggestionsFor: suggestionsFor,
    parsePicksBody: parsePicksBody
  };
});
