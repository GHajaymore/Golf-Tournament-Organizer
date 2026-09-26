# Overnight report — 2026-09-25 → 26

Ajay asked for the app to be tested all night "as a golf pro and experienced tournament
organizer", fixing as I go, and — specifically — tested **as a non-golfer running a tournament**.
This is the running log; the summary for the morning is at the top once the night is done.

Method: the seeded club (`scripts/seed-club.mjs` — 11 tournaments spanning every format), walked
in a real browser (Playwright, signed in as the club secretary and as a player), plus a
from-scratch tournament created and run the way a newcomer would, following only what the app
says. Every fix has a test that was watched going red with the fix removed.

## Shipped earlier in the evening (before the loop)

| PR | What a user would have hit | Status |
|---|---|---|
| #621 | Tied places read "9, 9, 11, 12" — looked like a numbering mistake; now "T9" on every board | live |
| #622 | Date formatting threw a React hydration error on every load of Tournament details; first-run controls had no accessible names; "Manage" left you on the list | live |
| #623 | A long surname clipped the "· YOU" marker on the player's leaders card | live |
| #624 | Create left you on the list; roster "Added 0" after the click; Phone never said required; a false announcements warning (items 1, 3–5 below) | merged |

## The non-golfer runs a tournament (from scratch)

A newcomer creates "Sunday Scramble" from the Tournaments list and follows the dashboard's own
setup checklist.

1. **Create tournament → nothing happened.** The tournament was made, but the page stayed on the
   list. `createEvent`/`cloneEvent` return `{ ok: true }` and never navigate; a comment in
   `CreateFirstTournament` (and one I wrote into #622) wrongly said the action redirects — the
   redirect in tournament.ts belongs to `deleteEvent`. **Fixed:** both create forms go to the new
   tournament's dashboard on success. Verified in the browser.
2. The dashboard for a new tournament is **genuinely good for a novice**: a "Setup checklist" and a
   progress strip ("3 of 5 done · NOW Registration & field").
3. **Adding members: "Added 0".** Eight club members ticked, "Add 8 members" pressed → "Added 0 ·
   no mobile for …". A free club collects a mobile from every entrant (Ajay's rule — unchanged),
   and none had one on file. Learning that after the click is the fault. **Fixed:** the roster
   list now marks "Needs a mobile number" / "Needs an email address" on each member *before* the
   tick, with one summary line and the remedy. The picker and the add action now read ONE rule
   (`entryContactNeeds` + `contactGap`), so the warning and the refusal cannot disagree.
4. **The Phone field didn't say it was required.** Email beside it says "· required" or
   "· optional"; Phone said nothing, so a newcomer typed a name, pressed Add, and was refused.
   **Fixed:** it reads "Mobile · required" when it is, and Add waits for it the way it waits for a
   required email. (Also: every control on that form now has a proper label.)
5. **A false warning.** After adding players with no email the screen said announcements "go by
   email, so those players won't receive any". Wrong — announcements are loaded by tournament and
   shown to every entrant in the app; only the Messages screen needs an email. **Fixed** the
   sentence, and pinned it to the code that makes it true (if announcements ever become
   email-scoped, the test fails and forces the sentence to change).

6. **The guide never asked for the teams.** The Scramble's setup walked details → rounds → field →
   flights → money and never mentioned sides, while the dashboard read "Sides in 0/0" — a round
   that cannot be scored, on a checklist that could reach "5 of 5 done". Worse, the step it did
   point at, Flights, previews "Flight 1: four names", which a newcomer takes for a team.
   **Fixed:** a "Teams & pairs" step, only for a tournament with a team-format round (the same test
   the sidebar uses), between the field and the flights; done when every player is on a side. The
   rail, dashboard checklist and journey card all carry it. Following it, "Draw sides
   automatically" made two sides off 12 and 13 — checked by hand against the published scramble
   split (25/20/15/10): side A 1.5 + 3.6 + 3.45 + 3.7 = 12.25 → 12.
7. **The tee sheet split every side.** Dealt player by player: side 1 had Dev and Finn off at 8:00
   and their partners Ada and Eve at 8:10. A scramble side hits one ball between them — unplayable,
   and no grouping rule could avoid it. **Fixed:** a team round's tee groups are made from whole
   sides (two four-ball pairs to a group, a scramble four on its own, an oversized side whole rather
   than cut); the rule only orders the sides, and the screen says so. Pinned as a golf invariant
   over 300 random shapes: no side split, every player on the sheet once.

### Noted, not changed (UX calls for Ajay)

- Tournament details has three save buttons ("Save dates", "Save event", "Save settings") — a
  newcomer may not know which saves what.
- "Prizes & payouts" shows DONE on the checklist before the organizer has opened it ("neither" is
  counted as a decision).
- On a free club whose roster was imported without mobiles, no member can be entered until each
  record is edited. The screen now says so up front; whether the free tier should require a mobile
  for roster adds is a product decision.

## Decisions needed from Ajay

1. **A multi-round event whose LAST round is "Other (scored by hand)" hides every earlier round**
   from the organizer: dashboard, Live leaderboard and Reports all show only the hand-scored round
   ("no board"). Seen on the Festival of Formats (11 rounds; rounds 1–10 unreachable). The console
   leaderboard has no round picker, although a `RoundPicker` component already exists (Group
   games uses it). Not changed overnight: which round the board shows is chosen deep in
   `loadEventState` and feeds many screens — ranking-adjacent, so it wants your call on the
   behaviour first.
2. Show the chosen format's one-line description under the Format select on Rounds & formats
   (today it is behind the ⓘ) — a small UI change, the moment a novice most needs it.

## Log
