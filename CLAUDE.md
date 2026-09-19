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

**`npm run smoke` is NOT the whole of CI's "Smoke-test every route" step.** That step boots the
server once and then runs FIVE scripts against it, of which `npm run smoke` is the first:

```
node scripts/smoke-routes.mjs        # what `npm run smoke` runs, and all it runs
node scripts/verify-round-controls.mjs
node scripts/verify-drafting.mjs
node scripts/verify-week-view.mjs
node scripts/verify-lifecycle.mjs
```

**`npm run smoke:all` is that whole step, locally, against a BUILT server** — and it is the one
to reach for. It builds into `.next-ci`, starts it on 3102, runs all five in order, stops at the
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
like a broken route. The same five scripts, unchanged, passed first time against the built
server. A production server compiles nothing and stays flat.

Two more ways to lose an hour here, both worth knowing before blaming a route:

- **the scripts default to port 3000**, and the dev server in this repo is on **3100**. Every
  route then reports `fetch failed` while `curl` says 200, because they are talking to different
  ports. `SMOKE_BASE_URL` is the fix; `smoke:all` sets it for you.
- **`| tail` swallows the exit code.** `node script.mjs | tail -4` exits with `tail`'s status, so
  a failed run reads as `exit=0`. Check the script's own status, or do not pipe it.

Three of the other four assert CONTENT — that a control is on the screens that need it and off
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

So a green `npm run smoke` says every route renders for the demo, and says nothing about the
other four. Run them too — against the same server, in that order — whenever you change copy,
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

**One recurring CI failure is a Chromium crash, not a test.** `organizer.spec.ts:54` — "the
leaderboard shows the whole field" — periodically fails on the desktop project with:

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

So read WHICH JOB failed before reading anything else. `verify` red is your change; `deploy` red
on a green `verify` is the token, the database, or the allowance, and the message names which.
Nothing shipped unverified either way — `deploy` has `needs: verify` — but a commit CAN sit
undeployed until the next merge, so do not read "merged" as "live" without checking the run:

```bash
gh run view <run-id> --json jobs -q '.jobs[] | select(.name=="Deploy to production") | .conclusion'
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

- `audit-idor.test.ts` — every server action checks authorization.
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

**Prove a new test can fail: revert the fix, watch it go red, put it back.** Six fixtures in one
pass could not fail — a card-venue test on gross match play (the card is never read), an
authorization test using a money mode that does not exist (every refusal passed on "Unknown money
setting"), a skins test with one player (nobody wins a skin either way). Each looked exactly like
a passing test of the fix, and each was counted as coverage.

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
- **The player app is the exception, by decision (2026-09-19).** The club chose the hand-hung
  scoreboard (design D) for the whole player app, so the play shell renders `scoreboardCss` —
  `SCOREBOARD_GROUND` in `themes.ts`, a fixed green field with the TourneyHQ orange — and not
  the club's theme. It is measured in `scoreboard-ground.test.ts`. If clubs ever need to change
  it, make it a club setting; do not reintroduce a second import on a screen.
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

The multi-agent exploratory audit that produced all this is a RELEASE GATE or
post-feature pass, not a per-change step — it costs over a million tokens. Use
it to find unknown classes of bug; use the sweep above to stop known ones
coming back.
