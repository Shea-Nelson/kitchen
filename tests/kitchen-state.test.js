const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../kitchen/state.js');

const root = path.join(__dirname, '..');
const recipesDoc = JSON.parse(fs.readFileSync(path.join(root, 'recipes/data/recipes.json'), 'utf8'));
const schedule = JSON.parse(fs.readFileSync(path.join(root, 'recipes/data/schedule.json'), 'utf8'));
const weeksDoc = JSON.parse(fs.readFileSync(path.join(root, 'planner/data/weeks.json'), 'utf8'));
const catalog = Object.fromEntries(recipesDoc.recipes.map(recipe => [recipe.id, recipe]));

test('storage keys stay off the workout app', () => {
  assert.notEqual(K.RECIPE_STORAGE_KEY, K.PLANNER_STORAGE_KEY);
  assert.equal(K.RECIPE_STORAGE_KEY.startsWith('wk.'), false);
  assert.equal(K.PLANNER_STORAGE_KEY.startsWith('wk.'), false);
  assert.equal(K.RECIPE_SCHEMA, 'kitchen.recipe-session');
  assert.equal(K.PLANNER_SCHEMA, 'kitchen.planner-session');
});

test('seed dates and confirmed dinner names', () => {
  assert.equal(K.weekdayName('2026-11-05'), 'Thursday');
  assert.equal(K.sundayOf('2026-11-05'), '2026-11-01');
  assert.equal(K.sundayOf('2026-11-08'), '2026-11-08');
  assert.equal(K.weekdayName('2026-11-14'), 'Saturday');
  assert.equal(schedule.days['2026-11-05'].recipeId, 'garlic-butter-salmon');
  assert.equal(K.recipeIdForDate('2026-11-05', schedule, weeksDoc), 'garlic-butter-salmon');
  assert.equal(K.recipeIdForDate('2026-11-08', schedule, weeksDoc), null);
  assert.equal(K.recipeIdForDate('2026-11-09', schedule, weeksDoc), null);
  assert.equal(K.recipeIdForDate('2026-11-10', schedule, weeksDoc), 'keto-pizza-bowls');
  assert.equal(K.recipeIdForDate('2026-11-11', schedule, weeksDoc), 'garlic-parmesan-chicken');
  assert.equal(K.recipeIdForDate('2026-11-13', schedule, weeksDoc), 'steak-bites');
  assert.equal(K.recipeIdForDate('2026-11-14', schedule, weeksDoc), null);
  assert.equal(K.recipeIdForDate('2026-11-06', schedule, weeksDoc), null);
  const week = weeksDoc.weeks[0];
  assert.deepEqual(week.days.map(day => day.date), [
    '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'
  ]);
  assert.deepEqual(week.days.map(day => day.title), [
    'Vital frozen pizza',
    "Kevin's frozen teriyaki",
    'Pizza night',
    'Garlic Parmesan chicken',
    'Broccoli ham bake',
    'Garlic butter steak bites',
    'Out of town'
  ]);
  assert.equal(week.days[0].recipeId, null);
  week.days.forEach(day => {
    assert.equal(K.weekdayName(day.date), day.weekday);
    if (day.recipeId) assert.ok(catalog[day.recipeId], day.recipeId);
    assert.equal(day.servings, 6);
  });
});

test('cookbook has no nutrition figures and real photo files', () => {
  function keys(value, found) {
    if (!value || typeof value !== 'object') return;
    const list = Array.isArray(value) ? value : Object.keys(value).map(key => {
      if (/^(calories|protein|carbs|netCarbs|nutrition)$/i.test(key)) found.push(key);
      return value[key];
    });
    list.forEach(item => keys(item, found));
  }
  const found = [];
  keys(recipesDoc, found);
  keys(weeksDoc, found);
  assert.deepEqual(found, []);
  assert.match(JSON.stringify(catalog['garlic-butter-salmon']), /145°F/);
  assert.doesNotMatch(JSON.stringify(catalog['garlic-butter-salmon']), /125/);
  recipesDoc.recipes.forEach(recipe => {
    const file = path.join(root, 'recipes', recipe.photo.src);
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.length > 20000, recipe.photo.src);
    assert.equal(bytes[0], 0xff);
    assert.equal(bytes[1], 0xd8);
    assert.equal(recipe.photo.src.startsWith('http'), false);
    assert.match(recipe.authoring, /newly written|Household seed|Household plan/);
  });
});

