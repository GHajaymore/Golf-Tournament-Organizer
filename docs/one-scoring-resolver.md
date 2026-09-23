# Engines, not patches

Ajay set the rule out over 2026-09-22, in three parts. It applies to every
engine in the app, not only scoring:

> "please dont apply patches instead fix the engin and gates"
>
> "we still need to honer the customizations"
>
> "everything else should be based on the standard golf tournament rules"

**In that order, and the order is the whole rule:**

1. **The engine decides, the screen prints.** A rule applied by a renderer is a
   rule the next renderer will not apply. Every defect in this document is that
   sentence: `rankedScore` subtracted the handicap strokes and `toParCell`,
   twenty lines away in the same file, did not — so the same round read -18 on
   the share link and +10 in the console.
2. **The ROUND'S FORMAT and the club's settings are inputs.** Both, and both
   per ROUND rather than per event — the shape CLAUDE.md keeps finding, where a
   reader asks the tournament about something one round decides. Consolidation
   is how either gets quietly flattened, so an engine takes them as ARGUMENTS
   rather than assuming a default. `toParOnBasis(row, isNet)` is the shape: it
   does the arithmetic and knows nothing about where `isNet` came from, so the
   individual board can read it off the board's own unit caption and the team
   board off the round's `scoringBasis`, and neither has to learn the other's
   way of asking. `standingsUnit(format, scoringBasis)` and
   `effectiveAllowance(format, override)` take both for the same reason.

   **The format is not a string to compare against.** `StagesClient` asked
   `format === "Match Play"` four times, so a FOUR-BALL round robin — the
   interclub league shape — fell to the else branch and was told "This round is
   scored as Stroke Play, so ties break by lowest net, then lowest gross",
   which is not true of a match between two sides. The predicates in
   `formats.ts` — `needsTeams`, `sharesOneCard`, `entryModeFor`, `boardKind` —
   exist so a format added later is described correctly without every screen
   learning its name.
3. **Everything else is the Rules of Golf.** Not current behaviour, and not
   whatever the fixture happens to do — the point CLAUDE.md makes about
   asserting against the Rules with the citation in the comment.
   `effectiveAllowance(format, override)` is the pattern: the committee's
   figure if they set one, the format's WHS allowance otherwise.

**The control for (2) is a gross competition**, because that is what a net
default destroys. Verified on the seeded club's Club Championship — 36 Holes
Gross — after the to-par change: ranked on gross 139, 143, 144, 148, to-par
gross-based, and the player with the best NET correctly still fourth.

---

# One scoring engine, not several

Ajay, 2026-09-22, after correcting the same class of defect four times in one
evening: **"we should have one score engin vs multiple."**

He is describing the mechanism behind every defect found that day. This note
records the measurement, the shape of the fix, and what has already been done
so the next person does not start from scratch.

## The measurement

`holeStrokesReceived(handicap, strokeIndex, holeCount)` is the primitive that
turns a handicap into shots on a hole. Swept on 2026-09-22 it had **13 direct
callers, 7 of them outside `src/lib/domain`**:

```
src/app/actions/tournament.ts         score import
src/app/(player)/me/card/page.tsx     the player's own card
src/app/play/page.tsx                 casual round
src/app/(app)/entry/page.tsx          entry, individual path
src/lib/services/expenses.ts          money
src/lib/services/points-standings.ts  league points
src/lib/services/skins-pot.ts         skins
```

Calling it means deciding **two things for yourself**:

1. **Which handicap.** Index, course handicap (which tee, at which venue), the
   round's own override, the format's allowance, and — in a match — the
   difference off the lowest handicap in that match.
2. **Which stroke index.** The event's card, or the round's own nine, narrowed
   AND re-ranked. (`cardForStage` exists for exactly this and has its own guard,
   `a round's card is narrowed in exactly one place`.)

Two screens that each decide are two screens that will eventually decide
differently. That is not a prediction; it is the list of defects fixed that day:
the console board against the public board, the printed card against the entry
screen, and both against the engine that decides the result.

## What has been done

- **`matchStrokesCount` / `matchStrokesPerHole`** (`domain/team.ts`) are now the
  only definition of "how many shots does this player or side receive in this
  match". `matchHolesOffTheLow`, the printed scorecard and the team path of the
  score entry screen all call them. Pass `low: 0` on a medal round and it is the
  identity, so medal paths are unchanged.
