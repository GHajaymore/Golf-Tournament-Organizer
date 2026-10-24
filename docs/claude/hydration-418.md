# React #418 and slow page delivery

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: a hydration error, `[hydration #418]`, relative times in components. Index: `CLAUDE.md`.

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

**What the recorder said, the two times it was attached when the slow-page fault struck** (the
entry above this one): "kept 124ms into the page … from <body> down the two are the same, element
for element and word for word", once with the document still "loading". Identical before and
after is what that fault looks like from outside, and it is what sent the search to TIME. The
recorder also logs the last thirty changes made to the document before a clear, the streamed
sections not yet in place, and when the document finished arriving.
