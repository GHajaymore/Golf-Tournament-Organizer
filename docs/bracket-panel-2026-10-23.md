# How a knockout's draw is shown — the panel's ruling, 2026-10-23

Ajay, after seeing a knockout of 129 drawn as one page 16,341px tall: "we need to
show entire bracket. doesnt matter if user has to scroll either way. but if there
is a limitation and if we can provide better feature, lets go for it (including
tabs based on the QF, SF, F or something better)."

The visible choices were put to his panel — the golf professional, the tournament
director, the UI/UX designer and the QA manager — the same day. This is what they
decided, why, and who disagreed. It is built in three pull requests, stacked:

| part | what | where |
|---|---|---|
| (a) | one drawing for every surface, club round names, no bye boxes, "Winner of", seeds only when seeded, section tabs, Find a player | `claude/bracket-sections` |
| (b) | what each surface opens on: the secretary's "To play" list, the player's own tie, the public's latest results; play-by dates per round | `claude/bracket-defaults` |
| (c) | print: each quarter on an A4 landscape page, plus Finals | to follow |

## 1. No bye boxes; club round names (all four)

A bye is a word beside a name ("bye") on the seed's first real tie, never a box —
nobody plays a bye, so a box for one is a tie that does not exist. A field over a
power of two plays a **Preliminary round** for the extra entries (129 is one tie,
128 v 129); the rounds are then **Round 1, Round 2, …, Quarter-finals,
Semi-finals, Final** — never "Round of 256", which is a sheet size, not a round a
club plays.

**Which byes are marked — a correction the same day**, after the first captures marked
"bye" on nearly every seat of a 129 draw's Round 1, often both players of one tie. Those
players had no bye in any round that is drawn; they simply did not need the one-tie
preliminary round, and a club's draw sheet never marks that. So:

- **the panel's rule** (golf professional and tournament director): "Call the first round
  a Preliminary round when FEWER players play in it than sit it out; when equal, it is
  Round 1 with byes." With N entrants on a sheet of S, 2N − S play and S − N sit out, so it
  is a preliminary round when 3N < 2S (`hasPreliminaryRound`): 129 of 256 (one tie), 20 of
  32 (four ties, 8 play, 12 sit out). 22 of 32 (12 play, 10 out), 24 of 32 and 100 of 128
  are a Round 1 with byes. Equality never falls on a power-of-two sheet. (A first draft
  drew the line at three quarters, where the draw stops pairing two byes; the panel
  ruled two thirds, so 22 of 32 has a Round 2 tie between two seeds who both had byes —
  both are marked, truly.)
- Nobody is marked "bye" for skipping a preliminary round; its winner's place in Round 1
  reads "Winner of A v B" until it is played and then the winner's name with "through the
  preliminary round" under it.
- In a Round 1, a player with nobody to play had a **bye in a drawn round**: "bye" under
  their name on their first real tie (100 in a draw of 128: 36 ties, 28 marked in Round 2).
- The words about a seat ("You", "bye", "through the preliminary round", the margin) are
  under the name, so they never cut it short.

**Byes in a draw made by lot (the golf professional).** "In an UNSEEDED (drawn by lot)
knockout, byes must not go to 'top seeds' — they are placed by lot, spread evenly through
the sheet (both halves, all quarters); only a SEEDED draw gives byes to the top seeds."
What the app does: one bracket, two flights, and flights by handicap, by the tournament's
flights or by qualifying are seeded, and the byes go to the top seeds. Flights divided
"Evenly, at random" are a draw by lot: the order is a shuffle of the tournament's seed
(reproducible), and the byes fall on the places the numerical draw leaves empty, one per
quarter before any quarter takes a second — so who has a bye is the lot's and where is
even. That was already so; what was wrong is that such a draw printed seed numbers in the
order dealt, so the first dealt read as a top seed. It shows none now
(`an-unseeded-draw-gives-byes-by-lot.test.ts`). A plate is filled by who lost and has no
byes at all.

