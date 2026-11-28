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
  assert.match(text, /Mon Nov 30 - Chicken cordon bleu bake: CHANGE: tacos/);
  assert.match(text, /Tue Dec 1 - .*: CHANGE: \(no suggestion/);
  assert.match(text, /Wed Dec 2 - Pizza night: NO PICK YET/);
  assert.match(text, /^WEEK: 2026-11-29$/m);
  assert.match(text, /^DAY 2026-11-29 \| Slow-cooker beef chili \| APPROVE \| $/m);
  assert.match(text, /^DAY 2026-11-30 \| Chicken cordon bleu bake \| CHANGE \| tacos$/m);
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
