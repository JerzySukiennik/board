# Tablica (board)

An interactive whiteboard that answers any question by drawing it step by step. The student can draw on the board too: circle something, underline it, write a question, and the teacher answers right next to the marks with an arrow.

Live: https://board.gzowo.fun · also built into Pupka (https://pupka.gzowo.fun, tab "Tablica").

## How it works

- `worker/` is a Cloudflare Worker (`board-api`). It streams a script in a small board language from Claude (`LESSON_MODEL`, default `claude-sonnet-5-5`, draws lessons; `REPLY_MODEL`, default `claude-haiku-5-5`, answers the student's marks) and keeps a daily budget and per-visitor limits in a Durable Object.
- `board/` is the engine, shared with Pupka: it parses the script line by line while it streams, lays the steps out in columns, turns every command into wobbly hand-drawn SVG and plays it back stroke by stroke. `Niepotrzebne/sync-pupka.sh` copies it into Pupka.
- The board language (`worker/src/prompt.mjs`): `step`, `say`, `note`, `key`, `wrong`, `ask`, `fig` and drawing commands such as `line`, `arrow`, `circle`, `curve`, `hatch`, `text`, `dim`, `angle`, `axes`, `plot`. The model never positions blocks; the app does.
- Marks drawn by the student are sent as a picture of that part of the board plus the nearest board elements; the reply block is placed in free space next to them.

## Run locally

```bash
cd worker && npm install && npx wrangler dev --port 8797 --local
```

```bash
node Niepotrzebne/devserver.mjs 8951
```

The worker needs `ANTHROPIC_API_KEY` in `worker/.dev.vars`. `DEV=1` there enables per-request model overrides (`?debug={"model":"claude-sonnet-5-5","effort":"low"}`).

Fonts: Shantell Sans and Geist (Google Fonts, OFL).
