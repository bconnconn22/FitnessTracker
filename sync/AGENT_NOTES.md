# Agent notes: writing to the AppSync tab

Brett's Health Tracker app and this Google Sheet stay in sync through the **AppSync** tab of spreadsheet `1gsyxFOLWmTwmaXjGLFv-V-XYEyBZYtMYzoMV6QR7NvY`.

Use the Google Sheets connector to add, edit, or delete rows here. Do **not** change the Workout Log, Personal Bests, or Weekly Scorecard tabs when you are only updating the app. After you write to AppSync, the next app sync (open, return to the app, save, or **Sync now**) picks up the change.

The Apps Script web app (`sync/Code.gs`) is what the phone talks to. You do not need to call that web app yourself; writing the tab is enough.

## Column spec

Header row (do not rename):

| Column | Name        | Type    | Notes |
|--------|-------------|---------|--------|
| A      | `id`        | text    | Stable record id. Reuse this id to edit or delete. Never invent a second row with the same `id` + `collection`. |
| B      | `collection`| text    | One of: `food`, `workouts`, `water`, `bp`, `sleep`, `records`, `weights`, `recipes`, `stats`, `customExercises`, `recentFoods`, `favorites`, `settings`. |
| C      | `date`      | text    | `YYYY-MM-DD` for dated entries; leave blank for `settings`, `customExercises`, `recentFoods`, `favorites`. |
| D      | `updatedAt` | text    | ISO-8601 UTC, e.g. `2026-11-09T23:15:00.000Z`. **Must be newer than the current value** or the app will keep its copy. Always set this to now when you add or change a row. |
| E      | `deleted`   | text    | `FALSE` for a live record. `TRUE` is a tombstone (the record is removed on the next sync). |
| F      | `json`      | text    | The record payload as a single JSON object. For tombstones this can be empty. Write it as plain text, not a formula. |

One row per record. If a duplicate `id` + `collection` is ever introduced, the script keeps the row with the newest `updatedAt` the next time the app syncs.

## How to add

1. Append a new row with a fresh `id` (use something unique, e.g. `bot-` plus a short random string).
2. Set `collection`, `date`, `updatedAt` to the current UTC time, `deleted` to `FALSE`.
3. Put the full payload in `json`. Include the same `id`, `date`, and `updatedAt` inside the JSON when the collection uses those fields (`food`, `workouts`, `water`, `sleep`, `weights`, `records`, `stats`, `recipes`).

## How to edit

1. Find the existing row by `id` (and `collection`).
2. Update `json` and set `updatedAt` (column D **and** the `updatedAt` field inside the JSON) to the current UTC time.
3. Leave `id` and `collection` alone. Do not append a second row.

## How to delete

1. Find the existing row.
2. Set `deleted` to `TRUE`, clear `json` if you like, and set `updatedAt` to now.
3. Leave the row in place (it is a tombstone). Do not only blank the row or the old value may come back from the phone.

## Id conventions

- Dated entries (`food`, `workouts`, `water`, `bp`, `sleep`, `records`, `weights`, `recipes`, `stats`): whatever string the app assigned (example: `mw9kgg076xtah`), or a new unique string you create.
- `settings`: always `settings`. There is only one settings row.
- `customExercises`: `custom:` + the exercise name in lowercase, e.g. `custom:chest press`.
- `favorites`: `fav:` + the food key, e.g. `fav:usda:123`.
- `recentFoods`: `recent:` + the food key. Do not overwrite a favorite/recent food object's own USDA `id` field inside `json`.

## Example rows

Values below are illustrative. Copy the shape, not the fake ids, and always use a fresh `updatedAt`.

### Strength workout (`workouts`)

```
id          bot-wo-20261111a
collection  workouts
date        2026-11-11
updatedAt   2026-11-11T23:10:00.000Z
deleted     FALSE
json        {"id":"bot-wo-20261111a","created":0,"updatedAt":"2026-11-11T23:10:00.000Z","date":"2026-11-11","time":"17:00","type":"strength","name":"Gym session","minutes":null,"unit":"lb","notes":"","exercises":[{"name":"Leg press","kind":"weight","sets":[{"reps":12,"weight":160},{"reps":10,"weight":160}],"note":""},{"name":"Chest press","kind":"weight","sets":[{"reps":12,"weight":70}]}]}
```

`type` must be one of: `strength`, `run`, `walk`, `bike`, `swim`, `other`.  
Exercise `kind` is `weight`, `bodyweight`, or `cardio`. Weight sets use `reps` + `weight`; cardio sets use `min` and/or `dist`. Distances are in miles when `unit` is `lb`, kilometers when `unit` is `kg`.

### Walk or other cardio session (`workouts`)

A walk is still a workout, with `type` set to `walk` (or `run` / `bike` / `swim`).

```
id          bot-wo-20261110a
collection  workouts
date        2026-11-10
updatedAt   2026-11-10T19:00:00.000Z
deleted     FALSE
json        {"id":"bot-wo-20261110a","updatedAt":"2026-11-10T19:00:00.000Z","date":"2026-11-10","time":"16:30","type":"walk","name":"Afternoon walk","minutes":40,"unit":"lb","notes":"Treadmill","exercises":[{"name":"Walking","kind":"cardio","sets":[{"min":40,"dist":2.37}]}]}
```

### Meal with macros (`food`)

```
id          bot-food-20261109d
collection  food
date        2026-11-09
updatedAt   2026-11-09T23:45:00.000Z
deleted     FALSE
json        {"id":"bot-food-20261109d","updatedAt":"2026-11-09T23:45:00.000Z","date":"2026-11-09","time":"18:30","name":"Chicken, rice, and broccoli","meal":"dinner","calories":620,"protein":48,"carbs":55,"fat":18,"notes":"Photo estimate"}
```

`meal` must be one of: `breakfast`, `lunch`, `dinner`, `snack`. Macros are grams. Leave a field `null` if it was not estimated.

### Weigh-in (`weights`)

```
id          bot-wt-20261109a
collection  weights
date        2026-11-09
updatedAt   2026-11-09T14:00:00.000Z
deleted     FALSE
json        {"id":"bot-wt-20261109a","updatedAt":"2026-11-09T14:00:00.000Z","date":"2026-11-09","time":"08:00","value":180,"unit":"lb","bf":null,"notes":""}
```

`unit` is `lb` or `kg`. `bf` is body-fat percent, or `null`.

### Other collections you may need

- **Water:** `{ "id":"...","date":"YYYY-MM-DD","time":"HH:MM","oz":16, "updatedAt":"..." }`
- **Sleep:** `{ "id":"...","date":"YYYY-MM-DD","bed":"23:00","wake":"07:00","minutes":480,"quality":3,"notes":"","updatedAt":"..." }` — one row per wake-up date.
- **Current stat (e.g. mile time):** collection `stats`. Example shape: `{ "id":"...","kind":"run","name":"1 mile","value":9.367,"unit":"min","date":"2026-11-03","note":"","race":"1mi","history":[{"value":9.367,"unit":"min","date":"2026-11-03","note":""}],"updatedAt":"..." }`. `value` for runs is minutes (9:22 is `9.367`).
- **Settings:** id `settings`, blank date, json like `{ "waterGoal":64,"units":"lb","updatedAt":"..." }`. Optional `weightGoal`: `{ "value":175, "unit":"lb" }`.

## After you write

The phone will not change until it syncs. If Brett has the app open, ask him to tap **Sync now** in Settings, or just reopen the app. If a change you wrote does not appear, check that `updatedAt` is newer than the row you replaced and that the `json` parses as a single object.