- **A guard with inverted polarity**, `one engine decides how many strokes a
  hole gives` in `audit-guards.test.ts`: nothing outside `src/lib/domain` may
  call `holeStrokesReceived` unless it is on the exemption list above. The list
  is debt, written down, and it may only shrink — a new screen asks a resolver,
  or the resolver grows a case. It carries the two controls every filesystem
  sweep in this repo carries: that it finds files at all, and that every
  exemption still matches.

## The shape of the rest

One resolver that owns the whole chain and hands back per-hole strokes:

```
strokesFor({ subject, stageId, purpose })
   subject : a player, or a side
   purpose : "score" | "match" | "money"
```

- it resolves the handicap chain once (index → course handicap for the ROUND's
  venue and tee → round override → format allowance);
- it resolves the card once, through `cardForStage`;
- `purpose` is the only thing a caller chooses, and it is a golf question
  rather than an arithmetic one. `match` takes the difference off the lowest in
  the match; `money` deliberately does not — Ajay's rule, stated twice: the
  differential is "just for golf. Not for any skins or other bet/money game."

Then the seven exemptions collapse one at a time, each with its value pinned
before and after.

## The trap to avoid while doing it

Consolidation **removes the cross-check**. Eight callers resolving a card three
different ways can be caught by diffing two screens; eight callers behind one
resolver agree by construction — and they agree whether the resolver is right
or wrong. CLAUDE.md says this about the team-card consolidation already.

So every step must land with its value pinned **against the Rules of Golf**,
not against another reader: to-par against the played course's actual par, a
Stableford point, a skin, a match hole. Agreement between readers is not
evidence; it survives an error they all share.

---

# Where else the same thing is happening

Ajay, 2026-09-22: *"check if there is any more opportunities like this to have
one engine across"*, and the reason it matters: *"my goal is to make this app
simple but effective and impressive and best of all."*

That is the right frame for ranking these. The prize is not tidier code — it is
that a club never sees two screens disagree, because that is the moment they
stop trusting the app. So these are ordered by **how visible the failure is to
a member**, not by how many call sites there are.

Counts are measured (2026-09-22, `src` excluding tests); the risk column is
judgment.

## 1. "Has this round produced anything, and how far along is it"

**83 direct reads of the result tables across 29 files.**

```
prisma.scorecard.*  prisma.teamScorecard.*  prisma.match.*  prisma.bracketWinner.*
```

There are FOUR tables a round can file its result in, and which one depends on
the format and the stage type — CLAUDE.md sets this out, along with the symptom:
*"Nothing returned for this round yet"* printed over eight complete sides,
*"Matches complete 0/0"* over a knockout five ties through, and *"this
tournament hasn't been launched yet"* said to people standing on the course.

`boardProgress` already carries the unit (`cards | matches | sides | ties |
manual`), which is the right shape. What is missing is that **everything else
still reads the tables directly** and re-decides which one to ask.

**Highest visible risk.** An absence reported as a fact is the most damaging
thing this app can print, because it is not a wrong number — it tells a member
that something they did never happened.

*Shape:* `roundProgress(stageId)` and `roundHasResults(stageId)` as the only
readers of existence and progress. A guard with inverted polarity, as above.

## 2. The handicap and card chain — MOSTLY ALREADY DONE

**The first count here was wrong and is corrected.** It said "63 calls across
22 files", which measured how many places TOUCH a handicap, not how many decide
the rule. Re-measured 2026-09-22, the chain is already layered the way this
document argues for:

```
courseHandicapMap      the arithmetic, in domain/handicap.ts
roundCourseHandicaps   the round-aware resolver, in services/handicaps.ts
round-handicap.ts      a LOADER that delegates to it
```

The loader shares a NAME with the resolver, which is how a duplicate appeared to
exist — a grep cannot tell the two apart. It is not one. Its own docstring:

> THE ARITHMETIC ITSELF IS `roundCourseHandicaps` IN `handicaps.ts` … the rule
> moved to where `teeForPlay` lives and this became its loader … Two copies of
> it would have been the defect this whole class is.

It also explains why it is not merged with `loadEventState`: the freeze runs on
every card write and must be able to decide not to query at all. The two are
pinned to each other by an audit test instead — the "pin two readers, don't
merge them" rule the last section of this document argues for.

What is left of the class is small and already written down:

- `tournament.ts` calls the arithmetic four times, building the event-wide 18-
  and 9-hole maps and then a per-round and a per-match one. That is
  `EventState` precomputing, and the comment says why: "the tees are a
  per-round answer and these two maps are an event-wide one."
- `regroup.ts` and `week-view.ts` are the two documented exemptions, named in
  CLAUDE.md, and `handicap-wiring.test.ts` lists them and fails on a third.

