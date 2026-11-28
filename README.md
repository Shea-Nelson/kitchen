# Family kitchen

Daily recipes, the week's dinner plan, and the Shopping list, served by GitHub Pages at https://shea-nelson.github.io/kitchen/.

- Recipes: https://shea-nelson.github.io/kitchen/recipes/
- Planner: https://shea-nelson.github.io/kitchen/planner/
- Shopping: https://shea-nelson.github.io/kitchen/shopping/
- Review (thumbs up or down on each dinner, then email the picks): https://shea-nelson.github.io/kitchen/review/

Moved here from `Shea-Nelson/workout-app` on Nov 10, 2026. The folder layout is unchanged (`recipes/`, `planner/`, `shopping/`, shared `kitchen/`), so only the repo and the URL prefix changed.

Adding next week's dinners does not require a code change. Append a week to `planner/data/weeks.json` and any new recipes to `recipes/data/recipes.json`. The exact fields, grocery sections, timers, and photo rules are in [`kitchen/README.md`](kitchen/README.md). Past weeks stay in the file and stay browsable.

Tests: `node --test tests/*.test.js`

## Weekly review page

`review/` reads `planner/data/weeks.json` and `recipes/data/recipes.json`, so a new week shows up with no code change. It opens on the upcoming week (the first week that starts after today in Eastern time, else the current one); `?week=YYYY-MM-DD` opens another. Picks are saved in `localStorage` (`kitchen.review.v1`) and leave the device only when the reader taps "Send my picks" (a `mailto:` link) or "Copy my picks". No form service, no tracking. The email body format is built in `review/picks.js` and covered by `tests/kitchen-review.test.js`.
