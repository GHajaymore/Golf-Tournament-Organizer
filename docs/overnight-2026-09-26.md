# Overnight report — 2026-09-25 → 26

Ajay asked for the app to be tested all night "as a golf pro and experienced tournament
organizer", fixing as I go, and — specifically — tested **as a non-golfer running a tournament**.
This is the running log; the summary for the morning is at the top once the night is done.

Method: the seeded club (`scripts/seed-club.mjs` — 11 tournaments spanning every format), walked
in a real browser (Playwright, signed in as the club secretary and as a player), plus a
from-scratch tournament created and run the way a newcomer would, following only what the app
says. Every fix has a test that was watched going red with the fix removed.

## What shipped

| PR | What a user would have hit | Status |
|---|---|---|
| #621 | Tied places read "9, 9, 11, 12" — looked like a numbering mistake; now "T9" on every board | live |
| #622 | Date formatting threw a React hydration error on every load of Tournament details; first-run controls had no accessible names; "Manage" left you on the list | live |
| #623 | A long surname clipped the "· YOU" marker on the player's leaders card | live |
| #624 | Create left you on the list; roster "Added 0" after the click; Phone never said required; a false announcements warning (items 1, 3–5 below) | live |
| #625 | A team event's setup never asked for the sides; the tee sheet split partners across tee times (items 6–7) | live |
| #626 | **Every club tournament created from the list scored against an empty card** on the boards, Reports and the public page; one round had three names (items 8–10) | live |
| #627 | Every form control named for screen readers — measured at zero on every console screen of five tournaments and in the player app (see "Accessibility" below) | live |
| #628 | A player's Today showed **−2** (net) while My card showed **To par +5** (gross) for the same round, with nothing saying which; Today now reads "Thru 11 · net" | live |
| #629 | Message and score-entry dates threw a hydration error for a few hours around every midnight (server in UTC, browser local) | live |
| #630 | The newcomer's Stableford: "Setup is done" over a launch that refused; a date lost to "saves on their own"; a Stableford flight card printing strokes; "Course —" on older tournaments (items 11–15) | live |
| #631 | **A straight knockout left half the field out of the draw**; "Add bracket" described a stroke round; a fresh tournament refused members with no email and named one remedy of two; the guide asked a knockout for flights (items 16–19) | live |
| #632 | Score entry was a dead end for every knockout round — stroke cards and "generate flights" instead of the bracket (item 20) | live |
| #633 | A straight knockout's leaderboard and dashboard showed 0-0-0 standings and a qualification cutoff for a draw nobody qualified into (item 21) | live |
| #634 | The dashboard called eight finished, unsigned cards "8 still out on the course" (item 22) | live |
| #635 | A leaderboard with no rounds claimed "stroke play"; a finished championship was still being told "NOW Flights" and called "live" (items 23–24) | live |
| #636 | **A knockout's members could not see the draw anywhere** — not on Today, their Board or the club's public link; the board also said a tie at the cut was undecided after the draw had decided it (items 25–26) | merged |
| — | A player's "games still to play" counted a closest-to-the-pin already decided and paid; the public sign-up form's six boxes had no names for a screen reader (items 27–28) | this PR |

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

### Second run: a club Stableford, start to finish

Eight members entered from the roster, flights, dates, launch, eight cards, the board. **The golf
was right**: every card scored exactly as worked by hand (a bogey on every hole is 18 + playing
handicap in points, a par card 36 + it — Ada 22 shots → 40, Dev 35 → 53, Eve 6 → 42) and the
board ranked them in that order. What was wrong was around it:

11. **"Setup is done — all 5 parts"** over a Launch button the dashboard then disabled. The details
    step takes a date *or* a venue (a club still arguing over the day has a course); launching needs
    a date. Both are right; the hand-off promised "take it live" anyway. **Fixed:** the guide asks
    the launch gate itself and says "One thing before it can go live" in the gate's words, with a
    button to the screen that fixes it.
12. The refusal sent people to **"Tournament setup"** — no such screen; the sidebar says
    Tournament details. **Fixed.**
13. **A date lost.** "Dates save on their own" sat beside a Save button; it meant "their own
    button", read as "automatically", and the date was gone on leaving the screen. **Fixed:** it
    says "Not saved yet".
14. **The Stableford flight card printed strokes.** Sorted by points, printing gross to-par:
    Flight 1 read "+18, +18, E, +18" — the level-par round third, behind two players 18 over.
    **Fixed:** it prints points, like the leaderboard card above it.
15. **"Course —"** on the launch confirmation, the Tournaments list and an empty "Golf course" box
    on Tournament details, for any tournament created before #626 — while the dashboard header
    named the course. **Fixed** on all three; saving the details form heals the old shape.

Golf-pro note, not changed: the Flights screen defaults to **"Balanced skills"**, which spreads
handicaps evenly across flights — right for team or match play. For a club medal or Stableford,
flights are prize *divisions* and are drawn **by handicap** so like plays like; a newcomer taking
the default gets a Flight 1 holding a 4 and a 24.

