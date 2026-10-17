# What a society or league customizes per round — reviewed 2026-10-16

Ajay, 2026-10-16: "we need to fulfill leagues/societies/non clubs options as well where they have
mixed skills golfers and that's why we have customize a round."

A golf professional and a society/league tournament director reviewed the round screen against
that (read-only). Their verdict: the handicap ARITHMETIC a mixed field needs is there —
allowances, team shares, best N of four, tees and the strokes for a higher par, one player's
figure and now their index. What is missing are the competition TERMS a society or league writes
down and a club rarely needs.

## Already offered (file, control)

| Need | Where |
|---|---|
| Allowance 95% / 100% (Appendix C; a smaller field at 100%) | Round's face, Handicap allowance → Change (`RoundAllowance.tsx`, `round-allowance.ts`) |
| Tees by gender, flight or one player; strokes for a higher par (Rule 6.2b) | `teeIdFor`, `setPlayerTee`, Flights |
| One player's strokes for a round; their index; to Members | Customize → Handicaps for this round (`RoundHandicaps.tsx`, `setPlayerIndex`) |
| Team shares for scrambles (25/20/15/10, 30/20/10, 35/15); best 2 or 3 of four | Handicaps for <format> (`Stage.allowanceWeights`, `Stage.countBest`) |
| Stableford pick-up as net double bogey (Rule 21.1b) | `stablefordPickUp` |
| Even-sized handicap divisions | Flights → Handicap divisions (`domain/grouping.ts`) |

## Gaps, ranked for a monthly mixed-ability Stableford

1. **A player with no index plays off 0, silently.** A blank entry is stored as 0 with source
   "none"; the round's handicap code never reads the source, and Handicaps for this round does not
   flag them. A beginner then looks like a scratch golfer's result. Needs a competition rule —
   "plays off N", or "plays, not for prizes" — and the player flagged on the round.
2. **No maximum handicap for the competition** (e.g. 28 men / 36 ladies), as "capped to enter" or
   "capped for prizes". A handicap limit is a term of the competition (Committee Procedures 5A).
   The only cap today is the Rules' 54.
3. **Divisions with band edges the organizer sets** (0–18, 19–28, 29+). Even-sized divisions move a
   19-handicapper between divisions from month to month; society prizes are announced by band.
4. Then: a cut after a win (a society's "bandit" rule — fits beside `setPlayerIndex`); a Maximum
   Score format (Rule 21.2); Texas Scramble minimum drives recorded and checked.

## Wording fixed the same day

"as most club competitions are" and "what clubs vary" on the round screen and in the guide, and
"if the club keeps its own handicaps" in the handicap help, now speak to a club, society or league.
The member-record sentences use the outfit's own word (`orgProfile(...).noun`).

## Decision

Gaps 1–3 are product changes to how a competition is scored and who wins a prize. They are queued
as one piece of work, with the panel, after the Rounds & formats batch merges — not slipped into it.