test('grocery sums are reliable and optional starch stays separate', () => {
  const week = weeksDoc.weeks[0];
  const list = K.aggregateGrocery(week, catalog, {});
  const butter = list.shop.find(item => item.groceryKey === 'butter');
  const cream = list.shop.find(item => item.groceryKey === 'heavy-cream');
  const limes = list.shop.find(item => item.groceryKey === 'limes');
  assert.equal(butter.amount, 6);
  assert.equal(butter.unit, 'tbsp');
  assert.equal(cream.amount, 1);
  assert.equal(cream.unit, 'cups');
  assert.equal(limes, undefined);
  assert.equal(list.shop.some(item => item.groceryKey === 'chicken-breasts'), false);
  assert.equal(list.onHand.find(item => item.groceryKey === 'chicken-breasts').amount, 3);
  assert.equal(list.shop.some(item => item.groceryKey === 'salt'), false);
  assert.equal(list.shop.some(item => item.groceryKey === 'shrimp'), false);
  assert.equal(list.shop.some(item => item.groceryKey === 'rice'), false);
  assert.equal(list.shop.some(item => item.groceryKey === 'pita'), false);
  assert.equal(list.shop.some(item => item.groceryKey === 'potatoes'), false);
  assert.ok(list.kidsStarch.some(item => item.groceryKey === 'pita'));
  assert.ok(list.kidsStarch.some(item => item.groceryKey === 'potatoes'));
  assert.ok(list.kidsStarch.some(item => item.groceryKey === 'dinner-rolls'));
  assert.ok(list.pantry.some(item => item.groceryKey === 'oregano'));
  const doubled = K.aggregateGrocery(week, catalog, { '2026-11-11': { servings: 12 } });
  assert.equal(doubled.shop.find(item => item.groceryKey === 'butter').amount, 9);
});

test('portion scaling and clock formatting', () => {
  assert.equal(K.scaleAmount(12, 6, 3), 6);
  assert.equal(K.formatQty(0.75), '3/4');
  assert.equal(K.formatQty(1.5), '1 1/2');
  assert.equal(K.formatQty(8.25), '8 1/4');
  const salmon = catalog['garlic-butter-salmon'];
  const butter = salmon.ingredients.find(item => item.id === 'butter');
  assert.equal(K.formatIngredient(butter, 3, 6).qty, '6 tbsp');
  const lemons = salmon.ingredients.find(item => item.id === 'lemons');
  assert.equal(K.formatIngredient(lemons, 6, 6).qty, '1–2 lemons');
  assert.equal(K.formatClock(12 * 60 * 1000), '12:00');
  assert.equal(K.formatClock(3 * 60 * 60 * 1000), '3:00:00');
  assert.equal(K.formatClock(45000), '0:45');
});

test('timers keep an end timestamp across a simulated reload', () => {
  const now = Date.parse('2026-11-05T18:00:00.000Z');
  let timer = {
    id: 'bake-12', stepId: 'bake', label: 'Bake', durationMs: 720000,
    status: 'idle', endAt: null, remainingMs: 720000, updatedAt: '2026-11-05T18:00:00.000Z'
  };
  timer = K.startTimer(timer, now);
  assert.equal(timer.status, 'running');
  assert.equal(timer.endAt, now + 720000);
  const later = now + 125000;
  timer = K.syncTimer(timer, later);
  assert.equal(timer.status, 'running');
  assert.equal(K.timerRemaining(timer, later), 720000 - 125000);
  timer = K.pauseTimer(timer, later);
  assert.equal(timer.endAt, null);
  assert.equal(timer.status, 'paused');
  const pausedFor = timer.remainingMs;
  timer = K.syncTimer(timer, later + 60000);
  assert.equal(timer.remainingMs, pausedFor);
  timer = K.resumeTimer(timer, later + 60000);
  assert.equal(timer.endAt, later + 60000 + pausedFor);
  timer = K.syncTimer(timer, timer.endAt + 5);
  assert.equal(timer.status, 'done');
  assert.equal(timer.remainingMs, 0);
  timer = K.resetTimer(timer, timer.endAt);
  assert.equal(timer.status, 'idle');
  assert.equal(timer.endAt, null);
  assert.equal(timer.remainingMs, 720000);
});

