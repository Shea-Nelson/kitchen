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

The email body has a plain-language list and a machine-readable block the weekly routine can parse (`KitchenReview.parsePicksBody` in `review/picks.js`):

    WEEK: 2026-11-29
    DAY 2026-11-30 | Chicken cordon bleu bake | CHANGE | Pork carnitas
    DAY 2026-12-01 | Sheet-pan Italian sausage with peppers and onions | CHANGE | surprise me
    GROCERY REMOVE | Yellow onions, 3
    GROCERY ADD | Salsa | 1 jar | Produce
    NOTES-JSON: "No fish this week"

`APPROVE` keeps the planned dinner. `CHANGE` plus a dinner name is the swap to use. `CHANGE` plus `surprise me` means Nicole asked Scorpy to choose a family-friendly keto dinner from the library (not already on that week, and not seafood). `CHANGE` with a blank swap, or `NONE`, follows the existing rules (offer options, or leave as planned).

Grocery list edits from the review page are optional. `GROCERY REMOVE | <item as listed>` means leave that written item off the shopping list (the text is the peek label, without the long em-dash note). `GROCERY ADD | <item> | <qty> | <section>` adds an item she typed; quantity and store section may be blank. Dinner picks can be sent again after grocery edits; grocery-only edits are enough to send on their own.
