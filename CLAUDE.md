# TourneyHQ

Golf tournament management. Next.js 15 (App Router) · React 19 · TypeScript · Prisma 6 · PostgreSQL.
Deployed on Vercel. Also packaged for iOS/Android via Capacitor and desktop via Electron.

## Hard rules

These are not preferences. Breaking one has consequences that cannot be undone from here.

1. **Never modify, seed into, or test against an event holding real people.**
   Read it if you must; never write to it. The "2026 CDG Matchplay Championship" is the
   example this rule was written for and it is **still live in production** — it is simply
   not in the development database any more, which is `localhost/tourneyhq_dev` and holds
   demo data. Do not read that absence as the rule expiring: production is full of events
   carrying member names and addresses, and a seed or a test pointed at one cannot be undone
   from here.
2. **The GitHub repository is public.** No player PII — names, emails, phone numbers, scores
   tied to real people — may ever be committed. That includes fixtures, test data, screenshots
   and pasted logs.
3. **`main` auto-deploys to production via Vercel.** Do not push to it without saying so first.
4. **Commit with explicit paths.** Never `git add -A`; an untracked scratch file with real data
   is exactly how rule 2 gets broken.
5. **Never `git stash`** — this working tree is shared.
6. **Never `prisma migrate reset`** or any command that drops the development database.
   The stated reason used to be the CDG data, which is not in the dev database any more — so
   here is the reason that does not depend on what happens to be in it: a reset replays every
   migration from zero against an EMPTY database, which is exactly how a migration that only
   works on a populated one gets discovered in production rather than here. If Prisma demands
   a reset, fix the drift by hand instead (see Migrations).
7. **TourneyHQ calculates and records money. It never moves money.** Skins, payouts and prize
   splits are arithmetic and a record. No payment rails, no transfers.

## Test fixtures

Use a throwaway organization and event, prefix every row with a mark (`zz-<purpose>`), invented
names, and `@example.invalid` addresses. Delete them in a `finally` — a fixture left in the
database is a fixture someone will later mistake for real.

**A fixture that signs itself in signs `signedInNow(user.id)`**, from
`scripts/session-cookie.mjs` — never the bare user id. Since 2026-10-11 a session cookie
carries when it was issued (`src/lib/domain/session-token.ts`): the server holds a sign-in to
seven days itself, and a password reset ends every earlier one. A cookie made the old way is
refused, and a refused fixture does not fail loudly — every screen answers 307 to the sign-in
page, which a route walk reads as the app working. `session-token.test.ts` sweeps `e2e/` and
`scripts/` for the old spellings.

## Sign-ins until launch: the list is the switch

Ajay, 2026-10-17: "block the signins until I say so or when we launch … app is not ready yet".
`src/lib/sign-in-gate.ts`. When `SIGNIN_ALLOW_EMAILS` (comma-separated) names anybody, only
those people and the owners on `OWNER_EMAILS` may sign in, set or reset a password, sign up, or
keep a session; everybody else is told the app "opens soon" above the front door's form, with
`inquiries@` for the interested and `/play` for a player. Round codes and public boards are not
touched. Empty or unset — dev, CI, e2e — it is open. To open production: delete the variable
(or `SIGNINS=open`) and redeploy. The check is in `createSession` and `getSession`, so a new door
is shut without knowing the rule. Never the word "closed" on screen (his ruling).

It does NOT close on its own in production with the owners let through, which was the first
draft: `/owner` answered 404 to the owner, signed in, so production's `OWNER_EMAILS` did not hold
his address and that draft would have locked him out the night before a real tournament.

## The club's clock: "today" is asked of the club, never of the server

A deadline is a DAY, and a day belongs to a place. Until 2026-10-11 the day was whatever the
server's clock said — UTC in production — so a club in New York whose entries "close on the
12th" stopped taking them at 8pm on the 12th, and a club in Sydney saw Saturday's 8am round as
"tomorrow" until eleven on Saturday morning. Every test was green over it for a year, because
every test ran the server and the club on ONE machine: one clock, one zone, in CI both UTC.

