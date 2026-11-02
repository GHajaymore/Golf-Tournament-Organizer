# CI failures that are not your change

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: a red CI job your diff cannot explain. Index: `CLAUDE.md`.

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
