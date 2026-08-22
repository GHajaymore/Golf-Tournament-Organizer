# Per-round handicap override — REQUIREMENT, not yet designed or built

Ajay, 2026-08-21, captured verbatim in substance while a review was running.
Written down immediately because a requirement stated once in conversation is a
requirement nobody can find later.

**Nothing here is designed, decided or implemented.** It is what was asked for.

## What was asked

1. **The member's handicap is the default.** The handicap on the Member record —
   entered on the roster — is what a player plays off, unless a GHIN interface
   supplies one. GHIN, where it exists, is the authority; the member entry is
   the fallback, not the other way round.
2. **A round may override it.** During round configuration there is an option to
   override a member's handicap.
3. **The override is scoped to THAT ROUND only.** It does not change the member,
   and it does not apply to any other round.
4. **Earlier rounds must not move.** Changing a handicap must not alter a score,
   a result or a standing in a round already played.
5. **In fact a played round should be LOCKED** against this.

## Why this is harder than a column

Points 3–5 are the whole requirement, and they are a statement about TIME.

This app currently derives net scores. `aggregateStroke` computes
`strokesReceived` live from `handicapFor(playerId, stageId)` every time the
board is drawn — nothing stores what a player's net score WAS. That is normally
the right design here and the codebase says so repeatedly: derive, never store,
one reader per rule.

But a handicap that changes over time breaks the assumption underneath it. If
the handicap is read live and an organizer edits it in round three, **round
one's net scores silently change** — a completed round, possibly a settled cut,
possibly a paid-out pot, all moving because of an edit made afterwards. That is
exactly what point 4 forbids.

So this is the one place where "derive, never store" and "history must not
change" pull against each other, and the resolution has to be deliberate.

## The shape of the answer, not yet chosen

The usual resolution is to store the INPUT as of the round rather than the
OUTPUT: keep deriving net from a handicap, but make the handicap a fact about
`(player, round)` that is fixed when the round is played, rather than a fact
about the player read live. Net stays derived; what it derives FROM stops
moving.

That keeps one reader for the arithmetic while making the input immutable, and
it is closer to how the app already treats `settingsForNewEvent` — copying the
club's defaults onto an event at creation, explicitly so "a club that changes
its house default next month must not silently rewrite the rules of an event
already being played." Same problem, same answer, different scale.

Questions that must be answered before building:

- **When does a round's handicap freeze?** At round creation, at first score, at
  round completion, or when the organizer locks it? Each gives a different
  answer to "I fixed a wrong handicap after one card came in".
- **What does "locked" mean in point 5** — locked against handicap changes only,
  or the existing setup lock (`isSetupLocked`, live/completed and not unlocked)?
  There is already a lock concept and a second one would be a second reader.
- **Does the override follow a player into the next round?** Point 3 says no —
  confirm, because "he plays off 12 all week" is a thing organizers say.
- **What happens to a round in progress** when the member handicap changes
  underneath it?
- **Where does it live on screen?** Round configuration is `StagesClient`; the
  member handicap is the roster. Two screens, one number.

## What it touches

Everything net, and the money.

- `aggregateStroke` / `netOf` / `holeStrokesReceived` — the derivation.
- `playingHandicapFrom`, `effectiveAllowance` — team and format allowances.
- The countback (`stroke-countback.ts`) ranks on net; a moved handicap moves a
  countback result and therefore who advanced.
- The cut and qualification.
- **Skins and side games settle on net.** A handicap edit that reaches a settled
  round changes who won money that has already been handed over in the bar.
- `handicapSource` / `handicapType` already exist on the roster, and there is an
  unrated-tee warning path (`unratedWarning`, `unratedFlightWarning`).

Per CLAUDE.md this is squarely the COMBINATIONS class — add cells to
`src/lib/__tests__/matrix.test.ts`, sweep field sizes from ONE, and assert
against the Rules and the WHS rather than against current behaviour.

## Sequencing

Not urgent, and it should NOT be started inside the scoring-input work
(`docs/scoring-input-model.md`), which is already touching the same aggregation.
Land that first, then design this against a settled base — otherwise two
changes to net scoring are in flight at once and neither can be verified.
