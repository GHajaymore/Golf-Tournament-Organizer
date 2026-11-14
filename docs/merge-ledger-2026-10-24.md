# Merge ledger, 2026-10-24

The merge queue of 24 October, one line per pull request: the head that was tested, the rounds
`npm run qa:changed` asked for and what they said, the merge commit, and what the deploy gate did.
Rounds are named by their branch (`round/<name>-N`); a verdict is the Verdict job's own line.

Kept by the merge-queue runner. Nothing here is a person's name; the queue order was the owner's.

## Where it stopped

**Main is red at `92dd1134` (#932), and the queue is stopped there, as the brief says to.** #928
(club settings tabs) added `a-tap-size-is-not-beaten-inline.test.ts`; #932 (a tie at the cut) was
rounded on a head that did not contain #928 and merged after it with one row that sweep refuses
(`CutReadyCard.tsx:159`, `minHeight: 32`). Each was green on its own; their sum fails
`Typecheck and unit tests` on main (run 40116626458). The fix is #947 (one line, the sweep red to
green), with its round `round/fix-cut-card-tap-1` pushed; it is not merged.

**The lesson for whoever runs the next queue:** two PRs rounded side by side are each tested
without the other. Before the second merges, merge the first into it and run the unit suite (a
minute) — a new sweep in one and a new screen in the other is exactly what a round on either head
cannot see.

## The lines

| PR | Head tested | Rounds (verdicts) | Merged as | Deploy |
|---|---|---|---|---|
| #942 foundation pass | `ec4fc75b` | foundation-pass-1 G308-1 CLEAN, -2 G309-2 CLEAN, -3 G310-3 CLEAN (three: money and handicap arithmetic; all six countries). The first three, on `6510a44e`, were cancelled while main was red | `1d6e1906` | verify green; gate HOLD for the nightly (core), as designed |
| #929 sign-in security (A012, A013) | `4b59a9cf` | signin-security-1, four times: on `64492e22` the database suite was red (#925's new audit test made an organizer with no proved address, which `createSession` now refuses; fixed); on `994fc4ef` cancelled while main was red; on `32416e68` G311-1 NOT CLEAN, 9 findings in two of main's specs (fixed, below); on `4b59a9cf` G312-1 CLEAN, 15 of 15 layers | `689ca435` | verify green; gate HOLD for the nightly (core) |
| #926 week sheet | `d8d122d0` | week-sheet-1 G313-1 CLEAN (core, all six) | `4f89b3a2` | verify green; gate HOLD for the nightly (core) |
| #945 lapsed-club archive (A014), opened today from `claude/lapsed-archive-2` | `6046f035` | lapsed-archive-1 G314-1 CLEAN (core, all six) | `26d4935f` | verify green; gate HOLD for the nightly (core) |
| #927 one prize per player (A015) | `08a60134` | one-prize-1 G316-1 CLEAN (core, all six) | `3c14fc67` | verify green; gate HOLD for the nightly (core) |
| #928 club settings tabs | `3464cb76` | club-settings-tabs-1: on `3116a27b` G315-1 NOT CLEAN, the iPhone part, deterministic on a re-run (fixed, below); on `3464cb76` G317-1 CLEAN. The jobs API answered 502 for that run, so the verdict was read from the Verdict job's log and the merge made by hand, pinned to the head, with verify green | `6144d46b` | verify green; gate HOLD for the nightly (core) |
| #932 a tie at the cut (A018) | `3a4b6952` | cut-tie-1 G318-1 CLEAN (core, all six) | `92dd1134` | **verify RED on main** (the tap-size sweep, above); nothing deployed |
| #947 fix for the above | `07f77dbc` | fix-cut-card-tap-1 CLEAN | `0b3e78bb` (merged by the coordinator) | main green again |

### After the restart (the coordinator's rule: a head must contain current main; one merge at a time)

