# Family kitchen data

The recipe page (`/recipes/`) and the week planner (`/planner/`) read JSON. Adding next week's plan is a data change: new recipe objects, then one new week object. No JavaScript change is required. Older weeks stay in `planner/data/weeks.json` and remain browsable.

Both pages treat "today" as the calendar date in `America/New_York`.

Do not put nutrition numbers, names, health notes, credentials, or private messages in these files.

## Files

| File | Role |
| --- | --- |
| `recipes/data/recipes.json` | Cookbook. One object per recipe. |
| `planner/data/weeks.json` | Weeks, daily breakfast / lunch / dinner, and the shopping list. |
| `recipes/data/schedule.json` | Optional one-off date that is not part of a week. The Nov 5 salmon card lives here. Prefer `weeks.json` for a normal week. |
| `recipes/assets/photos/` | Local images only. No remote `src`. |
| `recipes/assets/photos/credits.json` | Attribution for every image file. |

`schedule.json` is checked before the week file. Leave a date out of `schedule.json` when that date is already on a week, or the schedule entry hides the week entry.

## Recipe object

`recipes/data/recipes.json`:

```json
{
  "schema": "kitchen.recipes",
  "schemaVersion": 1,
  "authoring": "Short note about where the amounts came from. No nutrition figures.",
  "recipes": [
    {
      "id": "garlic-parmesan-chicken",
      "version": 1,
      "title": "Garlic Parmesan chicken",
      "summary": "One or two sentences.",
      "servings": 6,
      "servingsNote": "What the amounts mean. The portion control scales from servings.",
      "style": "Oven, 400°F.",
      "illustration": "oven",
      "authoring": "Household plan for that date.",
      "safety": "Chicken is done at 165°F in the thickest part.",
      "kidSide": "Optional kid side, or say there is none.",
      "photo": {
        "src": "assets/photos/garlic-parmesan-chicken.jpg",
        "alt": "What a cook sees in the picture.",
        "caption": "Say plainly if the picture is not this exact plate.",
        "author": "Name",
        "license": "CC0 1.0",
        "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:Example.jpg",
        "changes": "What you changed, such as a resize."
      },
      "ingredients": [],
      "steps": [],
      "tasks": []
    }
  ]
}
```

`illustration` is one of `oven`, `skillet`, `bowl`, `pot`.

`id` values match `^[a-z0-9][a-z0-9-]{0,63}$`. Bump `version` when ingredients or steps change so a phone can keep old checks and show that the cookbook moved on.

### Ingredients

```json
{
  "id": "butter",
  "name": "butter",
  "amount": 3,
  "unit": "tbsp",
  "note": "melted",
  "scalable": true,
  "group": "shop",
  "groceryKey": "butter",
  "groceryName": "butter"
}
```

- `amount` and `unit` are optional. Leave them off when the plan names a food and does not give a measure. Do not invent a teaspoon amount.
- `amountMax` is optional and makes a range, such as `1` to `2`.
- `scalable: false` keeps the amount fixed when the portion control changes. Use it for "to taste" and for kid sides that are not part of the adult batch.
- `group` is `shop`, `pantry`, `on-hand`, `kids-starch`, or `kids`.
  - `on-hand` shows on the recipe and stays out of the summed shop list.
  - `kids-starch` and `kids` stay off the adult plate.
  - `pantry` is for staples.
- The same `groceryKey` plus the same `unit` plus the same group are added together when a week has no written grocery list. `bag` and `bags` do not add together. The written list on the week is what the planner prints when it is present.

### Steps, timers, temperatures

```json
{
  "id": "bake",
  "text": "Bake at 400°F for 20 to 30 minutes, until the thickest part is 165°F.",
  "timers": [
    {
      "id": "bake-20",
      "label": "Bake chicken",
      "seconds": 1200,
      "note": "Start with 20 minutes. It may need up to 30. 165°F decides, not the timer."
    }
  ]
}
```

Put a timer on every step that states a duration. For a range, start the timer at the short end and put the long end in `note`. A timer's `seconds` must be from 1 to 43200 (12 hours). A running timer stores an end timestamp in the session file, so it keeps counting after a reload.

Put the safe internal temperature in `safety` and in the step that cooks the meat. Do not add calorie, protein, carb, or other nutrition fields.

`tasks` are the planner's prep checklist: `{ "id": "chicken-pound", "label": "Pound the breasts to an even thickness" }`.

## Week object

Append to the `weeks` array. Do not remove past weeks.

