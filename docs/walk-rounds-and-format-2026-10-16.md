# Rounds & formats, walked as a new organizer — 2026-10-16

Ajay hit problems setting up a tournament on Rounds and Format (2026-10-15) and asked whether
testing had reached that screen. It had not, far: the reach list names a dozen of its actions as
performed by no browser test (`setStageFormat`, `setStageHoles`, `setStagePlayedOn`,
`setStageDeadline`, `setStageCutScope`, `setStageCarry`, `setQualifyPerGroup`, `removeStage`,
`generateNextRound`, `dateUndatedRounds`, `setSingleMatchRule`). So this walk does what he did:
a fresh tournament from Tournaments → "Set it up yourself" → "A series of rounds", then Rounds &
formats, on the dev server at phone width (334px), as the seeded club's organizer.

Each finding: what was done, what the screen said, what it should say. Nothing fixed yet.

## Findings

1. **A stroke play round accepts Match Play as its format, and the step is then marked done.**
   Chose "Stroke play round", Format "Match Play", pressed "Add stroke play round". The round was
   created; its card then said "This round cannot be scored as set. Match Play is decided hole by
   hole against an opponent, and Stroke Play Round draws none". The progress strip marked
   **Rounds & formats DONE** over the tournament's only round, which cannot be scored. The Format
   list offers every format for every round type (Match Play first, even on a stroke round).
   Should: offer only the formats the chosen type can score (or refuse at Add, beside the button),
   and never count a round that "cannot be scored as set" as done. "What a screen offers, the
   server accepts and the app reads must be one list."
   *Where:* `StagesClient.tsx` ~1280 shows the warning from `roundShapeMismatch` (the one rule,
   also read by the templates' sweep). The guide documents the state (guide-steps.ts 187, 530), so
   it was allowed on purpose and explained after the fact. *Fix:* filter the Add-a-round format
   list through `roundShapeMismatch(type, format) === null`, and have the setup checklist treat a
   round with a mismatch as not done.

2. **The progress strip says NOW on the wrong step.** On Rounds & formats (step 2), step 1
   "Tournament details" is marked NOW. Reads as being on the wrong page.

3. **"AjAi drafting — COMING SOON" sits in the middle of setup**, offering a feature that does not
   exist, with a "Describe it instead" heading. Clutter at the moment of most confusion.

4. **Formats that look like duplicates**: Foursomes and Alternate Shot, Four-Ball and Best Ball,
   Scramble and Texas Scramble are listed separately with no word on how they differ. Golf pro:
   Foursomes and Alternate Shot are one game (UK and US names); Four-Ball and Best Ball differ only
   in how many balls count. Check what the app does differently for each; merge or explain.

5. **The round's delete button is named "Remove stage"** for screen readers, where every word on
   the screen says "round". (Small; the house word is round.)

6. **"IS THIS ROUND OVER? — This round is finished" is offered on a round nobody has played.** On
   a draft tournament, the moment Round 1 exists and before any card, its card carries the
   tick-box and a long paragraph about making the result official. At setup it is noise, and
   ticking it closes an unplayed round ("anybody without a card is then shown without a place").
   Should: appear once the round has a card, as the other "after play" controls do.

7. The Add-a-round form keeps the last format chosen (here the rejected Match Play), so the next
   Add would repeat finding 1. Small; goes away with the fix to 1.

8. **Two controls a screen reader cannot name.** The round's "This round is finished" tick-box is
   named "on" (an unlabelled checkbox's default value), and the "date them all" box above the
   rounds has no label at all (it defaults to today). Same class as the thirty captions in the
   deferred register.

9. **Adding two rounds spaces them a week apart, unasked.** "How many? 2", Stroke Play, "First
   round played 7 Nov" made Round 2 Sat 7 Nov and Round 3 **Sat 14 Nov**. A club championship over
   a weekend expects 7 and 8 November; nothing on the form said the rounds would be a week apart.
   Should: ask for the spacing (consecutive days, weekly) or say plainly what it will do before
   Add. Also: Round 1 (undated) now sits above Round 2 (7 Nov) with no date, and the dated rounds
   are headed by their date while the undated one is headed "Stroke Play Round".

(continuing — next: Customize this round, a cut, a bracket after the stroke rounds, removing a round)
