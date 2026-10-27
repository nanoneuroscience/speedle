# Speedle mountain overhaul

This branch is the separate visual overhaul. Production continues to deploy from `main`.

## Local preview

From this checkout:

```sh
PORT=4180 HOST=127.0.0.1 SPEEDLE_DATA_DIR="$PWD/.preview-data" node outputs/server.mjs
```

Open http://localhost:4180. Preview scores and progress stay in `.preview-data`, independently of the current site.

- `/` opens the new daily mountain climb.
- `/classic#room-entry` opens the existing multiplayer experience.
- Room invite links using `?room=…` still open the existing multiplayer game.

## Daily climb rules

Everyone receives the same deterministic sequence of faster-object matchups for the UTC day. Pick the faster object to climb one level. A miss keeps the current level and moves to the next matchup. The run continues until ten correct answers reach the summit.

Your final score is the total number of matchups needed. Ten is perfect; lower is better. Progress, summit streaks, and statistics persist across reloads and restarts. New challenges begin at midnight UTC.

## Checks

```sh
node --test outputs/climb.test.mjs
node --check outputs/server.mjs
node --check outputs/public/mountain.js
node --check outputs/public/mountain-scene.js
```

The tests cover deterministic comparable pair selection, answer privacy, wrong answers and final scoring, sequence continuation, concurrent or stale submissions, persistence and failed writes, summit streaks, and separation from the existing score store.
