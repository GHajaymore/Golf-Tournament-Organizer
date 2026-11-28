# The lock scopes: which action asks which, and what money locks

State machine PR L (20 Nov 2026), after 9b. The machine knows nine scopes (`LOCK_SCOPES`, `src/lib/domain/tournament-status.ts`):
`details`, `rounds`, `field`, `flights`, `draw`, `sides`, `cup`, `money`, `teeSheet`. A banner that says "Locked" over a control
that still writes is worse than no banner, so **each scope is asked by something**, and
`src/lib/__tests__/every-lock-scope-is-asked.test.ts` is the sweep that says so (with controls). A scope added to the machine
with no asker is red the day it lands.

| Scope | Locked when | Asked by |
| --- | --- | --- |
| `details`, `rounds`, `field`, `flights`, `sides` | launch (way out: the committee correction), completion (Reopen) | `refuseIfLocked(eventId, scope, what)` in `actions/tournament.ts`, `teams.ts`, `setup-suggest.ts` — listed in `the-scoped-locks-return.test.ts` |
| `draw` | a flighted knockout: results, completion | `refuseIfLocked(eventId, "draw", "change the flights")` inside `flightsOpenForChange` in `actions/tournament.ts`, which every flight action calls (PR L2: it keeps only the "arranged in flights" precondition and the state load; WHEN the draw is shut is the machine's, the same answer the Bracket banner draws) |
| `teeSheet` | completion only (Reopen) | `teeSheetVerdictFor` (the one rule `teeSheetChangeAllowed`); `scoped-locks.test.ts` holds `locksFor(f).teeSheet.locked` to `!teeSheetChangeAllowed(…).ok` over every family, status, step and change |
| `cup` | launch (the committee correction), completion (Reopen) | `createCupTeams`, `renameCupTeam`, `setCupPlayerTeam` |
| `sides`, read COMPLETION-ONLY (B115) | completion only (Reopen) — **never at launch**: a live league is drawn every week | `drawLeagueWeek` asks `refuseIfCompleted(eventId, "sides", "draw a league week")`, through `completionLockOf` (the reader `addRoundLockOf` is too); a first draw and a redraw, season week or play-off alike. Scores on a week stay refused by their own sentence. **B124:** the delete and every create are ONE transaction (a reader never sees a half-drawn week), the event row is locked `FOR UPDATE` and completion is read again inside it (`refuseIfCompletedFresh`, uncached) so a completion that lands after the first check refuses the draw and writes nothing, and the payload is parsed first (`cleanLeagueDrawRequest`, `league-draw-payload.ts`; `replace` must be exactly `true`). The screens (Tee times & draw, Teams & pairs) draw `completionLockFor` as `LeagueDraw`'s `locked`. Not `refuseIfLocked(…, "sides")`: that would refuse a live league. **B115b (PR A):** the same completion-only reading now covers ALL FIVE league writes: `nominatePair` ("nominate a pair"), `withdrawPair` ("withdraw a pair"), `setLeagueSettings` ("change the league's settings") and `setPlayoffHoleWinner` ("record a play-off result") each call `refuseIfCompleted(eventId, "sides", what)` directly (never through a league-local wrapper), after the role and the payload (`league-payload.ts`: strings only, at most two player ids, a reason of 3 to 200 characters) and before any row is read or written. **A league's Teams page reads the sides lock completion-only** (`completionLockFor`, when `isLeaguePointsSystem`): its banner, its side cards and its League section take that ONE value (`LeagueSection` has a required `lock` prop; `PairBuilder`, `LeagueSettings` and `PlayoffDecision` take `locked`), so a live league shows no "is live" banner and a completed one shows "Locked because the tournament is completed." with Reopen. **A league's sides have one door, the League section:** `createTeam`, `deleteTeam`, `addTeamMember` and `removeTeamMember` refuse a league (`leagueRefusal`, `LEAGUE_SIDES_REFUSAL`, asked before the lock) because they skipped the club-roster rule, and the side cards are drawn read-only. Every other tournament keeps the blanket `sides` lock. |
| `money` | completion only (Reopen) — **never at launch** | the OFFER-side actions below |

## The cup (TD, Q5)

The cup's **teams** — making them, a team's name, who is on it — are the `cup` scope and lock by launch. Points to win and the
holder are how the cup is decided, so `setCupSettings` asks `rounds`. **The lineup and the points are the day's work** and stay
open: `nameCupSession`, `addCupMatch`, `publishCupLineup`, `hideCupLineup`, `removeCupMatch`, `addCupPoint`, `awardCupPoint`,
`removeCupPoint`, `saveReportRecap`. A captain replacing a player on the morning goes through the field rule
(`field-change.ts`), not through an open cup scope.

## Money (Ajay, 19 Nov 2026)

At **completion** what was OFFERED locks, and Reopen unlocks it (`REOPEN_WAY_OUT`; a committee correction cannot open it).
The **ledger never locks**: settling up happens after the result is final. Nothing about money locks at launch. TourneyHQ still
only records money and never moves it (hard rule 7).

| Side | Action | Why |
| --- | --- | --- |
| offer (asks `money`) | `addPrize`, `updatePrize`, `removePrize`, `applyPrizeStructure` | the prize table |
| offer | `setOnePrizePerPlayer`, `setPrizeCounts` | the one-prize rule |
| offer | `addContest`, `removeContest` | a contest's definition |
| offer | `saveSkinsPot`, `removeSkinsPot` | a pot's definition and stake |
| offer | `saveSideGame`, `removeSideGame` | a side game's definition and stake |
| offer | `setEventMoneyMode`, `setPotEntryMode` | the money mode, how a pot is entered |
| ledger (no lock) | `setPrizeWinner` | awarding a prize is done once the result is final |
| ledger | `setContestEntrants`, `requestContestEntry`, `confirmContestEntry`, `setContestWinners` | who is in, who has paid, who won |
| both | `setSkinsEntrants` | changing the entrants of a pot that exists is the ledger's; starting a pot by naming its entrants is the offer's (asks `money` only when no pot exists) |
| ledger | `requestSkinsEntry`, `confirmSkinsEntry` | the same, for skins |
| ledger | `setSideGameEntrants`, `requestSideGameEntry`, `confirmSideGameEntry`, `setPotExcluded` | the same, for side games |
| ledger | `addFundLine`, `removeFundLine` | the kitty |
| ledger | `addExpense`, `updateExpense`, `removeExpense`, `recordSettlement`, `removeSettlement` | expenses and settling up |
| ledger | `setExpenseEntry` | who may write a cost down (costs are added after the day) |
| not a tournament's | `setOrgMoneyMode` | the club's default; a tournament that chose its own is not touched |
| neither | `setContestSponsor`, `renameBet` | a thank-you and a label; never money |

`entry fee as set up` is `saveEntryTerms` / `saveEvent`, which already lock (`field`, `details`) at launch and at completion.
`every-lock-scope-is-asked.test.ts` classifies every exported action of these files, so a new one cannot arrive without a side.

## On screen

A screen that draws a locked control reads `screenLocksFor(eventId, [scope…])`, mounts `ScopeLockBanner`, and hands the control
`locked` (`locked-actions-have-gated-controls.test.ts` requires both). A refusal of a press made on a screen drawn before the
lock is said where the press was (`role="alert"`, `ref={bringIntoView}`) and the screen catches up (`useAction` / `useCaughtUp`).
Walked in a browser by `e2e/locked-setup-refuses-in-words.spec.ts` (one control per scope).