```json
{
  "schema": "kitchen.weeks",
  "schemaVersion": 1,
  "authoring": "Where the plan came from. No nutrition figures.",
  "household": "Family of five. Dinners are about 6 adult portions. Adults eat keto or low-carb. Kid starch is listed on its own.",
  "weeks": [
    {
      "id": "2026-11-15",
      "startsOn": "2026-11-15",
      "endsOn": "2026-11-21",
      "title": "Sun Nov 15 – Sat Nov 21, 2026",
      "groceryNote": "Check the pantry before buying. This list does not order food.",
      "days": [
        {
          "date": "2026-11-15",
          "weekday": "Sunday",
          "title": "No dinner",
          "recipeId": null,
          "servings": 6,
          "breakfast": "What breakfast is.",
          "lunch": "What lunch is.",
          "dinnerNote": "Why there is no dinner, if that is the plan."
        },
        {
          "date": "2026-11-16",
          "weekday": "Monday",
          "title": "Garlic Parmesan chicken",
          "recipeId": "garlic-parmesan-chicken",
          "servings": 6,
          "breakfast": "What breakfast is.",
          "lunch": "What lunch is.",
          "dinnerNote": "One line a cook can read on the plan."
        }
      ],
      "grocery": [
        {
          "id": "meat",
          "title": "Meat",
          "items": [
            { "id": "chicken", "label": "Boneless skinless chicken breasts, about 3 lb — already on hand. Do not buy more." }
          ]
        },
        {
          "id": "pantry",
          "title": "Pantry",
          "pantry": true,
          "items": [
            { "id": "oregano", "label": "Oregano" }
          ]
        }
      ]
    }
  ]
}
```

Rules:

- `id`, `startsOn`, and the Sunday `date` are the Sunday of that week, `YYYY-MM-DD`. `endsOn` is the Saturday.
- `weekday` must match the date. The app checks this in tests.
- `recipeId` is an `id` from the cookbook, or `null` when that day has no dinner. Do not leave a removed dinner's id in place.
- `servings` is the batch size for that day, usually `6`.
- `breakfast`, `lunch`, and `dinnerNote` are shown on the plan and on that day's recipe. They are optional on older weeks.
- `grocery` is the printed, checkable list, grouped by store section. Section `id` and item `id` match `^[a-z0-9][a-z0-9-]{0,63}$`. The checkbox key is `list|{section id}|{item id}`.
- `"pantry": true` on a section shows a have / need control for each item. Checks stay on the phone.
- If `grocery` is omitted, the planner sums dinner ingredients instead. That sum misses breakfast, lunch, and "already on hand" notes, so write the list when you have one.
- A swapped dinner on a phone does not rewrite this published list.

## Photos

Use a licensed local JPEG (or other real local image) with credit, or original art. The caption has to say when the picture is not the dish on the page. Wikimedia Commons files need the author, license, license URL, and source URL in both the recipe and `credits.json`.

Do not point `photo.src` at another website.

## Friday update

1. Add any new recipes to `recipes/data/recipes.json`, including amounts that the plan actually states, numbered steps, timers on timed steps, and the safe internal temperature.
2. Add the image files and a `credits.json` entry.
3. Append the next week to `weeks` in `planner/data/weeks.json`, with seven days, breakfast, lunch, dinner, and a grocery list by store section.
4. Leave every earlier week in the array.
5. Run `node --test tests/*.test.js`.

The recipe page lists the days of the week you are viewing. The planner opens on today's date in Eastern time. A dinner link looks like `recipes/?date=2026-11-16&recipe=garlic-parmesan-chicken`.

## Shopping page

`/shopping/` builds the week's checkable list from three files, so a new week is a data change only:

1. `planner/data/weeks.json` says which dinner each day has.
2. `recipes/data/recipes.json` supplies the ingredients. `shop` and `pantry` items are listed and added together by `groceryKey` and unit. `on-hand` items show only in the "Already on hand" note. `kids-starch` and `kids` items stay off unless the week adds them. Days with `recipeId: null` (store-bought, away) add nothing.
3. `shopping/data/lists.json` has the store sections, a `sectionOf` map from `groceryKey` to section, and one entry per week under `weeks["YYYY-MM-DD"]` (the Sunday id):
   - `items`: `{ "key", "name", "qty", "note", "section", "for": [...] }`. A `key` that matches a recipe ingredient overrides its name or amount. Any other key is an extra item, such as breakfast, lunch, snacks, or the kids' pizza. `{ "key": "x", "hide": true }` removes a generated item.
   - `for` tags: `"2026-11-13"` is that day's dinner, `"2026-11-13 breakfast"` is a meal, and any other text is shown as written.
   - `dinnerShort`: optional short dinner names for the tags.
   - `skipDates`: optional dates whose dinner should not be shopped for.

Checks and hand-added items stay in this browser under `kitchen.shopping.v1`, keyed by week. They do not sync between phones. Copy or Share sends a plain-text copy.
