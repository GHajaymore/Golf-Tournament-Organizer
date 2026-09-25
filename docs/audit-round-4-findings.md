# Audit round 4 — findings and dispositions

A multi-method sweep (data-consistency "two-readers" enumeration, a concurrency /
idempotency pass, a second-threat-model security pass, and a dynamic render/fetch
walk of the seeded club). Security came back **clean for the second time**. The
rank / position / to-par / money-splitting pipelines are **heavily consolidated
and provably agree** (verified across console, player app and public `/live`).

What follows is everything that did **not** come back clean, with file:line and a
fix recipe, so the follow-up work has one reference. Items are grouped by how they
must be handled — several need a **product decision** or **production-data care**
and were deliberately not rushed in an autonomous pass.

## Fixed already

- **skins season / settle-up finality** — `skinsSeasonFor` excludes provisional
  weeks; a provisional pot offers no settle-up list. Shipped in #607.
- **P2002 on a double-tap pot/contest join** — `requestSkinsEntry` /
  `requestContestEntry` now `upsert` on the existing unique key, so a concurrent
  second tap is an idempotent no-op instead of a 500. Shipped with this doc.

## Money / scoring consistency (careful fixes; some need a product call)

### 1. HIGH — interclub league four-ball match uses the raw Handicap Index
`src/lib/services/league.ts:153-157, 174-188`. `leagueMeetings` prices the match
off `Player.handicap` (the roster **Index**), applying only the allowance — no
slope/course-rating conversion, no per-week venue tee, no frozen `RoundHandicap`.
The stored result (`recomputeTeamMatch`, `tournament.ts:2783-2793`), the entry
dots and the printed card all use the **Course Handicap** via
`roundCourseHandicaps` + `roundHandicapOf`. On any rated tee (every interclub
venue) the strokes land on different holes → different hole-winners → league
points → table → play-off seeding → champion. This is the exact 2026-08-12 defect
`recomputeTeamMatch` fixed, reintroduced here.
- **Fix:** resolve the per-player figure through `roundCourseHandicaps`
  (tees + `flightTeeByPlayer` + frozen `roundHandicapRows` + the week venue),
  exactly as `recomputeTeamMatch`; or, better, have `leagueMeetings` read the
  stored `Match.holes` so there is one reader. Mind `roundCourseHandicaps`'s
  optional per-match `match` venue.
- **Test gap:** `league-week.audit.test.ts` uses `handicap: 0` and unrated tees,
  so the divergence cannot manifest — the fixture must use rated tees + real
  indices, and reverting the fix must go red.
- This is Ajay's own 12-team pairs league; the result is member-visible, so it
  wants human validation against real league data.

### 2. HIGH — `/me/money` shows two money readers that disagree
`src/app/(player)/me/money/page.tsx:184-185` renders `roundMoneyFor`
(`expenses.ts:1665,1676`, whole-round finality — drops *all* of a round's money
until every field card is in) beside `moneyFor` (`expenses.ts:922,1033` →
`gameNets`, per-pot finality — Nassau/match paid live, skins per `provisional`).
When a round is not whole-round-final but a segment has settled (a Nassau back
nine done; an opt-in skins pot whose entrants have all finished), the ledger
shows the money and the round summary says "still being played."
- **`money-layout.ts` says withholding a settled Nassau is "just as wrong"**, so
  `roundMoneyFor` is the outlier. Fix: decompose its finality per pot-type the way
  `gameNets` does (don't gate match/Nassau/settled-subset-skins on whole-round
  finality).
- **Careful:** `round-money.audit.test.ts` pins the *current* whole-round
  behaviour, so it enshrines the divergence — changing the code means changing
  that test, which is the "don't launder a wrong assertion" trap. Add a test that
  asserts A's outing total equals B's games total before touching it.
