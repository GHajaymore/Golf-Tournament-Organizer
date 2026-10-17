# Brief for the panel: a player's adjusted handicap, pushed to their member record (2026-10-16)

## What Ajay asked

> "in rounds customize, not only allowance but organizer need an option to adjust individual
> handicap of the player and then another option to push it to member screen to become its new
> handicap."

So two things, both decided by him: (1) adjust one player's handicap from the round's
Customize, and (2) an option to make that the player's handicap on their member record
(Members screen), so it is their handicap going forward.

## What exists today (read the code to confirm)

- `src/components/RoundHandicaps.tsx` — under Customize, "Handicaps for this round". Lists each
  player: course handicap, the figure before rounding, what they play off. **Set one for this
  round** → **Set** beside a name: a whole-stroke PLAYING handicap for that round only
  (`setRoundHandicapOverride`, `src/app/actions/tournament.ts` ~1996). A button copies it to the
  tournament's later rounds (`applyRoundHandicapToRest`). Once a round has a card it freezes.
- `Player.handicap` (schema ~1428) — this TOURNAMENT's copy of the player's handicap INDEX, taken
  when they were entered. `Player.memberId` links to the club roster row when there is one
  (guests have none).
- `Member.handicap` (schema ~645) — the roster's handicap INDEX, the master figure; with
  `handicapSource` (`ghin` | `manual` | `none`). Changed today by editing the member
  (`updateMember`, `src/app/actions/roster.ts` ~334) or by accepting the club handicap worked
  out from their cards (`acceptClubHandicap` ~714, which REFUSES when an association holds the
  handicap: "TourneyHQ won't overwrite it").
- Under the Rules of Handicapping, a round override is a playing figure for one course, tees and
  allowance; an index is portable. They are different numbers.

## The proposal to judge

In each player's row in "Handicaps for this round", **Change** offers two things:

1. **For this round only** — a whole-stroke playing handicap (what exists).
2. **Their handicap index** — a figure to one decimal (e.g. 14.2). It changes this tournament's
   copy (`Player.handicap`) for every round not yet scored — scored rounds keep what they were
   played off — and, with a tick box **"Also make it their handicap on Members"**, the member
   record (`Member.handicap`, source `manual`) for every tournament they enter from now on.
   - The tick box shows only for a member; a guest is told they have no member record.
   - Where their handicap comes from an association (GHIN etc.), the tick box is not offered and
     the line says the association's figure is not overwritten — the tournament copy may still
     change.
   - Every change leaves a line in the history (who, when, from → to).
   - The sentence before Save says exactly what will change: "Changes Chris Doe's index to 14.2
     for Rounds 2–3 of this tournament and on Members. Round 1 keeps 15.0 — it has been played."

The alternative is pushing the ROUND figure (whole strokes) to the member record as their new
handicap.

## Questions

1. Golf: index or round figure? Is pushing a committee's adjustment to the roster the Rules'
   way (Rule 7 committee adjustments)? What does a club secretary expect?
2. Where should the control live — the round's Customize (Ajay's words), the field screen, or
   both? If a player plays every round, is a per-round home the wrong place for a per-player
   decision?
3. What must the screen say before and after, and what must it refuse?
4. What breaks: other rounds, frozen rounds, the tournament snapshot, a member in two
   tournaments, guests, association handicaps, plus handicaps, 9-hole indexes.
5. What tests prove it (browser and database), and what would a break-proof list hold?

## What the panel said (2026-10-16), and what was decided

All four: **push the INDEX, never the round figure.** The golf professional corrected the brief:
the round figure is a whole-stroke COURSE handicap for one course, tees and par (Rule 6.1)
(`resolveRoundHandicap` puts it in place of the course handicap, and the allowance is taken
after); 12 strokes off a slope of 135 is an index near 10.0, not 12. Storing it as
`Member.handicap` is a category error.

Decided:

1. **One action, two doors.** `setPlayerIndex` holds "change this player's handicap index". The
   round's Customize offers it (where Ajay asked), and the Registration & field handicap box goes
   through it too. QA and the tournament director found that box ALREADY pushes every edit to the
   member record (`updateSignup` → `upsertMember`), silently, with no history, matching the member
   by email or name, and greyed out by the setup lock exactly when a mid-championship cut happens.
2. **Change asks what is being changed.** "Their strokes in Round N only" (the existing course
   figure) or "Their handicap index" (moves every round not yet played). One box, its label and
   unit following the choice; "plays off" for strokes, "index" for the index, never "handicap" for
   both (UI/UX).
3. **"Also make it their handicap on Members"** under the index choice only. Off by default in a
   round (a competition cut is often for that event only); on by default on the field screen (a
   typo is wrong everywhere) — the tournament director. Needs the club's ADMIN, not an assistant
   (QA). A **reason** is required, and the history line reads "Committee adjustment (Rule 7.1):
   15.0 → 14.2, reason …" (golf pro).
4. **Refused, with the sentence on the row:** a guest (no member record); an index held by an
   association (`refuseHandByHand`, so `hybrid` is per member) — "An adjustment to their index is
   made by your Handicap Committee in GHIN"; a 9-hole index (no 9-hole index since 2020); a figure
   outside +10.0 to 54.0 or with more than one decimal; a round with a card (it keeps what it was
   scored off); a stale figure (compare-and-set).
5. **Said before Save:** which rounds move and which keep their figure (played, or holding their
   own round figure, which still wins); "the rest of the field keep the handicaps they started
   with" once Round 1 has a card (golf pro); and "their entry in <other tournament> keeps 15.0".
6. **Said after, in the row:** "Done. Index 14.2 for Rounds 2–3, and on Members. Round 1 kept 15.0."
7. **Defects found beside it, fixed in the same change:** `upsertMember` never writes
   `handicapSource` (a member on `none` pushed 14.2 still reads "no index") and defaults the type
   to 18; `applyRoundHandicapToRest` copies a course figure onto a later round at another course
   or tees, where it is wrong.

Left for later, recorded: notifying the player of a committee adjustment; a history kept on the
MEMBER (the event's log is deleted with the event, and free-plan events are wiped on close — a
migration); a review date for the adjustment.
