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
| #624 | Create left you on the list; roster "Added 0" after the click; Phone never said required; a false announcements warning (items 1, 3–5 below) | live |
| #625 | A team event's setup never asked for the sides; the tee sheet split partners across tee times (items 6–7) | live |
| #626 | **Every club tournament created from the list scored against an empty card** on the boards, Reports and the public page; one round had three names (items 8–10) | live |
| — | Every console form control named for screen readers — measured at zero on every screen of five tournaments (see "Accessibility" below) | this PR |

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
8. **THE BIG ONE — the results never appeared.** Launched, entered both sides' cards (Score
   entry: "62 gross · 50 net", "60 · 47"; dashboard: "Sides in 2/2 · 100% returned"). The Live
   leaderboard, Reports and the public board showed **both sides on 0 holes, no score**.
   Cause: creating a tournament at a club attaches the home course as a *venue* but never set the
   tournament's own course. Score entry quietly used "the only venue"; every other screen looked
   only at the tournament's own course, found none, and scored every hole against an empty card.
   **Every tournament a club created from the Tournaments list was in this state until someone
   re-picked the course on Tournament details** — not scramble-specific: a medal would have shown
   the same blank board. **Fixed** both ways: a new tournament now carries its home course
   properly, and ones already created read the sole venue as their course (only when they name
   no course of their own, and never guessing between two venues — so nothing that worked before
   can move). Checked by hand: Team 2 60 gross off 13 = 47 net (−24) wins from Team 1 62 off 12 =
   50 (−21). Verified on the Live leaderboard, Reports and the public board at 393px.
9. **The round had three names.** Heading: "Round 1 · Scramble". Dashboard card under it:
   "Current round — Stroke Play Round". Public board sent to members: "Stroke Play Round · 18 Oct
   2026", and no course named. "Stroke Play Round" is how the app stores a round's shape — a
   newcomer has never seen those words. **Fixed:** one function names a round for all three
   ("Round 1 · Scramble"), and the public board names the course.
10. **"Flight standings" on a team round** listed all eight players with "—" against every name
    after the round was complete — reads as nobody having scored. A scramble's result belongs to
    the side, so the card is no longer drawn for a team round (the standings card above it already
    says where the sides are ranked, and now names the Live leaderboard as well as Reports).

### Noted, not changed (UX calls for Ajay)

- Tournament details has three save buttons ("Save dates", "Save event", "Save settings") — a
  newcomer may not know which saves what.
- "Prizes & payouts" shows DONE on the checklist before the organizer has opened it ("neither" is
  counted as a decision).
- On a free club whose roster was imported without mobiles, no member can be entered until each
  record is edited. The screen now says so up front; whether the free tier should require a mobile
  for roster adds is a product decision.
- Tournaments list: a tournament created before #626 shows "—" in its Course column (the column
  reads the course NAME, which those tournaments never got). New ones are fine; re-saving
  Tournament details fixes an old one.

## Accessibility — every console control named

A screen reader announces a form box by its label. Most of the console's boxes had a caption on
screen that wasn't attached to the box, so a blind or low-vision organizer heard "edit text,
combo box, checkbox" with no idea which was which. Measured in the browser on five tournaments
covering every shape the club runs (a scramble, a 24-player medal, a knockout, a league, the
Invitational), walking every sidebar screen:

| Before | Screen |
|---|---|
| 18 on 8 players (58 on the seeded field) | Registration — every row's select box and handicap box |
| 12 | Group games — each skins game's Buy-in and Holes |
| 8 / 6 | Rounds & formats — knockout / league (points, carry-forward, deadlines, Which nine) |
| 5 | Bracket — each match's result box |
| 5 · 3 · 2 · 2 · 2 · 2 | Club settings · Prizes · Tee sheet · Score entry · Access · Announcements |
| 1 each | Roster search · Leaderboard commentary · Seasons · Teams |

**After: zero on every screen of all five.** Pinned by a render test that draws each screen with
real rows (per-row boxes were most of the count). The player app was measured too, signed in as
a member at phone width: Today, Board, My card, Events, Money, Calendar and the round-code screen
all load, none scrolls sideways, no console errors — and one unnamed box (the round code), now
named. The deferred-register entry for this class is closed.

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