**The risk ranking stands; the effort does not.** An away round scored on the
home card is still the invisible failure worth guarding against, and it is
already guarded — by `cardForStage`, its narrowing guard, and
`board-scores-the-round-venue.audit.test.ts`. There is no large refactor here.

The lesson is about the MEASUREMENT rather than the code. A call count answers
"how many places touch this" and was read as "how many places decide this". The
two differ by an order of magnitude, and only the second is the class.

## 3. Format capability asked as a string

Small and cheap. `formats.ts` already owns the predicates — `needsTeams`,
`sharesOneCard`, `boardKind`, `entryModeFor`, `isManualFormat` — but a handful
of callers still ask the question as a literal:

```
components/StagesClient.tsx     format === "Match Play"   (x4)
lib/domain/score-import.ts      format === "Match Play"
lib/services/teams.ts           /scramble/i.test(f.name)
```

`domain/match-entry.ts` records having already fixed one of these, and why: a
string test *"made the catalog and the screen disagree"*. The pattern is the
same every time — a new format is added, the predicate learns about it, the
string comparison does not.

**Low risk, low cost.** A guard forbidding `format === "` outside `formats.ts`
would close the class permanently in an afternoon.

## Found by working the list, 2026-09-22

Three defects, all in class #1 and #3, none found by walking a screen.

**Two were the fourth table, and both are fixed** (`a-knockout-is-a-result.audit.test.ts`):

- `playRefusalFor` read three of the four, so a knockout holding `BracketWinner`
  rows but never formally launched told players *"This tournament hasn't been
  launched yet"* — the exact sentence this class is named for. Its own comment
  said "all THREE sources" and argued carefully for three, which is what made it
  read as finished.
- `hasPlayingHistory` did not count them either, so a player who had won their
  way to a semi-final could be hard DELETED rather than withdrawn, leaving the
  bracket naming an id that resolves to nobody.

Both reachable because `setBracketWinner` is gated on **staff role, not on
launch**.

**And a fourth, which was a missing engine rather than a broken one.** A round
robin of TEAM matches was ranked on stroke totals, so the side that won 10&8
was printed second behind the side with the lower total. `boardKind` asks the
FORMAT alone and reaches `needsTeams` before anything can tell it the round is
head-to-head; singles match play has had a match-points board all along and a
team format could never reach one.

`boardKindForRound(format, type)` routes it, `teamMatchStandings` aggregates,
and `pairingPoints` — already written, already used by the interclub league —
decides what a match is worth. Default one point a win and a half each for a
half; the club's `leaguePoints` honoured where they have set it. All four
readers branch together: console board, `/live`, Reports and its CSV.

**A KNOWN GAP LEFT OPEN.** The halved-match tiebreaker (`matchTiebreakers`) is
applied to SINGLES standings through `computeStandings` and is not consulted
for a team round robin — `pairingPoints` returns half a point each and stops.
So a club that has set a countback gets it on a singles round robin and not on
a four-ball one. That is an inconsistency in honouring a customization, not a
wrong answer, and it wants a decision about whether a halved four-ball should
be breakable at all before anything is wired.

**One is class #3 and is NOT fixed, because the mechanism is not settled.**
`StagesClient` asks `format === "Match Play"` four times inside a
`stage.type === "Round Robin"` guard. A **Four-Ball round robin** — the
interclub league shape — therefore takes the else branch and is told:

> "This round is scored as Stroke Play, so ties break by lowest net, then
> lowest gross"

which is false of a four-ball match, and the "a match finishes all square"
tiebreaker is hidden from it entirely.

What is verified: the copy is wrong and the control is hidden.
What is NOT: whether the STANDINGS path for a generic team round robin also
ignores halved matches. `teamStandings` takes no tiebreaker argument at all and
ranks sides off aggregate cards, while a LEAGUE goes through
`league-meeting.ts`, which handles halves explicitly ("½ a half"). So the league
is fine and the generic case is open.

`entryModeFor(format) !== "stroke"` is the predicate the screen wants — it
returns "team" for Four-Ball and "match" for Match Play, and "stroke" for the
formats where the question genuinely does not arise. But changing the label
before understanding what the engine does with a halved team match would be
fixing the sentence rather than the answer, which is the mistake this file
warns about two sections down.

## What NOT to do

Do not collapse these because collapsing is satisfying. Each one is worth doing
only with its value pinned to the Rules first, and #2 in particular removes the
cross-check that found it. The order above is also the order of value: #1 stops
the app lying about whether something happened, #3 is a tidy-up, and #2 is the
big one in the middle that needs the most care.
