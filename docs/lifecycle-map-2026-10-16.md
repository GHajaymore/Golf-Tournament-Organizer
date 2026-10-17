# The tournament lifecycle, mapped — 2026-10-16

Ajay, 2026-10-16: "fix the entire Tournament lifecycle/workflow/sequencing if needed" and "as a
collective professional eyes, make sure the tournament lifecycle/workflow/sequencing should be up
to the mark. Do you think Registrations and entry should come after Rounds and Format? may be for
some tournaments but not all".

Mapped from the code (file:line in the working notes of that day), before any change. What follows
is what an organizer meets, in order, and what is wrong with it.

## The shape today

- **Statuses:** draft → registration → ready → live → completed (`lifecycle-state.ts`). Launch is
  the only move with a gate (`launchRefusal`: a round, a field, a date, the course cards — and, since
  2026-10-16, no round that cannot be scored). Completing has its own (`finishRefusal`).
- **The guided steps** (`setup-flow.ts`): Tournament details → Rounds & formats → Registration &
  field → (Team cup / Teams & pairs) → Flights → Prizes & payouts. They guide and do not cage.
- **The dashboard** offers one next status at a time: Start taking entries → Mark ready → Launch
  tournament → Complete tournament → Reopen.

## Where Registration goes — decided

**Rounds & formats stays before Registration in the guided order, and is never enforced.** A club
decides what is being played before it invites entries: the entry form and the invitation tell people
what they are entering — the format, the day, off handicap or scratch, how many rounds. Club medals,
championships, opens, knockouts and leagues all run this way.

Entries first is real for some: a society day collecting "who's in Saturday" and choosing the format
from the numbers (a Texas scramble in fours, a four-ball in pairs), or a knockout whose draw size
depends on the entries. Even then the KIND of event is settled first; only its SHAPE waits for the
field — and the shape (flights, sides, the draw) already comes after Registration. The app allows
entries first today; it does not OFFER it, and an entry form opened before any round exists says
nothing about the event. So: offer the path honestly ("Not decided the format yet? Take entries
first"), and make the entry form say what it can — not reorder the steps.

## The sequencing problems found

1. Launch sits behind two status clicks that change a label and nothing else ("Start taking
   entries", "Mark ready"); nothing checks anything until Launch.
2. The labels claim facts they do not check: "Registration open" while the public link may be
   unpublished; "Ready to launch" while the launch gate may refuse.
3. Entries can be taken before any round exists, and the form then describes nothing.
4. The dashboard's setup checklist disappears once one player is entered; after that only the
   setup screens' strip says what is left.
5. Two date rules disagree: Tournament details is done with a venue OR a date; launch needs a date.
   A one-round tournament reads "Setup is done" and is then refused (the strip patches it).
6. ~~"Done" over a round that cannot be scored~~ — **fixed 2026-10-16** (setup step and launch).
7. A medal must draw flights to finish setup, though launch does not need them; a player entered
   after the flights are drawn may sit in no flight while the step still says done (inferred).
8. After launch, Registration greys out closing/reopening entries that the server deliberately
   allows; and approving a pending entry from a live link needs setup unlocked.
9. The launch dialog does not read the action's refusal — a refused launch closes silently.
10. The copy says launch "gates nothing" the field sees; for a gated tournament draft shuts the
    player app, and before launch scoring is refused.
11. "Scoring works either way" on the mismatch warning is true only because results already exist.
12. A tee sheet can be published — notifying players — on a draft they cannot open (inferred).
13. Two counts of "results exist" differ: the dashboard's leaves out bracket winners.
14. The guide vanishes for good at launch, even after Unlock, and even with steps left undone.
15. Three progress models with three counts: the strip (5–6 steps), the journey card (4 phases),
    the dashboard checklist.
16. On the free plan, completing deletes the tournament while the Finish phase reads "send everyone
    the result" (the dashboard does warn beforehand).

## Next

The Rounds & formats redesign ships first (`docs/walk-rounds-and-format-2026-10-16.md`). Then the
lifecycle pass, in this order: 1, 2 and 9 (the moves themselves), 3 and the entries-first path,
5 and 7 (the steps' rules), 8, 14, 15, 4, then the rest — each walked in a browser as the organizer
would, and each with a browser test.
