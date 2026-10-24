# Knockouts and club leagues

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: brackets, byes, flights, club leagues, week sheets. Index: `CLAUDE.md`.

## A knockout's draw

**PAST THE FIRST ROUND THERE IS NO SUCH THING AS A BYE.** Until 2026-10-12 `buildBracket` called
an empty place in a later round a bye, and sent its opponent through unopposed, whenever the tie
feeding it "had two empty places" — which is true of every tie that has not been played yet. An
ordinary knockout of eight drew its Final as "Bye v Bye"; a finalist was drawn against a Bye; and
in a draw of sixteen or more a player whose quarter ran a round ahead was ADVANCED through a
semi-final nobody had played. A bracket is sized to its field, so no first-round tie is ever
between two byes, and a place in a later round is somebody or "TBD".

Every bracket test before that day played its results ROUND BY ROUND, which is the one order in
which the fault cannot show. A club does not play that way.
`a-tie-not-yet-played-is-not-a-bye.test.ts` plays every field from 2 to 40 in twelve random
orders each. When a rule is about what has and has not happened yet, the ORDER things happen in
is an axis, and a fixture that always fills it in the tidy order is a fixture that cannot reach
the case.

**A big field is divided into FLIGHTS, each its own knockout** (`Event.bracketMode = "flights"`,
Ajay 2026-10-11: "it should be pure knockouts"). Four things to know before touching it:

- **The division is kept whole**, in `Event.bracketDraw`, as `{ v: 2, criterion, flights }` — the
  same column one bracket keeps its flat list in, and each reader answers null for the other's
  value. It is written when the organizer divides the field, not by the first result, and
  clearing the last result does not wipe it.
- **`bracketDraws()` in `my-tie.ts` is the one answer to "which draws are there".** A reader
  that names `brackets.winners` and `brackets.consolation` sees the first two flights and passes
  every two-flight test; the third is the first draw the app has ever filed under a word of its
  own (`flight3-…`, from `flightKind`). Test with THREE.
- **Dividing the field is the DRAW, not setup.** The arrangement locks with setup at launch;
  the division stays open until the first result in any flight, and shuts on a completed
  tournament. A club championship flighted by qualifying score can only be divided after the
  qualifying round — which is after launch, always — so a lock there would have made the
  organizer unlock what they had just locked.
- **A finishing place, once given, never moves.** A lower flight is placed below the PLAYERS in
  the flights above it, not below however many have been placed so far: the first cut read the
  Second flight's winner as 9th and dropped them to 17th the afternoon the First flight finished.
  There is no order at all until the top flight has a champion, and no play-off for third.

The seeded club carries "Club Match Play — Three Flights" (three flights at three different
points) so the walks reach it, and `e2e/organizer-knockout-flights.spec.ts` builds one from
nothing. **That spec holds TEN players because a new club's free plan does**: its first draft
entered twelve, the plan refused two, and the entry loop passed anyway on the name still sitting
in the form. An organizer-from-nothing spec that needs a bigger field needs a club on a bigger
plan — and any entry loop should end by reading the field back.

## A club league: what has been ARRANGED has not HAPPENED

A league of clubs (flights as clubs, pairs nominated each week, `LeagueSection` on Teams & pairs)
was first run in a browser on 2026-10-13, as its secretary would, and four of the five things it
turned up were one mistake: a statement about golf made from what had been set up rather than
from what had been played.

    the table       "Played 1" for every club the moment a week was DRAWN — a meeting exists
                    from the draw, and the table counted the meetings that exist
    the meetings    "AS", all square, for every four-ball of a week just drawn — an empty card
                    has no holes left to play, so `resolveMatch([])` is complete and level. The
                    line carried a comment saying an unplayed match must read as a dash
    the play-offs   "Final: (1) Ardlui v Balfron (2)" before a ball was struck: the bracket is
                    seeded from the table at every moment, and nobody had played, so it was
                    the first two clubs in the alphabet
    the draw        the final drawn with two of three season weeks never played. Its check,
                    "every meeting before them has a result", is made of the meetings that
                    EXIST, and a week nobody drew has none to be unfinished

Three things to carry forward:

- **`matchIsOver(holes)` is the question; `resolveMatch(holes).complete` is not.** The trap is
  written up in `domain/match.ts` and was walked into again one file away, under a comment
  describing the right behaviour. A comment that states the rule is not the rule.
- **A check built from the rows that exist cannot see the row that was never made.** "Nothing is
  unfinished" is true of a week with no meetings in it. Count what there SHOULD be
  (`LeagueTable.unsettled`: a week of N clubs is N/2 meetings) and compare.
- **Ask, where a committee may mean it.** A league can abandon a week to the weather and go to
  its play-offs, so `drawLeagueWeek(stageId, replace, shortSeason)` asks rather than refuses —
  and its two questions are separate: saying yes to replacing a draw is not saying yes to a
  short season.

`e2e/interclub-league.spec.ts` runs the season from switching the league on to recording the
play-off hole, and works every four-ball out for itself (90% before rounding, off the lowest of
the four, better ball, the usual wording of a result). Week 1 and the final are typed into the
score-entry screen; weeks 2 and 3 are written as rows, and it says so. What it cannot see is in
its header.

**AND A LOOKUP BY `id: { in: [...] }` HAS NO ORDER.** `nominatePair` looked its two
players up in the tournament, rightly, and then took the pair's order from the
rows that came back: a secretary who picked One and then Four got "Four / One"
whenever the database returned them that way round. It was found by ONE failed
check in about twenty-five passes of the league's browser test, which read as
the test being impatient ("… was not put up"). The page the failed job kept
showed the pair had been put up, under the other name. **A failure that looks
like impatience is read from the page it kept, not from its message** — and
where an action is handed a list, the list's order is the caller's:
`a-pair-is-named-in-the-order-it-was-picked.audit.test.ts` sends each pair both
ways round, because whichever way the database prefers, one of them differs.
