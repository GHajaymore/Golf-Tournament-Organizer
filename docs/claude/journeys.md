# Journeys: measured, and held by a ratchet

> Read this when your task touches a journey spec (`e2e/secretary-first-event.spec.ts`, `e2e/player-journey.spec.ts`), `e2e/journey.ts`, `e2e/journey-budgets.ts`, or when a `JOURNEY-BREACH` line turns CI red. Index: `CLAUDE.md`.

Ajay, 14 Nov 2026: "I am keep telling to simplify the things while setting up or as a player", and "but still provide the full richer experience and functionality". Asked five times since 5 Oct. So the journeys a club and a player walk are measured in CI on every pull request, and a change that makes one longer fails. This is work plan row 0b. The budgets are Fable's (`journey-budgets.md`, 14 Nov), reviewed by the Principal Engineer.

## The journeys

| | Name | Walk |
|---|---|---|
| J1 | `secretary-first-event` | Sign up as a club → first member → first tournament → entry link, opened by somebody else |
| J2 | `secretary-playable-event` | J1's sign-up → date and catalogue course → the round → eight members by CSV → launch → tee sheet published → a member sees their tee time on Today. **The ten-minute promise is held here.** |
| J3 | `secretary-copy-last-event` | Copy last event from the home with a new first day → Entries → the new link, opened |
| J4 | `player-member` | Signed in: Today → card → hole 1 → Board |
| J4b | `player-member-signed-out` | The app's link on a new browser → log in → Today → card → hole 1 → Board |
| J5 | `player-card-18` | A realistic 88 on one bar of signal (saves held 2 s), certified, then the final standing; 0 choosers |
| J6 | `player-guest` | The personal player link → Open my card → Today → card → hole 1 → Board |

## What is counted (`e2e/journey.ts`)

| Figure | Meaning |
|---|---|
| screens | Distinct paths, reached by a full load or a client-side route change. Query and hash do not count. |
| visits | Paths in the order they were stood on. |
| returns | Visits minus screens: being sent back to a screen already left. |
| presses | Each press, including those a helper makes for the person. A helper counts through the walk (`verifyByCode(page, email, walk)`), never as a number written beside it. |
| boxes | Typed into, a date picked, a file chosen. |
| chars | Characters typed. The text is the journey spec's own, and its mark carries `projectTag` (5 characters), so the count is the same in every project. |
| seconds | At the panel's pace: 3 s reading before each press, 200 ms a character. The test's own waits (`walk.settle()`, at most 5 s) are off the clock. |

Each journey prints one machine-readable `JOURNEY {…}` line with its ceiling and target beside it. It then prints one `JOURNEY-STEP` line per step, giving the time, the screen and what was pressed. The persona panel reads these lines.

No press may depend on timing. Where the app moves on by itself (the card after a tap, the log-in to Today), the spec waits for it and fails with a sentence. It never presses something to help a slow run along.

## The ratchet (`e2e/journey-budgets.ts`)

Every journey has a **ceiling**: the measured figure for every count, and seconds where the panel set one. It also has a **target**: where the panel wants it, and the cut that gets it there. Targets are printed, never asserted.

**Over a ceiling fails.** The message names the journey, the figure, the ceiling and the file.

- Take the added step out.
- If it is truly needed, remove another step of the same kind elsewhere in the same journey. A trade within one figure passes (one press in, one press out).
- A trade across figures fails (one screen more for two presses fewer).
- A ceiling is raised only with a **named ruling** (who, when) written beside it in `journey-budgets.ts`.

**Under a ceiling fails too.** The counts are deterministic, so the ceiling is exactly the journey. The pull request that shortens a journey lowers its ceiling to the new figure in the same change. Otherwise a later change could put the step back unseen.

**Seconds fail only when over.** The counted steps did not grow, so the app or a wait got slower. Read the times on the `JOURNEY-STEP` lines to find which step, and make it faster. Seconds are never lowered: they move with the machine.

**A new journey** gets its ceiling from its first CI run. Until it has one, it fails, because nothing may be walked unheld.

## Traps met building it (14 Nov)

- **A press made by the spec is not the person's.** On `/choose`, "club" is already chosen from the sign-up, so the spec presses it only when the screen has not chosen it. J1 is 12 presses, not 13.
- **A press made because the machine was slow is not the person's either.** J4b's first run pressed the Today tab while `/choose` was still moving on to `/me` by itself.
- **The CSV import already gives each entry its tournament Account.** Account is unique on (event, address). A fixture that signs an imported member in makes only a User.
