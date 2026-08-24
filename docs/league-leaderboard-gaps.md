# League leaderboard: what a Thursday-night league expects, and what we have

Queued 2026-08-24 after comparing our screens against a running men's league's
leaderboard on a competing product. That comparison came from screenshots of a
live league and is **not reproduced here** — real member names, and this
repository is public.

## What we already do, some of it better

- **Skins, gross and net, with the CARRY.** `playSkins` in
  `src/lib/domain/skins.ts` carries a tied hole's value forward, which is the
  whole character of the game and is what makes the 18th worth playing for
  somebody who has won nothing all day. The product compared against showed no
  carry at all.
- **Pot arithmetic in whole cents.** `skins-pot.ts` divides integer cents, so a
  pot split three ways cannot drift by a penny and cannot pay out more than was
  put in.
- **Each week settles on its own.** Nothing rolls into next week, so a player
  who was not there last week is not playing for money they did not stake.
- **Per-skin detail is already in the data.** `SkinResult` carries the hole,
  the winning score and the carried value, and `SkinsStanding` carries
  `holesWon[]` — enough to render "won the 8th with a 3", and with the card's
  par, "birdie on 8".
- Per-round team standings, match results with hole-by-hole cards, a player
  money view, a prizes/pot screen, series standings ACROSS events, honours.

## The three real gaps

### 1. Front nine and back nine as separate skins games

A league night is commonly four games: front gross, front net, back gross,
back net, each with its own purse. `playSkins` runs one game over whatever
holes it is given, and nothing above it splits a round into two nines with two
pots. This is the most concrete gap and the smallest: the engine already takes
a hole range implicitly by the strokes passed to it.

Do NOT solve this by calling `playSkins` twice with sliced arrays at each call
site — that is the "guard you must remember to call" shape. One reader that
returns the night's games as a list.

### 2. Season standings across the rounds of one league

`teamStandings(eventId, stageId, ...)` is per ROUND. `seriesStandings` in
`src/lib/domain/series.ts` aggregates across EVENTS, which is a different
thing: a league is one event with many rounds, so neither answers "where do
the teams stand after six weeks".

This is the biggest gap. A league without a season table is not a league —
it is six unrelated evenings. It also needs ties handled as ties (T12, not two
twelfths) and a stated total, because a total that does not reconcile is how
an organiser loses confidence in the whole board.

### 3. One round summary, all players, with a total

Two tables an organiser reads every week: every player's points for the round,
and every player's purse for the round with a **Total Purse** line. We have
per-player views (`/me/money`) and the pot maths, but not the organiser-facing
one-screen version.

The total line is not decoration. It is the check that the money paid out
equals the money staked, and it belongs on the screen for exactly that reason.

## Recommendation, in order

1. **Season standings across rounds** — the gap that decides whether we can
   host a league at all.
2. **Front/back nine skins** — standard league practice, small engine change,
   one reader.
3. **Round summary screen** — composes what already exists; presentation
   rather than capability.

Sweep each into `matrix.test.ts` rather than testing bespoke: a season table
at 1, 2 and 3 rounds, and skins over a nine as well as an eighteen, are
exactly the combinations that go wrong.

**TourneyHQ calculates and records money. It never moves it.** Everything
above is arithmetic and a record, and none of it is a payment rail.
