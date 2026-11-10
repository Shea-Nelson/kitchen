const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const S = require('../shopping/list.js');
const read = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const weeksDoc = read('planner/data/weeks.json');
const recipesDoc = read('recipes/data/recipes.json');
const listDoc = read('shopping/data/lists.json');
const catalog = {};
recipesDoc.recipes.forEach(r => { catalog[r.id] = r; });

function build(id) {
  const week = weeksDoc.weeks.find(w => w.id === id);
  return S.buildList(week, catalog, listDoc);
}

test('the Nov 8 list is grouped by section and names its dinners', () => {
  const list = build('2026-11-08');
  const ids = list.sections.map(s => s.id);
  assert.deepEqual(ids, ['produce', 'meat', 'dairy', 'pantry', 'spices', 'snacks', 'kids']);
  assert.deepEqual(list.dinners, ['Tue chicken', 'Wed pizza night', 'Thu ham bake', 'Fri steak bites']);
  const items = list.sections.flatMap(s => s.items);
  const by = key => items.find(i => i.key === key);
  assert.equal(by('sirloin').qty, 'about 4 lb');
  assert.deepEqual(by('sirloin').for, ['Fri steak bites']);
  assert.deepEqual(by('garlic').for, ['Tue chicken', 'Thu ham bake', 'Fri steak bites']);
  assert.equal(by('broccoli').qty, '3 lb');
  assert.ok(by('kids-pizza'));
  new Set(items.map(i => i.checkKey)).size === items.length || assert.fail('duplicate keys');
});

test('on-hand, store-bought, kid starch, and seafood stay off the list', () => {
  const list = build('2026-11-08');
  const text = JSON.stringify(list.sections);
  assert.doesNotMatch(text, /chicken breast|vital|teriyaki|pita|dinner rolls|potatoes|shrimp|salmon|scampi|fish/i);
  assert.equal(list.onHand.length, 1);
  assert.match(list.onHand[0].name, /chicken/);
});

test('every planner week with a shopping entry builds without a code change', () => {
  Object.keys(listDoc.weeks).forEach(id => {
    assert.ok(weeksDoc.weeks.some(w => w.id === id), id + ' is in the planner');
    assert.ok(build(id).sections.length);
  });
  const sectionIds = new Set(listDoc.sections.map(s => s.id));
  Object.values(listDoc.sectionOf).forEach(s => assert.ok(sectionIds.has(s), s));
});

test('plain text copy and saved checks round-trip', () => {
  const list = build('2026-11-08');
  const text = S.plainText(list, { 'item|sirloin': true }, [{ id: 'a1', label: 'Paper towels', section: 'other' }]);
  assert.match(text, /\[x\] Sirloin steak — about 4 lb \(Fri steak bites\)/);
  assert.match(text, /Paper towels/);
  const store = S.readStore(JSON.stringify({ schema: S.SCHEMA, schemaVersion: 1, weeks: { '2026-11-08': { checked: { 'item|ham': true, bad: 'yes' }, added: [{ id: 'a1', label: 'Coffee', section: 'other' }, { id: 2 }] } } }));
  assert.deepEqual(store.weeks['2026-11-08'].checked, { 'item|ham': true });
  assert.equal(store.weeks['2026-11-08'].added.length, 1);
  assert.throws(() => S.readStore('{"schema":"kitchen.planner-session"}'));
  assert.equal(S.STORAGE_KEY.startsWith('wk.'), false);
});

test('shopping page shares the kitchen nav', () => {
  const html = fs.readFileSync(path.join(root, 'shopping/index.html'), 'utf8');
  assert.match(html, /aria-label="Kitchen"/);
  assert.match(html, /href="\.\.\/planner\/"/);
  assert.match(html, /href="\.\.\/recipes\/"/);
  ['planner/index.html', 'recipes/index.html'].forEach(f => {
    assert.match(fs.readFileSync(path.join(root, f), 'utf8'), /href="\.\.\/shopping\/"/);
  });
});