- `Organization.timeZone` is an IANA name, or `""` for a club that has not said (it then keeps
  the server's day). A club with none takes its organizer's device zone the first time they
  open the console (`ClubClockAdopter` → `adoptClubTimeZone`, which never overwrites); Club
  settings shows it, with the time at the club, and changes it.
- `src/lib/domain/club-clock.ts` is the rule: `clubToday(zone)` and `clubDay(zone)`. On the
  server, get the zone through `state.today` / `state.timeZone` on the event state, or
  `clubDayForEvent(eventId)` from `src/lib/services/club-clock.ts`.
- **The day helpers have no clock of their own.** `todayIso`, `deadlinePassed`, `deadlineState`,
  `playerMayChange` and `registrationStatus` must be TOLD the day; the compiler refuses a call
  that leaves it out, and `the-server-asks-the-club-what-day-it-is.test.ts` refuses one that
  hands over `new Date()`. An INSTANT (a timestamp, an expiry, "3 minutes ago") is the same
  everywhere and is still read straight off the server's clock.
- `clubDay(zone)` is the club's day at noon by this machine's clock, so that a helper's own
  `getDate()` reads the club's date. It is NOT the present instant — never compare it with a
  stored timestamp.

**`E2E_TZ` is how a test reaches the state production is always in.** `E2E_TZ=Pacific/Auckland`
puts the browser in Auckland (`playwright.config.ts`, and `e2e/coverage.ts` for a context a spec
makes itself) AND the seeded club (`scripts/seed-club.mjs` counts its dates from Auckland's
today), while the server stays where it is. Without it the walk cannot tell a server that asks
the club from one that asks itself. The audit test picks its zone by the hour — Kiritimati or
Pago Pago, whichever is on another calendar day right now — and reports the other direction as
SKIPPED rather than passed.

## Help and docs travel with the change

Ajay, 2026-10-10: "keep a step when there is any change in the app to update the help section
(guide etc) or any documentations." He chose written help over an AI help bot, and written help
is only worth having while it is true. So a change to what somebody sees or does is not done
until, **in the same pull request**:

- **the organizer's guide** says it — `src/lib/guide-steps.ts`, shown at `/guide/steps` with a
  search box (`guide-search.ts`) and shipped as a PDF. Rebuild the PDF when the guide changes:
  `node scripts/build-guide-pdf.mjs` against a built server (see the script's header);
- **the player's Help** says it — `src/lib/player-help.ts`, shown at `/me/help`;
- any doc that describes it is corrected — this file, `docs/`.

Say which in the PR description: "Help/docs: updated …" or "Help/docs: nothing to change,
because …". And **ask Ajay** when a change might deserve a place on the landing page — a new
capability, a claim that has changed, a better screen to show. Do not decide silently that it
needs nothing.

**The landing page** (`src/app/page.tsx`, rebuilt 2026-10-11 on midnight navy) is the one page
written in its own stylesheet: `src/lib/landing/home-styles.ts`, every class prefixed `m-`,
scoped to `main.m-home`, its colours taken from `landing-palette.ts` and nowhere else. The
shared chrome (`components/landing/chrome.tsx`, `lib/landing/styles.ts`) also dresses `/faq`,
`/privacy` and `/terms`, so a change there is a change to four pages. Three rules it is held to:

- **Every picture is an unedited capture of the app**, placed by
  `scripts/place-landing-shots.mjs` with its true size and its smaller sharp copies. A screen
  meant to be READ is flat, upright and still (`e2e/landing-screens.spec.ts`); only a layer
  marked `m-decor` and `aria-hidden` may be tilted, dimmed or moving, and nobody is asked to
  read one.
- **The demo club in the pictures is invented** — never a test tournament's own name, never a
  real club or person.
- **Two of its sections are green on a phone, and that is a TEST** (Ajay, 2026-10-13: "indoor
  navi looks okay but outdoors it looks not great … give me couple section with green while
  keeping navy so that I can test it"). The three feature cards (`m-leaf`: green panels on the
  navy ground) and the pricing section (`m-leaf m-leaf-ground`: green edge to edge) are drawn on
  the `LEAF` surface of `landing-palette.ts` below 900px; everything else, and every wider
  screen, is navy. It is there for him to look at in sunlight. Do not extend it, restyle it or
  take it out on anybody's word but his — and when he rules, the losing colour comes out whole.
- **Until go-live it is built and shipped as the designer and reported to Ajay; after go-live
  nothing on it changes without his preview first** (his ruling, 2026-10-11). Another session
  used to own these files; it has said it holds nothing in them.

Three ways help goes stale are tested, so they cannot happen quietly: a new player screen with
no help topic, a button the help names that a screen no longer draws (`player-help.test.ts`,
`guide-steps.test.ts`), and a search result with nowhere to jump (`guide-search.test.ts`). The
fourth is not testable and is yours: a flow that works differently under the same button names.
The day this rule was written, the guide already held a sentence that morning's work had made
false — "Only Manual lets you … set tees per flight".

## End-to-end means across the board

Ajay, 2026-10-10: "When you test, you test across the board — that's the e2e. It should cover
EVERYTHING IN THE APP." — functional, operational, security, every feature, onboarding, sign-in
and access control.

What prompted it. Eleven scripted tournaments, each a careful path at 120 players, passed three
times running and were reported to him as "three consecutive zero-defect rounds". An hour later
a sweep of options and inputs those scripts never used found about forty candidate defects: a
winner with a blank margin stored as a halved match, a back-nine round reset to the front nine,
a member made scratch by having a phone number corrected. Every one of those rounds was
honestly green. The claim was the defect: a pass count says how the paths walked behaved and
nothing about the paths nobody walked, and nothing was measuring those.

**So a browser-test result is never reported without its reach.** Two instruments exist for it:

- `e2e/coverage.ts` — every spec imports `test` from it, and every browser context records each
  server action called and each screen opened. `node scripts/e2e-coverage.mjs` holds that ledger
  against the BUILD's own lists and prints what was reached and, by name, what never was
  (`--reset` empties it before a run). Measured the day it was written: the whole standing suite,
  361 tests green, called **36 of 263 server actions**. Fourteen per cent.
- The app's controls, counted from the running app rather than from memory: as secretary,
  10,312 controls on screen across 267 screen-states of the seeded club — 117 distinct dropdowns,
  92 choice groups, 122 tick-boxes, 329 text boxes, 546 buttons.

**The layers of the suite**, each of which says in its own header what it cannot see:

- `e2e/everything.spec.ts` opens every console screen on every one of the seeded club's
  tournaments as the secretary, every player screen as a member, every public board signed out.
  The screen lists come from the filesystem and the menu itself.
- `e2e/every-control.spec.ts` (`E2E_EVERYTHING=1`) makes every choice every dropdown, choice
  group and tick-box offers, saves it the way the screen saves, reloads, and asks whether it was
  kept. It is the browser form of "what a screen OFFERS, the server ACCEPTS and the app READS
  must be one list" — see `docs/sweeps-2026-10-10.md`.

"A round" is the whole suite, and it is "clean" only with its reach stated beside it. A run
that did not exercise the list is a smoke test, whatever it is called.

**A SCREEN EVERY WALK OPENS AND NOBODY USES IS NOT A TESTED SCREEN.** Four areas were used in a
browser for the first time on 2026-10-13, each because the reach report named its actions as
never performed, and every one held something that was live in production:

    Season standings    a club could only ever have one season; a second showed the first's
                        rules; members who missed a cut were "entries with no roster record"
    the course editor   a refused card was refused above the whole form — none of the sentence
                        on the screen — so Add course looked like a button that did nothing
    Club settings       one tap on a radio changed somebody's role at the club
    the honours board   (nothing: the board was right, and the test's first draft was wrong
                        about which clubs keep one)

Three things to carry forward from them:

- **A REFUSAL IS SAID WHERE THE PRESS WAS.** Two of those were one fault: one line for every
  refusal at the top of a long screen, and the button at the bottom. So `e2e/coverage.ts` watches
  for it on every page of every test — words that look like a refusal, within four seconds of a
  press, with none of them on the screen — and `scripts/e2e-coverage.mjs` lists what it saw
  beside the reach (`R` lines). It is a list to READ: a "red" entry is a guess from the colour.
- **THE CLUBS THE SUITE WALKS DECIDE WHAT IT CAN SEE.** Both were on no plan, which is the free
  one, so every walk found the season table locked. The seeded club is a Birdie club now, with a
  season holding its finished championship; the e2e fixture's club is still on no plan, so the
  locked state is walked too. And that fixture club has no Commissioner, which no club made
  through the app can be: a spec that manages its staff seats the secretary first
  (`club-staff.spec.ts`), and the deferred register has what the ownerless state does.
- **A STEP THAT DID NOT RUN SAYS SO.** `club-course.spec.ts` first printed "NOT WALKED" for a card
  with a score on it — the fixture could not reach that — and then built the state for itself.
  A branch that skips in silence is a step counted as passed.

**Two habits this cost to learn, both the same night:**

- **Commit before any mutation check.** "Break it, watch the test go red, put it back" was done
  on uncommitted work and put back with `git checkout --`, which put back the fix as well. The
  rule further down says to restore with the Edit tool; the safer rule is that there is nothing
  uncommitted to lose. With the work committed, `git checkout -- <file>` is exactly right.
- **A finding from reading code becomes a test in the BROWSER, not only a fix.** The next round
  must be able to find it again without anybody remembering it.

## Verification

Run before committing anything non-trivial:

```bash
npx tsc --noEmit && npx vitest run && npx next lint && NEXT_DIST_DIR=.next-ci npx next build
```

`npm run smoke` GETs every route against a running dev server and fails on a 5xx. It exists
because neither tsc nor the unit tests render a server component — a screen can throw on every
request with a clean build and 1300 green tests.

It defaults to `http://localhost:3000`; point it elsewhere with `SMOKE_BASE_URL`. In a worktree,
check `preview_list`'s `cwd` before believing a green run — `preview_start` will reuse a dev
server already running from the MAIN checkout, and then every route passes against code you did
not write.

**A SPEC MOVES BY ADDRESS. A PLAYER MOVES BY THUMB, AND THE TWO ARE DIFFERENT REQUESTS.**
`page.goto` asks for a whole document. Tapping a tab asks for page data, through the service
worker (`public/sw.js`). Until 2026-10-11 the worker answered those from its cache FIRST, keyed
by address alone — so a member who took over somebody's phone and tapped Money was shown that
person's money, card and place on the board, and anybody re-opening the app was shown the first
tab they tapped as it was the last time.
Every spec, the every-screen walk and the control crawl were green over it, because none of them
taps. `e2e/shared-phone.spec.ts` does, and compares the screen with what that person is shown in
a clean browser that has no worker.

Two things to carry forward. **When a check is about what one PERSON sees, compare the screen,
not a word on it**: the first measurement of this looked for a name, found the right names (a
money page names everybody in the pot), and called it safe. And **the worker keeps nobody's
pages** — four static files and nothing else. The cache it had was for opening a tab with no
signal, which it never managed; if that is ever wanted it has to be BUILT, with each kept page
filed under the person it belongs to. Do not switch page caching back on to get it.

**AND A SPEC TYPES INTO A PAGE THAT LOADED LONG AGO.** The server is next door, so the script
is there before the first key. On a course it is not: a screen is drawn seconds before its
script arrives, and until 2026-10-11 anything typed in that gap was on the screen and unknown to
the page — a round code with Continue grey for ever. `TypedBeforeLoad` in the root layout
closes it for every text box. To test anything about a form's first seconds, hold the script
back (`page.route("**/_next/static/**/*.js", …)`, as `e2e/typed-before-load.spec.ts` does) and
type with `pressSequentially` — and wait for the page to be live before a `fill`, or the spec
itself is the slow-connection user and fails three steps later on a disabled button.

**AND A SPEC'S SAVE LANDS BEFORE THE NEXT TAP. ON A COURSE THE NEXT TAP COMES FIRST.** A card
saves itself after every hole. Until 2026-10-13 each save was sent on its own, so on one bar a
player three holes ahead of their signal had three saves in the air, and they arrived in whatever
order the network liked: the second to land carried a revision the first had already replaced,
and the server answered that somebody else had changed the card. The player was shown the
"Use theirs / Keep mine" chooser over a card nobody but them had touched. Next door to the
server a save is back in twenty milliseconds and none of this can happen, so every scoring spec
was green over it.

Two things hold it now. **One save is out at a time** (`usePendingCard`: `mayStartSend`, and
`landed()` for anything that must follow the last one, which certifying does), and a newer card
goes when the one before it is back. And **the server does not call a card it already holds a
conflict** (`scorecard-write.ts`): a retry of a save whose answer was lost is the same card, not
somebody's edit. `e2e/slow-signal-scoring.spec.ts` holds every save back and scores ahead of
them; to test anything about what happens BETWEEN a tap and its answer, delay the answer
(`page.route` on the action's POST) rather than waiting for a quiet network.

**AND A BUILD MADE ON WINDOWS HINTS NO FONT, SO THIS MACHINE CANNOT SEE WHAT A PHONE
DOWNLOADS.** Until 2026-10-13 every screen fetched five font files before it knew which it would
draw — 248 KB — and no local run or screenshot showed it, because next/font's manifest comes out
empty on Windows (`src/app/fonts.ts` says why). Production is built on Linux. So
`e2e/weight-budget.json` is kept PER PLATFORM, `e2e/fonts.spec.ts` says in a line when the rule
about hints was not exercised, and the figure to believe is the one the phone part prints on
GitHub: two hints a screen, three on a player's Today.

**AND THE FRONT DOOR IS NOT ITS FULL HEIGHT WHEN IT HAS LOADED.** The story of a round is a plain
section until the page's script starts, and then a scroll-told track: on a phone the page is
14,021px tall half a second after it loads and 16,559px a second after, and everything below the
story — the pricing, the sign-in box — is 2,500 to 3,500px further down. Three rounds on one
batch each stopped on a front-door test because of it (2026-10-13): one read where the sign-up
form was on arrival and scrolled there later; one pressed "Send reset link" in the instant the
page grew, and the press landed where the button had been. Three more walks read the page's
height on arrival and would NOT have failed — they would have stopped short of the bottom and
called the rest clean. **Any test of the front door awaits `landingSettled(page)`
(`e2e/landing-settled.ts`) before it measures or presses**, and one that scrolls to a thing asks
where the thing is at the moment it scrolls. The visitor is fine: somebody already at the
sign-up form keeps their place to the pixel on Chrome's engine and on Safari's — measured, after
it had been assumed otherwise and written down as a fault that was not there.

**AND THE SUITE IS CHROMIUM UNLESS YOU ASK.** Most players hold an iPhone, which is WebKit.
`E2E_ENGINE=webkit npx playwright test` runs the same three projects on it (CI installs Chromium
only, so this is by hand: `npx playwright install webkit` once). Two things to know before
believing a red WebKit run:

- **Start the server for it with `E2E_PLAIN_HTTP=1`.** The e2e server is a production build over
  plain http, and WebKit does not send a Secure cookie there — so every flow where the SERVER
  sets the cookie (sign-up, set-password, a round code) silently signs nobody in, and the spec
  fails three steps later on a screen that says "Enter your score". `secure-cookies.ts` drops the
  flag for that run and refuses to on Vercel. Start it WITHOUT the variable for Chromium runs.
- **"TypeError: Load failed" is a real finding; "Fetch API cannot load … due to access control
  checks" is not.** Both mean a request was dropped because the page was left. The second is the
  framework's own and `page-errors.ts` ignores it. The first is a request the APP made and did
  not catch — Safari raises it where Chromium says nothing, and the first run found three.
- **Push is NOT covered on WebKit.** This WebKit build offers `PushManager` and then never
  answers `getSubscription()`, freezing the page — the player's Today, on its second visit, once
  the service worker is there. It read for an hour as the app freezing on an iPhone.
  `e2e/coverage.ts` takes `PushManager` away on that engine. Real Safari answers the call; the
  real-phone push test is still owed.

**A RUN KILLED INSIDE AN ORGANIZER-FROM-NOTHING SPEC POISONS THE NEXT ONE.** Those specs
(`organizer-medal`, `organizer-entry` and their kin) make a club the app names after the PERSON,
not the fixture's mark. Stop a run inside one and the next run's standing fixture deletes the
organizer — their address carries the mark — and leaves the club, with a tournament on it that
still lists that address as its organizer. The next fresh organizer is therefore sent straight to
that tournament instead of being asked for a first one, and every such spec waits out its whole
timeout on a form that never appears. Six minutes each, and it reads as the app. Since
2026-10-11 `teardownOrganizer` finds the club through the tournament as well; if those specs all
time out together on "create your first tournament", look for an orphan club before the code.

**Reading a change in the browser: bust the URL, or you will read the old page.** Navigating to a
URL the browser has already visited serves it from cache, so `innerText` shows the render from
before the edit. On 2026-09-07 that reported a fix as missing three separate times — twice after
a dev-server restart, once on `/live`, which ALSO has its own server-side board cache and so has
two independent ways of handing back something stale.

The tell is that a `fetch(url, { cache: "no-store" })` of the same page contains the string the
rendered DOM does not. That is not a bug in the fix; that is two caches doing their job.

So: append a throwaway query (`?bust=1`) when navigating to check a change, or assert against a
no-store `fetch`. And note the failure is not symmetrical — a stale read can also show a string
you have just DELETED, which is the direction that ends with "already fixed" written on something
that is not.

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

The command above runs the DEFAULT config, which excludes `*.audit.test.ts` — those need a real
database and live in `vitest.audit.config.ts`. Anything whose behaviour is only provable against
real rows (handicap resolution, authorization, money) is asserted there, so a change to one of
those areas is not verified until you have also run:

```bash
npx vitest run --config vitest.audit.config.ts
```

Use `NEXT_DIST_DIR=.next-ci` for builds while a dev server is running; sharing `.next` between
them corrupts it.

**And PLAYWRIGHT STARTS A BUILD YOU DID NOT TYPE.** `playwright.config.ts` sets
`webServer.command` to `npm run build && npx next start --port 3101`, so running the e2e suite
runs a build whether or not you asked for one.

**It does NOT collide with the dev server.** That build goes to `.next-e2e` —
`webServer.env` sets `NEXT_DIST_DIR` — so the rule above is already satisfied and you do not need
to stop the preview or delete `.next` first. This file used to say the opposite, in detail, and
it was wrong: read `webServer.env` before believing any claim about which directory it writes.

**The trap that IS real is `reuseExistingServer`.** It is `!process.env.CI`, so locally Playwright
will happily attach to whatever is already listening on 3101 and skip the build entirely. And a
Playwright run killed part-way does not take its `next start` down with it — the wrapper dies, the
server keeps listening.

So the shape to recognise is: kill a run, edit code, run again, and the second run **tests the
first run's build**. It passes or fails on code you have changed since, and nothing in the output
says so. On 2026-09-11 a run sat green-looking for six minutes against a build twenty-five minutes
older than the branch.

Two checks settle it in seconds, and are worth making before believing any local e2e result:

```bash
ls -la --time-style=full-iso .next-e2e/BUILD_ID   # older than your last edit? stale.
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3101/   # 200 before you start? stale.
```

The cleanup is to kill the listener and delete the directory, then run:

```bash
powershell -c "Get-NetTCPConnection -LocalPort 3101 -State Listen | %{ Stop-Process -Id \$_.OwningProcess -Force }"
rm -rf .next-e2e
```

An earlier entry here blamed a red run — five `offline.spec` tests failing together, then the
whole of `organizer.spec` behind them — on dist-directory contention. The diagnosis was wrong; the
READING of the failure is still right and still worth keeping, because it is how you tell a dead
server from a real regression:

- every failure takes the SAME time (2.6s there), which is a timeout rather than an assertion;
- they CASCADE — everything from test 92 onward, not a scattered few;
- they take out WHOLE FILES, including ones unrelated to each other.

An assertion failure has an expected and a received value, and it does not bring its neighbours
down with it. So read that shape as "the server under it died", the same way `FAIL 0` is read
above — and note it looks nothing like any of the three intermittent e2e failures below, which is
why it is easy to start debugging the wrong thing.

**A build can still take the dev server down with it, and the smoke scripts then blame your
change.** Separate dist directories stop the two corrupting each other's output; they do not stop
the machine being busy enough that the dev server dies mid-run. On 2026-09-08 that happened four
times, always in the same shape: `next build` finishes, the smoke pass starts, and the first one
or two scripts report a route as `FAIL 0` or `[TypeError: fetch failed]` while a later one passes.

Read those two symptoms as "no server", not "broken route". A real 5xx has a status; `FAIL 0`
means nothing answered. `curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/` settles
it in a second — and note that an UNAUTHENTICATED curl of a console route correctly returns 307,
so a redirect there is the server working, not failing.

So run the smoke pass against a server you have just confirmed is up, and if a script reports a
transport failure, restart the preview and run the whole set again before believing any of it.
A green run after a restart on the same commit is the answer; half a red run is not evidence
about the code.

**And now the MECHANISM, read off `preview_logs` on 2026-09-09 rather than guessed at.** "The
machine being busy" above is the right instinct and not the actual event. Next restarts itself:

```
 ✓ Compiled /prizes in 1918ms (1197 modules)
 ⚠ Server is approaching the used memory threshold, restarting...
   ▲ Next.js 15.5.22
 ✓ Ready in 2.5s
```

That is the dev server deciding, on its own, that it is near its heap limit and starting a fresh
process — and it is MOST likely right after a build, because the smoke pass then walks 39 routes
and each one compiles. It takes a couple of seconds and it is invisible from outside except as
the `fetch failed` the scripts report.

Two things follow. `curl` before the run proves nothing about the middle of it, so a confirmed-up
server followed by a transport failure is this, not your change — do not go looking for the route.
And the answer really is just to run the set again: the process that comes back is healthy, the
same commit, and the second pass has the modules it needs already warm.

**The command at the top is FIVE SIXTHS of the gate. Playwright is the sixth**, and nothing
above it can see what it sees — a scorecard wider than its column, a target under the touch
minimum, a card that opens blank over a round already played, a date rendered in the wrong
words. It needs a database and about four minutes:

```bash
AUTH_SECRET=local-e2e-secret npx playwright test
```

Skipping it on an ordinary change is reasonable; CI runs it on every push. What is NOT
reasonable is skipping it and then saying a branch or `main` is verified. On 2026-09-05 `main`
was declared green after tsc, vitest, the audit config, lint and build all passed — and it was
RED, on an end-to-end test, and had been for twenty minutes. Running five of six and reporting
"the gate" is how a red `main` goes unnoticed, which this file has a whole section about.

It seeds a real fixture through `e2e/fixture.mjs` and tears it down afterwards, so it needs a
database it may write to. Never point it at anything but the development one.

**One recurring CI failure is a Chromium crash, not a test.** Somewhere in `organizer.spec.ts`,
on the desktop project, with:

```
[pid=####][err] Received signal 11 SEGV_MAPERR 0000000001b0
Error: browser.newContext: Target page, context or browser has been closed
```

Three times on 2026-09-08 alone, across unrelated branches, and twice before that. The browser
process dies; the assertion never runs. **Read the log every time rather than assuming** — a real
failure on that spec looks completely different, with an expected and a received value — and
confirm by re-running the SAME commit, which has gone green every time so far. What is not
acceptable is merging past a red e2e without opening the log, which is how a real regression gets
filed as this.

**IT IS NOT ONE TEST.** This entry named `organizer.spec.ts:54`, "the leaderboard shows the whole
field", for a fortnight, because that is where every observed crash had landed. On 2026-09-21 it
struck `organizer.spec.ts:34` — "an organizer lands in the console, not the player app" — with
the byte-identical signature, on the desktop project, on a pull request that changes only this
document.

So do not read a crash on a DIFFERENT line of that spec as a different problem, and do not go
looking at whatever the named test asserts. The signature is the diagnosis: signal 11,
`SEGV_MAPERR 0000000001b0`, desktop only, and no expected-versus-received anywhere in the output.
The line number is as much noise as the component name is in the `Client Manifest` fault below.

**What is known about it, measured rather than assumed** (2026-09-08):

- It is ONE test, and the browser RECOVERS. Read straight off attempt 1 of a failed run:
  test 84 (the last `offline.spec`) passes, 85 (`organizer.spec.ts:26`) passes, **86 crashes**,
  and 87 onwards all pass. So it is not `offline.spec` poisoning the browser for everything
  after it — a plausible theory that the log disproves.
- **Desktop only.** The `phone` and `small-phone` projects run the same spec and have never
  crashed on it. The difference is a 1280x900 viewport, not the assertions.
- **It does not reproduce locally.** A full `--project=desktop` run on the Windows dev machine:
  106 passed, 12 skipped, no crash.
- `SEGV_MAPERR` at `0x1b0` is a null dereference at a small struct offset, which is a renderer
  BUG rather than memory exhaustion — an out-of-memory kill is signal 9, not 11. So "the runner
  ran out of room" is the wrong tree, and so is `--disable-dev-shm-usage`: these jobs run
  directly on `ubuntu-latest`, not in a container, where `/dev/shm` is half of RAM.

So it wants a reproduction or a Chromium report, NOT a speculative change to this config. In
particular **do not add `retries`** to make it go away: the `retries: 0` above is deliberate and
its reasoning still holds — a retry that hides this would hide a real regression on the same
spec just as effectively.

**There is a SECOND intermittent e2e failure, and it is not that one.** On 2026-09-09
`3f5fa43` went red on `small-phone` with a real assertion — `/grouping has 0 h1s: []`,
expected 1, received 0 — which reads exactly like a screen that lost its heading. It had not.
Three lines above it in the same log:

```
[WebServer] ⨯ Error: Could not find the module ".../GroupingControls.tsx#GroupingControls"
in the React Client Manifest. This is probably a bug in the React Server Components bundler.
```

The dev server failed to serve one client component, so the page rendered empty and the
heading assertion reported what it saw. The commit touched nothing near `/grouping`, and
every later run on `main` passed the same test.

This one is the more dangerous of the two, because the SEGV announces itself as a crash and
this announces itself as YOUR BUG. So when a layout or heading assertion fails on a screen
your change did not touch, **search the log for `Client Manifest` before believing it** — and
confirm the same way as the SEGV, by re-running the commit rather than editing the page.

**IT ALSO COMES FROM A BAD BUILD, and then re-running the commit does NOT clear it.** On
2026-09-12 a local run went red on **fifteen** tests across all three viewports, every one of
them `/prizes`, with `Application error: a server-side exception` on the page and this in the
server log:

```
⨯ Error: Could not find the module ".../ContestsClient.tsx#ContestsClient"
in the React Client Manifest. This is probably a bug in the React Server Components bundler.
```

Same class, different component — and this was `next start` on a production build, not the dev
server. So the manifest written into `.next-e2e` was genuinely missing an entry, and it stayed
missing: re-running the failing spec reproduced it EXACTLY, because `reuseExistingServer`
attached to the same bad build. A deterministic repeat reads like a real bug, which is the trap.

**Delete `.next-e2e` and run again.** That took fifteen failures to zero on the same commit.

Two tells separate this from a real regression: every failure names ONE screen (or one client
component's screens) across every project, and the smoke pass on the dev server renders the same
route 200 — a build-local fault cannot reproduce against a different build.

**FOUR COMPONENTS NOW, WHICH IS THE POINT.** `GroupingControls`, `ContestsClient`, and on
2026-09-16 both `TeamsClient` and `OrganizationClient`. They share nothing but being client
components.

**The fourth settles it: it went red on a COMMENT-ONLY pull request.** Not a line of behaviour
changed anywhere in the repository, and `e2e/layout.spec.ts` still reported
`/organization has 0 h1s: []` — the shape this entry warns announces itself as your bug. There
is no version of that failure which is the author's fault.

So read the component name in the error as noise rather than as a lead: what settles it is
whether the same route renders 200 against a different build, not what changed in the file it
names.

It also does not always take the run down in the same place. That one failed the SMOKE pass
rather than an e2e assertion — `/grouping` had gone 500 on the route walk the same night, and
`/teams` did here — which is the same fault reported by a different instrument. `Build and smoke`
red reads much more like "you broke a page" than a heading assertion does, so check for
`Client Manifest` in the log before believing the route.

**SINCE 2026-09-19 EVERY BUILD CHECKS ITSELF FOR THIS, and rebuilds once.** It struck four times
that day (FoursomeMaker, LocalePicker, AnnouncementsClient — one of them on `main`, which left a
merged change undeployed until the job was re-run by hand). What was measured: eight local builds
of one commit gave identical manifests, so it does not reproduce on demand, and no Next.js release
note from 15.5.23 to 15.5.25 mentions it — the cause is still unknown. But in this app EVERY
page's client-reference manifest lists the same set of client modules (50 manifests, 81 each), so
one build can be checked against itself: a page missing a module the others list IS the fault.

`npm run build`, `vercel-build` and `smoke:all` now go through `scripts/build-checked.mjs`:
`next build`, then that check, then — only if a manifest is provably missing a module — one
rebuild, and a hard failure if the rebuild is bad too. The log line is
`[build-checked] build 1: INCONSISTENT client manifests` with the page and the module named. This
is NOT the `retries` the e2e section forbids: nothing the code could be at fault for is retried,
only a build artifact that fails a deterministic check. If that log line starts appearing often,
or ever twice in one build, it is time to chase the cause properly; `--check` inspects an existing
build without building.

**IT STILL GETS THROUGH, so do not read a green build as this being closed.** On 2026-09-20 the
`small-phone` job of a push-event run failed three tests on `/organization` and `/access` with
`Could not find the module ".../LocalePicker.tsx#LocalePicker" in the React Client Manifest` — and
that job's build goes through `build-checked` (`ci.yml` says so in its own words: "it builds its
own bundle into .next-e2e … which is why this job does not run `npm run build` first", and
`webServer.command` is `npm run build`, which is `scripts/build-checked.mjs`). The tests RAN, so
the build did not hard-fail: either no inconsistency was detected, or one was and the single
rebuild produced a manifest that passed the check while the server still could not resolve the
module at request time.

**TWO WAYS OF STRENGTHENING THAT CHECK WERE MEASURED ON 2026-09-22 AND BOTH ARE DEAD ENDS.**
Written down because each takes an hour to reach and both look obvious from the outside.

*"The union check must be blind to a component only ONE page uses — it cannot miss what no
manifest lists."* False. Probed against a real build: **51 manifests, every one carrying exactly
the same 83 own-source modules**, and both components that actually failed in CI —
`SeriesClient` and `RegistrationClient` — appear in all 51. The uniformity CLAUDE.md measured at
50x81 in September still holds at 51x83. A build that dropped either from one page WOULD be
caught. The check is not the weak link.

*"Then check the manifests against the SOURCE — every `use client` file should appear."* Also
false, and it would be worse than useless: **120 files in `src` carry `"use client"` against 83
modules in the union.** `clientModules` lists only the BOUNDARY entry points — a client component
imported by another client component is bundled into its parent and never gets its own entry, so
`ConfirmButton`, `CoursePicker` and 36 others are legitimately absent. A source-based check fires
38 false positives on a perfectly good build.

So `build-checked` is doing the right thing with the right instrument. What that leaves is the
other half of the sentence below — the artifact passes and the running server still cannot
resolve the module — which is where anyone chasing this should start rather than on the check.

So the check narrows this class; it does not close it. Read the failure the way this section
already says — the component name is noise, the tell is `Client Manifest` in the log plus the
same commit passing elsewhere. That day the `pull_request` run of the identical SHA was green on
all three viewports while the `push` run was red, which is as clean a control as this fault ever
offers.

**AND ON 2026-09-21 IT WENT RED ON A COMMIT THAT ADDS ONE TEST FILE AND NOTHING ELSE**, naming
`RegistrationClient` — the eighth component to appear in this error and one the commit does not
import, reference or reach. `/registration has 0 h1s: []`, the usual costume.

That is a stronger control than the comment-only PR above, and it is worth having both: a
comment-only change still TOUCHES a source file, so somebody can always wonder about a stray
character. A commit whose entire diff is one new file under `src/lib/__tests__` cannot alter what
`next build` emits for a page it never mentions. The three other proofs held as usual — `phone`
and `small-phone` passed the same SHA with their own builds, the PR run was green on all three
viewports twice over, and a re-run of the identical commit with no change went fully green and
deployed.

So the count of named components is now NINE and still climbing, which is the point the list is
making rather than a gap in it. **Do not chase the component.** Re-run the failed job
(`gh run rerun <id> --failed`) and read `Client Manifest` as the whole diagnosis.

The ninth arrived an hour later, on the pull request ADDING THE PARAGRAPH ABOVE — a change to
this file and nothing else — as `SeriesClient`, on `Build and smoke`. A documentation commit
cannot break a bundler, and that run's sibling jobs built the same SHA fine.

**AND THE FREQUENCY IS NOW THE FINDING.** This section has always described an occasional fault.
On the evening of 2026-09-21 the two build-time faults struck FIVE times across four pull
requests:

```
next/font        #550 End-to-end (desktop)      #551 Build and smoke
                 #554 End-to-end (small-phone)
Client Manifest  #553 End-to-end (desktop)   → RegistrationClient
                 #554 Build and smoke        → SeriesClient
Chromium SEGV    #554 End-to-end (desktop)   → organizer.spec.ts:34
```

Three of those four commits could not have caused anything — one added a single test file, one
edited only this document. Every one cleared on a re-run of the identical commit.

**#554 IS THE ONE TO REMEMBER: it collected all THREE faults, across two pushes, while changing
nothing but this file.** If a documentation commit can go red three different ways in twenty
minutes, then a red e2e on a branch that touches real code says nothing on its own either. Open
the log, name which of the three it is, and re-run.

That crosses the threshold this file sets for itself two paragraphs up: *"if that log line starts
appearing often … it is time to chase the cause properly."* It has not been chased yet. What the
evening establishes is the SHAPE to hand whoever does — both faults are in the build, both are
intermittent per-job rather than per-commit, both clear on a re-run, and they can hit the same
commit in different jobs at once. Whether one evening of a busy runner fleet explains both, or
whether `build-checked` needs to cover `next/font` the way it covers manifests, is open.

Until then the operational answer is unchanged and is cheap: read which of the two it is, re-run
the failed job, and do not edit application code on the strength of either.

**And that pair is worth knowing about on its own: `ci.yml` runs on BOTH `push` and
`pull_request`, so one commit has TWO workflow runs and two sets of identically-named checks.**
A merge watcher reading `commits/<sha>/check-runs` sees both and will refuse on a failure in
either, which is the conservative and correct behaviour — but `gh run view <id>` on one of them
can show all green while the SHA is still red. Ask which RUN before concluding anything, and
re-run the failed jobs of the red one (`gh run rerun <id> --failed`) rather than the PR.

**And a THIRD, which is a click that never lands.** `offline.spec.ts:245` — "taking their
card clears the queue without sending anything" — times out on the desktop project trying to
press the card chooser's button:

```
Error: locator.click: Test timeout of 30000ms exceeded.
  - locator resolved to <button ...>Use theirs</button>
  - element is not stable ... element is outside of the viewport
  - <a href="/me/board">…</a> from <nav aria-label="Sections">…</nav> intercepts pointer events
  - element was detached from the DOM, retrying
```

Note what it is NOT: the dialog is found and visible, so this is not a screen that failed to
render, and there is no expected-versus-received anywhere in it. It is the click.

**NOT desktop only**, which this entry claimed for a day. It was written off two desktop
samples where `phone` and `small-phone` passed in the same run, and the obvious reading — a
1280x900 viewport problem — was wrong. It has now been seen on **all three projects**:
`small-phone` on 2026-09-11 and `phone` on 2026-09-12, both with the identical signature, both
passing on a re-run. The viewport is not the variable; do not go looking for a layout fault at
any particular width on the strength of this note.

**It is on `main`**, measured 2026-09-11 rather than assumed: five runs of that spec at the
desktop viewport, three green and two red, across `main` and a branch whose new files nothing
in `src/app` or `src/components` imports.

That last bit is why it is written down. The first sample said branch-fails / main-passes, and
on one sample each that reads exactly like a regression you just introduced — it took two more
runs on `main` to see the coin land the other way. **One run of each is not a comparison.** If
this fails on a change that cannot reach the player card, re-run the same spec on `main` two or
three times before believing it.

Unlike the SEGV, this one may still be worth fixing rather than tolerating — but the reason has
changed with the evidence. It used to read "pointer events intercepted by the section nav at
1280x900, so it may be a real desktop layout fault". Failures at 375px kill that theory: the
section nav and the viewport are both different there and it happens anyway.

What every log DOES share is the sequence `element is not stable` → `outside of the viewport` →
`element was detached from the DOM, retrying`. That is a dialog still animating or re-rendering
under the click, at any width — so the thing to look at is what re-renders the card chooser
after it opens, not where the nav sits.

**Somebody has now looked, and there WAS something re-rendering it** (2026-09-12).
`usePendingCard` ran a `setInterval` every five seconds that called `tick()`
unconditionally — a forced re-render of the whole scoring screen, including the
open chooser — for the life of the page. It did two jobs and in this state
neither applied: `shouldRetry` already refuses a `held` card, and `syncStatus`
reads the clock in exactly one branch, which `held` never reaches. So while the
dialog sat waiting on a person, its subtree re-rendered under their finger every
five seconds.

That is removed — the timer now runs only when `shouldPoll` says a send is
outstanding — and it is the mechanism the log describes. **It is not a confirmed
fix.** The failure is intermittent and was never reproduced on demand, so
"60 consecutive passes of `offline.spec` across all three projects" is evidence
and not proof. If it recurs, the next thing to look at is what else changes
identity under the chooser: the two `CardConflict` call sites in `PlayerCard`
sit at different JSX positions, so a `conflict`/`recovered` flip unmounts one
and mounts the other, which would explain "element was detached from the DOM"
exactly.

**AND THE CHOOSER IS NOT A DIALOG, which everything above this line assumes it
is.** `CardConflict` is a `<section className="card">` rendered INLINE in
`PlayerCard`'s page flow. No backdrop, nothing fixed, not centred — the only
thing making it a dialog is `role="alertdialog"`, which is what
`page.getByRole("alertdialog")` binds to.

That matters for one symptom in particular. A centred overlay cannot BE
"outside of the viewport"; an inline card two thirds of the way down a
scorecard can, and Playwright has to scroll to it before it can click. So the
middle line of that three-line signature is explained by the shape of the
thing, not by animation — which is what the paragraphs above reach for.

Its GEOMETRY is now measured, inside `offline.spec` where it is already open,
and it is clean at 320, 393 and 1280 with a 59-character tournament name. So
"the chooser is too wide" is off the table as a cause; what remains is that it
is inline, in a page that re-renders, at two different JSX positions.

**And that is measured DURING a failure, not merely alongside one.** The
assertion sits immediately before the click. On 2026-09-15 the flake recurred
at `small-phone` with the full signature — and the geometry assertion two lines
above it had just passed. So at the moment the chooser was measured the box was
correct, and the click still could not land: whatever moves it, moves it
between the measurement and the press. That is the strongest evidence yet that
the cause is re-render timing rather than layout, and it is the reason to look
at what changes identity under the chooser rather than at its CSS.

**TWO SUSPECTS ARE NOW ELIMINATED, both of them named above.** Neither was the
cause, and knowing that is worth more than the guesses were:

- **The two call sites.** They were collapsed into ONE `<CardConflict>` fed by
  a `chooser` value on 2026-09-15, so a `conflict`/`recovered` flip can no
  longer unmount one and mount the other. The flake then recurred TWICE in the
  next full run — `phone` and `small-phone` — with `element was detached from
  the DOM` still in both logs. Whatever detaches it, it is not that.
- **The five-second timer.** `shouldPoll` refuses a `held` card, and a conflict
  DOES set `held`: `send` returns `"held"` for a conflict and `setHeld(true)`
  runs before the chooser appears. So the interval is already stopped while
  this chooser is open, and the 2026-09-12 fix cannot be what is still
  re-rendering it.

**AND THEN IT WAS FOUND, and it is in neither the app nor the test.** The order
in every log is the clue that pays off: `not stable` comes FIRST, before
`outside of the viewport`. That is the page still moving when the scroll was
attempted.

`globals.css` sets `html { scroll-behavior: smooth }`, overridden to `auto`
only inside `@media (prefers-reduced-motion: reduce)` — and **Playwright does
not emulate that preference by default**, so every test ran with animated
scrolling. Playwright scrolls an element into view before clicking, then checks
the box is stable across two consecutive animation frames. The chooser sits
~215px below the fold, so every click on it scrolls, and the box was still
animating when it was measured. Sampled per frame after a `scrollIntoView` at
320px:

```
t=0   y=783    t=93  y=669    t=143 y=369
t=27  y=781    t=110 y=574    t=160 y=303
t=60  y=755    t=127 y=460    t=176 y=253
```

114 pixels between two consecutive frames, for about 300ms. With
`contextOptions: { reducedMotion: "reduce" }` in `playwright.config.ts` the
same measurement is a single jump — `t=0 y=783`, `t=14 y=40` — and flat after.

That accounts for every part of it: intermittent because it is a race between a
~300ms animation and a stability check; all three viewports because the
property is on the document; only that test because it is the only click far
enough below the fold to need a real scroll; and `detached from the DOM` on the
retries, which is React re-rendering during the retry window — which is exactly
why the two suspects above looked so plausible. They were downstream of the
scroll, not the cause of it.

**The lesson is the method, not the CSS.** Three hypotheses were argued from
source and all three were wrong. The answer came from instrumenting the gap
between "the chooser is visible" and "the click lands" and sampling the box
every frame — the first thing done to this bug that was a measurement rather
than a guess.

In Playwright 1.62 `reducedMotion` lives on `contextOptions`, NOT among the
`PlaywrightTestOptions` that sit directly on `use` — `colorScheme` does, which
makes it easy to write in the wrong place. Put it at the top level and it is a
type error surfaced by `next build` type-checking the config, not by Playwright.

**AND IT HAS A SECOND SIGNATURE, WHICH IS NOT THE ONE ABOVE.** Everything from
`offline.spec.ts:245` down to here describes a click that cannot LAND on a
chooser that is on screen. On 2026-09-16 the same test failed on `phone` with the
chooser never appearing at all:

```
Error: expect(locator).toBeVisible() failed
  Locator: getByRole('alertdialog')
  Timeout: 20000ms
  Error: element(s) not found
  at e2e/offline.spec.ts:259
```

Read the difference rather than filing it as the same thing: `not stable` /
`outside of the viewport` / `detached` is the scroll race the `reducedMotion`
fix addresses, and this is twenty seconds of nothing. The `reducedMotion` fix
cannot help a dialog that was never rendered.

What it is NOT: a broken chooser. `offline.spec.ts:218` — "a card changed while
you were offline asks instead of overwriting" — opens the same chooser four
tests earlier and PASSED in the same run. So the mechanism works and this
specific test's setup did not produce a conflict that time.

Confirmed intermittent the usual way: green on a re-run of the same commit, on a
branch whose only change was a CI SCRIPT — no app code at all, which is as close
to proof as this gets that it is not the author's change. Worth watching for
whether it is the shared e2e fixture being raced (see
`e2e-fixture-collides-across-worktrees`), because "the conflict never got set
up" is exactly what a wiped fixture looks like from here.

Still not worth `retries`. The reasoning above about hiding a real regression
has not changed. The other
two dialogs in the app are measured in `e2e/dialog.spec.ts`, and
`src/lib/__tests__/dialogs-are-swept.test.ts` pins which of the three is which
kind — so a later change making this one a proper modal would resolve the
scroll-to and should be noticed rather than discovered.

**AND A FOURTH, WHICH WAS NEVER INTERMITTENT: React #418, a hydration mismatch, on a
screen your change did not touch.** `/me`, a knockout, `/cup`, `/stages`, `/me/help` —
never the same screen twice, cleared every time by `gh run rerun --failed`, and
written up here for weeks as something to re-run.

**It is a page that arrived slowly, and a bug in the React that Next 15.5 bundles.**
A page's data follows its HTML down the same connection in pieces. When React, wiring
the page up, reaches an element whose children are in a piece that has not arrived, it
stops and comes back — having already taken that element's place in the document and
moved on to its first child, and without moving back. It then compares the element
with its own first child, calls that a mismatch, throws the server's page away and
draws all of it again. The server's HTML and the browser's render were identical every
time, which is why every comparison this file ever asked for said "identical".

Found 2026-10-12, by MEASURING after a day of theories (dates, locale data, the test
harness — each argued from source, each wrong):

```
the same seven screens, opened 12 times each          threw #418
  directly                                             0 of 84
  through a proxy: 1,200 bytes, 4ms pause             11 of 84
                     400 bytes, 6ms                   14 of 84
                   4,000 bytes, 25ms                  15 of 84
```

Next door to the server a page arrives whole, so the suite saw it once in several
hundred loads. A phone on a course is the proxy. And against the DEV server, delivered
the same way, React says what it tripped on — always "expected `<X>`, found X's first
child", under `replaySuspendedUnitOfWork`.

React fixed it in facebook/react#35494 (released in 19.3.0, not taken back to 19.2).
**Until Next is moved to a version that carries that React (16.3 or later),
`scripts/react-hydration-replay-backport.cjs` puts upstream's change into the bundled
copy as the browser bundle is built** — a webpack rule in `next.config.mjs`, nothing in
`node_modules` edited. Four things keep it honest:

- it stops the build if either place it touches is not found exactly once, and says to
  delete it when the React underneath already has the fix;
- `scripts/build-checked.mjs` — every build, production's included — looks in the
  CHUNKS for the mark the fix leaves and fails without it, so a stale build cache or a
  change of bundler cannot ship a bundle that lacks it;
- `react-hydration-replay-backport.test.ts` runs it over every copy of React the
  installed Next ships, so a Next upgrade that changes their shape is red in its own PR;
- `e2e/slow-page.spec.ts` IS the experiment above, kept: thirty loads through the slow
  proxy, none may throw, with controls that delivery really was slow and that the React
  running is the patched one (`window.__thqHydrationReplayBackport`).

Three things to carry forward. **"Intermittent" is a description of the instrument, not
of the fault**: this one was certain under conditions no test produced. **A fault that
leaves identical before-and-after pictures is about TIME**, and the instrument for time
is to slow it down. And **the page's weight is the width of the window**: more than half
of every page is its own content sent a second time as data, and whatever is drawn by a
server component from a long string (the icon sprite, an inline style sheet) is in that
half too.

`e2e/page-errors.ts` still records every #418 with where the server's page and the
drawn one part. After this fix a `[hydration #418]` line is a REAL mismatch — read it
and fix the element it names; do not re-run it away.

One cause found by reading rather than by that line, 2026-10-11: a relative time
("5 minutes ago") worked out during render by a component that is drawn on both
sides. `no-client-screen-draws-from-its-own-clock.test.ts` refuses that — and it
follows IMPORTS, because `"use client"` marks a boundary and not a file: the
announcement card had no mark of its own and was missed for exactly that reason.
The time is worded once on the server and handed down.

**And one cause found by CI and by nothing local, 2026-10-12: the server's Node is not the
browser.** CI runs Node 20; this machine runs Node 24, whose locale data agrees with Chromium's.
A Korean clock time was "PM 1:05" from the server and "오후 1:05" in the browser — on CI only.
`formatClock` in `domain/locale.ts` takes the day-period word from its own table, and
`a-clock-time-is-written-once.test.ts` refuses a bare `toLocaleTimeString` in `src`.
`npx -y node@20 file.cjs` runs anything under CI's Node from here.

**AND THE CLASS IS CLOSED, NOT THE INSTANCE: SINCE 2026-10-13 THE APP WRITES ITS OWN DATES.**
A thin space, a Korean tilde, a British dash and a Korean "PM" were each patched where they
showed. The first run of the suite on Firefox and on Safari's engine then found three more in
one evening — a comma after a British weekday (which redrew the Rounds screen on every load, on
every iPhone), an hour written "1:05" by the server and "01:05" by Firefox, a Japanese range in
another notation. Every one is the same fault: two platforms, two editions of the conventions.

So the conventions are read ONCE, by `scripts/build-date-words.mjs` (which proves its table
against a year of days before writing it), into `src/lib/domain/date-words.data.ts`, and
`date-words.ts` fills a template in. It asks the platform for arithmetic only. Every date the
app writes goes through it — `formatDay`, `formatDayAt`, `formatMonthDayAt`, `formatDayRange`,
`formatClock`, `shortDate`, `clubClockInWords` — and three tests hold that:

- `date-words.test.ts` pins what each country's club reads, typed by hand; refuses a language
  the picker offers and the table does not hold; and refuses any screen that words a date by
  asking the platform (`new Intl.DateTimeFormat(locale…`, `toLocaleDateString`);
- `date-words-are-read.test.ts` swaps the table for one no platform would write, so a caller
  put back to asking the platform FAILS. On the machine the table was read from the platform
  writes the same thing, and a test of values alone cannot tell the two apart;
- `e2e/formats-agree.spec.ts` runs the same functions on both sides, on every engine a round
  drives.

A tag the table does not hold is still the platform's, and can still differ. AMOUNTS are still
the platform's too, and are measured by the same spec: no engine has disagreed about one yet.
To add a language, see `docs/testing.md`.

**AND WHAT THE APP WRITES IN A CLUB'S LANGUAGE, IT MUST READ BACK IN THAT LANGUAGE.** The
formatter was given the club's locale and the reader was not. A German, French or Spanish club's
stake, written "5,00" in its own box by this app, was read back as 500.00, and "1.234,56" as 1.23
— on the skins pot, every side bet, every shared cost and the kitty. Found 2026-10-13 by the
first browser test to start a side bet; measured before the fix, 90 of 392 locale × currency ×
amount combinations read back wrong. `one-currency.test.ts` had held "the parser is the exact
inverse of the formatter, in every currency offered" for months and formatted in en-US every
time: the rule ranged over two axes and the test walked one.

- `minorUnitsFrom(text, currency, locale)` reads which mark is the decimal one off the TEXT (both
  marks: the last; one mark more than once: grouping; one mark once: three digits after it group,
  anything else is the decimal), so the server and every browser read one figure one way. It
  still gives 0 for junk, never NaN — so a caller that must REFUSE a box with no figure in it
  checks for a digit itself (`ContestsClient`), because `Number.isFinite` will never say no.
- `decimalPoint()` in `domain/decimal-text.ts` is the same class for figures that are not money:
  a handicap "12,4" was refused by the entry form and read as SCRATCH by a casual round, and a
  course rating "71,3" was stored as 71.0. Any new reader of a decimal somebody types goes
  through one of the two.
- `figures-are-read-in-every-language.test.ts` walks every language and currency a club can
  choose, from the app's own lists; `e2e/side-bet-named-winner.spec.ts` does it as a German club.

**What the recorder said, the two times it was attached when the slow-page fault struck** (the
entry above this one): "kept 124ms into the page … from <body> down the two are the same, element
for element and word for word", once with the document still "loading". Identical before and
after is what that fault looks like from outside, and it is what sent the search to TIME. The
recorder also logs the last thirty changes made to the document before a clear, the streamed
sections not yet in place, and when the document finished arriving.

## The testing framework: `docs/testing.md`

Ajay, 2026-10-13: "you should be building these permanent test script which covers all aspects
of the app and use it whenever we make any change in the app. Keep it updated whenever we add
any functionality." That is `scripts/qa/` and `docs/testing.md`, and three habits come with it:

- **`npm run qa:changed` first, on every finished change.** It reads the files touched and says
  how much testing that needs: nothing ships (tests), its own tests (words, the front door),
  one full round (function in one area), or three (core). Quote it in the pull request.
- **A change is not done until the tests know about it.** A new action needs a spec that DOES
  it as the person who would; a new format needs a scenario; a new language needs a line in the
  date table. `docs/testing.md` has the table of what to add for what, and
  `qa-framework.test.ts` holds the framework's own lists to the files on disk.
- **"Is everything covered?" is answered with the measured figure, never with the size of the
  suite.** End-to-end does NOT cover every action yet: 36 of 263 were performed by a browser
  test when last measured (2026-10-10). Every round re-measures it and names what nothing does.

A round on GitHub is a push to `round/<name>-1` (`round.yml`: about thirty parts side by side).
Firefox will not start on this Windows machine at all — it is run there or not at all — and
its first run is where the dates above and `src/lib/leave-on-enter.ts` came from.

**TWO SESSIONS ON ONE MACHINE SHARE ONE FIXTURE, AND A PLAYWRIGHT RUN IN EITHER WIPES THE
OTHER'S.** Every run seeds the e2e fixture at its start and tears it down at its end, under one
mark, in the one development database — whichever worktree it is started from. On 2026-10-13 a
second session's runs (nine of them between 01:25 and 02:08) deleted the rows this session's
specs were reading: two "caught" results in a break-the-app run were the fixture vanishing, not
the test working, and both read exactly like success. A wiped fixture produces FAILURES, so a
"caught" or a red result taken while another session was running is the suspect one. The rule
the two sessions settled, by message: before any Playwright run, one line to the other session
("fixture turn: starting, ~N min"), wait for "go", and say "done" when the teardown has finished.
Unit tests, a build into your own dist directory and a server on your own port collide with
nothing.

**A background round stopped with TaskStop is NOT stopped.** The shell dies and its children do
not: on 2026-10-13 a "stopped" round went on reseeding the club for hours under later trials,
which read as the app losing a sign-in mid-walk, and then started a build over the working
tree. After stopping one, list the processes (`Get-CimInstance Win32_Process` for `node.exe`
with `playwright`, `next` or `round.mjs` in the command line) and kill what is left.

## What gates a merge, and what gates a deploy

`ci.yml` is the only workflow that runs on its own — every push and every PR. It does the
command above plus the smoke pass and Playwright.

**What stops a bad merge** is a RULESET named "main must be green", not classic branch
protection. Branch protection is OFF, so `/repos/.../branches/main/protection` returns 404
and tells you nothing; ask `/rules/branches/main` instead. It requires the `verify` check
and blocks deletion and force-push on `main`. `strict` is off, so a branch need not be
rebased onto `main` to merge.

**What stops a bad deploy**, since 2026-09-04: the `deploy` job in `ci.yml`, which
`needs: verify` and runs only on a push to `main`. Nothing reaches production until the
whole gate is green. Vercel's own Git deploy for `main` is off — `vercel.json` sets
`git.deploymentEnabled.main = false` — so that job is the only route in. Preview deploys
on other branches are untouched.

Until that day Vercel shipped `main` on push, BEFORE `verify` finished, and a bad commit
was REPORTED rather than stopped. On 2026-09-03 twenty-seven merges each deployed
unverified. Nothing went wrong; nothing was preventing it either.

**The deploy job does not build.** It uploads the source and Vercel builds it, exactly as
before. Building in CI and shipping with `--prebuilt` is the obvious improvement and is
wrong here: `vercel-build` is `pad-migration-names && deploy-migrations && next build`, so
it runs `prisma migrate deploy` against the PRODUCTION database. Building on the runner
would put production database credentials on a GitHub runner and move schema migrations
into CI. The symptom, if anyone tries again, is Prisma refusing an empty URL — Vercel does
not hand `vercel pull` a sensitive value, and that refusal is correct.

`VERCEL_TOKEN` is the only secret; `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` sit in the
workflow because they are identifiers, not credentials. If the deploy fails, check the
token FIRST and check it directly — `vercel whoami`. An invalid token reports
"Could not retrieve Project Settings", which reads like a permissions or id problem and
is not one. That error cost two wrong fixes before anyone ran `whoami`.

**The other way `deploy` fails is the production DATABASE, and it is not the token.** Because
`vercel-build` runs `prisma migrate deploy`, an unreachable production database fails the build:

```
Invalid `prisma.$queryRawUnsafe()` invocation:
Can't reach database server at `db.prisma.io:5432`
Error: Command "npm run vercel-build" exited with 1
```

That happened on 2026-09-08 to `8c1d75b`, a documentation-only commit — `verify` passed in full
and only `Deploy to production` went red, which is the shape that tells you it is not the code.
The next merge deployed normally and carried it, because git history is cumulative.

**And the third way `deploy` fails is the DEPLOYMENT ALLOWANCE, which is neither.** On
2026-09-09 it went red on `17db490` with `verify` fully green:

```
Error: Resource is limited - try again in 24 hours
(more than 100, code: "api-deployments-free-per-day")
```

A hundred deployments a day on the free plan, and **every push counts**, not every merge.
A branch pushed four times is four preview deploys; a merge is one more. Fourteen PRs in an
evening, each amended and force-pushed a couple of times, is comfortably a hundred — which is
how a working night ends with production quietly not updating.

It is SELF-CLEARING and it is intermittent, so do not read one red deploy as an outage. The
counter is rolling: `17db490` failed, `8a67263` deployed twenty minutes later, and because git
history is cumulative that one carried the failed commit's changes with it. Production was
never more than one merge behind.

What it should change is BEHAVIOUR, not configuration. Batch the work into fewer, larger PRs
and push each branch once. Opening a PR per small improvement is the habit that spends the
allowance, and the allowance is shared with the previews a human needs to review anything.

**And the fourth reads CANCELLED, and production may be fine.** On 2026-09-18
`ad73af3` (#470) had `verify` green and `Deploy to production` cancelled at
exactly 20 minutes — the job's `timeout-minutes`. The log ended:

```
Building…
Completing…
##[error]The operation was canceled.
```

Vercel's dashboard showed that same deployment **Ready, Production, built in
1m40s**, promoted twenty minutes earlier. The build finished; the `vercel` CLI
on the runner hung waiting to be told so, and the timeout killed the CLI rather
than the deploy. A re-run of the job deployed the same commit a second time,
which changed nothing and spent one deployment from the allowance.

So a CANCELLED deploy after a long `Completing…` is NOT evidence production
missed the commit. Check the Vercel dashboard for that SHA before re-running —
and if it is Ready and marked Production, there is nothing to do.

**AND A FIFTH KILLS `verify` ITSELF, FROM OUTSIDE THE REPOSITORY — `next/font` cannot reach
Google Fonts.** It reads as a compile error in your own layout, which is why it is here:

```
src/app/layout.tsx
An error occurred in `next/font`.
TypeError: Cannot read properties of null (reading '1')
    at .../@next/font/dist/google/loader.js:122:78
> Build failed because of webpack errors
```

`next/font/google` FETCHES the font CSS at build time, and the loader reads the response with a
regex. No network, a 429, or a truncated body and `.match()` returns null — hence the `reading
'1'`. Nothing in the repository is at fault and nothing in it can fix the run. The deeper frames
name the font: on 2026-09-21 it was `Oswald` from `layout.tsx`, the scoreboard face.

It struck TWICE within an hour, on two different commits and two DIFFERENT JOBS — `#550` on
`End-to-end (desktop)`, `#551` on `Build and smoke` — which is the tell. Every job that compiles
does its own build, so this can land on any of them, and the one it lands on decides which red
box you see.

Read it as environmental, not as your change, when any of these hold — all three were true both
times:

- a SIBLING job in the SAME run compiled the same SHA successfully. `Build and smoke` built fine
  while `End-to-end (desktop)` failed, and the next hour the reverse;
- the PR run of the identical content was fully green;
- the stack is entirely inside `node_modules/next`, with no frame in `src` except the `layout.tsx`
  the font is imported from.

`gh run rerun <id> --failed` on the same commit. Do NOT start editing `layout.tsx`, and do not
reach for `next/font/local` on the strength of one bad evening — that is a real change to how the
app is built, traded against an upstream blip. If it becomes frequent, self-hosting the two faces
is the fix worth costing, and then it is a decision rather than a reflex.

**DONE ON 2026-10-08, AND THE FETCH IS GONE.** It struck four times on 2026-10-07, past the
retry in `build-checked.mjs`, and the decision was made. Fraunces and Oswald now come from
`@fontsource-variable/*` on disk through `next/font/local` (`src/app/fonts.ts`), with the same
character ranges, the same preload, and the fallback metrics Google shipped written out in
`globals.css`. Measured against the last Google build: 0 differing pixels across every weight,
the italic, and every range. `font-hosts.test.ts` refuses a `next/font/google` import anywhere.
So an error in `next/font` after that date is NOT this fault; read it as a real one.

Same family as the `Client Manifest` fault two sections up and read the same way: the file it
names is noise, and what settles it is whether another build of the same SHA succeeded.

So read WHICH JOB failed before reading anything else. `verify` red is your change; `deploy` red
on a green `verify` is the token, the database, or the allowance, and the message names which.
A BUILD that fails inside `next/font` is none of them and is not yours either.
Nothing shipped unverified either way — `deploy` has `needs: verify` — but a commit CAN sit
undeployed until the next merge, so do not read "merged" as "live" without checking the run:

```bash
gh run view <run-id> --json jobs -q '.jobs[] | select(.name=="Deploy to production") | .conclusion'
```

**AND A GREEN PR IS NOT A GREEN COMMIT.** `gh pr checks <n>` answers "is this
PR green". On 2026-09-20 an auto-merge read it seconds after a second commit
was pushed to the branch, counted the PREVIOUS head's sixteen green checks,
merged, and `main` took the first commit only. The PR closed, the work looked
shipped, and nothing in the output said otherwise — it was found because a file
on the new `main` was missing a function it should have had.

Tie the verdict to a SHA at both ends:

```bash
head=$(gh pr view "$PR" --json headRefOid -q .headRefOid)
gh api "repos/$REPO/commits/$head/check-runs" -q '.check_runs[] | .status + ":" + (.conclusion // "pending")'
gh pr merge "$PR" --squash --match-head-commit "$head"
```

Two more things that cost time here. `--delete-branch` from a worktree fails
with `'main' is already used by worktree` on a merge that SUCCEEDED, so a
script reading the exit code announces a refusal over a merged PR — take the
verdict from `gh pr view --json state` instead. And afterwards, confirm the
work is actually on `main` rather than trusting the word MERGED:

```bash
git show origin/main:src/path/file.ts | grep -c theSymbolYouAdded
```

Related: `main` is exempt from `cancel-in-progress`. Two merges a minute apart used to leave
the first one's `verify` reading `cancelled` on a commit already in production — a deploy
with no verdict at all. Still right for the plainer reason that a cancelled check is a
missing verdict. Feature branches still cancel.

**That exemption protects a run that has STARTED, not one still queued**, and the difference
shows up the moment you merge a batch. GitHub allows one RUNNING and one PENDING run per
concurrency group; a third arrival cancels the pending one, and `cancel-in-progress: false`
does not enter into it. So merging nineteen PRs in thirteen minutes on 2026-09-05 left
**fifteen of them cancelled** — every one killed while queued, with zero jobs ever started —
and four green.

Nothing shipped unverified, and the reason is worth knowing rather than assuming: `deploy`
has `needs: verify`, so a cancelled verify means the deploy job never runs at all. Production
only ever received the commits whose gate actually went green, and because the last one is
the tip it carried everything before it. The gate held exactly as designed.

What it costs is the AUDIT TRAIL. `gh run list --branch main` now shows a wall of
`cancelled` against real merge commits, and nothing in that output distinguishes "cancelled
while queued behind a newer merge, never deployed" from "cancelled mid-flight on a commit
that went out" — which is the exact confusion the paragraph above was written to prevent.
Reading it later, you cannot tell which commits were ever verified.

So: **merge one at a time and let each `verify` finish** when the history needs to mean
something — a release, anything you may have to reconstruct afterwards. It costs about eight
minutes a PR. A batch merge is fine when you only care that the TIP is green, which is the
common case; just do not then read the run list as evidence about the commits underneath it.

To check whether a specific commit was verified, ask for its run rather than scanning the
list: `gh run list --branch main --json headSha,conclusion`. A commit with no successful run
was never verified, whether or not the code in it is now live under a later one.

The two mobile workflows are scaffolding, not pipelines. `android-release.yml` reads five
secrets and `ios-testflight.yml` seven; the repository holds NONE of them. (`gh secret list`
is no longer empty — it has held `VERCEL_TOKEN` since 2026-09-04 — so read the names rather
than the count.) Both are `workflow_dispatch` only, so nothing goes red on a push, but "Run
workflow" fails at signing. That is a missing certificate, not a broken file.

## What the tests enforce

The suite is not only about behaviour — several files exist to make a whole class of mistake
impossible. Extend these rather than working around them.

- `audit-idor.test.ts` — a row id an action is handed belongs to the caller: looked up with a
  scope key, or compared afterwards. That is ALL it asks. This line used to read "every server
  action checks authorization", which it does not: an action that takes no id is not its subject.
- `club-actions-check-the-role.test.ts` — an action that works on the caller's club asks their
  ROLE (`canEdit`), not only which club they are in. Added 2026-10-11 after deleting that check
  from one action left every guard green.
- `every-action-says-who-may-call-it.test.ts` — a staff action's gate comes BEFORE its first
  write, and an action with no staff gate is on a list that says who may call it (`WHO`). A new
  action cannot arrive ungated quietly. It proves a check is THERE, not that it is right.
- `the-directory-allowance-is-everyones.audit.test.ts` — every door to the live course directory
  draws on one hourly budget per person (`directoryBudget`), organizers included. The four
  directory actions are kept out of the every-action sweep because they spend that allowance —
  so they are the ones to read by hand whenever they change.
- `themes.test.ts` — every accent ramp and neutral ramp clears its contrast floor on both
  grounds, and stays monotonic.
- `brand-consistency.test.ts` — the logo is drawn once, at a size from `LOGO_SIZE`.
- `score-payload.ts` — scoring payloads are validated at the boundary. **TypeScript types are
  erased at runtime**; a `"use server"` export is a public HTTP endpoint and will be called with
  whatever the caller likes.
- `round-number-source.test.ts` — no screen derives a round number from a list position.
  `roundLabel` is the only count, and it does not count a cut as a round.
- `source-guard.test.ts` — **a test that searches source reads it through `readSource`**, from
  `src/lib/__tests__/source.ts`, which strips comments. Swept per file, so a new test file is
  covered the day it is added. See below for why.

**WHEN A CORRECT CHANGE MAKES AN EXISTING GUARD FAIL, READ THE GUARD BEFORE UPDATING IT.** A guard
that goes red on a change you have already proven right was asserting something false, and the
reflex — "update the test to match" — launders the old assertion into the new one. Three of these
in one day, 2026-09-21, none found by auditing tests and all three by changing code and reading
which cells went red:

```
audit-guards      required  roundTeeId(tees, event?.defaultTeeId)  in the net import
                  under a comment saying "required to use the ROUND's tees" — which is
                  what that expression was FIXING, not what it does. It is the
                  TOURNAMENT's set, so the guard held the door open in the name of
                  closing it
handicap-wiring   satisfied by a bare  courseHandicapMap(  in the team recompute, so it
                  could not tell the conversion being PRESENT from it being RIGHT
handicap-wiring   required  if (basis === "gross") return null;  in unratedWarning — and
                  that line was CORRECT. What it froze was the `basis: string` parameter,
                  which forced the caller to reduce a tournament's rounds to one answer
```

The third is the general case: **a source assertion freezes an interface, and an interface can be
the defect.** So pin the GUARANTEE, not the expression — the function a caller must go through and
the rungs it walks, never a spelling that could be either answer.

**AND ENUMERATE A STRING COLUMN'S REAL VALUES BEFORE NARROWING A TEST ON ONE.** Fixing the third
guard above, `!== "gross"` was replaced with the tidier `isNetBasis`, which is
`"net" || "both"`. `setScoringBasis` accepts FOUR values and the development database holds 2
`stableford` rounds, which are scored off a handicap — so the tidier spelling would have silenced
the warning for them: the same defect one value along, introduced while fixing it. `groupBy` on the
column is the check, not the schema comment, which said `gross | net | both` and was stale. Where an
unknown value should take the SAFE branch, prefer the negative test.

**Prove a new test can fail: revert the fix, watch it go red, put it back.** Six fixtures in one
pass could not fail — a card-venue test on gross match play (the card is never read), an
authorization test using a money mode that does not exist (every refusal passed on "Unknown money
setting"), a skins test with one player (nobody wins a skin either way). Each looked exactly like
a passing test of the fix, and each was counted as coverage.

**AND A MUTATION CAN STAY GREEN BECAUSE THE THEORY OF THE DEFECT WAS WRONG, which wears the same
clothes as a passing test.** A net-skins assertion said "Bob holds the pot and Ann does not"; the
mutation that priced the pot off the wrong club left it GREEN. Nothing was broken about the
instrument — Bob was on the higher index, so with identical gross cards he wins net skins off
EITHER club. What the venue changes is WHERE his extra strokes fall, because the gap between the two
moves with the slope: away he is alone on stroke index 8..15, off the host on 1..10. Re-pinned on
two holes, the mutation then failed with the received value `[1..10]` exactly.

So write the mutation before believing the assertion, and **when it stays green, suspect the theory
before the harness.** "What does this defect actually change?" is a different question from "is this
defect present", and a money test that answers only the second can be fully wired and prove nothing.

Mutate the WHOLE before-state, not half of it. Reverting one of two changed lines left the
headline case still passing: the rows were ordered wrongly but keyed the same, so they shared a
rank anyway. A mutation that models half the old code proves half as much as it appears to.

**And when the test reads SOURCE, the revert can stay green off your comment.** The prose above a
guard almost always names the guard, so `expect(src).toMatch(/checkRateLimit\(/)` goes on passing
after the call it pins has been deleted — the sentence describing the guard satisfies the
assertion instead. This is the one mutation failure that looks exactly like a mutation success:
the test is green, and you conclude the mutation was wrong rather than the test.

It happened twice on 2026-09-05, the second time in a test written by somebody who had been bitten
by the first that same afternoon. Hence `readSource`. Absence assertions are the safe direction
and need no help — a `not.toMatch` that a comment trips fails loudly.

The scale of it was measured rather than guessed, and the measurement is worth repeating whenever
this is in doubt: blank every comment in `src` and run the suite. In September 2026 that was 24,578
lines across 349 files and **4,268 of 4,268 still passed**, so eleven copies of a comment stripper
and 93 un-stripped reads had produced no live defect at all. Do that before believing a file count
means damage — the same discipline the course-card rules ask for, and for the same reason.

One trap in doing it: **blank the comments block-aware, and commit first.** A stripper that only
blanks lines starting with a marker leaves the body of any doc block written as plain indented
prose behind as dangling text, and three files stop parsing. And `git checkout -- src` afterwards
restores far more than the experiment — it discards every other uncommitted change in the
directory, which on 2026-09-05 cost a day's worth of conversions that had to be redone.

## Money: what may be reported while a round is live

`money-layout.ts` opens with the rule — final only, never live. The part that is easy to get
wrong is deciding what "final" means for a bet that is not skins, and the instinct is to ask
**has the event happened**. That is the wrong question. Ask **can the amount still change**.

A birdie already made does not un-happen, which reads like a licence to pay a birdie pot as the
cards come in. It is not. The pot divides by the counts RELATIVE to each other, so one birdie on
the 3rd shows a player holding all of it and four more across the field leaves them a fifth. The
event is settled; the amount is not, and the amount is the part the ledger states. Low gross and
low net fail the same test more obviously — `lowScoreWinners` compares only the cards with the
MOST holes played, so mid-round it pays whoever is furthest round, a leader dressed as a winner.

A Nassau passes both tests and is correctly paid LIVE. `nassauNets` pays only segments
`resolveMatch` calls complete, and a finished front nine cannot be re-decided by a back nine
nobody has started. Gating it would be withholding a settled result — the opposite failure, and
just as wrong. So judge each side bet on its own; they do not behave alike.

Enforce it at the SINK, as `gameNets` now does for both the skins pots and the derived ones. The
caller that had it right — `roundMoneyFor`, which gates on `roundMoneyIsFinal` — and the caller
that had it wrong — `moneyFor`, which gates nothing — were reading the same function, so a third
written later cannot get it wrong by forgetting. Same shape as `standingRows` returning `[]` on
its first line for a manual format.

One trap when reusing the round card's finality: `matchSettled` is satisfied by a match with ONE
hole on it. That is loose enough for "which round are we on" and far too loose to release money.

What a player may still see mid-round is their EXPOSURE — `stakeFor`, which reads membership and
never touches a card. That half is honest, it is what the player walking to the first tee
actually wants, and it must stay.

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

## Handicaps: an allowance is taken BEFORE rounding

Rules of Handicapping, 6.2a and Appendix C: a handicap allowance is "applied to the unrounded
Course Handicap as the final step", and the result is rounded once, a half upwards. For a format
with one team handicap (foursomes, greensomes, a scramble) the allowance is applied to each
partner's unrounded figure, the results combined, and the total rounded at the end.

Until 2026-10-13 the app rounded the course handicap, took the allowance of that, and rounded
again — **on purpose, with a comment saying so**, since the first handicap commit in August.
Measured over every index from 0.0 to 36.0 on four sets of tees:

```
                    95%            90%            85%
  a stroke out for  22-25%         22-23%         20-22%     of a field
```

in every net round with an allowance below 100, which is every individual net round and every
four-ball. The USGA's own example (8.6 and 10.3 off 71.0/125, par 71, at 85%) is 8 and 10; the
app said 9 and 9. The FAQ's worked example, headed as the calculation most golf software gets
wrong, printed 14 where the Rule gives 13.

**What to carry forward:**

- **The figures live in two forms and only one may meet an allowance.** `courseHandicap()` is the
  whole number a player is told; `courseHandicapExact()` is what it was rounded from. A field's
  handicaps are a `CourseHandicaps` — a `Map` of whole numbers, with `.exact(id)`. A round's
  answer is `resolveRoundHandicap(...).exact`, or `roundHandicapExactOf(row, whole, exact)`. A
  side member carries `handicapExact`, and `playing` where they play their own ball. **Never
  hand `playingHandicapFrom`, `allocatedStrokes` or `sidePlayingHandicap` a rounded figure**;
  `allowance-is-taken-of-the-exact-figure.test.ts` reads every caller, and refuses the
  arithmetic written out by hand anywhere but in `domain/handicap.ts`.
- **A whole number is right where a whole number is all there is**: a committee's own figure for
  the round (the Rule's exception covers it), and a round frozen before the exact figure was
  kept. `RoundHandicap.frozenExact` is written in the same statement as `frozen`. A reader that
  selects `frozen` and not `frozenExact` prices a frozen round a stroke differently from the
  board for one player in five.
- **`wholeStrokes()` is the only rounding.** 33.9 off an 85 slope is 25.5 exactly and arrives as
  25.499999999999996, which a bare `Math.round` calls 25.

**Why eleven thousand green tests could not see it, three ways:**

- **Nearly every fixture hands the engine a WHOLE-number handicap**, where rounding first and
  rounding last cannot differ. A golfer's index has a decimal place. That is an axis, and nothing
  walked it. `allowance-is-taken-of-the-exact-figure.test.ts` walks every tenth from plus 5.0 to
  54.0, on six sets of tees, at nine allowances, against the Rule worked in WHOLE NUMBERS
  (everything is an exact count of 113,000ths of a stroke) so that it shares neither formula nor
  floating point with the code.
- **The tests that did use an index worked out what to expect the way the app did.** Three
  database-backed tests had a helper `playing(tee) = playingHandicapFrom(roundedCourseHandicap, 95)`.
  A test that derives its expectation by the code's own method agrees with the code whether or
  not the code is right. Work the expectation from the RULE, by a route the code does not take.
- **"On purpose" in a comment is not a decision, and neither is a reason that sounds right.** The
  comment argued that the rounded figure is "a real, quoted number a player is told on the first
  tee". True, and beside the point: the Rule says what the allowance is taken of. When a comment
  defends a calculation, check the calculation against the SOURCE it is supposed to follow, not
  against the comment's own reasoning. It was found by writing a browser test that refused to
  take the board's word for the board.

And the guard that was already there: the score-entry screen had this arithmetic written out by
hand, in a file whose own test bans a second pipeline on that screen. The test banned a function
NAME (`playingHandicapFrom(`); the copy was spelled `Math.round((courseHandicap * pct) / 100)` and
walked past it for months. **Ban the shape, not the spelling** — the new sweep matches a handicap
multiplied and divided by a hundred, and has a control proving it recognises all three of the
lines it replaced.

A round frozen before that date keeps the strokes it was played off. See
`docs/deferred-register.md` for the neighbouring things seen and left alone.

**An individual net round has its allowance on its card, as a team round does** (2026-10-13;
Appendix C lets a field under thirty play at 100%). `individualAllowanceFor()` in
`round-allowance.ts` says which rounds have the line, `roundTakesAllowance()` is the same list
asked by `setStageAllowance` before it stores a figure — a gross medal, a singles match, skins
and a round scored by hand are refused — and `allowanceSaid()` is the one sentence both panels
print. The control was missing while the guide said it was there: **a sentence in the help that
names a control is a claim about a screen, and `guide-steps.test.ts` checks the buttons it names,
not the place it says they are.**

**AND THE FIGURE ITSELF DEPENDS ON THE ROUND, NOT ONLY ON THE FORMAT.** Appendix C gives a
four-ball 85% at stroke play and 90% in a match. The format table holds one number per format and
for Four-Ball held the match-play one, so a four-ball medal was offered 90% as "the recommended
allowance for this format" — and the seeded club's own four-ball round carried 85% "set by your
committee, in place of the usual 90%", typed over the app's figure by whoever wrote the fixture.
A fixture that has to correct the app is a finding nobody filed. `round-allowance.ts` is the one
reader (`recommendedAllowance(format, stage.type)`, `effectiveAllowance(format, override,
stage.type)`); the round's type is a required argument, so a caller cannot ask the format alone,
and `round-allowance.test.ts` refuses a file that reads `findFormat(x).allowance` for a round.
Best Ball's figure for a side of four is still not the table's — see the register.

**And the table is read against the SOURCE each time, not against the test that says it was.**
`handicap-allowances.test.ts` held the scrambles to being "a club convention, not a published
standard", with a paragraph explaining why that was the honest thing to say. Appendix C has carried
a scramble of four (25/20/15/10) and of two (35/15) for years, and the 2024 edition added a scramble
of three at 30/20/10 — where the app played 25/20/15, the four's shares with the last one dropped,
which is nobody's table. A test that asserts a fact about the Rules is as dated as the day somebody
last read the Rules; the header of that file says when.

## Tees of a higher par, and who chooses the tees

**A PLAYER ON TEES OF A HIGHER PAR IS GIVEN THE DIFFERENCE.** Rules of
Handicapping 6.2b: where the field plays sets of tees with different pars, in
stroke play or match play counted in strokes, a player on the higher par receives
the difference as extra strokes, AFTER the allowance and with no allowance taken
of it. None where a round is counted against par (Stableford).

The app gave none until 2026-10-13. Its own seeded medal is men off par 71 and
ladies off par 72: every lady was a stroke short, and `boards-by-the-rules.spec.ts`
— the test that works a board out "by the Rules" — agreed with the board about
all of them, because its author had read 6.2a and stopped. **A test worked from
the Rules is as complete as the Rules somebody read.** It was found by asking the
golf professional what the tests left out, not by any test.

- `roundPlayingHandicap(exact, allowance, parStrokes)` is what a round is priced
  with. The third argument is REQUIRED: thirteen places worked out a playing
  handicap, and each now says whether the strokes for the pars are in it.
  `playingHandicapFrom` is the arithmetic of an allowance and nothing else, and
  `tees-of-a-higher-par-get-their-strokes.test.ts` refuses it anywhere a round is
  priced.
- **The lowest par is the FIELD's, not the map's.** Nine readers build their
  handicaps from five different groups of players — everybody, one skins pot, one
  side, the two players of a match — and "the lowest par among the players I
  hold" is a different number for each. A pot of two ladies, both off 72, finds
  no difference and gives neither the stroke the board gives both; a skin is won
  hole by hole, so that is a different hole in a different pocket.
  `roundCourseHandicaps` REQUIRES `field`, and `confirmedField(eventId)` supplies
  it.
- `parStrokesApply(format, scoringBasis)` asks the BASIS as well as the format: a
  four-ball can be set to Stableford, and a stroke round can be stored the older
  way as points.
- A round that has frozen keeps what it froze (`RoundHandicap.frozenParStrokes`).
  A round frozen before that column existed reads nought and keeps its nets.

**THE ORGANIZER DECIDES THE TEES, AT THREE LEVELS** (Ajay, 2026-10-13): the
tournament's; a flight may override; the organizer may move one player. Where the
course has a ladies' set, a woman nobody has put elsewhere plays it — a DEFAULT
between the flight and the tournament, not a level. `teeIdFor` is the one
resolver and the ladies' rung is a required argument of it, which is how the
compiler found all five places that resolve a tee.

What prompted it: an ENTRANT could set their own tees through three doors — the
Preferred tee box on the public form, a member entering themselves, and adding a
member from the roster — each storing free text as the player's own set, where it
beat the flight's. Every test of tees was green over it, because every one put a
player on a set and asked whether it was honoured. **None asked who had put them
there.** When a rule is about who may decide, the test has to walk the doors,
not the outcome: `the-organizer-decides-the-tees.test.ts` finds every write to a
Player row in the app and allows exactly one to set tees.

- Nothing creates a player with a `teeId`. `setPlayerTee` is staff-only whatever
  the settings say. "Players choose their own tees" is retired; a tournament
  stored with it reads as `own`, which is how it was scored.
- Every reader of a round selects `FIELD_PLAYER`, which carries `gender`. Do not
  write the column list out again: a reader that left `gender` off would put a
  woman on the tournament's rating while the board had her on her own.
- What was left out on purpose is in `docs/deferred-register.md`.

## One rule, one place

Ajay, 2026-10-13, after the two above: "make sure the underlying pieces/modules
are in line and built as shareable vs every screen/function/round using different
logic or their own way" and "start from the basic and then move step by step up".

The browser tests found neither fault above, because every screen was right on
its own terms. **Two screens answering one question differently is the class a
screen test cannot see**, and it was three of the day's findings: thirteen places
pricing a round, nine readers with five fields, five builders of a flight's tees.

`docs/one-rule-one-place.md` is the inventory (measured, with file and line) and
the order: what people type, the field, the venue, handicaps, a card, a round,
across rounds, money, what screens say. For each rule the shape is the same:

1. **One function holds it, and takes what it needs as REQUIRED arguments**, so
   that the compiler lists every caller the day the rule grows. An optional
   argument is a caller free to forget.
2. **One test worked from the Rules of Golf**, by a route the code does not take,
   on the axis the fixtures have been missing.
3. **One sweep that refuses a second copy**, with a control proving it can see
   one.

And two cautions this file already carries, which apply to every step of it: a
single reader must be pinned to the RULES, because readers that agree by
construction agree whether or not they are right; and a dead twin of a live rule
(`courseHandicapForPlayer`, deleted that day with no callers) is a second copy
waiting to be used.

## Course cards: measure a guard before you ship it

A wrong card is invisible — a bad stroke index allocates shots to the wrong holes for the
life of the course — so the instinct is to add another check. **A guard that refuses a real
golf course is worse than no guard**, and on 2026-08-23 four separate plausible-looking
guards would each have thrown one away:

- a par range that assumed a regulation course, which made **par-3 courses** unstorable
  (9 holes = 27, 18 = 54);
- sorted-par detection on a **nine**, where 3,3,3,3,4,4,4,5,5 is a real executive routing,
  not a scrambled card — nine values across three pars is too small a sample;
- treating a **flat card** as a placeholder, when every one in the catalogue was a genuine
  par-3 course with a real per-hole stroke index;
- refusing a card that disagreed with the source's own stated par, whose single observed
  catch was a **real par-72 course** whose `par` field described one nine.

The yardage version of this actually landed: a re-validation pass cleared 33 good cards
because their yardage was missing or odd. Yardage is optional and nothing scores off it —
it must never be why a card is thrown away.

So before adding or tightening a card rule:

1. **Judge the real catalogue first, READ-ONLY.** `--revalidate` is not a report — it
   **DESTROYS every card it refuses**, writing `pars`, `yards` and `strokeIndex` back as
   empty strings. That is precisely how 33 good cards were lost, and re-fetching them costs
   API quota at 500 requests a day. This file used to describe it as costing no quota and
   say nothing about the wipe, which reads like a safe check. It is not one.

   So write a throwaway script that reads `courseCatalog`, calls `cardRefusal` on each row
   and PRINTS what would go — no `update` anywhere in it. Run that, read it, delete it.
   Against 892 stored cards on 2026-09-04 it took seconds and refused nothing, which made
   the real command a proven no-op before it was run.
2. **Look at what it would refuse, by name**, before believing the count — which is only
   possible if step 1 came first. A rule that clears a large slice is wrong about golf, not
   right about the data.
3. **Use `cardRefusal`** — do not reimplement the range in a script. An ad-hoc checker that
   omitted the par-3 exemption reported three good courses as failures. Judge pars and
   stroke index only: pass an empty yards array, exactly as `revalidateStored` does, or the
   range check on yardage takes good scoring data down with it.

## Migrations

`schema.prisma` splits the datasource: `url` is the pooled connection, `directUrl` the direct
one. Migrations need the direct URL — advisory locks and DDL cannot cross a pooler.

Before creating a migration, read the SQL it generated. Prisma emits everything it considers
drift, so an unrelated `DROP DEFAULT` can ride along with a one-line change. If that happens,
fix the *schema* so it matches the database rather than accepting the drop.

**NAME A NEW MIGRATION `A001_…`, `A002_…` — never `100_` and never Prisma's timestamp.** A fresh
database (CI makes one on every run) replays the folders in TEXT order. Two digits ran out at
`99_`, and `100_` sorts before `10_`; a timestamp name sorts between `19_` and `20_`, where 26
of them already sit from August and September — history, which replays there and works, and
is left as it is. A capital letter sorts after every digit, so `A000` to `A999` replay after all
of it, then `B000`. `migrations-replay-in-the-order-written.test.ts` refuses anything else. When
`prisma migrate dev --create-only` names one by timestamp, rename the folder before applying it.

**A new model means restarting the dev server, not just recompiling.** A running Next process
holds the generated client in memory, so `prisma.yourNewModel` stays `undefined` however many
times the page hot-reloads — and the screen fails with `Cannot read properties of undefined
(reading 'findMany')`, which reads like a bug in the query rather than a stale process. It
happened twice on 2026-08-22, to `courseCatalog` and then `honoursEntry`. It never reproduces
in production, because a deploy is always a fresh build.

So after `prisma migrate deploy`: `npx prisma generate`, then stop and restart the dev server
before believing anything the browser tells you.

## Design

- Two grounds, one set of tokens: `DARK_GROUND` and `LIGHT_GROUND` in `src/lib/themes.ts`.
  Components read `--color-*` custom properties and never hard-code a colour.
- The ramp reverses between grounds, so low steps are always foreground and high steps always
  background, whichever ground you are on.
- **The club's one setting drives the console and the public board.** `themeCss` is their
  stylesheet, so a club that picks its look gets it on every organizer screen and on `/live`.
  `auto` resolves dark unless the device asks for light. There was briefly a `playerThemeCss`
  resolving auto light-first; it made one club look like two products.
- **The player app wears the club's theme too — reversed 2026-09-24.** For five days
  (2026-09-19) it wore a fixed hand-hung scoreboard, the same green field at every club; Ajay's
  call since is one club theme, chosen once in settings, on the console, the public board AND the
  player app. `(player)/layout.tsx` renders `themeCss` and says why. This entry described the
  fixed scoreboard as current until 2026-10-10, and the organizer's guide repeated it to clubs —
  found by reading the first sheet of the printed guide, not by any test.
- **Outdoor legibility is a product requirement, not a nicety.** Scores are read on a phone in
  direct sun, and `SUNLIGHT_RATIO` is 7:1 on the dark ground against 4.5 on the light one.
  `sunlightVerdict` grades whatever ground the theme actually renders — so `auto` is graded as
  dark, and a club failing the bar is told that switching to Light is the remedy.
- Grid and flex children need `min-width: 0` to be allowed to shrink; `minmax(0, 1fr)`
  constrains the track, not the item. Anything wide (tables, scorecards) gets its own
  `overflow-x: auto` wrapper, so the page body never scrolls sideways.

## Shell

Windows. Both PowerShell and Git Bash are available and take different syntax — do not mix them
(a PowerShell here-string in bash silently becomes part of the string). Node needs
`PATH="/c/Program Files/nodejs:$PATH"` under Git Bash.

**Never rewrite a source file with PowerShell.** `Set-Content -Encoding utf8` adds a BOM and
re-encodes every em-dash and curly quote as mojibake. It corrupted `stage-types.ts` once and
seven page files later the same day, both times invisibly — the code still compiled and the
tests still passed. Use the Edit tool, however many files it takes. The tell is
`git diff --stat`: a one-line change showing seventy.

**The READ is what corrupts, so no output encoding saves you.** `Get-Content -Raw` decodes with
the system ANSI codepage, not UTF-8, so an em-dash (`E2 80 94`) comes back as three CP1252
characters before anything is written. Round-tripping through
`[System.IO.File]::WriteAllText` — which writes correct, BOM-free UTF-8 — then stores those
three characters faithfully, and the file is double-encoded. On 2026-09-05 that took out three
files and reached three PUSHED branches, because the rule above names `Set-Content` and this is
not `Set-Content`.

The trap is that it looks like the careful way to do it. `$o = Get-Content $f -Raw` … edit …
`WriteAllText($f, $o)` is the obvious shape for "mutate a file, run the test, put it back",
which is exactly the mutation-testing loop this file asks for on every change. Use `git` for
that instead — `git checkout -- <file>` restores far more reliably than a saved copy, and it
cannot re-encode anything.

So: **PowerShell may READ a source file for inspection and never write one back.**
`Select-String`, `Get-Content | Select-Object` and friends are fine; any path where bytes leave
PowerShell and return is not, whatever function does the writing.

Detecting it: `git diff --stat` shows the whole file changed, and
`([regex]::Matches([System.IO.File]::ReadAllText($f),'â€')).Count` is non-zero. Note that
PowerShell's own console rendering shows `â€` for a correct em-dash too, so the terminal is not
evidence either way — check a file with that command, or `git show HEAD:<file>`, before
believing there is a problem or that there isn't.

**A `node -e` string replace on a checked-out file usually does nothing, and says so quietly.**
Files land here with CRLF — git converts on checkout — so a replacement written with `\n` in the
search string matches nothing, `writeFileSync` writes the file back unchanged, and the command
exits 0.

That is a nuisance when editing and a LIE when mutating. The mutation-testing loop this file asks
for on every change is "break it, watch the test go red, put it back", and a replace that silently
did not apply produces a GREEN run that reads exactly like "the test cannot catch this" — the one
outcome that makes you weaken a good test. It happened three times on 2026-09-07, once on a
freshly written guard that was in fact perfectly capable of failing.

So when a script edits a file:

  - **print whether it changed** — `console.log(before !== after)` — and read it;
  - **verify with `grep -c` before AND after**, not just the exit code;
  - or, better, use the Edit tool, which fails loudly when its target is not found.

A mutation you did not confirm applied is not evidence about anything.

**AND THE SAME TRAP EATS REGEX ESCAPES, which is worse, because the result is
a script that runs and lies.** The note above is about `\n` against CRLF. On
2026-09-13 the same shell swallowed three more, each failing differently:

- `\\b` inside a heredoc reached node as `\b`, which in a JS string is a
  BACKSPACE. A sweep of 211 server actions for callers reported **211 of 211
  unreachable** — every regex was `<0x08>name<0x08>` and matched nothing.
  Believed for about a minute, because "nothing is called" is a plausible
  answer to a question you have not asked before.
- The same `\b`, written into a TEST FILE, put literal `0x08` bytes in the
  source. `/\bon\s+at\b/` became `/<0x08>ons+at<0x08>/` — still a valid regex,
  still passing, asserting nothing. It would have shipped as a green dud.
- `\s` and `\(` were stripped outright, producing
  `new RegExp("...(\"...")` — an unclosed group, which at least throws.

Detect the middle one with a control-byte scan; it is invisible in a diff:

```bash
node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");console.log([...s].filter(c=>c.charCodeAt(0)<9||(c.charCodeAt(0)>13&&c.charCodeAt(0)<32)).length)' <file>
```

The rule that actually works: **anything containing a backslash goes through
the Write or Edit tool, never through a heredoc or `node -e`.** Where a script
must match text, prefer `indexOf` / `includes` / `split` — none of them need an
escape, and a sweep built from them cannot be silently disarmed.

**A REBASE CAN REFUSE OVER A FILE THAT HAS NOT CHANGED, and `git diff` shows
you nothing.** Measured 2026-09-15 in a worktree, during the `Group` migration
work. `git rebase` refused with:

```
error: cannot rebase: You have unstaged changes.
```

naming `prisma/migrations/migration_lock.toml` — a file whose content was
BYTE-IDENTICAL to HEAD. `git diff` showed **no hunks at all**. `prisma migrate`
had rewritten it with different line endings, so the working-tree blob and the
index blob differ while the text does not.

That last part is the whole reason it costs an hour rather than a minute. Every
instinct says a refusal means there is a change to find, and there is nothing to
find — so the time goes on looking for a diff that does not exist rather than on
the line endings.

**Both of the obvious escapes are closed here**, which is worth knowing before
reaching for either:

- `git stash` is hard rule 5 — the stash stack is shared with the main checkout
  and every other worktree;
- `git checkout -- <file>` is the command that on 2026-09-05 took a day's
  uncommitted work along with the experiment it was meant to undo.

The fix is:

```bash
git add --renormalize prisma/migrations/migration_lock.toml
```

It re-stages the file through the repository's EOL rules; when the normalized
blobs match — which is the whole point, since the content never changed — the
entry collapses to nothing and the rebase proceeds. Non-destructive, touches no
other file, and it does not go near the shared stash stack.

Read the shape rather than the filename: **any tool that rewrites a file it
also owns** can do this. Prisma is simply the one that did.

**A SWEEP THAT FINDS NOTHING MAY BE BROKEN, so give every one a control.**
This is the same discipline as proving a test can fail, applied to the
instrument instead of the subject: assert that something you KNOW the sweep
should catch is caught, in the same run that reports the count. Three sweeps on
2026-09-13 were measuring nothing, and only the ones with controls said so —
the reachability sweep now asserts `addExpense` reads as called, and the money
sweep asserts four known money actions are found at all.

A control also catches the quieter failure, which is a sweep that is merely
NARROW. `money-leaves-a-trail` first used the model name `skinsPotEntry`; the
schema says `SkinsEntry`, so it skipped the two actions writing a player's
STAKE — the sharpest rows in the file it was aimed at — and reported the app
cleaner than it was. It checks every model name against `schema.prisma` now.

**THE SAME FAILURE WEARS A SECOND COSTUME: A CHECK THAT CAN PASS WITHOUT THE
CONTENT EVER ARRIVING.** A sweep with no control reports zero because it is
looking for the wrong thing; a content check does it by never receiving
anything to look at. The output is equally calm either way.

The shape to recognise is a UNIFORM, PLAUSIBLE, NON-ERROR STATUS across every
target. On 2026-09-14 a script fetched six screens to confirm a long fixture
name rendered, and printed a tidy "no mojibake, no problem" for all six. Every
one had returned **307**: the cookie was signed with `local-e2e-secret` while
the dev server on 3100 verifies against the secret in `.env`, so each request
was redirected to sign-in and each screen was then searched as an empty string.
It read as "checked six screens" and was "checked nothing". A 500 would have
been obvious; a redirect is a success and looks like the app working.

So when a script fetches an authenticated screen: sign with
`node --env-file=.env` against the dev server, `AUTH_SECRET=local-e2e-secret`
against the e2e one on 3101, and **assert the status is 200 before asserting
anything about the body**. A check that reports an absence of problems in an
absence of content is the same bug as a sweep with no control.

**And the mirror: a detector too LOOSE reports a defect that is not there.**
The same script flagged eight mojibake hits on `/entry`. They were the word
"Château" — U+00E2 is a correct French letter, and the check grepped for a bare
one. Real mojibake from the PowerShell round-trip above is U+00E2 followed by
U+20AC, or the U+00C3 family. Check the codepoints either side before reporting
anything — and when you write that warning down, spell the sequence as
CODEPOINTS rather than as the characters, or the file explaining the defect
becomes the first hit of every future sweep for it. That is the `readSource`
trap one layer out.

THIS FILE IS THE EXCEPTION AND KNOWS IT: the PowerShell detection command
above quotes the sequence literally, because a command you cannot paste is not
a command. So CLAUDE.md is the expected first hit of any mojibake sweep and
must be excluded from one deliberately rather than investigated. Everywhere
that is not a runnable command, use the codepoints.

**SWEEP THE CLASS, NOT THE INSTANCE.** Walking screens and fixing what you see
finds defects at a constant rate for ever; it never converges, because the pool
is large and you are sampling it. Sweeping a whole class finds all of it at
once and then the class is closed. On 2026-09-13, four classes swept in a day:
links (22 of 22 fine), absolute claims against deliberately-incomplete data
(nothing new), unreachable server actions (8 — five deleted, one real money
bug, two missing features), and money writes with no audit line (ten, including
the whole of `skins.ts`). The first two came back clean, which is itself the
result worth having: it is how you learn a class is finished.

**AND STILL — WALK THE SCREENS, because there is one class no sweep sees.** The
paragraph above is about not SAMPLING when you could be closing a class, and it
stands. It is not an argument against looking, and on 2026-09-18 six screens
walked with the fixture in front of them turned up two defects that 7,682 unit
tests, 1,194 audit tests, the smoke pass and Playwright had all passed:

- club settings showed **Staff 0** while the plan allowance on the SAME page
  counted two. A club on the free plan is refused the next person it adds by a
  limit its own screen has just said it is nowhere near;
- the league week read **"4 of 4 in have returned a card"** and printed
  "thru 9" for one of those players two lines below.

Both are the same shape, and it is the shape a test suite is blind to by
construction: **two screens, or two panels of one screen, answering the same
question with different numbers.** Every function involved is individually
correct, every test of it passes, and nothing anywhere compares the two
answers. That is a class, and the only instrument that finds it is a pair of
eyes on real rows.

```bash
node --env-file=.env scripts/look-at-screens.mjs           # seed + cookies
node --env-file=.env scripts/look-at-screens.mjs --teardown
```

It seeds the e2e fixture into the development database and prints the cookies
to paste in. It **refuses any database whose host is not localhost** — checked
on the host, because a password can contain the word — since a seed pointed at
production cannot be undone from here.

**KNOW WHICH SESSION THE BROWSER IS HOLDING BEFORE YOU BELIEVE A SCREEN IS
WRONG ABOUT YOU.** On 2026-09-20 about fifteen tool calls went into a defect
that did not exist: `/me/money` read "You aren't in this tournament's field, so
you have no stake in its pots" while the expense table directly beneath it
listed the signed-in name with a £25.63 share, and the database said that
person was `confirmed` in that event. Three independent checks agreed the
screen was lying.

The tab was holding the ORGANIZER's `ng_session`, not the player's. The
organizer is genuinely not in that field, the shared costs are deliberately
visible to everyone, and every word on the screen was true about a person I had
not checked I was. The tell was on screen the whole time — an "Organizer" badge
in a shell I believed I was reading as a player.

Three things make this easy to walk into, and all three are worth knowing:

- a cookie set an hour ago is still in the jar, through navigation and a
  dev-server restart, and it may belong to somebody other than the person you
  think you are testing as. (A reseed is the other half of the same trap from
  the opposite side: the VALUE survives while the row it names does not, so
  every cookie minted before the reseed now resolves to nobody.)
- `ng_active_event` is **HttpOnly** — `document.cookie` can neither read nor
  set it, so switching tournaments from the console is impossible and has to
  go through the app's own switcher (`/me/events`, or Manage on `/tournaments`);
- a stale `session=` cookie from an earlier fixture silently outranks the
  `ng_session` you just set.

So read `document.cookie` and confirm the user before concluding anything about
identity, entry status or permissions. It is the same class as the 307 trap
above — a check that runs cleanly while answering a different question from the
one asked — and it fails in the more expensive direction, because it invents a
bug rather than hiding one.

Two things make it worth the four minutes: read the numbers on a screen
AGAINST EACH OTHER rather than against your expectation, and follow anything
that disagrees to the two functions producing it. The staff number took about
four seconds to notice and an hour to prove; the noticing is the part no test
does for you.

## Testing: the combination sweep

The 2026-08-12 audit found ~80 defects against a suite of 1400 passing tests.
Almost none were in a function that was individually wrong — they were in
COMBINATIONS nobody had a test for: a nine-hole round inside an eighteen-hole
tournament, a format on a stage type with no engine, a cut sized against a
field that no longer exists, a two-player event drawn into two flights of one.
Unit tests cannot find that class of bug, because every part behaves correctly
on its own.

So, for any change to scoring, draw, cut, bracket or handicap code:

1. **Add the cell to `src/lib/__tests__/matrix.test.ts`, not a bespoke test.**
   It enumerates format x stage type and runs brackets, cuts, flights and
   standings at 1, 2, 3, 4, 5, 6, 7, 8, 16 and 28 players, asserting
   INVARIANTS rather than features — ranks contiguous, no NaN, a cut never
   exceeds the field, a bracket winner is in its own match, no flight of one.
   A new format is then swept the day it is added.

2. **Field sizes start at ONE.** A one-player tournament, a two-player round
   robin and a three-player knockout are where the off-by-ones live, and the
   suite went no lower than a comfortable eight for a year.

3. **Assert against the Rules of Golf, not against current behaviour**, and put
   the citation in the comment. Several bugs survived because a test asserted
   what the code did. Two fixtures encoded matches that cannot happen —
   `H("AAAAABBBB")` is A five up with four to play, so the match ended 5&4 and
   B cannot then win four holes.

4. **Layout is swept from the filesystem** (`e2e/layout.spec.ts`), not a
   curated list. The hand-written list covered 14 of 22 routes; the eight it
   missed had no layout assertion at all. Do not reintroduce a hand list.

5. **A guard you must remember to call is a guard that will be forgotten.**
   `isManualFormat` was exactly that, and one of seven result paths forgot it —
   `services/me.ts` handed a player a rank, a "T2" and a to-par for a round the
   leaderboard refuses to score, so the screen contradicting the organizer was
   the one the player looks at.

   FIXED, and the shape of the fix is the point. It is checked at the SINK now:
   `standingRows` returns `[]` on its first line for a manual format, and
   `strokeRounds` keeps manual formats out of the cards that feed
   `strokeStandings` at all. So a caller written later is correct without
   knowing the rule exists — the tee sheet's "by position" grouping reads
   `strokeStandings` directly, has no guard of its own, and is safe because
   there is nothing there to rank. Checked again 2026-09-04.

   Prefer that shape. A rule enforced where the data is built cannot be
   forgotten by a caller; a rule documented in a comment will be.

6. **A green cell is not a checked cell — this file is UNEVEN.** Half of it
   asserts VALUES over a fixture built so a wrong answer looks different.
   `tee policy` computes the expected course handicap from the ratings, asserts
   both branches, and asserts the two tees differ so passing cannot be an
   accident of them being equal. `forfeits` halves every other match, so a
   credited hole can only have come from the concession. `round handicaps`
   asserts the exact number, source and editability. Those cells earn their
   green.

   The other half asserted only SHAPE, and on 2026-09-04 four blocks were each
   found to pass a materially wrong answer:

       season      ranked on a raw sum — a side won the league by missing weeks,
                   and the absentee was also the best scorer, so no assertion
                   could tell "top for the right reason" from "top for the wrong"
       standings   the whole leaderboard inverted, loser first — every match in
                   the fixture was halved, so nobody ever won anything
       brackets    seeds 1 and 2 drawn against each other in round one —
                   "every seed exactly once" is satisfied by 1,2,3,4,…
       cuts        the bottom of the field advancing instead of the top — the
                   COUNT is identical either way, and only the count was checked

   All four passed a 598-cell suite. Size, count, contiguity and membership are
   cheap to satisfy; being right is not.

   So before trusting a cell: **mutate the thing it covers and watch it go
   red.** If it stays green the fixture cannot express a wrong answer, and the
   cell is decoration however many sizes it runs at.

7. **AN ERROR THAT SHIFTS EVERY ROW BY THE SAME AMOUNT IS INVISIBLE TO THE EYE
   AND TO THE ORDERING TESTS**, which makes it more dangerous than one that
   scrambles the order. A wrong order produces an argument and an argument
   produces a bug report; eight plausible numbers in the right order produce
   nothing at all.

   Measured 2026-09-20, on the seeded club's first round played away from its
   event's course. Every side's to-par on the leaderboard was out by exactly
   four — a nine at Ardmore, par 32, scored against Braid Hollow's front nine,
   par 36 — and the RANKING was untouched, because a constant offset cannot
   reorder anything. Eight sides, correctly sorted, every number wrong, on the
   screen a club sends to its members.

   Nothing in eight thousand tests could see it: they assert shape, count and
   order, which a constant offset preserves perfectly. That is point 6 on the
   value axis rather than the shape axis.

   Two consequences worth acting on. **Net totals cannot see a stroke-index
   bug at all** — a side receives the same NUMBER of strokes whichever card is
   read, so net is gross minus a constant and is blind by construction; assert
   to-par, a Stableford point, a skin or a match hole instead. And when a
   number looks plausible on every row, check one row against the RULES rather
   than against the other rows: agreement between rows survives an error they
   all share. That cost twenty minutes on the day it was found — the week
   sheet and the leaderboard printed identical gross and net for the away
   round, which read as confirmation and was two readers wrong the same way.

   **A STABLEFORD POINT IS NOT A STABLEFORD TOTAL, and the sentence above is
   only right about the first.** A stroke is worth exactly +1 point wherever
   it falls, so moving every stroke on a card from the hardest holes to the
   easiest leaves the TOTAL untouched. Measured rather than reasoned: an
   eighteen-hole card, bogeys on the first four and pars after, scores 33
   either way. The total moves only where the points FLOOR at zero — put a 9
   on that hole and the stroke is wasted on it, and the same card scores 33
   against 34. So a Stableford total is nearly as blind as net, and for a
   different reason; the per-hole point, a skin, a match hole or to-par are
   the assertions that actually see allocation.

   **HOW MUCH OF THE SUITE CAN SEE IT, measured 2026-09-20** by flipping
   `holeStrokesReceived` to allocate onto the EASIEST holes — the same NUMBER
   of strokes, so every gross and net total is byte-identical. **18 of 8,151
   unit tests and 13 of 1,258 audit tests go red**, across the allocator,
   `cardForStage`, the entry screen's dots, the nine-hole wrap, team cards, a
   rendered screen, and — in the audit suite — net skins, the money, a match's
   own venue, the net import and a league that rotates venues. That is the
   coverage this section asks for, and it is worth re-running the same
   mutation after any change to stroke.ts rather than assuming it still holds.

   **AND CONSOLIDATION TAKES THE COMPARISON AWAY, which is the price of the
   fix this file otherwise recommends everywhere.** Eight callers resolving a
   card three different ways can be caught by diffing two screens; eight
   callers behind one resolver cannot, because they now agree by construction
   — and they agree whether the resolver is right or wrong. "One model per
   act" is still correct, and the note on `standingRows` returning `[]` at its
   own first line still holds. But a single reader must be pinned to the RULES
   rather than to its peers: after the team-card consolidation the only test
   that can still fail is one asserting to-par against the played course's
   actual par, because every screen will now agree on whatever it says.

   **THAT NUMBER IS FIXED, AND THE CAUSE WAS ONE ARGUMENT.** `cardForStage`
   takes which NINE and how many HOLES off the stage — which is what its own
   docstring is about — and leaves the COURSE to the caller. Five callers
   handed it the tournament's: both console boards, the public board and the
   league week sheet, carrying the skins and Modified Stableford boards with
   them, because those read the same local's stroke index. Every WRITE path
   already walked round then event through `courseForRound`, so the stored
   strokes were honest and only the reports were wrong.

   Three of the five had the right answer in scope the whole time.
   `state.strokeCourseFor(stageId)` is resolved per round and cached on
   `EventState`, and it is what the individual stroke board on those same
   screens reads — so one board disagreed with the other half of itself. The
   guard is `nobody builds a round's card straight from the tournament's own
   course` in `audit-guards.test.ts`, with a control; the VALUE is pinned in
   `board-scores-the-round-venue.audit.test.ts` against the played course's
   par, exactly as the paragraph above asks.

   `regroup.ts` stays event-level on purpose and is the one exemption: it
   resolves a single stroke index for a CHAIN of qualifying rounds, which has
   no one card to be resolved per round. `week-view.ts` documents the same
   exemption for its match tiebreaks.

8. **ASK WHICH TABLE THIS ROUND FILES ITS RESULT IN, BEFORE BELIEVING ANY
   COUNT.** There are FOUR, and on 2026-09-20 six separate readers were asking
   a true question of one that is empty for the round in front of them:

       Scorecard       a stroke round, one row per player
       TeamScorecard   anything `needsTeams` — one row per SIDE for a shared
                       ball, one per player for a four-ball
       Match           match play, AND a Nassau, whose stage type is "Stroke
                       Play Round" so a reader keyed on the type looks for
                       cards that never existed
       BracketWinner   a knockout. A bracket stage files no Scorecard and no
                       Match at all; its results are rows keyed by slot

   The symptom is always an absence reported as a fact — "Nothing returned for
   this round yet" over eight complete sides, "Matches complete 0/0 · 0% of
   round robin" over a knockout five ties through six, "this tournament hasn't
   been launched yet" said to people standing on the course. Measured, not
   argued: the seeded club's invitational holds 0 Scorecard rows against 16, 8
   and 8 TeamScorecard rows; its knockout holds 0 Match rows against 5
   BracketWinner rows.

   **And the denominator is the same question one level along.** `total` was
   the event's entry list, which is the wrong field for a team round (sides,
   not players) and for a CUT round (the survivors, not everyone who entered).
   A completed championship cut to 16 of 28 read "Cards in 16/28 · 57%
   submitted" with every card in.

   Two things follow. Fix it where the data is built — `boardProgress` carries
   the unit now, and there are FIVE of those rather than four:
   `cards | matches | sides | ties | manual`, the last being a round scored by
   hand, which files cards and has no board for them to count towards. So a
   screen cannot re-derive it from the event's format, which is how one
   absence came to have four readers.

   And when a screen shows nothing, check the table before the code:
   `grep` for every read of `prisma.scorecard` that decides EXISTENCE or
   PROGRESS rather than score found all four readers in twenty minutes, where
   walking screens had found one in an evening.

The multi-agent exploratory audit that produced all this is a RELEASE GATE or
post-feature pass, not a per-change step — it costs over a million tokens. Use
it to find unknown classes of bug; use the sweep above to stop known ones
coming back.
