# Brief for the panel: tiebreakers on every round, short (2026-10-16)

## What Ajay said

Earlier: "for ex. tiebracker, there are two tiebracker in matchplay. one or the match and one for the
leaderboard/rankings" — keep the defaults as clubs play and the rest under Customize.

Now, looking at the redesigned Rounds & formats: "I see the customize screen but I didnt see the
tiebraker options" and "also there is still room for improvement".

## What the screen does today (read src/components/StagesClient.tsx — search "Tiebreakers")

- **Round robin (match play):** under Customize, two numbered questions — "1. If a match is all
  square after the last hole" (a chain of match tiebreakers: last 9/6/3/1, toughest holes by stroke
  index, sudden death…) and "2. If players finish level in the table" — followed by the POINTS
  table (win/halve/loss/hole-win ratio/bonus/most from one match), the table tiebreak chain with
  checkboxes and arrows, "Add a countback", and a worked example. On a phone this block is about
  2,000px long, below "How scores are recorded", and reads as part of the scoring. Components:
  `ScoringClient`, `MatchTiebreakers` (search), `tiebreakers` / `matchTiebreakers` on the event.
- **Knockout:** no tiebreak choice at all. A halved knockout match is settled by the organizer
  pressing a winner on the Bracket screen.
- **Stroke round (medal, Stableford):** one fixed sentence: countback on the card, last nine, six,
  three and the last hole; still level shares the place. No choice (`countbackSegments`).
- **Team rounds, leagues:** check what exists.

## Questions

1. For each kind of round (knockout, round robin, single match, medal, Stableford, team/four-ball,
   league week), what tie questions arise, what does a club, a society and a league usually do by
   default, and what do they vary? (Rules of Golf 3.2/3.3 and Committee Procedures 5A(6), 6.4 etc.)
2. Which of those choices should be on the face, which under Customize, which nowhere (a term
   printed on the sheet, not a setting)?
3. How should the block look so it is short on a phone: e.g. one line per question with the club's
   default named ("All square after 18 → sudden death from the 1st · Change"), the detail on Change?
   Where should the round robin's POINTS live — they are scoring, not a tiebreak?
4. What must the engine do for each choice (some are words only, some change who wins)?

Read-only. Verdict first, then numbered points with concrete copy. Under 600 words.
