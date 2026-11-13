const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../kitchen/state.js');

const root = path.join(__dirname, '..');
const recipesDoc = JSON.parse(fs.readFileSync(path.join(root, 'recipes/data/recipes.json'), 'utf8'));
const schedule = JSON.parse(fs.readFileSync(path.join(root, 'recipes/data/schedule.json'), 'utf8'));
const weeksDoc = JSON.parse(fs.readFileSync(path.join(root, 'planner/data/weeks.json'), 'utf8'));
const credits = JSON.parse(fs.readFileSync(path.join(root, 'recipes/assets/photos/credits.json'), 'utf8'));
const catalog = Object.fromEntries(recipesDoc.recipes.map(recipe => [recipe.id, recipe]));
const week = weeksDoc.weeks[0];
const removed = ['shrimp-scampi'];

test('Eastern time decides today, including the evening before midnight', () => {
  assert.equal(K.easternISODate(new Date('2026-11-09T04:30:00.000Z')), '2026-11-08');
  assert.equal(K.easternISODate(new Date('2026-11-09T05:00:00.000Z')), '2026-11-09');
  assert.equal(K.easternISODate(new Date('2026-11-09T17:00:00.000Z')), '2026-11-09');
  assert.equal(K.defaultWeekId(weeksDoc, '2026-11-09'), '2026-11-08');
  assert.equal(K.weekContaining('2026-11-09', weeksDoc).id, '2026-11-08');
  assert.equal(K.weekContaining('2026-11-15', weeksDoc).id, '2026-11-15');
  assert.equal(K.weekContaining('2026-11-22', weeksDoc), null);
});

test('this week matches the final dinner order and drops the removed dinners', () => {
  assert.deepEqual(week.days.map(day => day.recipeId), [
    null,
    null,
    'keto-pizza-bowls',
    'garlic-parmesan-chicken',
    'broccoli-ham-bake',
    'steak-bites',
    null
  ]);
  const blob = JSON.stringify(weeksDoc) + JSON.stringify(recipesDoc);
  removed.forEach(id => {
    assert.equal(catalog[id], undefined);
    assert.equal(week.days.some(day => day.recipeId === id), false);
  });
  assert.ok(catalog['tuscan-chicken']);
  assert.equal(week.days.some(day => day.recipeId === 'tuscan-chicken'), false);
  week.days.forEach(day => {
    assert.doesNotMatch(JSON.stringify(day), /shrimp|tuscan/i);
  });
  recipesDoc.recipes.forEach(recipe => {
    assert.doesNotMatch(recipe.id + recipe.title, /shrimp/i);
  });
  assert.doesNotMatch(blob, /Nicole|Shea|Scorpy|discord/i);
  assert.match(week.days[0].dinnerNote, /Vital/);
  assert.match(week.days[0].dinnerNote, /Already eaten/);
  assert.match(week.days[1].lunch, /Turkey and cheese roll-ups/);
  assert.match(week.days[4].lunch, /pickles and string cheese/);
  assert.match(week.days[6].lunch, /Out of town/);
  assert.match(week.days[6].dinnerNote, /Out of town/);
});

test('each dinner has a temperature or a cooked-meat note, kid side, and timers', () => {
  const expectTimers = {
    'keto-pizza-bowls': { 'brown-meat': 480, 'bake-bowls': 720 },
    'garlic-parmesan-chicken': { 'bake-20': 1200 },
    'steak-bites': { 'sear-batch': 120, 'rest-steak': 180 },
    'broccoli-ham-bake': { 'bake-casserole': 1500 }
  };
  week.days.forEach(day => {
    assert.ok(day.breakfast);
    assert.ok(day.lunch);
    if (!day.recipeId) return;
    const recipe = catalog[day.recipeId];
    assert.equal(recipe.servings, 6);
    const text = JSON.stringify(recipe);
    assert.match(text, /°F|already cooked|no longer pink|doneness/i);
    const kidSide = recipe.kidSide || recipe.ingredients.some(item => item.group === 'kids-starch' || item.group === 'kids');
    assert.ok(kidSide);
    assert.ok(recipe.steps.length >= 4);
    recipe.steps.forEach((step, index) => {
      assert.match(step.text, /\S/);
      assert.equal(index >= 0, true);
    });
    const timers = {};
    recipe.steps.forEach(step => (step.timers || []).forEach(timer => { timers[timer.id] = timer.seconds; }));
    Object.keys(expectTimers[day.recipeId]).forEach(id => {
      assert.equal(timers[id], expectTimers[day.recipeId][id], day.recipeId + ' ' + id);
    });
  });
  assert.match(catalog['garlic-parmesan-chicken'].safety, /165°F/);
  assert.match(JSON.stringify(catalog['steak-bites']), /doneness you want/);
  assert.match(JSON.stringify(catalog['keto-pizza-bowls']), /no longer pink/);
  assert.match(JSON.stringify(catalog['broccoli-ham-bake']), /already cooked/i);
  assert.match(JSON.stringify(catalog['keto-pizza-bowls']), /400°F/);
  assert.match(JSON.stringify(catalog['broccoli-ham-bake']), /375°F/);
  assert.match(JSON.stringify(catalog['steak-bites']), /425°F/);
  assert.equal(catalog['garlic-parmesan-chicken'].ingredients.find(item => item.id === 'chicken').group, 'on-hand');
  assert.equal(catalog['keto-pizza-bowls'].ingredients.some(item => item.group === 'kids-starch'), true);
  assert.equal(catalog['tuscan-chicken'].ingredients.some(item => item.id === 'chicken'), true);
});