One function names a round (`roundLabels` in `src/lib/domain/bracket.ts`, which
needs the field as well as the sheet, so the compiler lists every caller), and
everything reads it through the draw: the drawing, the report ("Round 1: X beat Y
3&2"), a player's own line, the boards, the guide.

**Play-by dates per round** (part b). A Bracket Stage had one `deadline` for the
whole knockout and nothing per round, so part (b) adds one column,
`Stage.knockoutPlayBy` (migration `A022`): JSON, rounds counted BACK FROM THE FINAL
to an ISO day, so one set of dates serves flights of any size — every flight's
final is due the same day. The secretary sets them on the Bracket screen
(`setKnockoutPlayBy`, refused when a round would be due after the round it feeds);
every round heading of the drawing, the "To play" list, a player's own tie and the
public board show them in the club's words (`shortDate`), with "Overdue" written
out from the morning after, by the CLUB's day (`state.today`), never the server's.
`domain/knockout-play-by.ts` is the only reader and writer.

## 2. "Winner of A v B", not "TBD" (the golf professional)

Wherever the tie that fills a place is drawn and unplayed, the place says whose
tie it is: "Winner of Seed 128 v Seed 129". A golfer can act on two names; "TBD"
tells them nothing. A place whose feeding tie is itself still waiting on somebody
stays "TBD". The wording is one function (`winnerOfWords`), and a player's own
line ("v the winner of A v B") reads the same one.

Seed numbers are shown only where the draw was actually seeded (`drawsSeeded`):
not while a qualified draw is still the entry order, and not on a plate, which is
filled by who lost in the order they lost.

## 3. Each surface opens on its own question (all four) — part (b)

- **Secretary** (Bracket screen): opens on **To play** — the current round's ties
  in draw order, each with its play-by date and "Overdue" written out once passed,
  and result entry right there (winner, margin, conceded / walkover / withdrawn).
  A result is saved by tie id, never by position, and its confirmation names the
  round and both players. The drawing is the next tab.
- **Player** (`/me/board`, and Today if it shows the draw): opens on their own tie —
  opponent, strokes given or received off 100% of the difference, play-by date,
  "Win, and you play the winner of X v Y" — with their path lit in their section
  below.
- **Public** (`/live/<token>`): opens on **Latest results** and **Still to play /
  who is still in**, then the drawing.

Built in part (b): the Bracket screen's two tabs are **To play** (`KnockoutToPlay`,
the default) and **The draw** (`?view=draw`); a result from To play is sent with
the tie's key and its two players (`recordTieResult`, refused unless the place
still holds them — `tieStillHolds`) and said back as "Recorded — Round 2: A beat B
3&2."; the player's Board opens on `MyKnockoutTie` (strokes are the difference of
the two playing handicaps for the knockout round, in full); the public board opens
on `KnockoutNews` (the latest round's results, who is still in, what is still to
play). Today does not show the draw, so its existing tie card was left as it is.

## 4. The drawing: tabs by section (all four; one dissent)

- more than 32 places: **Quarter 1 · Quarter 2 · Quarter 3 · Quarter 4 · Finals · Whole draw**
- 17 to 32 places: **Top half · Bottom half · Finals · Whole draw**
- 16 or fewer: no tabs

Finals is quarter-finals → semi-finals → final. A quarter (or half) runs from its
first real tie to its quarter-final(s), so every tie is on exactly one tab besides
Whole draw, except a quarter-final, which is on its quarter and on Finals. Each tab
says how many of its ties are still to play.

A real bracket: each tie centred between the two that feed it, connector lines
(hidden from screen readers), the winner in bold with a tick and the margin — never
colour alone. On a phone the bracket scrolls sideways (and down) inside its own
box, with the round headings held at its top; the page never scrolls sideways.

**Dissent — the UI/UX designer** preferred, on phones, a swipe through two rounds
at a time. The other three preferred one model everywhere, so a player, a parent
and the secretary are looking at the same thing whatever they hold. Decided: one
model now. The designer's preference is recorded here for when phone use is
measured.

## 5. Find a player

A search box that opens the player's section and lights their path. The section
and the player live in the address (`?section=q2&p=…`), so a link can be shared
and Back works. The last tab a viewer chose is also kept in their own browser, for
when the address says nothing.

## 6. Print — part (c)

Print CSS: each quarter on its own A4 landscape page plus one Finals page, legible
in black and white, "Printed on <date>", a blank result line under each unplayed
tie, byes left out.

## 7. Not built (all four)

- no zoom or mini-map;
- no phone numbers on overdue ties — privacy; a later ruling.

## 8. Tests (the QA manager)

One draw model behind all three surfaces; the ties across all tabs equal the whole
draw, each exactly once, with the quarter-final rule counted explicitly; the three
surfaces show the same names and results for every tie; field sizes 1, 2, 3, 5, 8,
16, 17, 31, 32, 33, 64, 65, 128, 129 (and 256) and three flights; twelve random
result orders plus a result cleared; a result entered from inside a section tab
lands on exactly that tie on all three surfaces; switching tabs while a save is in
the air loses nothing; 320, 393 and 1280 with no sideways page scroll; 44px
targets; print-media emulation. Where each is, and what was not run, is in the pull
request.