### Third run: a club match-play knockout

"Set it up yourself" → "A knockout", a bracket as the only round, the same eight members.

16. **Half the field left out of the draw — the serious one.** A knockout's qualification cut ranks
    players on a round played *before* the bracket. With the bracket as the first round there is no
    such round, and the cut was applied anyway, by seed order. With the defaults a new knockout gets
    (top 2 per flight), the bracket read **"0 players qualify"** before flights existed and would
    have drawn **4 of the 8** after — measured: the new test gets exactly 4 with the fix removed.
    A club match-play knockout puts every entrant in the draw, with byes to the top seeds.
    **Fixed:** when the bracket is the first round, every confirmed entrant is drawn; the Rounds
    card, the bracket's subtitle and its qualification panel now say so instead of offering a cut.
    A bracket fed by a round robin or a medal is unchanged — the seeded Summer Knockout still reads
    "Top 8 overall", 8 of 16.
17. **"Add bracket" said "No pairings are drawn — the field returns cards"** — the stroke-play
    sentence, for a knockout. **Fixed:** the line says what each round type draws.
18. **A fresh tournament refused all eight members** for want of an email: "Set it up yourself"
    takes the club default (email sign-in), while the Stableford — copied from a Round Code
    tournament — had entered the same eight an hour earlier. The picker named one remedy (go and
    find eight addresses). **Fixed:** it also names the other, "Access code on their scorecard", by
    the option's own label.
19. **The guide asked a straight knockout for flights** ("4 of 5 — NOW Flights") that its draw then
    ignores. **Fixed:** the Flights step, the journey card and the dashboard checklist leave it out
    when the bracket is the first round; the guide now reads "Setup is done — all 4 parts" and names
    the one thing left (the date).
20. **Score entry was a dead end for every knockout round** — the newcomer's and the seeded Summer
    Knockout's alike. It opened the bracket round as a stroke card for every player (eliminated
    ones included), and "Match by match" said "generate flights to draw this round's matches",
    which never happens for a bracket. **Fixed:** a bracket round says "Round 2 is the knockout —
    its matches are recorded on the bracket", with a button there, and nothing that does not apply.
21. **A straight knockout's standings screens showed nothing true.** With a semi-final already
    decided, the Live leaderboard listed all eight players on 0 played / 0 points "reflecting the
    qualification cutoff", and the dashboard showed "Qualification cutoff · Top 2/flight · cutoff ≈
    0 pts" and "8 of 8 advancing". **Fixed:** in a knockout with no qualifying round the draw *is*
    the standings — the Live leaderboard shows it (read-only), and the dashboard drops those cards
    and says so. A knockout fed by a qualifying round is unchanged.

### Consistency sweep: every tournament's dashboard against its leaderboard

