# Overnight report — 2026-09-25 → 26

Ajay asked for the app to be tested all night "as a golf pro and experienced tournament
organizer", fixing as I go, and — specifically — tested **as a non-golfer running a tournament**.

## Morning summary

**21 pull requests, #621–#641, every one gated locally, merged only on a green CI run, and
confirmed live on tourneyhq.club** (each deploy checked by its own production run). 33 numbered findings below, each with what a member or
organizer would actually have hit. Nothing touched production data; every walk ran on the
development database and every fixture change was put back.

**The biggest things fixed**, in the order a club would feel them:

- **Tournaments created from the list scored against an empty card** — every board, Reports and
  the public page (#626).
- **A straight knockout left half the field out of the draw**, and its members could not see the
  draw anywhere — not on Today, their Board or the public link (#631–#633, #636).
- **Score entry scrolled sideways on a phone** in six of eleven tournaments, taking holes 13–18
  off the screen (#640); Score entry for a knockout was a dead end (#632).
- **The public link could 500 once per tournament after a deploy** — a cached board of the old
  shape read by new code (#641).
- **The same round showed −2 on Today and +5 on My card**, net and gross unlabelled (#628); the
  tee picker called Blue "the tournament's" on a medal off the Whites (#639); "3 games still to
  play" counted a pin already won and paid (#637).
- **Every form control in the console, the player app and the public sign-up** now has a name a
  screen reader can announce (#627, #637).

**What was tested:** three tournaments built from scratch the way a newcomer would (a Scramble, a
Stableford, a match-play knockout), following only what the app says; the seeded club's eleven
tournaments as the secretary (220 console loads at desktop width, 209 at phone width) and as a
member (eight tournaments × every player tab at 393px and 320px); the public share link and the
public sign-up; a real score entered on a phone and taken back; the money screens player against
organizer, pot by pot; and one consistency sweep of every dashboard against its leaderboard.

**What was clean** is worth knowing too: every page returned 200 in every sweep; the league, the
four-ball and the medal agree across Today, the Board, the leaderboard, Reports and the public
link; the money adds up on both sides.

**Six decisions are yours** — see "Decisions needed from Ajay" near the end. A seventh (a finished
cut championship ranked players who missed the cut among the finishers) was answered the same
morning — Completed closes the rounds — and is built as item 34.

**The day after (2026-09-26, you out):** your two morning decisions built (#643, #644), then
the app walked as an ordinary club member — Today, card, board, money, calendar, messages, a
knockout, a league, the foursomes, the casual round — at 393px and 320px, every figure checked
as a golf pro would (a medal handicap to the shot under WHS; the money to the penny). Items
37–45, PRs #645–#648. Two more decisions noted for you under "Noted, not changed": a one-tap
entry a member cannot undo, and Events filing dated rounds under "No dates yet".

**The second night (2026-09-26 → 27, "keep testing with multiple roles"):** your three evening
decisions built first (#650: a member can withdraw until entries close; Events dates an undated
tournament by its rounds; a round picker on the console leaderboard). Then the app walked as
every role it has — secretary, member, public viewer, an assistant (the first time that role was
ever walked) and the organizer who also plays — with the same fact checked from each side.
Items 46–54, PRs #649–#653, every one confirmed live. What a user would have hit:

- **An assistant was shown five organizer-only buttons that failed every time** — clear scores,
  a round's course and tees, a flight's tees, the knockout arrangement, the course search — and
  links into two screens they cannot open dropped them on the dashboard with nothing said. Both
  fixed: the buttons follow the role, and a refused visit now says why (#651).
- **One-tap entry let a member in without the mobile** every other way in requires (#652).
- **A player entered after the tee sheet was drawn** saw no tee time and no reason (#652).
- **A finished championship listed its missed cut in sign-up order** (+20, +15, +19 …) — now by
  score, still without a place (#653).
- Checked and right: a member withdrawing, from the member's side and yours (18 → 19 → 18);
  the skins pot to the penny on your Prizes against the member's Money; Reports against the
  public board; the new round picker on a phone.

**Two new decisions for you** (end of the "second night" section): whether the audit log gets a
screen — it records withdrawals, money and cuts, and nothing shows it — and whether assistants
should be allowed to set a round's course and tees. **Both answered "yes" on 2026-09-27 and built
(#655).**

**The day of 2026-09-27 ("keep continue with the testing and fixing"):** items 57–67, PRs
#656–#659, every one gated locally (the last three with the full Playwright suite too) and
confirmed live. What a user would have hit:

- **The Tournament details, Rounds & formats, Teams, bracket and Clear scores screens of a live
  tournament offered 35 controls that crashed the page** into "Application error" when pressed.
  Each now follows the lock and says to unlock setup (#657).
- **The tee sheet showed a fresh shuffle over the published sheet**, so the secretary read a
  player's time as 8:50 when he'd been given 8:10 (#659).
- **A member who set up a casual round was told they weren't in it**, and a blank handicap on a
  net round silently played off scratch (#656).
- **Picking "Stableford" started a round called "Stroke Play"** (#658).
- **A finished board promised a result "when it is settled"**, and **"You're in!" was a dead end**
  for a member sent to the entry form (#659, #657).

The walks ended when two passes in a row found nothing new: as an assistant, on a Stableford
nine, and on a knockout. **Three new decisions** (8–10 under "Decisions needed from Ajay"):

- which mid-event jobs should work without unlocking setup — **decided, built (#661)**;
- what "gross" should mean on a Stableford round — **decided, but held back: it needs a count
  from production first (see 9)**;
- whether the round picker goes on the public board — **decided "yes, both", built (#662,
  item 68)**.

Five one-liners are also under "Noted, not changed".

The rest of this file is the night's log in the order it happened.

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
| #636 | **A knockout's members could not see the draw anywhere** — not on Today, their Board or the club's public link; the board also said a tie at the cut was undecided after the draw had decided it (items 25–26) | live |
| #637 | A player's "games still to play" counted a closest-to-the-pin already decided and paid; the public sign-up form's six boxes had no names for a screen reader (items 27–28) | live |
| #638 | Reports and the club's public link showed the console's "Overview · Live leaderboard" heading inside their own page for team, skins, Nassau and Modified Stableford rounds (item 29) | live |
| #639 | Score entry's tee picker called the course's first set "the tournament's" — Blue on a medal played off the Whites (item 30) | live |
| #640 | **Score entry scrolled sideways on a phone** in six of eleven tournaments; the dashboard's Flight standings showed empty cards, a caption about highlights nobody got, and "2, 2" for a shared place (items 31–32) | live |
| #641 | **The club's public link could 500** once per tournament after a deploy — a cached board of the old shape read by the new code (item 33); this morning summary | live |
| #642 | This report: every PR's live status confirmed | live |
| #643 | **Completed closes the rounds** — your decision; players who missed the cut no longer rank among the finishers, and say "didn't play Round 2" (item 34) | live |
| #644 | **A stroke-play cut is made when its round is marked finished** — top N and ties, your decisions; cut players were being offered the next round's card (item 35) | live |
| #645 | Today called a season total "YOUR CARD"; a Stableford card never showed its points; entry deadlines in American on a British club (items 37–39) | live |
| #646 | The calendar put Round 2 before Round 1; a knockout's Today said "Position T1" over "Out in the semifinal"; two audit lines counted rounds by hand; the seeded money held rows the app refuses (items 40–43) | live |
| #647 | Ties printed "1, 1, 3" on the sides, skins, Modified Stableford and league tables and "T1" everywhere else (item 44) | live |
| #648 | My own #645 made the league read "YOUR TOTAL · FINAL" four weeks into seven — now "SO FAR" until completed (item 45) | live |
| #649 | The rules sheet named the format twice, once in the app's internal words (item 46) | live |
| #650 | **Your three evening decisions**: a member can withdraw until entries close; Events dates an undated tournament by its rounds; a round picker on the console leaderboard (items 47–49) | live |
| #651 | Testing as an assistant: a link into a screen you cannot open now says why; five organizer-only buttons no longer offered to assistants (items 50–51) | live |
| #652 | One-tap entry let a member in without the mobile every other door requires; a player entered after the tee sheet was drawn was told nothing (items 52–53) | live |
| #653 | A finished championship's missed cut was listed in sign-up order — now by score, still without a place (item 54) | live |
| #655 | **Your two "yes" answers**: a Recent changes list on Reports and Registration; assistants set a round's course and tees (items 55–56) | live |
| #656 | A member's casual round: the organizer wasn't recognised in their own round; a blank handicap silently played off scratch; "the tournament's" tees and "Back —" on a nine (items 57–61) | live |
| #657 | A live tournament's setup screens offered 35 controls whose action crashed the page — each now follows the lock; "You're in!" leads a member back to their events (items 62–64) | live |
| #658 | Picking "Stableford" started a round called "Stroke Play" — now a Stableford round, scoring measured identical (item 65) | live |
| #659 | The tee sheet showed a fresh shuffle over the published sheet — it now shows the sheet the players have; a finished board no longer promises a result "when it is settled" (items 66–67) | live |
| #660 | This report: the day of 2026-09-27 and three new decisions | live |
| #661 | **Your decision 8**: drawing the next round, adding a round, deadlines, the single match and the third-place play-off work on a live tournament without unlocking; a drawn round with scores is refused rather than wiped | live |
| #662 | **Your decision 10**: the public board and the player's Board get the round picker (item 68) | live |
| #663 | "On now" on Events showed nothing to a member playing in five tournaments; the switcher now says which one has their card open; the landing's Club card promised "WHS posting" and its Free card "as many players as turn up" (items 69–71) | live |
| #664 | Retire the team season engine no screen ever called (from a separate session; the week sheet's stroke table finding it surfaced is parked by Ajay) | live |
| #665 | A switched-off feature said "On the paid plan" to clubs already on it; the wordmark's "HQ" was under the 10px floor (items 72–73) | live |
| #666 | **The TourneyHQ logo stands up**: one lockup everywhere, the mark the full height of the word, deeper orange on light screens (your choice); the new-round page opens on its header (item 74) | live |
| #667 | The share picture that unfurls when someone posts a TourneyHQ link now wears the real lockup (from the landing session) | live |
| #668 | **Your local prices**: a club is quoted its own set price in GBP, EUR, CAD, AUD, NZD or ZAR, otherwise USD; the owner console lists them (from a separate session) | live |
| #669 | **Your "App too, from the club's country"**: a Golf words setting, and the first screens say buggy/fourball/organiser for a UK club (item 75) | merged |
| #670 | More of the player app in the club's golf words: Today, Enter, Messages, the refused-screen notice (item 76) | merged |
| #671 | The organizer's Voice entry switch never did anything; now it does. The landing stops overstating its sixteen formats (items 77–78) | merged |
| #672 | A UK club's own role reads "Organiser" on every screen at once (item 79) | merged |
| #673 | A second tap on a listening mic stops it, on every screen that has one (item 80) | merged |
| #674 | A US club's dates in US order everywhere; the tee sheet's group words follow the club (item 81) | live |
| #675 | **Your landing redesign, ported to the real site**: country editions, real captures, the sourced comparison, /faq (from the landing session) | live |
| #676 | Landing refinement: readable phone-width crops, the phone hero, stacked comparison on phones (from the landing session) | live |
| #677 | The landing's sign-in form clears the 44px touch minimum (item 82) | live |
| #678 | A notice says when it was posted; a net board says its To par is net; a complete card asks to be certified (items 83–85) | live |
| #679 | Landing polish: named comparison tabs, a formats gallery, facts-only copy (from the landing session) | held: /faq overflowed at 320px (fixed), now reopened for Ajay's mobile rework |
| #680 | A new club can start before its first tournament: add members and save settings; entry form in the club's words; labelled Members form (items 86–88) | live |
| #681 | A new club can decide how money works before its first tournament (item 89) | live |
| #682 | A club member with nothing published is told their club; /week's number headers no longer run together (items 90–91) | live |
| #683 | The Events card tells a waiting-list member the truth about their place (items 92–93) | live |
| #684 | An entry awaiting approval is said as such, not as a waiting list (item 94) | live |
| #685 | Recent changes says who approved an entry and who got a freed place (item 95) | live |
| #686 | Every action written to the record has a heading; a forfeit is a result (item 96) | live |
| #687 | Sign-in addresses land on the sign-in panel; branded 404 and error pages (item 97) | live |
| #679 | Landing phone rework: comparison and pricing side by side on phones, clean phone crops, no sideways scroll at 320px (from the landing session) | live |
| — | **A new club couldn't get started** — fixed; the public entry form speaks the club's golf; a withdrawal says what was given up; Members form labels (items 86–88) | pending |

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

### Every console screen in every tournament

As the club secretary: twenty console screens in each of the eleven seeded tournaments at desktop
width — 220 page loads. All returned 200, none overflowed, none showed an application error. The
only console errors were three dropped connections to the dev server's reload socket while it
restarted itself for memory, which is the development server and not the app. One screen was
wrong:

29. **Reports carried a second "Live leaderboard" heading — and so did the club's public link.**
    The Invitational's Reports page had two page headings: its own, and the "Overview · Live
    leaderboard" header of the team board it embeds in its print snapshot — so the sheet a
    committee prints and pins up after the round said "Live". The public share link embeds the
    same four boards (team, skins, Nassau, Modified Stableford) under the tournament's own name,
    so members saw the console's "Overview" kicker and a second heading there too. **Fixed:** both
    screens take the table and its one-line "what this is ranked on", without the console's page
    header. The console's own Live leaderboard is unchanged. Checked in the browser on Reports and
    on the public link (one heading each); the public board was already public and was left so.

### A score, entered and taken back

The thing a member does most, done for real on the April Medal as the player (thru 11): tapped
"Par" on the 12th. The card moved on to the 13th by itself and said "Saved — 12 of 18 holes in";
Today then read "thru 12 · net −2" and the Board "T9 · thru 12 · −2" — gross 52, +5 on the card,
all three agreeing. Emptying the 12th's box took the score back off, and after a reload the card
was thru 11 again, exactly as seeded. No console errors throughout.

Then the organizer's side of the same round, Score entry:

30. **The tee picker named the wrong set as "the tournament's".** The April Medal is played off
    the Whites — the tournament's tees, the round's, and every player's. The picker's first
    option read "Blue (the tournament's)", directly above a card headed "TEES White". It was
    naming the course's first rated set rather than the tournament's own choice, so an organizer
    choosing it was promised Blue and would have had every card priced off White. A wrong tee
    moves every course handicap in the round, so this is the kind of label a committee acts on.
    **Fixed:** the page now works the name out through the same chain that prices the cards
    (round, then tournament, then course) and the option reads "White (the tournament's)".
    Nothing that scores a card changed — only the words on the option. Flights and Registration
    have the same kind of option and were already right.

### The league, the festival and the dashboards

The Thursday league agreed across all four readers — the night's results, the season table on the
week sheet, the Live leaderboard and the member's Today (8th, 132 points, everywhere), and the
movement column is read out properly by a screen reader ("up 2 places"). The Festival's ten
played rounds, Modified Stableford to Texas Scramble, all read "Played". One card was wrong on
several dashboards:

31. **Flight standings said things that were not so.** On the finished championship and the
    nine-hole Stableford (no flights) and the Festival (a round scored by hand) it showed its
    heading over nothing. On every tournament where nobody advances it still said "Advancing rows
    highlighted". And on the April Medal a shared flight place read "2, 2" — every board has
    printed "T2" since #621. **Fixed:** the card appears only when it has rows, the caption only
    when a row is lit (the knockout keeps it), and a shared place reads T2.

### The console on a phone

An organizer on the course is on a phone, so the same twenty screens in all eleven tournaments
again at 393px — 209 loads.

32. **Score entry scrolled sideways on six of eleven.** By 85 to 170 pixels, taking the round
    tabs and holes 13–18 of the hole picker off the right edge. The cause was one line: the
    caption under the heading ("Stableford · Braid Hollow — Championship Course · …") was told
    never to wrap, and a real course name made it 530px wide. The end-to-end layout check measures
    this very thing at phone widths and missed it because its test course has a short name.
    **Fixed:** the caption wraps; all eleven measured clean at 393px and at 320px.

    Two other screens (Announcements on the league, Tournament details on the Winter Series)
    measured wide once and clean on every re-measure since — read as the development server
    restarting mid-page (it does, for memory), not as a fault. The only genuinely wide thing on
    Tournament details is the setup guide's step strip, which scrolls in its own box by design.

### The public link, once more

The share link is the page a club sends its members and families, signed out. Every seeded
tournament that allows it (five), at 320px and 393px: no overflow, one heading, no errors — and
one 500.

33. **The public link threw a server error once, then worked.** The April Medal's link returned
    500 ("Cannot read properties of undefined") and a clean page a moment later. The public board
    is cached, and the cache outlives the code that filled it: an entry built before last night's
    #636 added the knockout draw to the board was handed to the page that now reads the draw.
    On Vercel that cache is documented to persist across deployments and to serve a stale entry
    once while it refreshes — so in production the first spectator after any deploy that changes
    the board's shape could get an error page, once per tournament. **Fixed:** the cache is keyed
    on the deployment, so a new deploy never reads the old one's entries, and on a shape number
    that a test ties to the board's fields — add a field without bumping it and the test fails
    with the instruction. All five public boards measured clean twice over afterwards. (Not
    reproduced against production: I have no production share token and did not go looking.)

### Decided the next morning — Completed closes the rounds; closing a round makes the cut

34. **Built as Ajay decided.** Marking a tournament Completed now closes every round still open,
    through the same "This round is finished" his #577 rule already reads, and the audit log says
    which. A round the committee closed earlier keeps its own time; reopening the tournament
    leaves the rounds closed (a closed round blocks no card, and each can be re-opened on Rounds
    & formats). Tried through the real button on the seeded Club Championship, put back to live
    for the purpose: after "Complete tournament" the sixteen who played both rounds rank 1–16 and
    the twelve cut after round 1 hold no place. And the sheet now says why — they were captioned
    "card incomplete" (console) and "F · not ranked" (player board, public link), both wrong about
    a complete card; all three now read **"didn't play Round 2"**. The seeder closes the rounds of
    the tournaments it writes as completed, so a fresh seed shows the same. Tests: the real action
    against real rows (the precondition — the cut player leads while round 2 is open — asserted
    first), and the caption on both boards; every rule mutated and watched go red.

35. **A stroke-play cut was never applied — cut players were offered the next round's card.**
    Found walking the finished championship as a player who missed the cut: her Today said
    "Start my card" for round 2, and My card opened an empty round 2 card to fill in and certify.
    Saving one would have put her straight back on the board. A cut could be set on a stroke round
    ("cuts to top 16") and was printed on the rules sheet, but nothing ever applied it — the only
    code that makes a cut builds rounds from a round robin. **Ajay decided, 2026-09-26:** the cut
    is made AUTOMATICALLY when the round it is taken out of is marked finished, and players level
    on the last place ALL go through ("top 16 and ties"). **Built:** closing round 1 ranks the field
    on round 1 alone (a round 2 card somebody started early cannot move the cut), gives every
    survivor an empty round 2 card and nobody else one, and writes one audit line ("Round 1
    closed: top 16 and ties go through — 17 into Round 2"). Closing it again after a correction
    re-makes the cut on the corrected scores; an empty card left with somebody who no longer
    survives is removed, a card with a score on it never is. A player the cut left out is told
    "You didn't make the cut after Round 1" on Today and My card, and the server refuses a card
    from them (the committee can still enter one). The Rounds screen's cut help now says when the
    cut is made. Tests: the tie rule on its own (including a tie BELOW the last place, which stays
    out), and the whole flow through the real actions with both roles — every rule mutated and
    watched go red. Checked in the browser as the cut player on the seeded championship.

36. **A member's Events list is walked as a member now — and two things on it were mine.** The
    three tournaments I built from scratch overnight ("zz-novice …") were still in the development
    club and sat at the top of every member's Events as "ON NOW"; deleted, as CLAUDE.md says a
    fixture must be. And ten of the seeded club's eleven tournaments were filed under "No dates
    yet", the live medal among them, with the sign-up page printing "2026-10-23": the seeder wrote
    each tournament's date only as a sentence, while the app writes the calendar dates too and
    groups by them. The seeder now writes both, labelled the way the app labels them ("25 Sept
    2026"). A fixture problem, not an app one — but every walk runs on this fixture.

### An ordinary golfer's day (2026-09-26, Ajay out)

The member's own questions, on a phone: what's on, can I enter, when do I tee off, how am I
doing, what did I score. The tee time is on Today (group, time, playing partners). Three things a
golfer would stop at:

37. **"YOUR CARD · 132" over a card that scored 36.** Today's big number is the player's standing
    — the right number to lead with — but the panel called it "YOUR CARD" whatever it covered. On
    the league it sat over the week-4 card (36 points) while 132 was the season; on the 36-hole
    championship "+27" over the round-2 card. **Fixed:** when the standing covers more than this
    round it says so — "YOUR TOTAL · 72 HOLES · FINAL"; one round stays "YOUR CARD".
38. **A Stableford card never showed its points.** Gross, to par and net, on a round decided on
    points — the Twilight Nine card read "Net 37" while Today said 13 points. **Fixed:** on a
    Stableford round the card shows Points (13, the board's own figure) in place of to-par, both
    hole by hole and in the full card's totals; Modified Stableford uses its own table. Worked
    out through the same scoring functions the board totals with, so the two cannot disagree.
39. **Entry deadlines in American on a British club's screens.** An Events card read "24 Oct 2026"
    for the tournament and "Entries open Sep 19, 2026 · close Oct 17, 2026" beneath it; the
    sign-up page and the organizer's Registration screen the same. Ten calls to the deadline
    formatter passed no locale and fell back to US English. **Fixed:** every one now takes the
    tournament's own locale (override, then club), and a test sweeps the whole source so a new
    screen cannot bring the American date back.

40. **The member's calendar put Round 2 before Round 1.** The Club Championship read "Sat 22 Aug ·
    Round 2" above "Sun 23 Aug · Round 1" — dates right, numbers swapped. The round number is a
    count down a list, and the calendar fetched its rounds in whatever order the database kept
    them; closing Round 1 (item 34) rewrote that row and moved it to the back. **Fixed where the
    number is made**, so no screen can repeat it: a round is now numbered by its position in the
    tournament, whatever order the rows arrive in. The same sweep found two lines in the audit log
    ("Closed Round N", one of them mine from item 34) counting rounds by hand. The test that exists
    to stop exactly that had exempted the whole 5,000-line file for one legitimate use, so it never
    saw them. Both fixed, and the test now allows that file its one legitimate use and no more.

41. **A knockout's Today said "Position T1" over "Out in the semifinal".** The member topped his
    round-robin group and lost the semi at the 19th; the first panel was the QUALIFYING table,
    labelled as if it were his finishing place. Both numbers were right; the name was wrong. It
    now reads **"Qualifying T1"**, and the top-five board beneath it is headed QUALIFYING. Stroke
    rounds unchanged. No ranking touched.

42. **The seeded money was a shape no club could store.** Money read "Paid by Séamus · £80.03" beside
    a balance that only works if he had paid £71.03 — the seed had recorded a £9 repayment as a
    second PAYER on the bill, which the app's own form refuses. The team dinner was worse: five
    £20 "payers" on a £410.05 bill, and the line never named who paid the other £310.05. The app
    was right about the money throughout; the fixture was wrong. Now a settlement and a real
    two-card bill, and the seeder checks its own bills. After re-seeding every figure on the
    member's Money screen reconciles by hand: expenses £44.95, side bets −£3.00, settled −£16.00,
    owed £25.95, and the four suggested handovers also come to £25.95.

43. **Walked and found right** (as a member, at 393px and 320px, no console errors, no sideways
    scroll): Money and settle-up, messages, the calendar, the knockout draw (seeded 1v8, 4v5, 3v6,
    2v7), and the foursomes round (every side's net to-par correct against Ardmore's par 32, and
    Today's "5th of 8 sides" matching the board).

44. **A tie printed "1, 1, 3" on four boards and "T1" on the rest.** The foursomes board read 1, 1,
    3, 3, 5, 6, 6, 8 beside a medal board reading T9, T9, 11 — two conventions on one phone. The
    app settled on "T" the day before; the sides, skins, Modified Stableford and league tables had
    simply never been brought onto it (the league table's own notes promised "T12, T12, 14"). All
    four now print T1, T1, T3. Also checked a member's medal handicap by hand under WHS — index
    8.4 off the White tee (70.8/129, par 71) at 95% is 9 shots, and all nine fall on stroke index
    1–9 — correct to the shot.

45. **My own item 37 said a season was over when it wasn't.** Item 37 named Today's big number
    "YOUR TOTAL" when it covers more than one round — and kept the card's label after it. That
    label says "Final" when a player's returned cards are complete, so the Thursday league read
    **"YOUR TOTAL · 72 HOLES · FINAL"** four weeks into seven, with the next round on Tuesday and
    "these standings will change" printed underneath. **Fixed (#648):** a complete total says **SO
    FAR** until you mark the tournament completed; then it says FINAL. A single round still reads
    "YOUR CARD · FINAL", which is true of the card. Checked on the league (SO FAR), the completed
    championship (FINAL · GROSS) and the live medal (YOUR CARD · THRU 11 · NET).

46. **The rules sheet said the format twice, once in the app's own code.** A member's Rules read
    "Format: Stroke Play · Stroke Play Round" on the medal, "Stableford · Stroke Play Round" on
    the Twilight Nine (a contradiction to a golfer) and "Match Play · Bracket Stage" on the
    knockout. The round's type now follows the format only where it tells two competitions apart,
    and in the words the app shows elsewhere: "Stroke Play", "Stableford", "Match Play · Bracket".
    Also walked, and right: "entered, nothing to play yet" (Spring Meeting) on Today, card and
    board; the waiting-list line on Events; the medal's sheet otherwise — 95% under Appendix C,
    countback 9/6/3/1 under Committee Procedures 5A, certification under Rule 3.3b.

### Decided that evening — built overnight (your answers of 2026-09-26)

47. **A member can withdraw their own entry until entries close.** On Events, an entered or
    waiting member now sees "Can't make it? Withdraw" — two steps, because a place given up in a
    full field goes to the next person waiting and entering again joins the back of the queue. It
    does exactly what your own removal does: somebody who has already played is kept as withdrawn
    with their cards, anybody else is removed; their tournament sign-in goes; a place freed in a
    full field goes to the first person on the waiting list, only if there is room; and the
    tournament's audit log records that they withdrew themselves. **Correction, the same night:**
    no screen shows that log yet, so you would not actually see the line — see the decision below
    item 52. "Entries close" is read off the same
    rule that lets them in — past the deadline, closed by you, or finished, and the button is
    gone. Tried as a member on Captain's Day: in, withdraw, confirm, and the card is back to
    "Open for entries · 22 of 40 places left".

48. **Events files a tournament with no dates by its rounds' dates.** The Summer Knockout and the
    Thursday league had left "No dates yet" and now sit in the season list on their first round's
    day, where the member's calendar already put them. Where a tournament has no date sentence of
    its own either, its card says the rounds' span ("Sat 5 Sept – Sat 19 Sept"). The tournament's
    own dates still win wherever they are set.

49. **The console leaderboard has a round picker.** On the Festival of Formats every round is
    reachable again — "Showing: Round 1 · Modified Stableford" and so on, the same picker Group
    games uses — and the hand-scored last round is still where it opens. It appears only where
    choosing changes the board: a two-round medal or a league of Stableford weeks shares one
    board and gets no picker. **Not done:** the dashboard and Reports still show the board's own
    round only; your answer was about the leaderboard, so I left those alone.

### The second night — testing as each role (you asked: "keep testing with multiple roles")

Walked as the club secretary, as a member, as the public viewer and — for the first time — as an
**assistant**, the role that runs a tournament without reshaping it. There was no assistant in
the seeded club, so one was created for the walk and removed afterwards. All 18 screens an
assistant may open loaded at 393px with a heading and no sideways scroll, all four they may not
sent them back, and the sidebar listed exactly the right screens. Two things were wrong.

50. **A link into a screen you cannot open landed on the dashboard in silence.** Five screens an
    assistant can open link to two they cannot — "change on Tournament details" on Registration,
    "Unlock the tournament" on Flights, "Correct the course's card" on Score entry, "Check the
    card" on Rounds & formats, "Club settings" on Prizes — and every click dropped them on the
    dashboard with nothing said. A player sent to Prizes the same. **Fixed where every refusal
    ends**, so a link written next year is covered too: the landing screen now says "Tournament
    details is for the tournament's organizer, so it can't open for you. If something there needs
    changing, ask them." It only ever names a screen it knows, so a crafted link cannot put words
    on the page.

51. **Five organizer-only controls were offered to assistants, and failed every time.** Found by
    a sweep of every organizer-only action against the screens an assistant can open, then each
    one read in the code: the knockout's Arrangement "Change" button, a flight's Tees select, the
    "Clear scores" button, a round's course and tees (on Score entry and on Rounds & formats), and
    the course-directory search. Each is now shown only to the organizer — on Rounds & formats the
    course and nine stay visible but greyed, with "The organizer sets where this round is played"
    on the page. **Kept for assistants, deliberately:** importing a spreadsheet of scores and
    typing in a course card, both of which the server allows them. And an assistant entering cards
    on a round with no course is still told the course is missing — a player still is not.
    **Your call if you want it the other way:** assistants could be allowed to set a round's
    course and tees (it is one permission on the server), but "assistants run it, they don't
    reshape it" is the rule the app was written to, so I matched the buttons to it rather than
    the other way round.

52. **One-tap entry let a member in without the mobile every other way in insists on.** Walked
    from both sides at once: a member entered Captain's Day in one tap, and your Registration
    screen then read "19 players have no mobile on file … entered before that applied" — untrue
    for the entry just made. A free club collects a mobile from every entrant; the public form,
    your own "add a player" and the roster import all refuse without one; the one-tap button did
    not ask. **Fixed:** it now keeps the same rule — "This tournament needs a mobile number, and the
    club doesn't have one for you yet — add it on the entry form", with the entry form one tap
    away. Also walked: a member withdrawing from Captain's Day as you watched Registration — 18 →
    19 → 18 confirmed, the numbers right throughout.

53. **Entered after the tee sheet was drawn, a player was told nothing about their tee time.**
    Walked as the organizer who also plays — you, adding yourself to your own medal after
    publishing its tee sheet. The sidebar offered "My round", and Today, the card and the board
    all treated you as a player, correctly. But Today showed no tee time and no reason, the same
    silence as "no sheet yet". A late entrant is in exactly this state. **Fixed:** "You're not on
    the tee sheet yet — the tee times for this round are out, and you were entered after they were
    drawn. The organizer adds you to a group." Shown only while the sheet is published, you are
    not on it and your card is empty; a drawn player still sees their group and time. (The seeded
    club has no organizer in any field, so this state was unreachable until the walk added one —
    removed afterwards.)

54. **The missed cut was listed in sign-up order.** Walked as the public viewer on the finished
    Club Championship's link: the sixteen who made the cut read −3 down to +33, correctly; the
    twelve who missed it read +20, +15, +19, +23, +15, +14 … — the order they entered, because
    nothing ordered a row without a place. Every results sheet lists the missed cut by score, and a
    member reading down that block reads nonsense. **Fixed:** below the field, the players who
    missed the cut now read +14, +14, +15, +15, +16, +19 …, on the same statistic as the board's
    own "Ranked by"; anybody with no score at all comes after them. **None of them is given a
    place** — your rule from #577 and the morning's Completed decision stands, and the test pins
    it. The console, Reports and the player's Board read the same list, so all four agree.

**A decision for you, found on that walk: the audit log has no screen.** Money changes, rounds
closed, cuts made, a member withdrawing themselves — the app writes a line for each, and nothing
in the app shows them. So when a member withdraws, your field simply goes from 19 to 18 with
nothing saying who or when. A small read-only "Recent changes" list — on Registration for entries
and withdrawals, or on Reports for everything — would make the record visible. Not built: it is a
new screen, and which one is your call. **Decided 2026-09-27 ("yes") — built, item 55.**

### Your two "yes" answers, 2026-09-27

55. **The audit log has a screen.** You did not say where, so both: **Reports** ends with "Recent
    changes" — the whole record, newest first, each line filed as Field, Scores & results,
    Rounds, Money or Settings — and **Registration** ends with "Recent changes to the field",
    entries and withdrawals only. Two things were needed to make it true rather than a list of
    withdrawals: the app never recorded an ENTRY, so a member entering in one tap, a stranger on
    the sign-up link, and you adding or removing somebody now each write a line too; and some
    money lines held a player's internal id, so the list turns ids back into names — and a
    player who has since left the field reads "someone no longer in the field", the words the
    settle-up already uses. Times are shown in your own time zone. Only you and assistants see
    either screen, as before. Lines from before today start with the withdrawals from last
    night's walk, because entries were not recorded until now.

56. **Assistants can set a round's course and tees.** On Score entry and on Rounds & formats, the
    round's course, nine and tees are open to assistants again — the server allows it now, so the
    buttons match. Three things stay yours, deliberately: searching the national course
    directory (it spends the app's shared daily lookups, so an assistant picks from the club's own
    courses), a flight's tees, and clearing a round's scores.

### The day after — a member's casual round, end to end (2026-09-27)

Walked as Séamus, an ordinary member, on a 393px phone: set up a net nine against a guest, scored
both cards, read the board and Today. Every figure checked by hand — 40 gross is +4 off a par-36
nine and 34 net with six shots; the guest's 39 is +3 and 38 net, because a 0.0 index still gets a
shot off the Blues where the course rating is above par. What was wrong was all in what the round
said to the people in it. The Recent changes list from item 55 was also checked from the
organizer's side this time: adding a player, removing one who never played and withdrawing one who
has now each have a test through the real actions, alongside the member's own entry.

57. **The person who set up a casual round was told they weren't in it.** Today said "You aren't
    entered in this tournament, so there's no card here" to the member who had set the round up,
    was playing in it and had a saved card on it. A player is recognised by their email address,
    and the setup screen asks nobody for one — so the organizer's own entry went in without theirs,
    although the code's own comment said it carried it. It now does: their entry is found by their
    own club record, or by their name exactly as the screen fills it in, and nobody else's entry
    gets an address. Today now shows "Your card" and "· You" on the leaders.
58. **…and then told to ask whoever set it up to keep the round.** That was themselves. Today now
    words the warning for whoever is reading it, as the dashboard already did: the person who set
    the round up gets the "Keep this round" button, and the other players are still told to ask
    them.
59. **A blank handicap on a net round played off scratch without a word.** The guest's box was
    left empty, and the card started them on "hcp 0" — their whole handicap given away with
    nobody having decided to. The setup screen now says "zz-walk Guest Golfer has no handicap
    here, so plays off scratch (0). Add it if they have one." It is still allowed, because scratch,
    or friends agreeing to it, is a real answer. The handicap boxes were also unnamed for a screen
    reader, which read out "12.4" for every player; each is now "Handicap for" the player.
60. **The tee picker offered "Blue (the tournament's)" on a round with no tournament.** On a casual
    round it now reads "Blue (as set up)".
61. **A finished nine read "Front 40 · Back —" under the card**, as if half the card were
    missing. On a round of the back nine it would have called its own total "Front". A nine now
    shows only the count ("9/9 holes"); the gross is printed just above it.

### The same day — the Recent changes lists, and a live tournament's setup

The Recent changes lists from item 55 were walked with real actions on Captain's Day: the
secretary added a player and removed them, Séamus entered on the sign-up link and withdrew. All
four lines appeared on both screens, newest first, in local time, with the right person against
each, and all filed as Field. Nothing to fix there. What the walk found was on the way.

62. **Adding a player to a live tournament crashed the page.** On the live April Medal, whose setup
    is locked, Registration still offered the "Add someone new" form. Every other control on the
    screen follows the lock and this one did not. Pressing Add replaced the whole screen with
    "Application error: a server-side exception has occurred", because the action refuses a
    locked tournament by throwing rather than answering. And the banner above it said, in bold,
    "You can still add players below". Now the Add button and the CSV import follow the lock, a
    line under the button says why it can't be pressed, the banner no longer promises it, and
    both actions answer in a sentence if anything reaches them.
63. **The same crash was waiting behind 34 more controls on five screens.** Swept as a class: 45
    actions refuse a locked tournament that way, and 34 of them could be reached from a control
    that stayed live on a live tournament. The five screens are Rounds & formats (24 controls:
    format, holes, scoring, cut, carry-forward, deadlines, tiebreakers, adding, drawing and
    deleting rounds), Teams & pairs (6), the bracket arrangement, Tournament details' Save, and
    Score entry's Clear scores. I reproduced it on the live Summer Knockout: "Change", then
    "Two flights", and the page went to the error screen, under a sentence that said changing it
    was blocked. Every one now follows the lock the server already enforces, and says to unlock
    setup. Nothing that was allowed before is refused now. The things that were deliberately left
    open stay open: a round's date, course and tees, "this round is finished", the round's
    handicaps and the sign-up deadline. A new guard fails if any control reaches such an action
    without being given the lock. It was watched failing on the old Rounds & formats and Teams
    screens, naming every action they reached.
64. **"You're in!" was a dead end for a member.** A member without a mobile on file is sent from
    one-tap entry to the entry form to add it. The form then confirmed them and stopped: no way
    back, and on the installed app no browser back button. It also told a signed-in member to "use
    this email to sign in". A signed-in member now gets "Back to your events", and is not told to
    sign in. A stranger on the public link sees exactly what they did before.

### A newcomer builds a tournament from scratch, once more (2026-09-27)

A brand-new organizer with no club, on a 393px phone, did the whole route: the create form, four
players, flights, a date, launch, and then every setup screen after launch. Nothing crashed after
launch, and each locked screen said so, which is what #657 was for. The launch button without
dates said why on the page, not only in a tooltip. Adding the field wrote four Recent-changes lines
under the organizer's name. One real defect, and three things for you.

65. **Picking "Stableford" gave a round called "Stroke Play".** The Stableford starting point
    created its round in an old spelling that the Rounds screen deliberately no longer offers.
    The newcomer saw "Round 1 · Stroke Play" on the dashboard under a points leaderboard, and on
    Rounds & formats a Stroke Play round with none of its scoring options ticked. It now creates
    a Stableford round, off handicap. It scores exactly the same, measured rather than argued: the
    same two cards through the league week's reader give identical points, net and places either
    way. One player's 37 points were worked by hand under Rule 21.1 and matched the board. Three
    old tests had pinned the old spelling on the belief that Stableford could not be chosen as a
    format; they now pin that no starting point creates the old spelling. Tournaments already
    created from it are unchanged and still score correctly.

    Two things were keyed on the old spelling, and would have broken with it. One was the
    create form's ordering, which dropped Stableford behind greensomes for a society; a test
    caught it. The other was the sentence on Rounds & formats that would have told the new
    round "scored as Stroke Play, so ties break by lowest net". A sweep of every
    remaining reader found no others. Both now recognise Stableford either way.

### The tee sheet and the public boards (2026-09-27)

66. **The tee sheet showed a different draw from the one the players had.** On the live April
    Medal, the secretary's Tee sheet screen put Séamus in Group 6 at 8:50. He had been published
    Group 1 at 8:10, and the printed cards on the same page said 8:10. The screen always showed a
    freshly shuffled draw, even over a published sheet. The only hint was "regenerating here only
    changes the preview", which reads as a note about a button. It now shows the sheet of record
    whenever one exists, and says "this is the sheet they have". Pressing "Re-draw this sheet"
    shows a new draw and says that too. Closing it goes back to the published sheet. The screen
    and the printed cards now agree.
67. **A finished tournament's board promised a result "when it is settled".** The Festival of
    Formats is finished; its last round was scored by hand. Its public board read "the committee
    works out the result and posts it when it is settled" directly above "Final · these scores no
    longer change". The player's Board said the same. Both now say only that there is no board for
    it here and the committee works out the result, which is true whether the tournament is live
    or finished.
68. **The public board and the player's Board have the round picker** (decision 10, "yes add the
    round picker to both"). The Festival of Formats' public link opened on its hand-scored last
    round and showed no results, with ten scored rounds behind it. Both screens now carry the
    console leaderboard's picker, "Showing Round 1 · Modified Stableford …", and only where
    choosing changes the board. Walked at 393px as the anonymous viewer and as Séamus: all eleven
    rounds listed, picking Round 1 shows its Modified Stableford table on both, and neither
    scrolls sideways. The public board's one-minute cache now keys on the round too, so two
    viewers on two rounds never see each other's. A round id that is not this tournament's falls
    back to the board's own round.

The rest of the public boards were clean at 393px as the anonymous viewer: all five load, none
scrolls sideways, and no row is cut off. A member's money screen was checked figure by figure
against the organizer's: both say Séamus is owed £25.95, and the four handovers add up to it. The
organizer also sees running skins winnings, labelled "Provisional", which the member does not.
That is by design, and both agree on what is owed.

### Two passes that found nothing new, and the loop stops (2026-09-27)

- **As an assistant**, a temporary one on the April Medal, removed afterwards. All eight screens
  an assistant may open loaded at 393px with a heading, and Tournament details sent them back with
  the reason. Both Recent changes lists were there. Every money control Prizes offers them is one
  the server accepts from an assistant.
- **The Twilight Nine, a Stableford, as a member.** Today, the Board, the card and the public board
  all say 13 points and 10th. The card adds up hole by hole, level players are separated on
  countback, "11 of 12 cards in" is right, and the tee time comes from the published sheet.
- **The Summer Knockout, as the seeded player and the organizer.** Today ("Out in the semifinal ·
  lost to Dilip Ranganathan at the 19th"), the Board and the bracket tell the same story, and so
  does the club's pinned notice about the second semi-final.

Two passes in a row found nothing new, which is where you asked the testing loop to stop. It has.

### The evening of 2026-09-27: navigation ("keep continuing with testing … and navigation")

Walked as Séamus (member) and the secretary at 393px. Every tab, every menu item and every screen
reached from them was checked for a heading, a way back and sideways scroll. All passed:
five player tabs, nineteen console menu screens, and three old console addresses that now
redirect to their replacements. What a member tripped on was not getting lost, but being told
the wrong thing about where they were:

69. **"On now" on Events showed nothing to a member playing in five tournaments.** Séamus is in
    five live tournaments, one with his card open at the 12th. He chose "On now" and got "Nothing
    matches". The filter read "when" off the card's band. The band puts the member's own place
    first, so a live tournament he was IN counted as "upcoming", and "On now" listed only the ones
    he was not in. "When" is now read from the tournament's own status, which is the same for
    everybody. Within "You're in", what is being played now also comes before what hasn't started.
    The November Spring Meeting had led the list above the medal he was mid-way through.
70. **The tournament switcher said "Playing now" five times over and never said where his card
    was.** After he looked at the Twilight Nine's board, Today followed it, and his unfinished medal
    card was behind "Switch". The switcher then offered five identical "You're in · Playing now"
    lines. It now names the one that needs him, "April Medal … Your card · thru 11", which agrees
    with the medal's own Today, and puts it first. A card with every hole in but not signed reads
    "Your card · to sign". Only stroke cards are read: a team round files its card per side and a
    match files none, so those keep "Playing now" rather than a guess.

71. **The public landing promised two things the app does not do.** The Club price card read
    "…your own branding, WHS posting, and any size of field". No score posting exists (the GHIN
    integration is a deliberate stub), and "WHS" is the word the landing's own handicap copy
    refuses to use. The Free card listed "As many players as turn up" directly under its own
    "up to ten players". Both now read what is true, and the Free cap comes from the plan, as the
    Season card's always has. Found while checking launch-site claims for the session redesigning
    the landing.

72. **A feature nobody can have said it came with the paid plan.** Text alerts, reading a
    photographed card and AI drafting are switched off on every plan, Club included, by cost.
    Their locked card was still tagged "On the paid plan", so a club already paying for Club was
    told the feature came with the plan it pays for. The tag now follows the plans: "Coming soon"
    until a plan has the feature, and "On the paid plan" from the day one does. Found on the
    secretary's Announcements screen.
73. **The "HQ" in the TourneyHQ wordmark was too small to read.** It is sized as a fraction of
    the wordmark. That put it at 9.2px in every page header, 8px in the phone top bar and 6.7px
    in the landing footer, under the app's own 10px floor. The test that enforces the floor only
    reads literal sizes, so it never saw this one. The chip now stops shrinking at 10px, and a new
    test computes it at every size the wordmark is set at. Found by the session redesigning the
    landing.
74. **The TourneyHQ logo looked tiny, and faint in light mode.** Ajay, on the console sidebar:
    "TourneyHQ and logo looks tiny on this screen … it should stand up." The mark's drawing
    fills only about 70% of its box, and the box was sized to the wordmark. So the visible mark
    was about a capital letter's height: 13px beside a 19px word in the sidebar. It was also
    centred against three lines of text, and five screens built the pair by hand, three of them
    inside a tinted tile. In light mode the orange "Tourney" measured 1.8:1 against the page.
    Now:
    - one lockup draws the mark and word everywhere, the mark standing the full height of the word;
    - the tagline and club name sit beneath it, smaller;
    - the sidebar uses the page-header size;
    - in light mode only, "Tourney" is a deeper shade of the same orange (Ajay's choice), about
      4:1 against the page, with the flag, ball and "HQ" unchanged.
    Measured by the landing session across 11 screens, 7 widths and both modes. In the same pass,
    the new-round page stopped opening scrolled past its own header, and long club names wrap in
    the sidebar instead of being cut off.
75. **The app speaks the club's golf.** A club's country now picks its golf words: a British,
    Irish, Australian, New Zealand, South African or eurozone club reads buggy, fourball and
    organiser, and everyone else reads cart, foursome and organizer. Club settings has a "Golf
    words" choice to override it. Format names never change, because UK "foursomes" is a format
    (alternate shot), not a group. Converted so far: the player's Board, Card and Money, and the
    console's Group games; `docs/country-terms.md` lists what is left. Measured on the seeded
    Scottish club: its Group games reads "a fourball's own skins", and switching the setting to
    US reads "a foursome's".
76. **More of the player app speaks the club's golf.** These now say "organiser" to a UK club:
    - Today;
    - the Enter button's reply, which takes each row's own club's word, since a member can
      play for two clubs;
    - Messages, in both apps;
    - the notice a member reads when a console screen is refused.
    The role NAME "Organizer" is left as it is on purpose: it is one label in a dozen places,
    and changing it screen by screen would show a club both spellings of its own role.
    Checked as a GB-club member: "is for the tournament's organiser".
77. **Switching off voice entry did nothing.** Play settings has "Voice entry: let scores be
    dictated out loud instead of typed". It was saved, set by the templates and copied with a
    tournament, but no microphone ever read it, so a club that turned it off still gave every
    player a mic. It now works everywhere a player scores: their card ("Say the card" and the
    hole-by-hole mic), group scoring, and the Round Code card. The organizer's own entry screen
    is unaffected. Found while checking the landing's voice claim against the code.
78. **The landing overstated the sixteen formats.** It said every format is "scored off its own
    published allowance" and counted brackets and cuts among them. In fact:
    - "Other" is entered by hand;
    - scrambles and shambles use a common club convention, because no allowance is published;
    - brackets and cuts are ways to run a format, not formats.
    The page now says fifteen are scored for you and the sixteenth is for a club's own game.
    The landing session's new comparison was checked the same way, row by row. Voice "hold the
    button", Free "no time limit" and an unqualified "public board" were corrected before
    anything shipped.
79. **A UK club's own role is now "Organiser", everywhere at once.** Item 76 left the role
    name alone because it was spelled out separately in six places, and converting it one
    screen at a time would have shown a club both spellings. It now goes through one function,
    fed the club's golf words. That covers the sidebar and phone menu (including "Viewing as"),
    the Access screen, the club's access table, the tournament chooser (per row), the player
    header and the plan panel's staff line. Nobody's actual role changes. On the seeded Scottish
    club's Access screen: "Organiser" six times and "Organizer" none; switched to US wording,
    the reverse.
80. **Tapping a listening mic again didn't stop it.** On four of the five microphones, a second
    tap only reset the button: "Listening…" went away while the phone kept hearing until the
    recogniser gave up on its own. The four were:
    - the player's "Say the card";
    - the hole-by-hole mic;
    - both of the organizer's entry screens.
    The app's own note under each mic promises "only on while you use this button". All four
    now stop the recogniser, and a test sweeps every mic for it. Found in the same fact check
    as item 77.
81. **A US club's league weeks were dated the British way.** Braid Hollow, set up as a US club
    (locale en-US), read "Sun 20 Sep" across its league week, while its public board said
    "Sep 27, 2026". The short date was hand-built day-first for every club; only the month
    name followed the locale. It now follows the club's locale, "Sun, Sep 20" in the US and
    "Sun 20 Sept" in Britain.

    It also stopped being optional. Half the screens never passed the club's locale and fell
    back to US, which was harmless only while the order ignored it. Fixing the order alone
    would have turned every British club's dates American. So each screen now reads its own
    club's locale:
    - the week sheet;
    - availability;
    - the attendance report;
    - the member calendar (per tournament);
    - the clash notice;
    - the rounds screen;
    - season dates;
    - the tee sheet.

    The old tests had pinned the defect. Found by the landing session capturing the US
    edition. In the same PR, the tee sheet's "7 foursomes · 1 twosome" reads "fourballs ·
    two-ball" for a UK club. The casual-round notice now says "your foursome" to a US club,
    where it had said "fourball" to everyone. The Season plan's blurb names "league, society
    or golf group".
82. **The sign-in form on the landing was too small to tap.** The Log in and Sign up tabs were
    30px tall, "Forgot?" was a 40×12 button and the password eye was 28×28, all under the 44px
    minimum. The landing session measured them on the live page at four widths. No test had
    ever measured this form, because the touch tests sign in first and the form only appears
    when you are signed out. All four targets are now 44px, and a signed-out test measures the
    form at every width.
83. **A member couldn't tell when a notice was posted.** Walked as the Scottish club's secretary
    and a member. The secretary's list read "Tee times moved ten minutes later · just now". The
    member's Today showed the same notice with no time at all, so this morning's tee-time change
    looked the same as last week's. Both now say "3 minutes ago" in the same words.

    Two smaller fixes to the same screens:
    - A long title no longer leaves the megaphone icon alone on its own row.
    - The Announcements screen now says where a notice lands before anyone posts one. Nothing is
      sent to phones; it waits on Today, pinned at the top and the rest at the foot, below the card
      and the board.
84. **The board's "To par" was net and said nothing.** On a member's casual nine, the score card
    read "Gross 41 · To par +5 · Net 35" and the board read "41 · 35 · −1". Both are right: the
    board ranks on net, so its To par is net. But a golfer reads +5 and −1 as two different
    rounds. A net board's footnote now says its To par is the net score against par. A gross
    board keeps its sentence exactly as it was.
85. **A finished card said "Finish my card".** All nine holes were in, and Today read "YOUR CARD ·
    FINAL" over a button saying "Finish my card". The only step left is signing, so it now reads
    "Every hole in — not yet certified" with a "Certify my card" button, the same words as the
    card screen's button. Left alone: "Nothing returned for this round yet" under the two unsigned
    cards. A card is returned when it is signed, so that sentence is true.

    Checked and found fine on the same walk:
    - "and 2 others" in the setup line for three players;
    - the "plays off scratch" note for a guest with no handicap;
    - the service worker's pre-cache list. An agent flagged `/icon.svg` as missing, but Next serves
      it from `src/app/icon.svg`.

    Found in the walk and left for you as decision 14: a notice doesn't alert anyone.
86. **A brand-new club or society could never create its first tournament.** Walked as a
    fresh society sign-up. The checklist keeps "Create tournament" shut until the society is
    named and has members. But with no tournament yet, the app treated the new owner as a
    player:
    - adding the first member crashed the page with an application error;
    - their own society settings were read-only ("Only an organization owner or admin can change
      these settings") with every save refused, so they couldn't name it either.

    This was live in production: nobody could have started a new club. Both steps now recognise
    the owner of the club they just created. That is the same rule that already lets them open
    those screens, and it is narrower than the usual role check, not wider. A person who owns
    nothing and a plain member of the club are still refused, and tests check both. Walked
    again after the fix: member added, society named, tournament created.
87. **The public entry form said "organizer" to a Scottish club's entrants.** Three sentences
    ("The organizer needs this…", "The organizer uses them…", "with the organizer for
    approval") now use the club's own word, "organiser". Also from that walk: the organizer's
    Recent changes read "withdrew their own entry (confirmed)", as if the withdrawal were what
    was confirmed. It now says what was given up: "(had a place)".
88. **The Members add form's labels weren't attached to its boxes**, so a screen reader heard
    eight unnamed fields on the first form every new club fills in. Each label is now tied to
    its field.
89. **The third checklist step, "Decide how money works", refused the same new club.** It said
    "An organizer sets how money is handled" to the owner it had just sent there, because the
    club-default setter demanded an open tournament before asking whether this person runs the
    club. It now asks only the club question (owner or admin), which #680 taught to work before
    the first tournament. The same controls apply: a person who owns nothing and a plain member
    are still refused, and the test goes red when the old tournament requirement is put back.
90. **A member of a club with nothing published yet was greeted as a stranger.** Walked as a
    plain member of a British society with no tournaments. `/choose` said "If an organizer has
    invited you … otherwise create your own" and never named the society. It now says "You're a
    member of <club>, which hasn't published a tournament yet", with a button to Events. Events,
    for its part, said "Your club has not published…" to people in no club at all. It now names
    the club, or says plainly that no club has added them. Both states are added to
    `verify-player-states.mjs`, with somebody in no club as the control. Each of its three
    checks was mutated and watched go red.
91. **On `/week` at phone width the Results headers ran together as "GROSSPOINTS"** (reported by
    the landing session). Neither header nor cell had any sideways padding, so two right-aligned
    number columns met. They now carry a 14px gutter. Measured at 390px: the header gap is 0
    without the gutter and 14 with it. The same measurement was then swept across every visible
    table on 14 routes × 6 tournaments of the seeded club (64 tables): no other collisions.
92. **A member on the waiting list was offered "Keep my place".** Withdrawing from the Am-Am's
    waiting list asked "If the field is full, your place goes to the next person on the waiting
    list", which is true only of somebody IN the field. They are now told "You'll lose your spot
    in the queue" and offered "Stay on the list". That is accurate: `drainWaitlist` promotes in
    sign-up order. The same card's status line said "the organizer" to a Scottish club while
    the button beside it said "organiser"; both now read the club's word.
93. **A full field's button said "Enter this tournament"** beside "Full — waiting list open".
    The reply after the tap was already honest ("You're on the waiting list…"); the label
    before it now says "Join the waiting list", on Events and on Today.
94. **An entry awaiting approval was told it was on the waiting list.** A club that approves
    entries puts each one in front of a person with the field wide open, and the player app
    filed those members with the waiting list. Today, My card, Events and the switcher all said
    "You're on the waiting list", a queue they were never in. Every rule still treats the two
    alike (no card, not a spectator), but the words now say "Your entry is awaiting approval",
    "Awaiting approval" and "Keep my entry". This was found by extending the one rule
    `verify-player-states` asserts to the state it did not walk. The walk went red on the old
    code on `/me` and `/me/card`, and green after.
95. **Recent changes did not say who got a freed place, or who approved an entry.** The field
    record listed entries, withdrawals and removals. Approving an entry wrote nothing, and
    neither did a freed place filling from the waiting list, so "who took Ann's place?" had no
    answer on the screen built to give it. Both now write a Field line. The promotion is
    attributed to "Automatic" rather than to whoever freed the place, since the waiting list's
    order chose. Declining an entry used to read "X was removed from the field", a field they
    were never in; it now says the entry was declined, or that they were taken off the waiting
    list.
96. **A forfeit was filed under "Other" in Recent changes.** A new guard,
    `every-change-has-a-heading.test.ts`, reads every action name the app writes to the record
    (62 of them, across every writer) and requires each to resolve to a real heading. It found
    `match.forfeit` and its undo unfiled; a conceded match is its result, so both are now
    Scores & results. A writer added later is swept the day it is added.

    Checked and fine after this batch: the player app at 320px on 11 tournaments × 8 routes
    (88 screens) has no sideways scroll, and an injected over-wide element was caught, so the
    check can fail. The member's own row on the player Board matches the organiser's
    leaderboard on all five boards that list him: place, figure and to-par. Two consecutive
    passes found nothing new, which is this run's stopping rule.

Resumed at Ajay's "keep going … make it error free and professional":

97. **A console-error sweep found the app clean, and two unbranded dead ends.** Every
    sidebar screen was swept as the organiser on five tournament shapes (full, empty, 36-hole
    cut, knockout, festival): 113 screens with zero console errors or warnings. Every
    player screen was swept on six, plus every public board, entry form and public page. The
    only entries were dev-server restarts and addresses I had guessed. The listener was
    proven by those very 404s. Two things read as unprofessional:
    - `/login`, `/signin` and `/signup` answered 404. Nothing links there, but it is what a
      returning secretary types. They now land on the front page's sign-in panel, on the
      right tab. `/register` is matched exactly, and a test fails if a rule could ever catch
      a `/register/<token>` entry form.
    - A wrong address showed Next's bare "404: This page could not be found.", and a failed
      screen "Application error: a server-side exception has occurred". Both pages now carry
      the brand and a way on. The 404 still answers with status 404. The error page offers
      "Try again" and quotes the error's reference, never its message, which is server detail
      and could name a person. A test turns red if the message is ever printed.

    Then three class sweeps, each with a planted-defect control, all clean:
    - **Copy:** 145 organiser and member screens were scanned for a space before punctuation,
      doubled full stops, unfilled `{{ }}`, a literal undefined/NaN/null, a leftover TODO,
      empty brackets and doubled words. Nothing found. A planted sentence tripped four of
      the checks.
    - **Accessibility basics:** 116 screens at 393px were checked for images without alt text,
      buttons or links with no accessible name, duplicate element ids and a missing page
      language. Nothing real. The three candidates were controls inside a closed `<details>`,
      where `innerText` is empty; their `textContent` names them ("Add tees", the tournament
      switcher rows, "under Rules of Golf 22").
    - **Public pages at 320px:** the five public boards, three entry forms, the front page,
      /faq, /play and /privacy. No sideways scroll, and exactly one `<h1>` each.

    Three consecutive clean passes: stopped here.

98. **A club on the 24-hour clock got its tee sheet drawn in American time.** Resumed after
    #679 merged. The draw wrote every tee time as "8:10 AM" whatever the club, so a Scottish
    club's sheet read "8:10 AM" while its members' cards read "17:30". The time is stored on
    the sheet as drawn, so it is now drawn on the club's own clock, decided by Intl's
    `hourCycle` for the club's locale: en-GB, en-IE and de-DE give "08:10"; en-US and en-AU
    keep "8:10 AM". Sheets already saved keep the text they were saved with. Measured on the
    seeded club: Round 5 now reads 08:00, 08:10, 08:20 with no AM/PM on the screen. Pinned
    in both clocks, with the tee sheet's call checked to pass the club's clock. Dropping the
    24-hour branch turns it red.

    Also checked this pass, all clean:
    - The five console screens the earlier sweeps skipped because only some formats show
      them in the sidebar: `/scoring`, `/qualification`, `/scorecard`, `/bracket`, `/teams`,
      on all 11 tournaments. Three are old addresses that redirect; the real two are clean.
    - A member's money against the arithmetic: the Four-Ball dinner of £410.05 splits 16 ways
      (13 × £25.63 + 3 × £25.62). His £310.05 paid, less his share and one settled £25.63,
      leaves £258.79, which is exactly what the settle-up handovers to him add up to.
    - The League's two tee-sheet groups for him are two different rounds (the week played,
      and next week's draft), not two answers to one question.

    **Decision for Ajay (15): what unit is a course's distance in?** The scorecard's distance
    row is labelled "Yards" for every club, and nothing records a unit. The app serves
    Australia and New Zealand, Germany and Austria, France, Spain, China and Korea, most of
    which measure courses in metres. A German club typing its card in metres reads them as
    yards. It cannot be fixed by relabelling from the club's country, because a card from the
    course catalogue may be in yards whatever the club. It needs a unit stored per course (set
    on import or entry), or per club. Not built; it is a data-model choice, and every scoring
    figure is unaffected, since nothing scores off distance. **DECIDED 2026-09-28: per course,
    built as item 99.**

99. **A course's distances are labelled in its own unit (decision 15).** `Course.distanceUnit`
    stores "yards" or "metres", or "" for not set. An unset course follows one rule
    (`resolveDistanceUnit`): a card from the course directory is yards, and anything else
    follows the club's country (metres for Australia, New Zealand, South Africa, continental
    Europe, Korea and China). The migration adds the column with an empty default, so no
    existing row is rewritten, and the numbers are never converted. The unit rides on the
    resolved card from the same round → tournament → venue walk that chose it, so every
    screen agrees:
    - the player's card, the Round Code card and score entry label the row "Metres" and the
      hole "150 m";
    - forms for a NEW course say the club's unit, even inside another course's score entry;
    - the course library has a Yards | Metres switch that saves with the card.

    `saveClubCourse` validates the unit at the boundary, since it is a public endpoint. It
    was checked in the browser: the member's card read "m" with the club set to Germany and
    "yds" back in Britain, and the library's switch relabelled the row. Pinned by domain,
    render and audit tests; the unguarded save, the hard-coded "Yards" and the directory
    rule were each mutated and watched go red.
100. **A club's calendar week starts where its members' diaries do** (reported by the landing
    session). Both calendars drew every month Sunday-first, so a British club read S M T W T F
    S. The grid and its headings now take the club's week start from one fixed table: Monday
    for Britain, Ireland, Europe, Australia and China; Sunday for the US, Canada, India, Japan
    and Korea. It is a table, not `Intl` week data, so the server's HTML and the browser
    cannot disagree and redraw every square. Checked in the browser: the seeded (GB) member's
    calendar reads M T W T F S S, with no console errors. A test proves every column is the
    same weekday under either start, and reverting the grid arithmetic turns it red.
101. **A tournament cannot launch with a round its format cannot score** (Ajay, 2026-09-28:
    "we need to warn or stop if golf course score card is incomplete"). Score entry already
    refused a round with no card, but on the first tee. Launch now asks the same question at
    setup, per round. A round that needs par and stroke index (anything but gross match play)
    and has none stops the launch, with the round, the course and the fix named. So does a
    round whose OWN venue has no card: falling back to the home course's card would score it
    against the wrong pars. These never stop a launch: gross match play, a "players choose the
    course" tournament, a round with no venue in a tournament with carded venues (scored per
    match), an imported card nobody has checked (already a warning), missing distances and
    unrated tees. The fact is REQUIRED on `LaunchFacts`, so the Launch action, the dashboard's
    button and the setup guide all had to supply it. Rounds & formats shows the same sentence
    while the tournament is being built. Checked in the browser on a throwaway club: the note
    on Rounds & formats, and "Launch tournament" disabled on the dashboard with the reason.
    Pinned by domain and audit tests with controls; the wrong-course fallback and the action
    skipping the check were each mutated and watched go red.

    **Open for Ajay:** #679, the landing session's phone rework, is approved per the landing
    session. My permission check refused to merge it on an approval that came through another
    session rather than from you. It is frozen at `05187716` and waiting on your word or your
    click.

    Checked and fine: a member refused one-tap entry for a missing mobile is told why and given
    the entry form. That form is pre-filled for a signed-in member (an earlier "not pre-filled"
    note was my measuring error). Withdrawing restores the places-left count, and Recent
    changes shows both lines, attributed, on Registration and Reports.

Checked and left alone: a knockout's dates reading "2026-09-05 onwards" is the organizer's own
text, printed as typed. "Copy one of yours" offers the six newest tournaments on purpose, and
the seed created the April Medal first, which real use would not.

The original note behind item 34, kept for the reasoning:

- **A finished championship lists players who missed the cut among those who made it.** The
  seeded Club Championship (36 holes, cut after 18) ranks Odette Brissaud, cut on +14 after 18,
  at T10 — above Cormac Threlfall, who made the cut and finished +16 over 36 (T14), and Hattie
  Mwangi, who finished all 36 at T21. The leaderboard, Reports and the player's Board all agree,
  because they read one ranking. The app already has the answer, and it is Ajay's decision of
  2026-09-23 (#577): once the organizer ticks "This round is finished" on round 2, anybody with no
  card for it is shown without a place. Nobody ticked it on this tournament, and nothing asks
  them to — the tournament was marked Completed with round 2 still open. I have not changed the
  ranking, because that decision says a round is over only when the organizer says so. **The
  question:** should marking a tournament Completed also close its rounds (it is the organizer
  saying so), or should it at least ask "Round 2 isn't marked finished — players who missed the
  cut are still ranked. Close it?" Either is small; both change a decided rule, so it is yours.

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
- ~~A member cannot undo a one-tap entry.~~ **Decided — withdraw until entries close. Built
  (item 47).**
- ~~A tournament with dated rounds but no tournament dates is filed under "No dates yet".~~
  **Decided — use the rounds' dates. Built (item 48).**
- ~~Shared places print as "1, 1, 3" on the sides board.~~ **Fixed (item 44).**
- **Two figures called "To par" on one net round.** Score entry shows the gross to par beside the
  gross (Séamus +4), and the leaderboard, which ranks a net round on net, shows the net to par
  (−2). Both are right, and both are headed "To par". Relabelling a board column touches the
  ranking display that three checks pin, so I have not changed it: should the board say "Net to
  par" on a net round?
- ~~A league's week screen for a week not yet played does not list who has said they are
  playing.~~ **Done (2026-09-28, "go with your recommendation").** A week not yet played now
  says "Playing this week (N)" with the names alphabetically: everyone not out on an opt-out
  week, only those who put their name down on an opt-in week. If nobody has, it says so.
- ~~**The create form files every organizer as an "outing".**~~ **Done (2026-09-28).** Once a
  name is typed, the form asks "Which is it?" (Golf club, Society or league, or Personal), as
  sign-up does. The kind is taken on the same terms as the name: only while the organization is
  still unnamed, and never in a way that would hide a members list it already has. A club or
  society is told up front that it adds its members before its first tournament. That is the
  existing club-first rule, now said before the click rather than after.
- ~~**"Overall result: Stroke play" on a Stableford tournament.**~~ **Done (#699).** It now
  reads "Stableford points".
- ~~**"5 of 6 ties decided" on a knockout of eight.**~~ **Done (#699).** It now counts the
  whole draw, "5 of 7".

  **DECIDED 2026-09-28 ("rest — go with your recommendation"). BUILT in one PR:**
  - **Knockouts:** progress counts the whole draw, excluding byes. A draw of n players is n−1
    ties, so this now reads "5 of 7", and a draw not yet made counts nothing.
  - **Stableford wording:** the "Overall result" reads "Stableford points" when every playing
    round is Stableford. One function supplies the words to both summaries.
  - **Format description:** its first sentence now sits under the Format select, and the full
    text stays in the ⓘ ("keep most of it in the information button").
  - **Reports:** it has the leaderboard's round picker, while the dashboard stays on the current
    round.
  - **Prizes DONE before anyone chose:** already fixed. The checklist takes its tick from the
    setup flow, which counts only a real money answer.
  - **Still to come:** the create form asking club, society or outing; the league week showing
    who's playing.

### New features Ajay approved, 2026-09-28 ("go ahead with your recommendations")

- **Suspend play, with an alarm (Rule 5.7).** BUILT.
  - **Organizer:** a "Suspend play" button on the dashboard of a live tournament, with an
    optional reason. While suspended it shows "Play is suspended since …" and a "Resume play"
    button.
  - **Every confirmed player** gets an urgent push, which asks for a long vibration and stays on
    screen. A red banner shows on every player screen and on the public board.
  - **An open player screen** sounds a four-second hi-lo siren and vibrates when it sees the
    suspension happen. It does not sound on a screen opened after the fact.
  - **The limit, stated plainly:** a web page cannot choose the sound a locked phone makes. That
    is the notification's own sound. The native app could carry a custom one later.
- **Trip team cup (Ryder Cup style).** BUILT.
  - **Set-up:** two teams, which are the tournament's two flights, and a new round type called
    "Team session", one per session: four-balls, foursomes, or singles.
  - **Scoring:** every match is a point and a halve is half each. The score counts decided
    matches only. The target is more than half the points (14½ of 28) unless it is set, and a
    named holder keeps the cup on a tie.
  - **Organizer:** the lineups are entered on a new Team cup screen. Each side must come from
    the right team, nobody plays twice in a session, and only unplayed matches can be removed.
  - **Everyone else:** the same scoreboard appears on the player's Board and on /live. Score
    entry calls the matches "Match 1, 2, 3".
  - **Getting started:** a template "Four-Ball, foursomes & singles — team cup". The seeded
    club has a part-played Autumn Cup.
  - **Not in this version:** captains entering their own lineups (they are read-only today).
- **Pin sheet (hole locations).** BUILT, 2026-09-28 ("go ahead with your recommendations as a golf
  pro").
  - **Committee:** a Round day panel on the Tee sheet screen, per round. For each hole it takes
    paces on from the front of the green, the side (L, C or R) and paces in from that side, in
    the notation golfers read ("22 / 6R").
  - **Printed cards:** a Pin row under S.I.
  - **Players:** "Pin 22 / 6R" on each hole of their phone card.
  - **Limits:** anything outside a real green (more than 60 paces on or 30 from a side) is
    refused, and the refusal names the hole.
  - **Records:** setting a pin sheet is logged under Recent changes. It is not copied when a
    tournament is copied, because holes move every round.
- **Pace of play.** BUILT, same day.
  - **Where:** a panel on the committee's dashboard, for a round dated today with times on its
    tee sheet. Each group is measured against its own tee time.
  - **Time allowed:** set per round on the same Round day panel (default 4h 15m for a
    four-ball). Three-balls and two-balls are allowed proportionally less (3h 44m and 3h 11m).
  - **What each group shows:** on pace, "N min behind", or out of position (10 minutes or
    more, in red, named in a summary line). It also shows its due-in time.
  - **Honest measurement:** a group is only called late once the time for the hole it is on
    has run out, and its furthest card vouches for the group. After three holes' time with
    nothing entered it reads "No scores yet". Ninety minutes past its due-in time with holes
    missing, it reads "chase the cards" rather than "400 min behind".
  - **Clock:** worked out on the committee's device, which is the course's clock. No time zone
    is stored or needed.
- **Charity extras:** already there. The float records entry fees, sponsors and raffle as
  money in, so nothing new was built.
- **Cart tags: PARKED by Ajay ("park it for future build").** These are printable tags from
  Reports or the tee sheet, for all carts or selected ones. Each tag carries:
  - the names of the two cart buddies;
  - the starting hole;
  - the round code;
  - the club's name and logo.

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

1. ~~A multi-round event whose LAST round is scored by hand hides every earlier round.~~
   **Decided 2026-09-26 — add a round picker. Built on the console leaderboard (item 49).** The
   dashboard and Reports still show the last round only; say if you want the picker there too.
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

   **3–5 DECIDED 2026-09-28 ("you recommend based on your experience"). BUILT.**
   - **Flights, corrected on the way in:** item 3 above proposed "By handicap", but that rule
     snake-drafts, giving every flight the same spread of handicaps. That is the opposite of a
     division.
     - There is now a real **Handicap divisions** rule: Flight A holds the lowest handicaps. On auto
       it makes one, two or three divisions (under 16 players, under 32, then more), never flights
       of four. The old rule is renamed **Spread by handicap**.
     - A tournament whose playing rounds are all individual stroke or Stableford defaults to
       divisions. Anything with an opponent or a side keeps Balanced.
     - The default only moves while no flights are drawn and the stored rule is still the app's own
       default, so an organizer's choice is never overwritten.
   - **Knockout:** a new tournament starts in **One bracket**.
   - **Access:** an email-only tournament handed a list with **no addresses at all** turns on
     Round Codes as well as email, imports the list and says so. A list with some addresses keeps
     email sign-in and skips the gaps as before.
6. **Players cannot record their own knockout results.** The bracket is staff-only to edit, so in a
   club knockout played over weeks (players arrange their own matches) every result has to go
   through the secretary. Most club knockouts let the winner report it. Worth deciding before a
   club runs one — it is a permissions question, so not changed overnight.

   **DECIDED 2026-09-28: "player may enter it but organizer/club needs to approve it". BUILT.**
   - **Reporting:** either player in a tie can report it once both seats are known. They do it from
     the tie card on Today: who won, plus an optional margin ("3&2").
   - **Approving:** the report waits in a separate table (`BracketReport`), which nothing that
     advances, crowns or counts results reads. Staff see it above the draw on the Bracket screen and
     in the dashboard's "Awaiting review" count, and either approve it or turn it down.
   - **What approval does:** it records the result through the same write as the console's own
     click, so the first result freezes the draw the same way. An organizer who records the tie
     directly also clears the report.
   - **Evidence:** walked as the player at 393px and as the secretary at 1280px on the seeded club,
     then checked against the database. Nine audit tests; five mutations each turned a test red.
7. ~~A finished cut championship ranks players who missed the cut among those who made it.~~
   **DECIDED by Ajay on the morning of 2026-09-26: Completed closes the rounds. Built — item 34.**
8. **Which jobs should an organizer be able to do mid-event without unlocking setup?** Since item
   63 the screens say what the server has always done. Once a tournament is launched, its setup
   locks, and so do several things organizers genuinely do while it is being played:
   - drawing the next round's pairings, or handing the field its next cards;
   - adding next week's round to a live league;
   - clearing a round's scores to re-enter them;
   - creating the third-place play-off, or pairing a single match;
   - the scoring window ("closed early" / "reopened").

   Each now says "unlock setup first", where before it crashed. That works, but it means
   unlocking the whole setup to do one of these, and re-locking is on the organizer to remember.
   If some of them should just be allowed on a live tournament, as a round's course and date
   already are, that is a change to what the server allows. Name which, and I'll take each one
   out of the lock with a test.

   **Decided 2026-09-27 ("go with what a golf pro would decide") — built.** A committee locks
   setup to protect what the field entered, not the running of the competition. So these now
   work on a live tournament without unlocking:
   - drawing the next round;
   - adding a round;
   - the completion deadline and the scoring window;
   - making the single match and the play-off for third.

   Two safeguards hold:
   - **Drawing:** it deletes and redraws the round. On a locked tournament, a round that
     already has scores is refused ("drawing it again would wipe them") and its scores are left
     alone. The lock used to prevent that only by accident.
   - **Still behind the lock:** clearing a round's scores (a deliberate step before wiping
     results), whether there is a third-place play-off, and the single-match rule. Those are
     setup.
9. **A Stableford round set to GROSS is still scored off handicap.** Found while measuring item 65.
   Stableford points are computed with the player's strokes whatever the round's gross/net
   setting says. So a scratch Stableford (a real competition, and one the Rounds screen lets
   you set up) would be scored exactly like a handicap one. Not live: the development database
   holds no such round. It is how points are calculated, so I have not touched it. Should
   "gross" on a Stableford round mean points off scratch (the Rules' reading), or should gross
   simply not be offered for Stableford?

   **You said "go with what a golf pro would decide" (2026-09-27). The golf pro's answer is
   scratch (Rule 21.1), and I built it — then took it back out before shipping,** because
   building it showed that "gross" on a Stableford round usually isn't a choice. Every new round
   is created with the basis "gross" (the schema default, and what "Add round" writes), whatever
   its format. So a club that added Stableford rounds with the round builder has them stored
   "gross", and their points have always been counted off handicap. Making "gross" mean scratch
   would silently re-score every such round already played. A golf pro would never change a
   finished competition's result. The development database can't say how many there are: its
   rounds are seeded "net" explicitly, which is exactly why it shows none. Production could have
   many.

   So nothing about Stableford scoring has changed. What it needs from you:
   - **Count them.** How many Stableford or Modified Stableford rounds in production are stored
     "gross"? That's one read-only query, but on production, so it isn't mine to run.
   - **If none:** make new Stableford rounds default to "net", and then "gross" can safely mean
     scratch.
   - **If some:** those rounds need converting to "net" first (their results don't change,
     because their points were always net). That is a write to live events, so it's your call.
   - **Until then:** the Rounds screen can say "Gross scoring" on a Stableford round that is
     scored off handicap. That's a wrong label, but it doesn't change anyone's result.

   **DECIDED 2026-09-28: "go with what other professional clubs would do." BUILT.** Clubs play
   Stableford off handicap; a scratch competition is run as stroke play. So a Stableford round
   is always net:
   - **Every write of a round's basis goes through `basisFor`** (`week-basis.ts`). That covers
     adding a round, changing its format, the basis control, cloning, templates, a described
     setup and the match planner. A source sweep names each writer, and has a control.
   - **Rounds & formats no longer offers Gross for Stableford.** In its place it says "Off
     handicap", and names Stroke Play for a scratch competition.
   - **No stored round is rewritten, and no result moves.** Points were always counted off
     handicap, so a row still stored "gross" is scored exactly as before. Rounds & formats and
     the member's rules sheet ("Stableford (net)") no longer call it gross. The production
     count is no longer needed.
10. **The public board and the player's Board still show only the last round.** Your answer of
    26 September ("add a round picker") was built on the console leaderboard (item 49). But the
    finished Festival of Formats' public board, the link a club sends its members, still opens
    on its hand-scored last round and shows no results at all. So do the player's Board and, as
    item 49 noted, the dashboard and Reports. Should the picker go on the public board and the
    player's Board too? The public board has its own cache, so it is a real change rather than a
    copy, which is why I have not done it on the strength of an answer about the leaderboard.

    **Decided 2026-09-27 ("yes add the round picker to both") — built, item 68 (#662).** The
    dashboard and Reports still show the last round only.
11. **A free competitor offers more than our Free plan (a finding, not a proposal).** The
    landing session checked competitors' own pricing pages on 2026-09-27 and found Squabbit
    (squabbitgolf.com/pricing.html). It is free for unlimited players, events and leagues, with
    live boards, handicaps and standings. Tournament Pro is $99.99 a year and League Pro $249.99
    a year, priced in seven currencies. Against ours:
    - our Free plan caps at 10 players and one active tournament;
    - Season is $490 a year.

    It is not a like-for-like comparison: our paid plans are display-only for now, and a club's
    console, local set prices and the money record are not what it sells. Pricing is your call,
    so nothing has changed. The landing's named comparison is hidden until you rule on it, and a
    lawyer should read any named comparison before it goes live. Sources are in the landing
    session's `HANDOVER-2026-09-27.md`.

    **Later that night:** you chose to name the club platforms (Golf Genius and BlueGolf TM),
    with a disclaimer, and approved porting the redesign to the real site. Squabbit stays a
    finding and is not named.
12. **The plan limits are published but not enforced.** The Free card says "one tournament at a
    time" and "up to 10 in a field", and both are in the code (`plans.ts`). But
    `enforcementEnabled` is off by default, so today nothing refuses a Free club its second
    tournament or its eleventh player. That is consistent with the plans being display-only
    until billing exists, and it is a switch on `/owner`, not a code change. The question is
    when to turn it on. Probably with billing, since a club refused a place it cannot pay to
    unlock is the worse experience.
13. **The contact address on the live landing page cannot receive mail.** The "Let's talk" card
    links to hello@tourneyhq.club, and tourneyhq.club has no MX record (checked 2026-09-27
    against GoDaddy's zone and 8.8.8.8), so anything sent there bounces. The Microsoft 365 step
    that would have added support@tourneyhq.club was planned and never finished. The same
    address is the push-notification contact (`VAPID_SUBJECT` fallback), which is harmless. The
    landing session will not publish any @tourneyhq.club address until you choose:
    - finish the M365 step so tourneyhq.club receives mail;
    - use an ajailabs.app address you read;
    - or drop the mailto and send that card to sign-up instead.

    **Decided 2026-09-28:** aliases hello@ and support@tourneyhq.club on the admin@ajailabs.app
    mailbox, set up through GoDaddy in your Chrome. It is parked until you are back ("ask me
    tomorrow"). Until a test email arrives, the landing shows no address and sends "Talk to us"
    to sign-up.
14. **A new announcement alerts nobody.** Players can turn on phone alerts, but alerts are only
    ever sent for tee times. Posting on Announcements writes the notice and nothing else. It
    appears the next time a player opens Today: pinned at the top, the rest at the foot. It
    doesn't ring, and it isn't counted anywhere. Messages broadcasts at least show an unread
    count. So "Tee times moved ten minutes" posted at 7am reaches a player only if they open
    the app and scroll. The Announcements screen now says that honestly (item 83). The question
    is whether a new or pinned announcement should also send a phone alert to players who
    turned alerts on, the same way tee times do. That would be in-app and consistent with your
    non-email rule, but it is a behaviour change, so it waits for you.

## Log
