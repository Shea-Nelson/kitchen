const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../review/picks.js');

const root = path.join(__dirname, '..');
const weeksDoc = JSON.parse(fs.readFileSync(path.join(root, 'planner/data/weeks.json'), 'utf8'));
const recipesDoc = JSON.parse(fs.readFileSync(path.join(root, 'recipes/data/recipes.json'), 'utf8'));
const week = weeksDoc.weeks.find(w => w.id === '2026-11-29');

test('the review page opens on the upcoming week, then the current one', () => {
  const doc = { weeks: [{ id: '2026-11-22', startsOn: '2026-11-22', endsOn: '2026-11-28' }, { id: '2026-11-29', startsOn: '2026-11-29', endsOn: '2026-12-05' }] };
  assert.equal(R.defaultReviewWeekId(doc, '2026-11-27'), '2026-11-29');
  assert.equal(R.defaultReviewWeekId(doc, '2026-11-22'), '2026-11-29');
  assert.equal(R.defaultReviewWeekId(doc, '2026-11-29'), '2026-11-29');
  assert.equal(R.defaultReviewWeekId(doc, '2026-12-03'), '2026-11-29');
  assert.equal(R.defaultReviewWeekId(doc, '2027-01-10'), '2026-11-29');
  assert.equal(R.defaultReviewWeekId({ weeks: [] }, '2026-11-27'), null);
});

test('?week= picks a known week and ignores junk', () => {
  assert.equal(R.pickWeek(weeksDoc, '2026-11-22', '2026-11-27').id, '2026-11-22');
  assert.equal(R.pickWeek(weeksDoc, 'nonsense', '2026-11-27').id, '2026-11-29');
  assert.equal(R.pickWeek(weeksDoc, null, '2026-11-27').id, '2026-11-29');
  assert.equal(R.pickWeek(weeksDoc, '2020-01-05', '2026-11-27').id, '2026-11-29');
});

test('every dinner in the real week can be shown: recipe, summary or note', () => {
  const byId = Object.fromEntries(recipesDoc.recipes.map(r => [r.id, r]));
  assert.equal(week.days.length, 7);
  week.days.forEach(day => {
    if (day.recipeId) assert.ok(byId[day.recipeId] && byId[day.recipeId].summary, day.recipeId);
    else assert.ok(day.dinnerNote, day.date);
  });
});

test('saved picks are cleaned up on the way in', () => {
  const raw = { days: { '2026-11-29': { vote: 'approve', swap: 'ignored' }, '2026-11-30': { vote: 'change', swap: 'tacos\nplease' }, '2026-12-01': { vote: 'yolo' }, '1999-01-01': { vote: 'approve' } }, notes: 'x'.repeat(5000) };
  const p = R.normalize(raw, week);
  assert.equal(p.days['2026-11-29'].vote, 'approve');
  assert.equal(p.days['2026-11-29'].swap, '');
  assert.equal(p.days['2026-11-30'].swap, 'tacos please');
  assert.equal(p.days['2026-12-01'].vote, '');
  assert.equal(p.days['1999-01-01'], undefined);
  assert.equal(p.notes.length, R.NOTES_MAX);
  assert.deepEqual(R.normalize(null, week).days['2026-12-05'], { vote: '', swap: '' });
});

