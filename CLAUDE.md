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

The command above runs the DEFAULT config, which excludes `*.audit.test.ts` — those need a real
database and live in `vitest.audit.config.ts`. Anything whose behaviour is only provable against
real rows (handicap resolution, authorization, money) is asserted there, so a change to one of
those areas is not verified until you have also run:

```bash
npx vitest run --config vitest.audit.config.ts
```

Use `NEXT_DIST_DIR=.next-ci` for builds while a dev server is running; sharing `.next` between
them corrupts it.

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

1. **Run it against the real catalogue first.** `--revalidate` re-judges every stored card
   with today's rules and costs no API quota. A rule that clears a large slice is wrong
   about golf, not right about the data.
2. **Look at what it would refuse, by name**, before believing the count.
3. **Use `cardRefusal`** — do not reimplement the range in a script. An ad-hoc checker that
   omitted the par-3 exemption reported three good courses as failures.

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
- **One ground everywhere, from the club's one setting.** `themeCss` is the only theme
  stylesheet: the console, the play shell and the public board all use it, so a club that picks
  its look gets that look on every screen. `auto` resolves dark unless the device asks for light.
  There was briefly a `playerThemeCss` resolving auto light-first; it made one club look like two
  products. If the two ever need to diverge again, diverge on something a club can see and set.
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
   `isManualFormat` is the only thing between the hand-scored format and a
   scoring engine, and one result path forgets it. Prefer making the wrong
   thing unrepresentable over documenting that callers must check.

The multi-agent exploratory audit that produced all this is a RELEASE GATE or
post-feature pass, not a per-change step — it costs over a million tokens. Use
it to find unknown classes of bug; use the sweep above to stop known ones
coming back.
