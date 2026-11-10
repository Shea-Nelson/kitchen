# Family kitchen

Daily recipes, the week's dinner plan, and the Shopping list, served by GitHub Pages at https://shea-nelson.github.io/kitchen/.

- Recipes: https://shea-nelson.github.io/kitchen/recipes/
- Planner: https://shea-nelson.github.io/kitchen/planner/
- Shopping: https://shea-nelson.github.io/kitchen/shopping/

Moved here from `Shea-Nelson/workout-app` on Nov 10, 2026. The folder layout is unchanged (`recipes/`, `planner/`, `shopping/`, shared `kitchen/`), so only the repo and the URL prefix changed.

Adding next week's dinners does not require a code change. Append a week to `planner/data/weeks.json` and any new recipes to `recipes/data/recipes.json`. The exact fields, grocery sections, timers, and photo rules are in [`kitchen/README.md`](kitchen/README.md). Past weeks stay in the file and stay browsable.

Tests: `node --test tests/*.test.js`
