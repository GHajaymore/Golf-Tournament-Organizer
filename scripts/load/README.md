# The shotgun load test

`shotgun-144.js` is a Saturday shotgun as load: 144 players on a nine-hole round scored by round
code, each saving their card after every hole (every 10–20 seconds — a two-hour round squeezed into
a few minutes), while 300 phones reload the public board. It calls the same two server actions the
`/play` screen does (`claimPlayerSlot`, `savePlayCard`) and the same `/live/<token>` page members
open. Added by the testing panel, 2026-10-23 (`docs/testing-panel-2026-10-23.md`, item F3).

**Never against production.** It writes 144 cards, and production holds real members (CLAUDE.md,
hard rule 1). The seeder refuses any database it has not been told the name of, and refuses Vercel's
production environment outright.

## Against a preview deployment (the real run)

What makes the number mean anything is the DATABASE: a preview whose database is a copy the size of
production's, so the board's queries meet as many clubs, tournaments and cards as they will on a
Saturday. An empty preview database measures an empty app.

1. **A preview with a production-sized database.** Push the branch to be measured (Vercel builds a
   preview of every branch push). Point that preview's `DATABASE_URL` / `PRISMA_DATABASE_URL` at a
   database restored from a production backup **with the people taken out** — names, addresses and
   phones replaced — or at a copy grown to production's row counts with invented rows. Never at
   production itself.
2. **Seed the field into THAT database**, typing its host so it cannot happen by accident:

   ```bash
   DATABASE_URL=<the preview's database URL> LOAD_DATABASE_HOST=<its host> node scripts/load/seed-shotgun.mjs
   ```

   It writes `.qa/load/shotgun-plan.json` (the round code, the board's token, the 144 players' ids —
   no secret, nothing to commit; `.qa/` is ignored by git).
3. **Run k6** ([k6.io](https://k6.io); a single binary):

   ```bash
   k6 run -e BASE_URL=https://<the-preview>.vercel.app scripts/load/shotgun-144.js
   ```

   If the preview is behind Vercel's deployment protection, add a bypass header for the run, or turn
   the protection off for that preview while it runs.
4. **Take the field away**, every time:

   ```bash
   DATABASE_URL=<the preview's database URL> LOAD_DATABASE_HOST=<its host> node scripts/load/seed-shotgun.mjs --teardown
   ```

### Knobs (`-e NAME=value` to k6, or the environment for k6-lite)

| | Default | |
|---|---|---|
| `BASE_URL` | `http://localhost:3101` | the app |
| `PLAYERS` | the whole seeded field | up to the field's size |
| `VIEWERS` | 300 | phones on the board |
| `SPREAD_S` | 30 | seconds over which the players reach the first tee |
| `HOLE_MIN_S`, `HOLE_MAX_S` | 10, 20 | seconds between one player's saves |
| `VIEW_MIN_S`, `VIEW_MAX_S` | 15, 30 | seconds between one phone's reloads of the board |
| `CLAIM_ACTION_ID`, `SAVE_ACTION_ID` | read off `/play` | the server actions' ids, which belong to one build |

### What it holds the app to

| Threshold | Why |
|---|---|
| `card_saved` rate > 99.9% | a card that does not save is a player re-typing on the green |
| `save_card_ms` p(95) < 1.5 s | a save a player waits on, on one bar of signal |
| `claim_ms` p(95) < 2 s | 144 people typing one code within half a minute |
| `board_ms` p(95) < 2 s | a board reloading on a phone |
| `http_req_failed` < 1% | anything else |

k6 exits 99 when a threshold is crossed.

## On this machine (to prove the script works, not to measure Saturday)

k6 is not needed for that: `k6-lite.mjs` runs the same file with the part of k6's API it uses
(synchronous `http`, `check`, `sleep`, `Trend`/`Rate`/`Counter`, the two executors, thresholds).

```bash
# a built server with the Secure cookie flag dropped, because this is plain http (see CLAUDE.md, WebKit)
NEXT_DIST_DIR=.next-load npx next build
NEXT_DIST_DIR=.next-load AUTH_SECRET=local-load-secret E2E_PLAIN_HTTP=1 npx next start --port 3102 &
PLAYERS=36 node --env-file=.env scripts/load/seed-shotgun.mjs
BASE_URL=http://127.0.0.1:3102 VIEWERS=75 node scripts/load/k6-lite.mjs scripts/load/shotgun-144.js
node --env-file=.env scripts/load/seed-shotgun.mjs --teardown
```

A laptop's figures are the laptop's database next door: they say the script and the actions work
under a crowd of this size, and nothing about a Vercel function cold-starting against a pooled
database across a region. The measured figures are in `docs/testing-panel-2026-10-23.md`.
