# Smoke and the gate scripts

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: `npm run smoke`, `smoke:all`, `verify-*`, a gate that pipes an exit code. Index: `CLAUDE.md`.

`npm run smoke` GETs every route against a running dev server and fails on a 5xx. It exists
because neither tsc nor the unit tests render a server component — a screen can throw on every
request with a clean build and 1300 green tests.

It defaults to `http://localhost:3000`; point it elsewhere with `SMOKE_BASE_URL`. In a worktree,
check `preview_list`'s `cwd` before believing a green run — `preview_start` will reuse a dev
server already running from the MAIN checkout, and then every route passes against code you did
not write.

**CAPTURE THE COUNTS, NOT THE TAIL — a gate script can report a red run as
green.** On 2026-09-20 a local gate piped each suite through `tail -3` and
never captured its exit code. A failing unit test still prints a `Duration`
line, so the tail looked normal and the script exited 0; the failure was found
only by re-running `vitest` with the summary visible. One test was red for
three commits' worth of work.

Grep for `Tests ` and record the status of the command rather than the pipe:

```bash
npx vitest run 2>&1 | grep -E "Test Files|Tests " >> "$O"; echo "unit exit=${PIPESTATUS[0]}" >> "$O"
```

The same trap as `| tail` swallowing an exit code two paragraphs down, and the
same lesson as the sweeps section: **a check whose failure looks like its
success is not a check.**

**`npm run smoke` is NOT the whole of CI's "Smoke-test every route" step.** That step boots the
server once and then runs SEVEN scripts against it, of which `npm run smoke` is the first:

```
node scripts/smoke-routes.mjs        # what `npm run smoke` runs, and all it runs
node scripts/verify-round-controls.mjs
node scripts/verify-drafting.mjs
node scripts/verify-week-view.mjs
node scripts/verify-lifecycle.mjs
node scripts/verify-player-states.mjs
node scripts/verify-public-boards.mjs
```

**`npm run smoke:all` is that whole step, locally, against a BUILT server** — and it is the one
to reach for. It builds into `.next-ci`, starts it on 3102, runs all six in order, stops at the
first failure and kills the server afterwards. `-- --no-build` reuses the last build. It refuses
to run when something is already listening on that port rather than testing somebody else's
build, which is the trap `reuseExistingServer` sets for Playwright one section down.

Use it INSTEAD OF pointing the scripts at the dev server, because on a developer machine the dev
server does not survive the walk. Measured 2026-09-17: three attempts, three failures, always
partway through — and Next says why in its own log, seven times in one evening:

```
⚠ Server is approaching the used memory threshold, restarting...
```

`next dev` compiles each route on demand and holds the graph, so a 41-route walk compiles most of
the app in one process; on a 16GB machine also running a build and a test suite it reaches the
threshold and respawns itself. Every request in flight then returns nothing, which the scripts
print as `→ 0` / `fetch failed` — the "no server" signature described below, which reads exactly
like a broken route. The same six scripts, unchanged, passed first time against the built
server. A production server compiles nothing and stays flat.

Two more ways to lose an hour here, both worth knowing before blaming a route:

- **the scripts default to port 3000**, and the dev server in this repo is on **3100**. Every
  route then reports `fetch failed` while `curl` says 200, because they are talking to different
  ports. `SMOKE_BASE_URL` is the fix; `smoke:all` sets it for you.
- **`| tail` swallows the exit code.** `node script.mjs | tail -4` exits with `tail`'s status, so
  a failed run reads as `exit=0`. Check the script's own status, or do not pipe it.

Five of the other six assert CONTENT — that a control is on the screens that need it and off
the ones that do not, that the locked drafting panel still says what to do instead, that the
movement column says somebody climbed exactly when they did. They pin user-facing STRINGS
verbatim, so rewording a sentence turns one of them red while all 39 routes still return 200. On
2026-09-07 a four-word copy fix — "below" to "above" on the locked drafting panel — passed tsc,
4558 unit tests, lint, build, `npm run smoke` and Playwright, and went red in CI on
`verify-drafting.mjs`.

**`verify-lifecycle.mjs` asserts a different thing, and it is the gap `smoke-routes` cannot
see.** The smoke pass walks the SEEDED DEMO — a fully populated tournament with rounds, a field,
flights, cards, a bracket and money — so every screen in the app has been rendered in that state
and in almost no other. A club is not in that state. This walks every sidebar screen at each
stage one actually passes through: named-only, one round, a field, flights, cards, finished.

It was written because `/entry` returned **500** on a tournament with no rounds —
`rounds[roundIdx] ?? rounds[0]` is undefined on an empty list and the screen read
`round.stroke.stageId` off it. Score entry is in the sidebar from the moment a tournament
exists, so that is the state every club is in for their first ten minutes. The smoke pass, 7,338
unit tests and Playwright all missed it, because all three run against a fixture that has
rounds.

It also requires an `<h1>` on every screen at every stage, which `e2e/layout.spec.ts` demands on
every route and only ever checks on the populated case — the first fix for that 500 removed the
heading and the whole suite stayed green.