test('the written grocery list is grouped and checkable', () => {
  const sections = K.grocerySections(week);
  assert.deepEqual(sections.map(section => section.id), ['meat', 'dairy', 'produce', 'pantry', 'frozen-store', 'snacks', 'kids']);
  const labels = sections.flatMap(section => section.items.map(item => item.label)).join('\n');
  ['Sirloin', 'already on hand', 'Rao', "Kids' pizza", 'Vital frozen pizza', "Kevin's Natural Foods", 'Broccoli, 3 lb', 'Do not buy more'].forEach(bit => {
    assert.match(labels, new RegExp(bit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
  assert.doesNotMatch(labels, /shrimp|lemon|zucchini|sun-dried|spinach|pork shoulder|hot dog buns/i);
  const keys = [];
  sections.forEach(section => {
    assert.equal(section.pantry === true || section.id !== 'pantry', true);
    section.items.forEach(item => {
      assert.match(item.key, /^list\|[a-z0-9-]+\|[a-z0-9-]+$/);
      keys.push(item.key);
      if (section.id === 'pantry') assert.equal(item.pantry, true);
    });
  });
  assert.equal(new Set(keys).size, keys.length);
  const empty = { days: [{ date: '2026-11-16', recipeId: 'garlic-parmesan-chicken', servings: 6 }] };
  assert.deepEqual(K.grocerySections(empty), []);
});

test('a later week can be added without code changes', () => {
  const next = {
    id: '2026-11-22',
    startsOn: '2026-11-22',
    endsOn: '2026-11-28',
    title: 'Sun Nov 22 – Sat Nov 28, 2026',
    days: [
      { date: '2026-11-22', weekday: 'Sunday', title: 'No dinner', recipeId: null, servings: 6 },
      { date: '2026-11-23', weekday: 'Monday', title: 'Garlic Parmesan chicken', recipeId: 'garlic-parmesan-chicken', servings: 6 }
    ]
  };
  const doc = { weeks: weeksDoc.weeks.concat([next]) };
  assert.equal(K.recipeIdForDate('2026-11-23', schedule, doc), 'garlic-parmesan-chicken');
  assert.equal(K.recipeIdForDate('2026-11-09', schedule, doc), null);
  assert.equal(K.recipeIdForDate('2026-11-11', schedule, doc), 'garlic-parmesan-chicken');
  assert.equal(K.recipeIdForDate('2026-11-10', schedule, doc), 'keto-pizza-bowls');
  assert.equal(K.recipeIdForDate('2026-11-22', schedule, doc), null);
  assert.equal(K.defaultWeekId(doc, '2026-11-25'), '2026-11-22');
  assert.equal(K.weekContaining('2026-11-08', doc).days[0].title, 'Vital frozen pizza');
  assert.equal(K.recipeIdForDate('2026-11-18', schedule, doc), 'keto-pizza-bowls');
  assert.equal(K.defaultWeekId(doc, '2026-11-18'), '2026-11-15');
});

test('pages share a kitchen nav and images are credited', () => {
  const recipeHtml = fs.readFileSync(path.join(root, 'recipes/index.html'), 'utf8');
  const plannerHtml = fs.readFileSync(path.join(root, 'planner/index.html'), 'utf8');
  const recipeApp = fs.readFileSync(path.join(root, 'recipes/app.js'), 'utf8');
  const plannerApp = fs.readFileSync(path.join(root, 'planner/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'kitchen/hearth.css'), 'utf8');
  assert.match(recipeHtml, /aria-label="Kitchen"/);
  assert.match(plannerHtml, /aria-label="Kitchen"/);
  assert.match(recipeHtml, /href="\.\.\/planner\/"/);
  assert.match(plannerHtml, /href="\.\.\/recipes\/"/);
  assert.match(recipeApp, /easternISODate/);
  assert.match(plannerApp, /easternISODate/);
  assert.equal(recipeApp.includes('keto-pizza-bowls'), false);
  assert.equal(plannerApp.includes('steak-bites'), false);
  assert.match(css, /prefers-reduced-motion/);
  const credited = new Set(credits.photos.map(photo => photo.file));
  recipesDoc.recipes.forEach(recipe => {
    const file = path.join('recipes', recipe.photo.src);
    assert.equal(credited.has(file), true, file);
    assert.ok(recipe.photo.caption);
    assert.ok(recipe.photo.author);
  });
  assert.equal(credited.has('recipes/assets/photos/shrimp-scampi.jpg'), false);
  assert.equal(credited.has('recipes/assets/photos/tuscan-chicken.jpg'), true);
});

test('weekday mornings stay in the cookbook and are not a dinner slot', () => {
  const section = (recipesDoc.sections || []).find(item => item.id === 'weekday-mornings');
  assert.ok(section);
  assert.equal(section.title, 'Weekday Mornings');
  assert.match(section.note, /Weekday morning game plan/);
  assert.match(section.note, /400°F/);
  assert.match(section.note, /bacon/i);
  assert.match(section.note, /last/i);
  ['scrambled-eggs', 'fried-eggs'].forEach(id => {
    const recipe = catalog[id];
    assert.ok(recipe, id);
    assert.equal(recipe.section, 'weekday-mornings');
    assert.equal(recipe.illustration, 'skillet');
    assert.doesNotMatch(JSON.stringify(recipe), /toast|—|shrimp|seafood/i);
    weeksDoc.weeks.forEach(weekItem => {
      assert.equal(weekItem.days.some(day => day.recipeId === id), false, id);
    });
    assert.equal(Object.values(schedule.days || {}).some(day => day.recipeId === id), false);
  });
  const scrambled = catalog['scrambled-eggs'];
  assert.equal(scrambled.servings, 4);
  assert.equal(scrambled.defaultPortions, 3);
  assert.equal(scrambled.ingredients.find(item => item.id === 'eggs').amount, 8);
  assert.equal(scrambled.ingredients.find(item => item.id === 'butter').amount, 2);
  assert.equal(K.formatIngredient(scrambled.ingredients.find(item => item.id === 'eggs'), 3, scrambled.servings).qty, '6');
  assert.equal(K.formatIngredient(scrambled.ingredients.find(item => item.id === 'butter'), 3, scrambled.servings).qty, '1 1/2 tbsp');
  assert.match(scrambled.tips.items.join('\n'), /8 or more eggs/);
  const fried = catalog['fried-eggs'];
  assert.equal(fried.servings, 2);
  assert.equal(fried.defaultPortions, 3);
  assert.equal(fried.ingredients.find(item => item.id === 'eggs').amount, 4);
  assert.equal(fried.ingredients.find(item => item.id === 'fat').amount, 2);
  assert.equal(K.formatIngredient(fried.ingredients.find(item => item.id === 'eggs'), 3, fried.servings).qty, '6');
  assert.equal(K.formatIngredient(fried.ingredients.find(item => item.id === 'fat'), 3, fried.servings).qty, '3 tbsp');
  assert.match(fried.tips.title, /fall apart/);
  assert.ok(fried.tips.items.some(item => /cup/i.test(item)));
  assert.ok(fried.tips.items.some(item => /lid/i.test(item)));
  assert.ok(fried.tips.items.some(item => /10 inch pan/.test(item)));
  const session = K.emptyRecipeSession('weekday-mornings');
  K.ensureRecipeState(session, scrambled, new Date('2026-11-11T12:00:00.000Z'));
  K.ensureRecipeState(session, fried, new Date('2026-11-11T12:00:00.000Z'));
  K.ensureRecipeState(session, catalog['garlic-parmesan-chicken'], new Date('2026-11-11T12:00:00.000Z'));
  assert.equal(session.recipes['scrambled-eggs'].portions, 3);
  assert.equal(session.recipes['fried-eggs'].portions, 3);
  assert.equal(session.recipes['garlic-parmesan-chicken'].portions, 6);
  assert.equal(catalog['garlic-parmesan-chicken'].defaultPortions, undefined);
  const recipeApp = fs.readFileSync(path.join(root, 'recipes/app.js'), 'utf8');
  assert.equal(recipeApp.includes('scrambled-eggs'), false);
  assert.equal(recipeApp.includes('fried-eggs'), false);
  assert.match(recipeApp, /standingHtml/);
});