| PR | Head tested | Rounds (verdicts) | Merged as | Deploy |
|---|---|---|---|---|
| #931 report while played | `032b5aad` | report-walk-1 CLEAN (the round on `dd808995` cancelled: old base) | `05b07713` | verify green |
| #933 knockout of 129 | `e80a6159` | ko129-1 on `7151ef4a` G322-1 NOT CLEAN (iPhone: main's round-code spec deleted and re-made a card while a late save landed; now an upsert); G327-1 CLEAN. Merge: `tieResultWords` (#931) folded into `marginWords`, one reader | `5fe7bea4` | verify green |
| #952 US landing words (taken early) | `b9bd0a6d` | us-words-landing-1 CLEAN | `6e908425` | verify green |
| #935 the draw in sections | `e8b23d99` | bracket-sections-1 on `e3f1bfad` G332-1 NOT CLEAN (Firefox desktop cut two 20-letter names; ties 236→256px); then CLEAN. Its CLAUDE.md paragraph moved to `docs/claude/knockouts-and-leagues.md` with a manifest hash | `de466f69` | verify green; the nightly on `de466f69` succeeded |
| #955 country words | `e574d2a1` | country-words-1: on `e13e9729` the database suite was red — `createEvent` built the setup refusal without the outfit's country or noun, so a British society was told "your league" (fixed, audit fixture made British); CI on `59055f25` red — three sign-up specs pressed the old kind labels (fixed); G346-1 CLEAN | `8741a2ac` | main run started |

Not reached: #933, #938 (A019), #940, #943 (A020), #936 (A021), #935, #939 (A022), #941. Each was
brought up to date with main at some point today and gated locally (tsc, unit, lint, and the
database suite where it has one); none was pushed with a round except as listed. Held: #934.
Skipped: `claude/email-sheet-and-results` (A016) exists only as a local branch in another worktree,
with no PR and nothing on GitHub.

## What the merges found, and what was done

- **#929 meeting main's tests.** `a-free-club-asks-no-mobile-unless-it-chooses.audit.test.ts` (#925)
  gave its organizer a proved address. `secretary-back-after-a-week.spec.ts` (#937), whose own header
  said the new-device code belonged there when it landed: the old device now holds its `ng_device`
  cookie and `KnownDevice` row, and the clubhouse tablet types the emailed code. In
  `every-action-vs-a-stranger.spec.ts`, `claimPassword` making an `EmailCode` row for a member's
  address is listed as an open door, with why, beside `requestPasswordReset`.
- **#927 meeting main.** `PrizesClient.tsx` kept both sides (main's refused amounts and Add, the
  one-prize picker and per-line refusals); its report test reads main's new `amount` column.
- **#928 on Safari's engine.** The tabs spec's held answer was never held on the iPhone project:
  with the service worker in the page, WebKit sent the POST past `page.route`, and the refusal came
  back as the tab changed. The test blocks the worker and checks the hold before it changes tabs.
  Seen and left for a decision: a refusal drawn in the same commit that hides its section is missed
  by the panel's observer (attached after the commit); `e2e/coverage.ts` reported it.
- **#932 meeting main.** `strokeRankingBasis` kept once (#926 had added the same field); #942's
  property test asks `strokeCutOutcome`, which replaced `survivorsWithTies`; its audit's secretary
  has a proved address.
- **Prepared, not merged.** #943: the home-club control looks for the home-club line (the
  withheld-name label shares the cell), proved by a mutation. #938: the archive sweep lists
  `recordPrinted` among the reads (printing is the archive's "exportable"); `RoundSigns.tsx` stays
  deleted (the print kit replaced it; #928's tap change to it is moot) — but the print kit's own
  `PrintKitClient.tsx:121` and `:157`, and `PlaySettings.tsx:792`, fail the tap-size sweep, and
  `foursomes/page.tsx` imports `Link` twice after the merge — NOT yet fixed on that branch. These
  resolutions are local branches of this repository (`mq-933`, `mq-935`, `mq-936`, `mq-938`,
  `mq-939`, `mq-940`, `mq-941`, `mq-943`), not pushed to the PR branches. #936: the plan table moved to `lib/landing/plan-diff.tsx` without
  the mobile row #925 removed. #935, #939, #941, #940: built on the resolved #933.
- **Guide PDF.** Every branch that changes the guide conflicts on the PDF after another such merge.
  It was rebuilt (`scripts/build-guide-pdf.mjs` against a built server) for #928 and #931; branches
  that merged without a conflict were not rebuilt.

## Notes

- **Main was red for a while** after #937 (run 40075266243): `secretary-back-after-a-week.spec.ts`
  could not find a zone at seven o'clock at some hours. Fixed by #944 (test only). No merge was
  made while it was red.
- **`qa-pipeline.test.ts` fails on this Windows machine and passes on Linux** (on main as well):
  vitest reports `SyntaxError: Invalid or unexpected token` importing `scripts/qa/quarantine.mjs`,
  the one module of the four with a `#!` line, checked out with CRLF. Every local gate read
  "1 failed" for that file alone; CI is the judge of it.
- **Migration order.** A012 to A015 and A018 are on main, in that order. A016 (the email sheet) and
  A017 (tax at checkout) are not; whichever merges next will sort before A018 although applied after
  it, so they should be renumbered past the last merged number when they come.