test('export and import keep escaped notes and reject the other app', () => {
  const notes = 'Tom </script><img src=x onerror=alert(1)> & "quotes"\nnext line \u2028';
  const session = K.emptyRecipeSession('ks_12345678-1234-4123-8123-123456789abc', new Date('2026-11-05T18:00:00.000Z'));
  K.ensureRecipeState(session, catalog['garlic-butter-salmon'], new Date('2026-11-05T18:00:00.000Z'));
  session.recipes['garlic-butter-salmon'].notes = notes;
  session.recipes['garlic-butter-salmon'].ingredients.salmon.checked = true;
  session.recipes['garlic-butter-salmon'].steps.heat.checked = true;
  session.recipes['garlic-butter-salmon'].phase = 'cooking';
  session.recipes['garlic-butter-salmon'].timers['bake-12'] = K.startTimer(
    session.recipes['garlic-butter-salmon'].timers['bake-12'],
    Date.parse('2026-11-05T18:00:00.000Z')
  );
  const exported = JSON.stringify(session);
  assert.equal(exported.includes('<script>'), false);
  assert.match(exported, /\\u003c\/script\\u003e|<\/script>/);
  const parsed = K.parseSessionJson(exported);
  const result = K.validateRecipeSession(parsed);
  assert.equal(result.ok, true, result.errors && result.errors.join('\n'));
  assert.equal(result.value.recipes['garlic-butter-salmon'].notes, notes);
  assert.equal(result.value.recipes['garlic-butter-salmon'].ingredients.salmon.checked, true);
  assert.equal(result.value.recipes['garlic-butter-salmon'].timers['bake-12'].status, 'running');
  assert.equal(typeof result.value.recipes['garlic-butter-salmon'].timers['bake-12'].endAt, 'number');
  assert.equal(K.esc(notes).includes('<'), false);
  const planner = K.emptyPlannerSession(session.sessionId, new Date('2026-11-05T18:00:00.000Z'));
  planner.weeks['2026-11-08'] = {
    notes: notes,
    days: {
      '2026-11-08': {
        plannedRecipeId: 'steak-bites',
        overrideRecipeId: 'pork-carnitas',
        servings: 6,
        notes: notes,
        favorite: true,
        rating: 4,
        cookedAt: '2026-11-08T23:00:00.000Z',
        status: 'cooked',
        tasks: { 'steak-cut': { checked: true } },
        customTasks: [{ id: 'ct_abc123abc123', label: 'Slice limes', checked: false }]
      }
    }
  };
  planner.pantry.salt = 'have';
  planner.groceryChecked['2026-11-08'] = { 'butter|tbsp|shop': true };
  const plannerResult = K.validatePlannerSession(K.parseSessionJson(JSON.stringify(planner)));
  assert.equal(plannerResult.ok, true, plannerResult.errors && plannerResult.errors.join('\n'));
  assert.equal(plannerResult.value.weeks['2026-11-08'].days['2026-11-08'].notes, notes);
  assert.equal(plannerResult.value.groceryChecked['2026-11-08']['butter|tbsp|shop'], true);
  assert.equal(K.validateRecipeSession(plannerResult.value).ok, false);
  assert.equal(K.validatePlannerSession(result.value).ok, false);
  const polluted = JSON.parse(exported);
  polluted.__proto__ = { polluted: true };
  const safe = K.parseSessionJson(JSON.stringify(session));
  assert.equal(Object.prototype.hasOwnProperty.call(safe, '__proto__'), false);
});

test('invalid sessions are rejected instead of partially trusted', () => {
  const broken = K.emptyRecipeSession('not-an-id');
  const result = K.validateRecipeSession(broken);
  assert.equal(result.ok, false);
  const badTimer = K.emptyRecipeSession('ks_12345678-1234-4123-8123-123456789abc', new Date('2026-11-05T18:00:00.000Z'));
  K.ensureRecipeState(badTimer, catalog['garlic-butter-salmon'], new Date('2026-11-05T18:00:00.000Z'));
  badTimer.recipes['garlic-butter-salmon'].timers['bake-12'].status = 'running';
  badTimer.recipes['garlic-butter-salmon'].timers['bake-12'].endAt = null;
  assert.equal(K.validateRecipeSession(badTimer).ok, false);
});