All 13 tournaments walked, reading the dashboard's counts against the board's rows. They agreed
everywhere (the league's "17/20" and its week view's "17 of 20 in", the championship's 16/16 after
the cut, the four-ball's 8/8 sides) except one:

22. **"8 still out on the course" for eight finished cards.** The newcomer typed in all eight of the
    Stableford's cards; the leaderboard ranked all eight on eighteen holes, Score entry's approval
    panel said "8 cards need attention — not certified yet", and the dashboard said "0/8 certified ·
    8 still out on the course". Nobody was on the course. **Fixed:** the dashboard now says
    "8 finished, not yet certified · accept on Score entry", and "still out on the course" counts only
    cards that really are part-way round. (The committee queue is unchanged on purpose: an uncertified
    card waits on the player's marker, not the committee.)
23. **A leaderboard with no rounds claimed a format.** The seeded Captain's Day — eighteen entered,
    no round added — showed "Overall standings · stroke play (gross / net / to-par)" over eighteen
    rows of dashes. **Fixed:** "No rounds yet — there is nothing to rank until this tournament has a
    round", with the link to add one.
24. **A finished championship was still being set up.** The completed Club Championship carried
    "Setting up · 4 of 5 done · NOW Flights" on every setup screen — a locked, finished tournament
    told to make flights a single-division medal doesn't need — and its lock banner said "the
    tournament is live". **Fixed:** the guide stops at launch; the banner says "launched".

### The player app in every tournament shape

Until now the player app had been walked as a medal player. Walked as the seeded member in all
eight of their tournaments at 393px — medal, championship, knockout, league, four-ball invitational,
nine-hole Stableford, a round-less meeting and the festival of formats. Every screen returned 200
with no horizontal scroll and no script errors, and Today, Board and My card agreed with each other
in all eight (medal −2 net thru 11 on both; league 132 pts on both; nine-hole 13 pts on both;
the foursomes side 35 gross / 30 net / 5th of 8 on Today and on the board). Two faults, both in the
knockout:

25. **A knockout player could not find out who they were playing.** The Summer Knockout member,
    beaten in a semi-final, opened Today and read "your score is recorded against your opponent —
    it appears on the board as soon as it's in". No opponent was named, and the Board showed only
    the qualifying match points with "Round 2 · Not settled yet". The draw existed only in the
    organizer's console, so no screen a member could open said who was still in. (Match-play
    rounds name the opponent from the Match table; a knockout files its results elsewhere.)
    **Fixed:** Today has a "Your tie" card — "Semifinal v Dot", or "Semifinal v the winner of Dot v
    Eve" before that's played, "Out in the semifinal · lost to Dilip Ranganathan at the 19th",
    "Runner-up", "Champion" — and the Board shows the draw read-only under the standings (or instead
    of them when the knockout is the first round, matching the console fix in #633). The Your card
    note now points to the draw. **The club's public share link had the same gap and gets the same
    draw** — checked on the Summer Knockout and on the newcomer's straight knockout, each made
    public for the check and put back to "participants" in the same script.
26. **The board said a tie at the cut was still undecided after the draw had settled it.** Under
    the qualifying table: "Rafe Sandoval and the last qualifier are level on 10.5 pts … A play-off or
    your published countback decides who goes through — the app has not", printed above a draw with
    Rafe in it at seed 8, whose quarter-final was already lost 4&3. **Fixed:** once the draw is fixed by
    its first result, the cut-line notes (tie, level-on-points, bubble watch) are no longer shown, on
    the player board and on the console's highlights alike.

    Noted, not changed: the seeded draw is not the qualifying order — Hattie Mwangi (0 points, 16th)
    is seed 5 while Lena Kowalczyk (12.5, 5th) isn't in it. In the app a draw is frozen from the
    qualifiers at the first result, so this is the fixture, not the product. But it shows the board's
    CUT LINE divider still follows the live qualifying order after the draw is frozen; if results
    are corrected after the draw, the divider and the draw can disagree. Left alone: changing who is
    "advancing" after a draw is qualification logic, and the draw itself is correct.

Then the same eight tournaments at 320px, the narrowest phone: Today, Board, My card, Money and
Rules in each, plus Events, Calendar and Messages — 43 page loads, every one 200, one heading
each, nothing wider than the screen outside its own scroll box, no console or hydration errors.

### Money: the player's and the organizer's figures, side by side

The April Medal is the seeded tournament with money on it — expenses, a closest-to-the-pin, low
net and a net skins pot, round still in play. The player's settle-up adds up (expenses £35.95,
side bets −£3.00, settled −£7.00 → owed £25.95), and every pot on the player's screen matches
the organizer's Prizes screen (closest-to-the-pin £42.00 = 14 × £3; low net £24.00 = 12 × £2;
skins £80.00 = 16 × £5). The organizer's skins table shows a running split and says
"Provisional — some holes have no score yet"; the player's screen correctly shows no running
figure. The Nassau stake set on this stroke round is flagged on Prizes with what to do about it.
One fault:

27. **"3 games still to play · £10.00 in" counted a game already decided and paid.** The
    closest-to-the-pin had a winner, and its −£3.00 was already on the settle-up as a side bet —
    the ledger pays a contest the moment a winner is ticked. The exposure line counted the same
    £3 again as a game still to play. **Fixed:** it now reads "2 games still to play · £7.00 in"
    (low net £2 + skins £5). Only the exposure line changed; no settlement or payout figure moved.
    The test was written first and failed on the old code.

### The public sign-up page

The page a member opens from the club's link, signed out — walked on the three open tournaments
at 393px and 320px: all 200, no overflow, no errors; the full-field one says "Field full —
joining the waitlist" and its button says "Join the waitlist".

28. **None of its six boxes had a name for a screen reader** — name, email, handicap index,
    index type, mobile, preferred tee. The captions were on screen and attached to nothing. The
    accessibility pass (#627) covered the console and the player app and missed this page, which
    is neither. **Fixed**, with the boxes also telling the phone which is the name and which the
    email (so autofill offers the right thing), and a refused entry's error is announced.

    Noted, not changed: the seeded tournaments show their date as "2026-10-23" on this page. That
    is the seed script writing a raw date; a date saved in the app is stored as the club's own
    wording ("Fri 23 Oct 2026").

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
3. **Default flight rule for a stroke or Stableford round: "By handicap"** instead of "Balanced
   skills" (see the golf-pro note above). A one-line default, but it changes what every new medal's
   divisions look like, so it's your call.
4. **Default bracket arrangement for a new knockout: "One bracket"** instead of "Two flights".
   Today a newcomer's knockout of eight is split into two brackets of four (top four seeds and bottom
   four) — a real club format (A and B divisions), but not what most clubs mean by "the knockout".
   It is one click to change on the Bracket screen; the default is your call.
5. **Should a fresh tournament default to access codes rather than email sign-in** when the club's
   roster holds no addresses? The picker now points at the option; the default is a product decision.
6. **Players cannot record their own knockout results.** The bracket is staff-only to edit, so in a
   club knockout played over weeks (players arrange their own matches) every result has to go
   through the secretary. Most club knockouts let the winner report it. Worth deciding before a
   club runs one — it is a permissions question, so not changed overnight.

## Log