**`verify-player-states.mjs` IS THAT SWEEP POINTED AT THE PLAYER, and it was added on
2026-09-20 because everything above it walks the CONSOLE.** The player app had been walked many
times and always in one state: confirmed, in a tournament with a round under way. Two of the
other three were wrong.

    confirmed, round live     correct — the state everybody walks
    on the waiting list       "You aren't entered in this tournament"     (#524)
    entered, no round yet     "You aren't entered", plus an opponent who
                              does not exist and a ranking of nothing     (#525)
    not entered at all        correct

Both were one collapse. `entered` means CONFIRMED — the rule every card guard uses, and rightly,
since a card must never reach somebody without a place — so `!entered` swept the APPLICANT in
with the STRANGER, and `!me.round` swept "nothing to play yet" in with "not entered".

It asserts a RULE rather than four sentences: **nobody with a Player row in this event is ever
told they are not in it.** And the CONTROL that makes that rule mean something — somebody with
NO Player row IS told exactly that — because otherwise the rule is satisfied perfectly by
deleting the sentence. All three of its checks were mutated separately and watched go red.

**The fixture is the other half, and it is the reason this went unseen.** A state nothing can
express is a state nobody walks: every roundless tournament in `seed-club.mjs` deliberately kept
the signed-in player OUT — Captain's Day so that `/me/events` has an Enter button, the Winter
Series because it has no entrants at all — so "entered, and nothing to play yet" was
unreachable. It now seeds `Spring Meeting — Format To Follow` for exactly that cell, the same
reasoning that added the away round. When a walk finds nothing, ask whether the fixture can
reach the case before concluding the case is fine.

**`verify-public-boards.mjs` IS THE ONLY ONE THAT NEEDS NO COOKIE, and that is why it exists.**
Every walk above signs in as somebody. `/live/<shareToken>` is the screen a club actually sends
its members, and nothing checked it beyond a 200 — which it always returned.

Added 2026-09-22, after the seeded club's April Medal board was found headed "Ranked by net
strokes", sorted correctly on net, and printing the GROSS to-par:

```
1  Marnie    gross 81  net 53   shown +10
3  Nkechi          70      63   shown  -1
4  Priyanka        91      65   shown +20
```

Every figure correct, the column unreadable. 8,359 unit tests, the route walk and three
Playwright viewports were green over it, because each asks whether a number is right and none
asks whether the column can be read DOWN.

So that is what it asserts — **the scores printed on a board run in the order the board is sorted
in** — with the direction taken from the board's own "Ranked by …" caption, so the check cannot
disagree with the screen about which statistic it is reading. The fixture is the other half: its
gross and net orders are deliberately OPPOSITE, because a board where they coincide passes
whichever figure it prints. Reverting the fix turns it red on both counts, the ordering and the
control.

It pins no net FIGURE, deliberately. The first draft did — `gross - handicap` — and reported the
app broken when it printed -3 against an arithmetic -4. The app was right: a playing handicap is
a course handicap with the round's allowance applied. Freezing that here would put a rule
belonging to `stroke.ts` inside a script about whether a column reads downward.

**AND EVERY FIXTURE IT HAD WAS ONE ROUND, WHICH IS A WHOLE CLASS IT COULD NOT SEE.** Added
2026-09-22 after the seeded club's Thursday league was found ranked on points PER HOLE: ordered
perfectly on a figure it does not print, headed "Greta Lindqvist leads on 135 Stableford pts"
over a table in which three players had more, while the league's own week view named somebody
else on 170.

Over ONE round a points board physically cannot show this. `scoreOnBasis` ranks on
`points - levelPoints`, and with everybody round the same eighteen that term is identical for
all of them, so the order is the points order whether the engine is right or wrong. **The board
that was wrong for four weeks would have passed this script every time.** It takes uneven
ATTENDANCE to separate them, so the fixture now runs three weeks with a player who misses the
middle one and scores best per hole — 108, 102 and 80 — and pins the season totals exactly,
because an ordering check alone can be satisfied by a kind fixture.

The lesson generalises past this script: **a fixture that cannot reach a state is a state
nothing checks**, the same reasoning that added `Spring Meeting` for "entered, nothing to play
yet" and the away round for the venue. When a rule holds over one round, ask what it does over
two, and whether anything you own can build the second.

**And the blast radius of that fix was MEASURED rather than argued**, which is worth copying
because it takes one read-only query. A change to a ranking term can only move a board where two
players' charged holes differ, so the question is which stored events meet that: a points board,
more than one counted round, and uneven attendance. Against the development database, one did —
the league that was wrong — and the other three points boards are single-round and provably
untouched. The same query settled the edge this fix was riskiest on: that league holds **seven**
points rounds of which only **four** are played, so three empty future weeks are charged to
everybody, and the board is still correct. A term added to every player shifts the whole board
by a constant and reorders nothing, which is the reason "not the active round" is safe HERE and
is not safe for unranking somebody — see `docs/deferred-register.md`.

Same shape one layer up: **a check built from a fixture pins whatever value that fixture
happens to have.** The rule here — the printed scores run in the board's own order — had shipped
broken three times on three different units (match points, net strokes, Stableford), and each
fix pinned the unit in front of it. `src/lib/__tests__/board-prints-what-it-ranked-on.test.ts`
now ENUMERATES the units instead, over both readers, and says in its own docstring which part of
the axis it does not close. Prefer that to another fixture when a rule ranges over a set.

One trap in reading a points board from a script: its scores are bare integers and **so is the
finishing position**. A flat text scan returned `1, 108, 2, 102, 3, 80` and reported a correct
board as unsorted — a false alarm, which is the direction that gets a check deleted. Read a
points board by ROW, taking the last figure on each; the console draws one as a `<table>` and
the public board as a `<li>` list, so accept both rather than making a screen match a script.

So a green `npm run smoke` says every route renders for the demo, and says nothing about the
other six. Run them too — against the same server, in that order — whenever you change copy,
move a control, or touch a screen that reads a list which can be empty.