test('the email has a plain list and a machine-readable block', () => {
  const p = R.normalize({ days: { '2026-11-29': { vote: 'approve' }, '2026-11-30': { vote: 'change', swap: 'tacos' }, '2026-12-01': { vote: 'change', swap: '' } }, notes: 'No fish\nthis week' }, week);
  const text = R.body(week, p, 'https://shea-nelson.github.io/kitchen/review/?week=2026-11-29');
  assert.match(text, /Sun Nov 29 - Slow-cooker beef chili: APPROVE/);
  assert.match(text, /Mon Nov 30 - Bacon cheeseburger casserole: CHANGE: tacos/);
  assert.match(text, /Tue Dec 1 - .*: CHANGE: \(no suggestion/);
  assert.match(text, /Wed Dec 2 - Pizza night: NO PICK YET/);
  assert.match(text, /^WEEK: 2026-11-29$/m);
  assert.match(text, /^DAY 2026-11-29 \| Slow-cooker beef chili \| APPROVE \| $/m);
  assert.match(text, /^DAY 2026-11-30 \| Bacon cheeseburger casserole \| CHANGE \| tacos$/m);
  assert.match(text, /^DAY 2026-12-02 \| Pizza night \| NONE \| $/m);
  assert.match(text, /^NOTES-JSON: "No fish\\nthis week"$/m);
  assert.equal(R.counts(week, p).open, 4);
  assert.equal(R.hasAnything(week, R.normalize({}, week)), false);
  assert.equal(R.hasAnything(week, R.normalize({ notes: 'hi' }, week)), true);
});

test('the mailto has the right inboxes, subject and a decodable body', () => {
  const p = R.normalize({ days: { '2026-11-29': { vote: 'approve' } } }, week);
  const link = R.mailto(week, p, '');
  const url = new URL(link);
  assert.equal(url.protocol, 'mailto:');
  assert.equal(decodeURIComponent(url.pathname), R.RECIPIENTS.to);
  assert.equal(url.searchParams.get('cc'), R.RECIPIENTS.cc);
  assert.equal(url.searchParams.get('subject'), 'Meal plan picks: week of Nov 29, 2026');
  assert.equal(url.searchParams.get('body'), R.body(week, p, ''));
  assert.ok(link.length < 3000);
});

test('the grocery peek skips pantry sections and trims notes', () => {
  const peek = R.groceryPeek(week);
  assert.ok(peek.length > 0);
  assert.ok(peek.every(s => s.items.length > 0));
  assert.ok(!peek.some(s => /pantry|spices/i.test(s.title)));
  assert.ok(peek.every(s => s.items.every(i => !i.includes('\u2014'))));
});

test('the review page loads no third-party code and no trackers', () => {
  ['index.html', 'app.js', 'picks.js', 'review.css'].forEach(file => {
    const src = fs.readFileSync(path.join(root, 'review', file), 'utf8');
    const urls = src.match(/https?:\/\/[^\s"')]+/g) || [];
    urls.forEach(u => assert.match(u, /^https:\/\/(shea-nelson\.github\.io\/kitchen|www\.w3\.org)/, file + ' ' + u));
    assert.doesNotMatch(src, /analytics|gtag|pixel|sendBeacon|XMLHttpRequest|formspree|googleapis/i, file);
  });
});

test('suggestions come from the dinner library and skip this week plus known dislikes', () => {
  const pool = R.suggestionPool(recipesDoc, week);
  const ids = pool.map(r => r.id);
  assert.ok(ids.includes('egg-roll-bowl'));
  assert.ok(ids.includes('pork-carnitas'));
  assert.ok(ids.includes('tuscan-chicken'));
  assert.ok(!ids.includes('garlic-butter-salmon'));
  assert.ok(!ids.includes('scrambled-eggs'));
  assert.ok(!ids.includes('fried-eggs'));
  assert.ok(!ids.includes('thanksgiving-turkey-breast'));
  week.days.forEach(day => {
    if (day.recipeId) assert.ok(!ids.includes(day.recipeId), day.recipeId);
  });
  pool.forEach(r => {
    assert.doesNotMatch((r.id + ' ' + r.title + ' ' + (r.summary || '')), /shrimp|salmon|scampi|seafood|\bfish\b|thanksgiving/i);
    assert.ok(!r.section, r.id);
  });
  const first = R.suggestionsFor(recipesDoc, week, { size: 4, offset: 0 });
  const next = R.suggestionsFor(recipesDoc, week, { size: 4, offset: 4 });
  assert.equal(first.length, 4);
  assert.equal(next.length, 4);
  assert.deepEqual(first.map(r => r.title), pool.slice(0, 4).map(r => r.title));
  assert.notEqual(next[0].id, first[0].id);
  const withoutCarnitas = R.suggestionsFor(recipesDoc, week, { size: 4, offset: 0, excludeTitles: ['Pork carnitas'] });
  assert.ok(!withoutCarnitas.some(r => r.title === 'Pork carnitas'));
});

test('a chosen idea or surprise-me is written into the email lines the routine reads', () => {
  const p = R.normalize({ days: {
    '2026-11-29': { vote: 'approve' },
    '2026-11-30': { vote: 'change', swap: 'Pork carnitas' },
    '2026-12-01': { vote: 'change', swap: 'Not sure — Scorpy, you choose' },
    '2026-12-02': { vote: 'change', swap: '' }
  } }, week);
  assert.equal(R.isSurpriseSwap(p.days['2026-12-01'].swap), true);
  assert.equal(R.swapText(p.days['2026-12-01']), 'surprise me');
  assert.equal(R.SURPRISE_SWAP, 'surprise me');
  const text = R.body(week, p, 'https://shea-nelson.github.io/kitchen/review/?week=2026-11-29');
  assert.match(text, /Mon Nov 30 - Bacon cheeseburger casserole: CHANGE: Pork carnitas/);
  assert.match(text, /Tue Dec 1 - .*: CHANGE: surprise me/);
  assert.match(text, /Wed Dec 2 - Pizza night: CHANGE: \(no suggestion/);
  assert.match(text, /^DAY 2026-11-30 \| Bacon cheeseburger casserole \| CHANGE \| Pork carnitas$/m);
  assert.match(text, /^DAY 2026-12-01 \| .* \| CHANGE \| surprise me$/m);
  assert.match(text, /^DAY 2026-12-02 \| Pizza night \| CHANGE \| $/m);
  const parsed = R.parsePicksBody(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.weekId, '2026-11-29');
  assert.equal(parsed.days['2026-11-29'].vote, 'approve');
  assert.equal(parsed.days['2026-11-30'].swap, 'Pork carnitas');
  assert.equal(parsed.days['2026-12-01'].swap, 'surprise me');
  assert.equal(parsed.days['2026-12-02'].swap, '');
  assert.equal(parsed.days['2026-12-03'].vote, '');
});

test('surprise-me aliases and the parser stay stable', () => {
  assert.equal(R.isSurpriseSwap('surprise me'), true);
  assert.equal(R.isSurpriseSwap('Surprise Me'), true);
  assert.equal(R.isSurpriseSwap('Not sure - Scorpy, you choose'), true);
  assert.equal(R.isSurpriseSwap('scorpy, you choose'), true);
  assert.equal(R.isSurpriseSwap('tacos'), false);
  assert.equal(R.isSurpriseSwap(''), false);
  const parsed = R.parsePicksBody('WEEK: 2026-11-29\nDAY 2026-11-30 | Bacon cheeseburger casserole | CHANGE | surprise me\nNOTES-JSON: "hello"\n');
  assert.deepEqual(parsed.days['2026-11-30'], { vote: 'change', swap: 'surprise me', dinner: 'Bacon cheeseburger casserole' });
  assert.equal(parsed.notes, 'hello');
});

test('grocery edits persist, can be sent on their own, and round-trip in the email', () => {
  const empty = R.normalize({}, week);
  assert.deepEqual(empty.grocery, { removed: [], added: [] });
  assert.equal(R.hasGroceryEdits(empty), false);
  assert.equal(R.hasAnything(week, empty), false);

  const raw = {
    days: { '2026-11-29': { vote: 'approve' } },
    grocery: {
      removed: ['Yellow onions, 4', 'yellow onions, 4', 'Not on the list', { label: 'Bell peppers, 5' }],
      added: [
        { name: 'Salsa', qty: '1 jar', section: 'Produce' },
        { name: 'Extra bacon', qty: '', section: '' },
        { name: '', qty: '1', section: 'Produce' },
        { name: 'Pipe|name', qty: '1|box', section: 'Snacks|drinks' }
      ]
    }
  };
  const p = R.normalize(raw, week);
  assert.deepEqual(p.grocery.removed, ['Yellow onions, 4', 'Bell peppers, 5']);
  assert.equal(p.grocery.added[0].name, 'Salsa');
  assert.equal(p.grocery.added[0].qty, '1 jar');
  assert.equal(p.grocery.added[0].section, 'Produce');
  assert.equal(p.grocery.added[1].name, 'Extra bacon');
  assert.ok(p.grocery.added.every(i => i.name !== ''));
  assert.ok(p.grocery.added.some(i => i.name === 'Pipe/name' && i.qty === '1/box' && i.section === 'Snacks/drinks'));
  assert.equal(R.hasGroceryEdits(p), true);

  const groceryOnly = R.normalize({ grocery: { added: [{ name: 'Salsa', qty: '1 jar', section: 'Produce' }] } }, week);
  assert.equal(R.hasAnything(week, groceryOnly), true);
  assert.equal(R.counts(week, groceryOnly).open, 7);

  const text = R.body(week, p, 'https://shea-nelson.github.io/kitchen/review/?week=2026-11-29');
  assert.match(text, /Grocery list changes:/);
  assert.match(text, /^- Leave off: Yellow onions, 4$/m);
  assert.match(text, /^- Leave off: Bell peppers, 5$/m);
  assert.match(text, /^- Add: Salsa, 1 jar \(Produce\)$/m);
  assert.match(text, /^- Add: Extra bacon$/m);
  assert.match(text, /^GROCERY REMOVE \| Yellow onions, 4$/m);
  assert.match(text, /^GROCERY REMOVE \| Bell peppers, 5$/m);
  assert.match(text, /^GROCERY ADD \| Salsa \| 1 jar \| Produce$/m);
  assert.match(text, /^GROCERY ADD \| Extra bacon \|  \| $/m);
  const parsed = R.parsePicksBody(text);
  assert.deepEqual(parsed.grocery.removed, ['Yellow onions, 4', 'Bell peppers, 5']);
  assert.deepEqual(parsed.grocery.added[0], { name: 'Salsa', qty: '1 jar', section: 'Produce' });
  assert.deepEqual(parsed.grocery.added.find(i => i.name === 'Extra bacon'), { name: 'Extra bacon', qty: '', section: '' });
  assert.equal(parsed.days['2026-11-29'].vote, 'approve');

  const dinnerOnly = R.body(week, R.normalize({ days: { '2026-11-29': { vote: 'approve' } } }, week), '');
  assert.doesNotMatch(dinnerOnly, /GROCERY /);
  assert.doesNotMatch(dinnerOnly, /Grocery list changes/);
});

test("the suggestion filter includes the Swiss cheese dislike", () => {
  assert.ok(R.DISLIKES.some(d => d.id === 'swiss' && /Nicole/i.test(d.label)));
  const fake = { id: 'swiss-bake', title: 'Swiss cheese bake', summary: 'A casserole with Swiss.', ingredients: [{ name: 'Swiss cheese slices' }] };
  assert.equal(R.suggestionPool({ recipes: [fake, recipesDoc.recipes.find(r => r.id === 'egg-roll-bowl')] }, week).map(r => r.id).includes('swiss-bake'), false);
  recipesDoc.recipes.forEach(r => {
    assert.doesNotMatch(JSON.stringify(r), /\bswiss\b/i, r.id);
  });
});
