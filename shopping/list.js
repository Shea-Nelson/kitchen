/* Builds the week's shopping list from the planner week, the cookbook, and shopping/data/lists.json.
   Classic script in the browser (window.KitchenShopping) and CommonJS in tests. */
(function (root, factory) {
  const K = (typeof module === 'object' && module.exports) ? require('../kitchen/state.js') : root.KitchenState;
  const api = factory(K);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KitchenShopping = api;
})(typeof self !== 'undefined' ? self : this, function (K) {
  'use strict';
  const STORAGE_KEY = 'kitchen.shopping.v1';
  const SCHEMA = 'kitchen.shopping-checks';
  const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
  const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function dayShort(iso) { return DAY_SHORT[new Date(iso + 'T12:00:00Z').getUTCDay()]; }

  // "2026-11-13" is that day's dinner, "2026-11-11 breakfast" is a meal, anything else is shown as written.
  function forLabel(tag, week, short) {
    const m = /^(\d{4}-\d{2}-\d{2})(?: (\w+))?$/.exec(tag);
    if (!m) return tag;
    const day = (week.days || []).find(function (d) { return d.date === m[1]; });
    const meal = m[2] || 'dinner';
    if (meal === 'dinner') return dayShort(m[1]) + ' ' + ((short && short[m[1]]) || (day ? day.title : 'dinner'));
    return dayShort(m[1]) + ' ' + meal;
  }

  function sumQty(parts) {
    // parts: [{amount, amountMax, unit}] -> "10 cloves" or "1 1/2 cups + 2 oz"
    const byUnit = new Map();
    parts.forEach(function (p) {
      const cur = byUnit.get(p.unit) || { lo: 0, hi: 0, ranged: false };
      cur.lo += p.amount;
      cur.hi += p.amountMax != null ? p.amountMax : p.amount;
      if (p.amountMax != null) cur.ranged = true;
      byUnit.set(p.unit, cur);
    });
    return Array.from(byUnit.entries()).map(function (e) {
      const q = e[1];
      const n = q.ranged && Math.abs(q.hi - q.lo) > 0.02 ? K.formatQty(q.lo) + '–' + K.formatQty(q.hi) : K.formatQty(q.lo);
      return (n + ' ' + e[0]).trim();
    }).join(' + ');
  }

  function buildList(week, recipesById, listDoc) {
    const sections = (listDoc.sections || []).map(function (s) { return { id: s.id, title: s.title, hint: s.hint || '', items: [] }; });
    const sectionIds = new Set(sections.map(function (s) { return s.id; }));
    const sectionOf = listDoc.sectionOf || {};
    const plan = (listDoc.weeks || {})[week.id] || {};
    const skip = new Set(plan.skipDates || []);
    const short = plan.dinnerShort || {};
    const items = new Map();
    const onHand = [];
    const dinners = [];

    (week.days || []).forEach(function (day) {
      const recipe = day.recipeId ? recipesById[day.recipeId] : null;
      if (!recipe || skip.has(day.date)) return;
      dinners.push(day.date);
      const scale = recipe.servings ? (day.servings || recipe.servings) / recipe.servings : 1;
      (recipe.ingredients || []).forEach(function (ing) {
        const key = ing.groceryKey || ing.id;
        if (ing.group === 'on-hand') { onHand.push({ name: ing.groceryName || ing.name, for: forLabel(day.date, week, short) }); return; }
        if (ing.group !== 'shop' && ing.group !== 'pantry') return; // kid starch stays off unless the week adds it
        const item = items.get(key) || {
          key: key, name: ing.groceryName || ing.name, section: sectionOf[key] || (ing.group === 'pantry' ? 'spices' : 'other'),
          parts: [], tags: [], note: '', qty: ''
        };
        if (typeof ing.amount === 'number' && ing.unit) {
          const f = ing.scalable === false ? 1 : scale;
          item.parts.push({ amount: ing.amount * f, amountMax: ing.amountMax != null ? ing.amountMax * f : null, unit: ing.unit });
        }
        if (item.tags.indexOf(day.date) === -1) item.tags.push(day.date);
        items.set(key, item);
      });
    });

    (plan.items || []).forEach(function (entry) {
      const existing = items.get(entry.key);
      if (entry.hide) { items.delete(entry.key); return; }
      const item = existing || { key: entry.key, name: entry.name || entry.key, section: entry.section || sectionOf[entry.key] || 'other', parts: [], tags: [], note: '', qty: '' };
      if (entry.name) item.name = entry.name;
      if (entry.section) item.section = entry.section;
      if (entry.qty) item.qty = entry.qty;
      if (entry.note) item.note = entry.note;
      (entry.for || []).forEach(function (tag) { if (item.tags.indexOf(tag) === -1) item.tags.push(tag); });
      items.set(entry.key, item);
    });

    items.forEach(function (item) {
      const out = {
        key: item.key,
        name: item.name.charAt(0).toUpperCase() + item.name.slice(1),
        qty: item.qty || sumQty(item.parts),
        note: item.note,
        for: item.tags.slice().sort().map(function (tag) { return forLabel(tag, week, short); }),
        checkKey: 'item|' + item.key
      };
      let section = sections.find(function (s) { return s.id === item.section; });
      if (!section) {
        section = sections.find(function (s) { return s.id === 'other'; });
        if (!section) { section = { id: 'other', title: 'Other', hint: '', items: [] }; sections.push(section); sectionIds.add('other'); }
      }
      section.items.push(out);
    });
    const order = new Map(((plan.items || []).map(function (e, i) { return [e.key, i]; })));
    sections.forEach(function (s) {
      s.items.sort(function (a, b) {
        const ai = order.has(a.key) ? order.get(a.key) : 1e6, bi = order.has(b.key) ? order.get(b.key) : 1e6;
        return ai - bi || a.name.localeCompare(b.name);
      });
    });
    return {
      weekId: week.id,
      title: week.title,
      note: plan.note || '',
      dinners: dinners.map(function (d) { return forLabel(d, week, short); }),
      onHand: onHand,
      sections: sections.filter(function (s) { return s.items.length; })
    };
  }

  function plainText(list, checks, added) {
    const lines = ['Shopping list · ' + list.title, ''];
    list.sections.forEach(function (s) {
      const extra = (added || []).filter(function (a) { return a.section === s.id; });
      lines.push(s.title.toUpperCase());
      s.items.concat(extra.map(function (a) { return { name: a.label, qty: '', for: [], checkKey: 'm|' + a.id }; })).forEach(function (item) {
        const box = checks && checks[item.checkKey] ? '[x] ' : '[ ] ';
        lines.push(box + item.name + (item.qty ? ' — ' + item.qty : '') + (item.for.length ? ' (' + item.for.join(', ') + ')' : ''));
      });
      lines.push('');
    });
    const loose = (added || []).filter(function (a) { return !list.sections.some(function (s) { return s.id === a.section; }); });
    if (loose.length) {
      lines.push('ADDED BY HAND');
      loose.forEach(function (a) { lines.push((checks && checks['m|' + a.id] ? '[x] ' : '[ ] ') + a.label); });
      lines.push('');
    }
    return lines.join('\n').trim() + '\n';
  }

  function emptyStore() { return { schema: SCHEMA, schemaVersion: 1, weeks: {} }; }

  function readStore(raw) {
    if (!raw) return emptyStore();
    const data = JSON.parse(raw);
    if (!data || data.schema !== SCHEMA || typeof data.weeks !== 'object' || !data.weeks) throw new Error('Not a shopping checklist');
    Object.keys(data.weeks).forEach(function (id) {
      const w = data.weeks[id] || {};
      const checked = {};
      Object.keys(w.checked || {}).forEach(function (k) { if (w.checked[k] === true && k.length < 160) checked[k] = true; });
      const added = (Array.isArray(w.added) ? w.added : []).filter(function (a) {
        return a && typeof a.id === 'string' && typeof a.label === 'string' && a.label.trim();
      }).map(function (a) { return { id: a.id.slice(0, 40), label: a.label.slice(0, 120), section: String(a.section || 'added') }; });
      data.weeks[id] = { checked: checked, added: added };
    });
    return data;
  }

  return { STORAGE_KEY: STORAGE_KEY, SCHEMA: SCHEMA, MEALS: MEALS, buildList: buildList, plainText: plainText, readStore: readStore, emptyStore: emptyStore, forLabel: forLabel };
});