- **Product call:** confirm a settled Nassau should surface live in the round
  summary (it should, per the money rule, but worth Ajay's nod).

### 3. MEDIUM — a not-yet-played match player's position: two readers, two answers
`src/lib/domain/shared-position.ts:55-63` (started-gated; the Today hero and
`/me/board` summary) vs `src/lib/domain/scoreboard.ts:44-48` and the board tables
(`LeaderboardTable.tsx:256`, `PlayerLeaderboard.tsx:260`) which show the rank
whenever `ranked`. In singles match play a row can be `ranked:true, started:false`
(`tournament.ts:2576,2585`), so the boards and the player's own Today *tile* show
`T3` while their Today *hero* says "Not started."
- **Product decision first:** should a confirmed player who hasn't teed off show a
  position (`T3`, tied among the 0-point players) or "Not started"? Then apply the
  one answer in a single place so hero, tile and boards agree.

### 4. MEDIUM — single net-round tie-break: leaderboard countback vs `/week` gross
Board/`/live` break a net tie by a last-nine-net countback
(`tournament.ts:1712-1739`); the `/week` night table breaks it by gross
(`week-basis.ts:140`). Separating state: a match-play weekly league with exactly
one net Stroke Play Round as the board round, two players level on net but
different gross where the countback and gross disagree.
- **Fix:** the `/week` individual night order should use the same countback as the
  board, or the difference should be documented as deliberate.

### 5. LOW–MED — foursomes four-ball printed card ignores frozen `RoundHandicap`
`src/app/(app)/foursomes/page.tsx:254,344` builds the four-ball per-player low/dots
from `roundCourseHandicaps` **live**, while the entry dots and the stored result
wrap it in `roundHandicapOf` (frozen). The same page's single-ball branch *is*
frozen, so foursomes is internally inconsistent. Fix: route the four-ball figure
through `roundHandicapOf` too.

## Concurrency hardening (schema migrations + production-data care)

None of these corrupt data at rest today; they fire under double-submit or
concurrent editing. The unique-index fix in particular **must not** be run blind
against production — if the double-tap bug has already created live duplicates the
index creation fails the deploy, so a dedup/merge must run first.

### 6. HIGH — duplicate field entry on double-submit
`Player` has no unique constraint on `(eventId, email)` (schema `@@index([eventId])`
only). `register.ts:105/166`, `enter.ts:125/182`, `roster.ts:455/536` all
`findFirst`-then-`create` (not atomic), so a double-tap creates two confirmed
rows — the player appears twice in the field, draw and pots.
- **Fix:** a **partial** unique index `(eventId, lower(email))
  WHERE status IN ('confirmed','waitlisted','pending')` (keeps withdrawn re-entry
  legal), catch P2002 to return the existing-row result. **Audit prod for existing
  live duplicates and dedup before adding the index.**

### 7. HIGH/MED — capacity & tier field-cap TOCTOU
`register.ts:113`, `enter.ts:140`, `roster.ts:462` read `confirmedCount` then
`decideIntake`/`effectiveCapacity` then `create` — three statements, no
transaction. Two concurrent sign-ups at the boundary both confirm past the cap
(applies to the organizer capacity **and** the tier field cap from #605).
- **Fix:** enforce at the DB — a conditional insert
  (`INSERT … SELECT … WHERE (SELECT count(*) …) < capacity`) or a serializable
  `$transaction` that re-checks. The partial unique index does not fix over-cap by
  two different people.

### 8. MED — scorecard conflict guard is itself a TOCTOU
`scorecard-write.ts:111` (read) → `:164` (`staleAgainst`) → `:191` (`upsert`) are
three statements with no transaction and no compare-and-swap; the revision is a
content hash, not a DB version. Two offline devices replaying with the same
`expectedRevision` both pass and the second silently discards the first.
- **Fix:** an integer `version` column and
  `updateMany({ where: { stageId, playerId, version: expected } })`, treating
  `count === 0` as the conflict; or a serializable transaction.

### 9. MED — `recordSettlement` double-submit records the payment twice
`expenses.ts:576`; `Settlement` has no idempotency key. A double-tap on
"Mark settled" logs the handover twice and understates what's still owed.
- **Fix:** a client-generated idempotency key unique per intent, or a short-window
  dedup on `(eventId, fromPlayerId, toPlayerId, cents)`.

### 10. LOW/MED — tee-sheet lost update
`tee-sheet.ts:67` (read) → `:91` (write whole JSON), no version guard: two
organizers editing at once, last write wins silently.
- **Fix:** optimistic concurrency (check `updatedAt`/version in the update
  where-clause; report reload-needed on `count === 0`).

## Verified clean / provably consistent (do not re-investigate)

- Security: tokens, mass-assignment, session identity, CSV/AI, secrets — clean
  twice, with dedicated audit tests.
- Counts/denominators: round progress (`boardProgress`, five units), staff seats,
  field count, week attendance, flights/advancing — single-source, past bugs
  confirmed fixed.
- Ranks / shared places / net-and-gross to-par / champion order / cut-line ties /
  team & flight places — one reader each, pinned.
- Money splitting/netting — one `splitExactly`/`settle`.
- Performance hot paths: `liveBoard` (cached), `loadEventState` (memoised),
  `meFor`. Season/honours waterfalls parallelized (#608). Deferred perf: memoise
  `flightTeeByPlayer`/`teesForEvent`, `skinsSeasonFor` per-pot reads,
  `/leaderboard` cache.
</content>
