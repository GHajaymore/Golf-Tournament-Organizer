/**
 * THE STEP-BY-STEP ORGANIZER GUIDE, as data (Ajay, 2026-10-02: "add the
 * guide to the Help section").
 *
 * Written from the app as built on 2 October 2026 — five read-throughs of the
 * screens, one per area — so every label in [[double brackets]] is the text a
 * button or field actually carries. When a screen's wording changes, change it
 * here too: a guide that names a button the app no longer has is worse than no
 * guide. `guide-steps.test.ts` holds a few of those labels to their source.
 *
 * Markup kept deliberately tiny so the page renders it without a markdown
 * library: [[label]] is an on-screen control, **text** is emphasis.
 */

export type GuideBlock =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "where"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "list"; items: string[] }
  | { kind: "tip"; text: string }
  | { kind: "warn"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "recipes"; items: { title: string; for: string; steps: string[] }[] }
  | { kind: "faq"; items: { q: string; a: string }[] };

export interface GuideSection {
  id: string;
  part: string;
  title: string;
  blocks: GuideBlock[];
}

export const GUIDE_STEPS: GuideSection[] = [
  {
    id: "start",
    part: "Part 1",
    title: "Before your first tournament",
    blocks: [
      { kind: "h", text: "Club settings" },
      { kind: "where", text: "Club → Club settings (or Society settings)" },
      {
        kind: "p",
        text: "Club settings shows one section at a time. The row at the top picks it: **Name & branding**, **Colour**, **House defaults**, **Handicaps**, **Money**, **Plan** and **Staff & access**. Anything typed and not yet saved stays as it is while you look at another section.",
      },
      {
        kind: "steps",
        items: [
          "On **Name & branding**, set **Organization name**, an optional **Short name**, and a **Logo** ([[Upload an image]] or paste a link). Choose **Name beside the logo** and fill in **Where you play**. Press [[Save changes]].",
          "On **Colour**, pick **Appearance** (Light, Dark or Auto) and a **Colour scheme**. The pairs marked easiest to read in direct sun are the safest choice for the course. Press [[Save theme]].",
          "On **Money**, pick your **Currency**. It saves as soon as you choose and shows an example amount.",
          "Beside it, check the **Time zone**. It is taken from your own device the first time you open the console, and the screen shows the time at the club so you can see it is right. Every closing date and sign-up deadline ends at midnight on that clock.",
        ],
      },
      { kind: "tip", text: "If a save is refused after you have moved to another section, that section's name in the row gets a red dot. Open it to read why." },
      { kind: "tip", text: "Your colours apply everywhere your club is seen: this console, the public leaderboard and the player app on every member's phone." },
      { kind: "h", text: "Members" },
      { kind: "where", text: "Club → Members" },
      {
        kind: "steps",
        items: [
          "[[Add member]]: Name, Email (how they sign in), Phone, **Handicap index**, **Handicap is for** (18 or 9 holes), plus optional **Gender**, Member number, GHIN, Home club and private Notes. Gender is used for one thing: in a tournament a woman starts on the course's ladies' tees.",
          "Or bring everyone in at once with [[Import CSV]]. You'll see what was added, updated or skipped, and any columns it didn't recognise. A plus handicap is written “+2.4”, in the file and in the form, and is shown that way on every list.",
          "To enter members into the open tournament, tick them and press [[Add N to ‹tournament›]].",
          "Someone who has played can't be removed — use [[Set inactive]] so their results stay intact.",
          "An active member who signs in with the email on the roster sees the club's tournaments straight away — no invitation needed. An inactive member does not.",
        ],
      },
      { kind: "tip", text: "A member with no handicap shows **No index yet**, never 0 — a blank handicap is not scratch." },
      { kind: "h", text: "Staff" },
      { kind: "where", text: "Set up → Staff & helpers (organizers only)" },
      {
        kind: "steps",
        items: [
          "[[Add account]] with Name, Email and a role: **Organizer** (full control), **Assistant** (runs the day) or **Player**.",
          "To change a role, pick the new one, then confirm with [[Yes — make ‹name› ‹role›]]. Picking alone changes nothing.",
          "Each organizer or assistant uses a staff seat on your plan. The last organizer on a tournament can't be removed or demoted — promote someone else first.",
          "Club staff are added the same way under Club settings → **Staff & access**, by email address. When somebody has asked to join, that section's name shows how many are waiting. There is nothing for them to accept: they are staff at once, and are emailed. Until they next sign in the list shows the address you typed and **Invited — not opened yet**, not their name.",
          "The first time somebody you added signs in, they choose a password and we email a 6-digit code to the address you typed. The password only takes effect once they type that code back, so only the person who reads that inbox can take the seat. The code works for 15 minutes; **Send a new code** sends another.",
          "A role at the club is changed the same way as one on a tournament: pick it, then confirm. It reaches further — an **Admin** is an organizer on every tournament the club runs, and the confirmation says so before you agree.",
          "Anyone added can leave again themselves, from Your account → Your clubs. A club's only Commissioner can't leave until somebody else is one.",
        ],
      },
    ],
  },
  {
    id: "create",
    part: "Part 2",
    title: "Create a tournament",
    blocks: [
      { kind: "where", text: "Club → Tournaments" },
      {
        kind: "steps",
        items: [
          "Type a name under **Create a new tournament**.",
          "Choose **How is it played?** — a single round, a series of rounds, or a knockout.",
          "Choose **Start from**: a template, or one of your past tournaments to copy (settings carry over, scores never do).",
          "Press [[Create tournament]], then [[Manage]] to open it.",
        ],
      },
      {
        kind: "table",
        head: ["Template", "What it sets up"],
        rows: [
          ["Stroke Play", "A club championship: staff enter cards, results hidden until released, one set of tees."],
          ["Stableford", "A charity or club day: individual net points, public board, players score themselves."],
          ["Match Play — round robin", "Everyone plays everyone in their flight; players self-score; live board."],
          ["Four-Ball Match Play", "Pairs, net, public board (a member-guest)."],
          ["Four-Ball Match Play — round robin", "Flights of six pairs playing five nine-hole matches."],
          ["Four-Ball", "Pairs, better-ball net."],
          ["Foursomes / Greensomes", "Pairs sharing one ball, net."],
          ["Scramble", "Four-a-side, net, public board."],
          ["Skins", "Hole-by-hole pot that carries over."],
          ["Four-Ball, foursomes & singles — team cup", "Two teams, three sessions, a running cup score."],
          ["Set it up yourself", "Plain defaults. Everything stays editable whichever you pick."],
        ],
      },
      { kind: "h", text: "Tournament details" },
      { kind: "where", text: "Set up → Tournament details (organizers only)" },
      {
        kind: "steps",
        items: [
          "**Tournament name** and **Tournament dates** are required to launch. Tick **These dates are tentative** if they may move; dates have their own [[Save dates]].",
          "**Overall result** — Match play or Stroke play — decides how season standings are worked out, not each round's format.",
          "**Golf course**: pick a course, **Other (enter manually)**, or **No fixed course — players choose**.",
          "Registration: **Entries open**, **Registration deadline** and **Field capacity** (a fixed number, or open). The deadline day itself is open, until midnight at the club. Press [[Save event]].",
        ],
      },
      { kind: "h", text: "Players & scoring" },
      { kind: "where", text: "Tournament details → the Players & scoring card" },
      {
        kind: "list",
        items: [
          "**Who can see the leaderboard**: Organizers only, Organizers and players, or **Anyone with the link** — which shows the **Public leaderboard link** with [[Copy]] and [[New link]] (the old link stops working at once).",
          "**Who enters scores**: Organizers and assistants only, or Players may enter their own scores.",
          "**When players may submit**: during the round, hole by hole; or after the round, as a completed card. A match is complete once it is decided, so a match won 5&4 goes in without the four holes nobody played.",
          "**How players sign in**: Email and password, Access code on their scorecard, or Either email or access code (see Round codes in Part 3).",
          "**Tees**: pick the tournament's tees, then **Who may play other tees**. You decide the tees at three levels, each beating the one before: the tournament's here; a flight's, on Flights & groups; one player's, on Registration. **Everyone plays the tournament's tees** stops at the first (a seniors' championship off one set), **A flight may play its own tees** at the second (a club championship off three), and **A flight or a player may play their own tees** allows all three and is what a new tournament starts on. A player never chooses their own, and the entry form does not ask.",
          "Where the course has a ladies' set, a woman you have not put elsewhere plays it. Registration shows what each player will play and why: White (tournament’s), Yellow (flight’s) or Red (ladies’). To put a mixed field on one set, choose **Everyone plays the tournament's tees**.",
          "Card confirmation: **Who decides**, and **How many playing partners must confirm**.",
        ],
      },
    ],
  },
  {
    id: "rounds",
    part: "Part 3",
    title: "Rounds and formats",
    blocks: [
      { kind: "where", text: "Set up → Rounds & formats" },
      { kind: "h", text: "Add a round" },
      {
        kind: "steps",
        items: [
          "Open [[Add a round]].",
          "Pick what the field plays — **Round robin** (everyone in a flight plays everyone), **Stroke play round** (cards, no pairings) or **Team session** (a team cup) — or a structure: **Single match** (a play-off or decider) or **Bracket** (knockout).",
          "**How many?** adds up to 40 identical rounds at once — handy for a league season. Set **First round played** and **Then** (for example weekly).",
          "Choose **Format** and **Holes** (18 or 9), then [[Add round]]. The line under the button says what will happen. Picking the kind of round picks the format clubs usually play it in — Stroke Play for a stroke play round, Match Play for a round robin or a bracket — and the list offers only the formats that kind of round can be scored in.",
        ],
      },
      { kind: "h", text: "Configure a round" },
      {
        kind: "steps",
        items: [
          "Open the round's card. Set **Played on** — if it's rained off, change the date here and only this round moves.",
          "For 9 holes, choose **Which nine**: Front nine or Back nine. Strokes fall differently on each nine, so a round scored from cards uses the front nine until you say otherwise. A match-play round can be left **Not fixed** — each match then says which nine it played when its score goes in.",
          "If the event uses more than one course, pick the round's **Course** — handicaps and par come from it.",
          "**Handicap** is on the face of the round: **Net** (off handicap — how a new round starts, as most club, society and league competitions are played), **Gross** (scratch, as a championship) or **Both** (a gross and a net order of merit from the same cards). Stableford is always off handicap. The handicap allowance sits right under it.",
          "A round players arrange among themselves — a knockout, a round robin, a league week — shows **Play by** on its face, with the sign-up deadline where there is one; a round robin also shows **Before the next round** there, where **Points into Round N** is one choice: **Start fresh**, **Carry all** or **Carry part** (then the share).",
          "Under [[Customize this round]] is what clubs, societies and leagues vary — above all for a field of mixed abilities: **Ties** first, how scores are recorded, **Handicaps for this round**, and the **Play by** date of a round the field plays on one day. It shows only what this kind of round raises — a medal has no match lines, a knockout no table — and its closed bar names the ties and anything you have changed.",
          "**Ties** is first under [[Customize this round]], and its closed bar says so. Each tie question the round raises is one line, with the rule in use — the standard rules of golf until you change it. A knockout all square after 18 plays extra holes from the 1st, hole by hole, and you record the winner on Bracket. A medal or Stableford places players level by countback on the card — the last nine, six, three, then the last hole — and anybody still level shares the place. A match-play round robin raises two questions: **A match all square after 18** (it stays halved unless you choose a countback or a play-off) and **Level in the table** (head-to-head, then hole difference, and so on). Press [[Change]] beside either to choose; they apply to every round robin in the tournament. A round robin's **Points for a match** — win, halve, loss — are under Customize too, as their own line.",
          "A round with matches also asks **How players keep their matches**, under [[Customize this round]]: **Tap who won each hole** — one tap a hole on any phone, the card players praised at the first cup — or **Stroke cards**, where each player enters their own strokes and the app works out who won each hole, shots included, with gross and net published: on the cup board each ball's gross and net sit under the names. A cup session starts on tapping; any other team match on stroke cards. Match Play and Nassau ask the same question as **How scores are recorded**. Choose before anyone scores: a round is kept one way, so once a match has a score the choice stays as it is.",
          "**On the day** appears once the tournament is live or the round has a card: **Is this round over?** and the **Scoring window**. Before then there is nothing to finish.",
          "Each format comes with the usual handicap allowance (Stroke Play 95%, Foursomes 50%, a Four-Ball 85% at stroke play and 90% in a match…). On a team round you can change it: the round's card has a section named for its format, **Handicaps for Four-Ball**, with [[Change]] beside the allowance. If cards are already in you are asked first, because every one of them is re-scored. An individual net round — a medal, a Stableford — has the same line on its card under **Handicap allowance**: the Rules of Handicapping recommend 95% for a field of thirty or more, and a committee may play a smaller field at 100%. A gross round and a match have no such line, because neither takes a share of a handicap.",
          "The allowance is taken of a player's course handicap before that is rounded, and the result rounded once, as the Rules of Handicapping say. So a course handicap of 7 that was 6.6 plays off 6 at 95%, not 7. **Handicaps for this round** shows all three figures for every player — the course handicap, what it was before rounding, and what they play off — so you can check any card by hand.",
          "To change one player's handicap, press [[Change a player's handicap]] there, then **Change** beside their name, and say what you are changing. **Their strokes in this round only** is whole strokes — 12, not 12.4 — and a plus handicap is typed “+2”; nothing else moves, and **Use in later rounds too** copies it to later rounds on the same course, tees and holes. **Their handicap index** is to one decimal — 14.2, or 14,2 — and moves every round of this tournament not yet played; a round with cards in keeps what it was scored off, and a round with its own strokes keeps those. The sentence above **Save** says exactly which rounds move.",
          "Tick **Also make it their handicap on Members** to make the new index the member's own, for every tournament they enter from now on. Only the organizer of the club, society or league can, a reason is asked for and kept in the history, and it is not offered for a guest, for a member whose index comes from an association such as GHIN, or for a nine-hole index. Their entries in other tournaments keep the figure they entered with.",
          "A two-ball round scored on gross (Four-Ball, Best Ball, Shamble) can be written down as **One card for the side** instead of a card each, under **Scores are entered as**. On net or Stableford each player's own card is needed, so the choice is not offered.",
        ],
      },
      {
        kind: "table",
        head: ["Format", "How it's scored", "Note"],
        rows: [
          ["Stroke Play", "Total strokes", "Gross, net or both."],
          ["Stableford", "Points per hole", "Always off handicap."],
          ["Modified Stableford", "Points, can go below zero", "Bigger rewards for birdies and eagles."],
          ["Match Play", "Holes won", "Needs an opponent: round robin, single match or bracket."],
          ["Nassau", "Front, back and overall, three games in one", "Needs a head-to-head round."],
          ["Skins", "Each hole a prize; ties carry", "No finishing position."],
          ["Four-Ball", "Pairs, better ball", "Match on a head-to-head round, medal on a stroke round."],
          ["Best Ball, Shamble", "Sides of 2–4", "Everyone plays their own ball."],
          ["Foursomes (alternate shot)", "Pairs, one ball", "50% combined allowance by default. One game, two names — listed once."],
          ["Greensomes, Chapman / Pinehurst", "Pairs, one ball after the drives", "60/40 handicap split."],
          ["Scramble, Texas Scramble", "Sides of 2–4, one ball", "Texas has a minimum-drives rule."],
          ["Other (scored by hand)", "Not scored by the app", "Field, tee sheet and messages work; the committee posts the result."],
        ],
      },
      { kind: "warn", text: "**This round cannot be scored as set** means the format and round type don't fit — for example Stroke Play on a round robin. The pickers no longer offer such a pair, so you will only see this on a round set up earlier. Choose another format on its card: until you do, Rounds & formats is not done and the tournament cannot be launched." },
      { kind: "h", text: "Set a cut" },
      {
        kind: "steps",
        items: [
          "On the round before the cut, tick **Cut the field for Round N** — under **What this round decides** on a stroke play round, under **Before the next round** on a round robin.",
          "Choose **Top N** or **Top N%**, and **Overall** or **Per flight**. The preview reads “X of the Y entered play Round N”. A cut after Round 2 or later ranks on the total so far, as a 36-hole cut does.",
          "A **Bracket** after a stroke play round takes the top 16 **Overall** to begin with, as a club qualifying on strokes does; after round-robin groups, the top players **Per flight**. Change either under **Qualification cut**. Where the number is at least the field, the card says everybody goes into the knockout — the draw gives byes.",
          "The bracket's card also says what shape its draw takes, under **The draw**: **One bracket** (lose and you are out), **Main + plate** — lose in the first round and you go into the plate, a knockout of its own — **Two flights** (top and bottom half by qualifying rank) or **Several flights**. Two round robins of match play and then a Main + plate knockout of the top 16 is a club match-play championship in groups.",
          "On a stroke play cut, choose how a tie for the last place is settled: **Ties go through** (the usual one, and the default — everybody level on that score plays on, so a cut to 16 can pass 17 or 18), **Play-off** (the players level play off and you record who won), or **Countback** (the better last 9 holes, then the last 6, 3 and the last hole, on the round's own gross, net or points — and if they are still level, a draw by lot that you record). Choose it before play: it is part of the terms you publish, and it locks with setup.",
          "The cut is made when you mark that round finished. Under **Play-off**, or a **Countback** that cannot separate them, the Dashboard's cut card names the players who are level and gives each a tick: tick who went through and press [[Record the play-off]] (or [[Record the draw]]), then [[Approve the cut]]. Until you do, the cut waits, closing the round says why, and nobody in the tie is shown as out — the board marks them “Tied for the last place”.",
          "While that round is played, the rules sheet tells players what it is for: “Top 16 and ties advance to the next round” — “in each flight” for a per-flight cut, and how a tie is decided when it is a play-off or a countback.",
          "Until then the next round is open to everybody. A card somebody starts in it early is kept if they make the cut and taken out if they don't — its holes are listed under **Recent changes** on Reports, so you can put them back in from Score entry.",
        ],
      },
      { kind: "h", text: "Round codes — no accounts needed" },
      {
        kind: "steps",
        items: [
          "In Tournament details → Players & scoring, set **How players sign in** to an access-code option.",
          "Each round gets one code under **Round Codes**, with [[Copy]] and [[Reissue]].",
          "Under the codes, [[Show the signs]] draws one sign per round — the round, a QR code and the code in large letters — and **Print** puts each on a page of its own. Put one in every cart and one on the first tee. A player scans it and lands on the round's names; or opens tourneyhq.club/play and types the code. Either way they then tap their own name.",
          "Before the day, scan a sign with your own phone: it should open that round's names. Stop there — tapping a name starts scoring as that player. A sign carries no names, so it stays right when groups change; reissuing the code stops its signs working, so print them again after a [[Reissue]].",
          "In a four-ball or foursomes match, any player on either side can keep the match on their phone: the code lists each foursome as its two pairs under their teams, and once they tap their name they tap, by name, the pair who won each hole — so a scorer who picks the wrong name still records every hole for the right pair. A player signed in to the app keeps their match on the same card: **Score this match** on Today. Ask one player per group to keep it, so two phones are not keeping one match. On Score entry you can open any of the round's matches and keep or correct it on the same card.",
          "Where a round is kept on **Stroke cards** instead, the code opens each player's own card: everyone enters their own strokes — a side playing one ball, its one card — and the app works out who won each hole from the cards.",
        ],
      },
      { kind: "warn", text: "Anyone with the code can report a score for that round. If it spreads beyond the field, [[Reissue]] it." },
      { kind: "h", text: "What locks after launch" },
      { kind: "p", text: "Structure locks: format, holes, course, scoring basis, cuts, tiebreakers, deleting rounds and editing the field. An organizer can [[Unlock setup]] to correct something. Running the event stays open: changing a round's date, marking a round over, handicap adjustments, adding a round, drawing the next round and deadlines." },
    ],
  },
  {
    id: "field",
    part: "Part 4",
    title: "Entries",
    blocks: [
      { kind: "where", text: "Set up → Entries" },
      { kind: "p", text: "Waiting to see how many sign up before choosing the format? Take entries first — the entry form says “Format to be confirmed” until you add a round, and Rounds & formats shows how many have entered when you come back to choose." },
      { kind: "h", text: "Add players yourself" },
      {
        kind: "steps",
        items: [
          "Under **Add someone new**: Player name, Email (required or optional depending on how players sign in), Mobile if this tournament requires one (it does only when you tick **Require a mobile number**, on any plan), **Handicap source** (GHIN, Manual or None), the handicap (a plus handicap is typed “+2.4”) and whether it's an 18- or 9-hole index, and optionally their Home club, which the list then shows under their name. Press [[Add to field]]. A handicap in the list below can be corrected in its own box, the same way; it saves when you leave the box, changes this tournament only, and works after setup has locked. Where Members still holds the old figure, the row says so and offers [[Make it … on Members]] — press it when the old figure was a mistake.",
          "Or [[Import CSV]] with a header row: a **name** column (or First Name and Last Name), plus email and phone if this tournament needs them, and a Home club or GHIN column if you have one. A plus handicap is written “+2.4”; a blank means no handicap, not scratch.",
        ],
      },
      { kind: "tip", text: "If your list has no email addresses at all, the import switches Round Codes on so players can still get in." },
      { kind: "h", text: "Let players sign up themselves" },
      {
        kind: "steps",
        items: [
          "Open **Let players sign themselves up** and press [[Publish the link]].",
          "For the noticeboard or the pro shop, [[Show QR code]] draws a poster — the tournament, its date and course, and a QR code to the sign-up link — and [[Print poster]] prints it on a page of its own. [[New link]] makes printed posters stop working, so print them again after one.",
          "Choose **When someone registers**: **Auto-confirm to capacity** or **Approve each entry**. Tick **Require a mobile number** if you want one.",
          "Share it from **Invite players**: edit the message, then [[WhatsApp]], [[SMS]], [[Share…]], [[Copy message]] or [[Copy link]].",
          "Under **Pending approval**, press [[Accept]] or [[Decline]]. Beyond capacity, entries go to the **Waitlist** and are promoted automatically when a place frees up.",
        ],
      },
      {
        kind: "list",
        items: [
          "[[Close registration]], [[Reopen registration]] and [[Follow the deadline again]] control the public sign-up only — staff can always add players by hand.",
          "Remove someone with × (or select several and [[Delete N selected]]). A player who has already played is withdrawn instead, and their results are kept.",
        ],
      },
    ],
  },
  {
    id: "draw",
    part: "Part 5",
    title: "Flights, sides and the tee sheet",
    blocks: [
      { kind: "h", text: "Flights" },
      { kind: "where", text: "Set up → Flights" },
      {
        kind: "steps",
        items: [
          "Pick a rule: **Balanced skills**, **Handicap divisions**, **Spread by handicap**, **By seeding**, **Random** or **Manual**.",
          "Pick **Flight size**: Auto, Set flights or Players / flight. Handicap divisions on Auto follow club convention — one division under 16 players, two under 32, three from 32.",
          "Press [[Generate flights]]. If matches have been scored, you're asked to confirm, because redrawing deletes them.",
          "Only **Manual** lets you drag players between flights and name captains.",
          "Divisions off different tees: set **Tees** on each flight here — on flights the app drew as well as Manual ones. A flight you leave alone plays the tournament's tees (and a woman in it the ladies', where the course has a set). A flight's Tees are offered unless Players & scoring says **Everyone plays the tournament's tees**; a player's own Tees on Registration are offered only under **A flight or a player may play their own tees**, and anyone you have not moved still plays their flight's.",
        ],
      },
      { kind: "h", text: "Teams and pairs (team formats only)" },
      { kind: "where", text: "Set up → Teams & pairs" },
      {
        kind: "steps",
        items: [
          "Add each side with [[Add team]], or press [[Draw sides automatically]] to balance by handicap.",
          "Fill sides with [[Add player]]; **Not on a side yet** shows who is left.",
          "In a round robin of sides, press [[Generate matches]] once there are at least two sides. A stroke-play round has no matches to draw, so the button is not there.",
          "Rename a side in its name box. Taking out a player who has returned a card asks first, because the side's score changes; a side with scores on it cannot be removed.",
        ],
      },
      { kind: "h", text: "Tee sheet" },
      { kind: "where", text: "The round in play → Tee sheet" },
      {
        kind: "steps",
        items: [
          "**Who plays together**: Random, Balanced handicap, Balanced skill, Seeded, or By position (once a round has been played). In a pairs event By position follows the pairs' own board, and partners always go out together.",
          "Choose the order off the tee and the group size (2, 3 or 4).",
          "**Start**: One tee, **Split** (1st and 10th) or **Shotgun** (a group on every hole). Set **First tee** and **Interval**.",
          "Players' pairing requests are kept together where possible (not in a draw by position); any that couldn't fit are listed.",
          "In a team round partners always go out together, and where sides play a match — a cup's four-balls or foursomes — both sides of each match share a group, so every group is one match.",
          "[[Save sheet]] keeps a draft. [[Save & publish]], then confirm [[Publish the tee sheet]].",
        ],
      },
      { kind: "tip", text: "On publish each player gets “Your tee time is set” (or “has changed”) on their phone and sees their group on Today. [[Unpublish]] hides it again without losing the draw. Print scorecards, one per group, from the tee sheet." },
    ],
  },
  {
    id: "launch",
    part: "Part 6",
    title: "Launch",
    blocks: [
      {
        kind: "steps",
        items: [
          "Finish the setup steps the **How a tournament runs** panel on Tournament details shows — including name and dates.",
          "Press the launch button on the status bar. **Launch “‹name›”?** summarises dates, course, result, players, flights and rounds, and notes that every non-staff account becomes a Player.",
          "Press [[Launch tournament]]. Setup locks; Part 3 lists what you can still change.",
        ],
      },
    ],
  },
  {
    id: "day",
    part: "Part 7",
    title: "On the day",
    blocks: [
      {
        kind: "list",
        items: [
          "Post a notice in **Tell players → Announcements** (Title, Message, and **Pin to the top of players' Today screen** if it matters). It shows on players' Today screens; it is not pushed to phones.",
          "Message a group in **Tell players → Messages**: under **Who is this for?** pick the club, the tournament, players, organizers, a flight, a round, a team, a group, or one person. It opens on this tournament; the line under it says in words who the message is going to, and a message cannot be called back.",
        ],
      },
      { kind: "h", text: "How scores come in" },
      {
        kind: "list",
        items: [
          "**Players on their phones** — hole by hole or a full card, by tap or by voice. No Save button; holes are kept on the phone with no signal. One phone can hold the group's cards (**Me / Group**). Players press [[Certify my card]] when done, or [[Something on this card is wrong]] to flag it.",
          "**Staff** on The round in play → Score entry, below.",
        ],
      },
      { kind: "h", text: "Stroke play" },
      {
        kind: "steps",
        items: [
          "Choose the round, then the **Player**.",
          "Enter the card **Hole by hole** or as a **Full card**, or use [[Voice entry]] (“four, par, birdie, six…”). Press [[Save scorecard]].",
          "Many cards at once: [[Import scores]] from a spreadsheet. A finished card comes in as returned, so one press of [[Approve N clean cards]] accepts the whole file; an unfinished one waits under Needs attention. Importing a changed card over an approved one sends it back to be approved again.",
          "Team rounds import the same way, gross only: a row per player for a four-ball (it goes on that player's side), a row per side for a shared ball — name the side or any one of its players.",
          "A match-play round takes who won each hole, the results, or gross cards — a card goes on that player's match and the match is scored from the pair. Somebody with two matches in the round can't be imported by card; use the results for them.",
        ],
      },
      { kind: "h", text: "Match play" },
      {
        kind: "steps",
        items: [
          "Pick the match from **Matches** (filter by Not started, Live, Awaiting approval, Final or Disputed).",
          "Enter a **Hole-by-hole result**, a **Full scorecard**, or the **Final result only** — winner and margin such as 3&2, then [[Apply result]]. A margin no match can finish on — 6&3 (that match was over at 5&4), or 3 UP — is refused beside the box, so the board never shows a different result from the one typed.",
          "A finished match can be confirmed ([[Confirm result]]) or disputed ([[Dispute]]); an organizer can [[Reopen]] it. Record a concession or walkover with [[‹Player› concedes]].",
        ],
      },
      { kind: "h", text: "Approve" },
      {
        kind: "steps",
        items: [
          "Press [[Approve N clean cards]]. Only approved cards are results.",
          "Work through **Needs attention** (for example “Incomplete — 14 of 18”) with [[Approve anyway]] where right. An organizer can [[Reopen]] an approved card.",
          "For match play, filter to Awaiting approval and press [[Approve N shown results]].",
          "A team match round or a cup session kept by tapping who won each hole — the singles too — lists its matches with **Awaiting approval** beside any finished result still to be signed off; open it and press [[Confirm result]] above the card.",
        ],
      },
      { kind: "h", text: "Leaderboard and the unexpected" },
      {
        kind: "list",
        items: [
          "A pairs event over more than one round shows the pairs' **Total over N rounds** above the round's own board — on the public board and on players' phones too — as long as the same pairs played every round. A team board ranks on score to par while a round is being played. Players or sides level on the round's figure are separated by countback on their card (last nine, six, three, then the last hole); only those still level share the place.",
          "**Leaderboard** refreshes every 30 seconds and shows Live or Final. For the clubhouse screen or the group chat, set **Who can see the leaderboard** to **Anyone with the link** and share the public link — names and scores, and anything you post as commentary.",
          "**Commentary**: under the Leaderboard, write a line — a run of birdies, a delay, where the cut is falling — and press [[Post]]. The latest shows above the scores on the public board and on every player's Board, with how long ago and without your name; the two before it are one tap away. Take one down with the ✕ beside it.",
          "**Weather**: [[Suspend play]], add a reason, [[Suspend play now]] — every player and the public board are told. [[Resume play]] when ready.",
          "**Pace of play** on the Dashboard shows each group's Thru and Due in, and names groups running behind.",
          "**Wrong scores**: correct the card on Score entry, or [[Clear scores]] (organizers) for chosen players or the whole round. Entries, flights and tee times are untouched. A card or result the committee has approved is reopened first.",
        ],
      },
    ],
  },
  {
    id: "special",
    part: "Part 8",
    title: "Knockouts, team cup and leagues",
    blocks: [
      { kind: "h", text: "Knockout" },
      {
        kind: "steps",
        items: [
          "Add a **Bracket** round. After a qualifying round, set the bracket's **Qualification cut** — Per flight (top 1, 2 or 3) or Overall (top N). As the first round, the whole field is seeded in.",
          "Optionally turn on the **Third and fourth** play-off.",
          "**Bracket** opens on **To play**: every tie that can be played now, round by round, each with its round's play-by date — and **Overdue** once that day has passed. Choose who won, how (**Played** with the margin, **Conceded**, **Walkover** or **Withdrawn**) and press [[Save result]]; the screen says back what it recorded, naming the round and both players. Winners move on automatically; players can report results for you to approve.",
          "Set each round's date under **Play-by dates** on the same tab and press [[Save dates]]. The dates show on every round heading of the draw, in To play, on each player's own tie and on the public board. A round can't be due after the round it feeds.",
          "**The draw** is the next tab: click a match's winner there and add the result (3&2, 1 up) if you prefer to work on the bracket.",
          "The rounds are named as a club names them: **Round 1**, **Round 2** and so on, then **Quarter-finals**, **Semi-finals** and the **Final**. Where a field does not fill its draw (of 4, 8, 16, 32, 64, 128 or 256), the first round is a **Preliminary round** when fewer players play in it than sit it out — 129 players is one preliminary tie, 128 v 129; 20 in a draw of 32 is four — and its winners go into Round 1 marked **through the preliminary round**. Nobody else is marked for not needing it.",
          "A place in a later round reads **Winner of** the two players of the tie that fills it, until that tie is played (**TBD** while that tie is itself still waiting on somebody). Nobody goes through a round unplayed. Where as many play in the first round as sit it out, or more, it is Round 1 and the players with nobody to play have a bye: it is not drawn as a tie, and they start in Round 2 with **bye** under their name — 100 players in a draw of 128 is 36 ties and 28 byes. In a seeded draw the byes go to the top seeds; in flights divided **Evenly, at random** they fall by lot, spread through every quarter, and no seed numbers are shown. A bye has no result to enter, and a tie can be decided only once both its players are known.",
          "A draw of more than 16 places is shown in sections, as tabs above it: **Quarter 1** to **Quarter 4** for more than 32 places, **Top half** and **Bottom half** for 17 to 32, then **Finals** (quarter-finals to the final) and **Whole draw**. Each tab says how many of its ties are still to play. A quarter-final is in both its quarter and Finals. Everything you can do on the draw works the same on every tab.",
          "Type a name into **Find a player** and choose them: the draw opens on their section and their path through it is outlined. The section and the player are in the page's address, so you can send the link to somebody, and Back returns to where you were. On a phone the draw scrolls sideways inside its own box.",
        ],
      },
      { kind: "h", text: "A big field: several flights" },
      {
        kind: "steps",
        items: [
          "On **Bracket**, under **Arrangement**, choose **Several flights** (before you launch: the arrangement locks with setup). Each flight is then its own knockout with its own champion — lose and you are out.",
          "Choose **How** the field is divided — **By handicap** (lowest in the Championship flight), **By the flights you already have**, **Evenly, at random**, or **By qualifying score** once a qualifying round has been played.",
          "Choose **Into** what shape. Each shape says how many byes it costs and one is marked Suggested; **Your own sizes** takes any numbers that add up to the field (16, 16, 12). Then [[Divide the field]].",
          "Until the first result is recorded you can move a player to another flight, put a late entrant in one, reseed or rename a flight, or start again. Dividing is the draw, not setup, so it stays open after launch — which is when a qualifying round is played.",
          "Once any flight has a result the flights are fixed. A player who withdraws stays in the draw and their opponent goes through by walkover. There is no play-off for third in flights: each flight's beaten semi-finalists share third.",
        ],
      },
      { kind: "h", text: "Team cup" },
      {
        kind: "steps",
        items: [
          "On Flights choose **Manual** and make exactly two flights, named for the teams.",
          "Add rounds of type **Team session** (four-ball, foursomes or singles match play).",
          "On **Team cup**, set each session's **Lineups**. A match is worth a point, a half each for a halve.",
          "Name a session — “Saturday four-balls” — with [[Rename]] beside its title; that name is what the board, the players and the final report call it. Leave it empty and it is “Session 1”, “Session 2”.",
          "A point that isn't a match — the lower team net total, say — goes under **Other points**: name it and give it a value with [[Add point]], and it counts in the cup's total straight away, so the target is right before it is decided. Give it to a team when it is; until then the board says **To be decided**.",
          "**Final report**, under the cup's score, is the whole cup on one page to send round: the score, every session's matches, who won every match they played and each player's points. Write **The story** in your own words and [[Save the story]], or leave it empty and the report tells it from the results. Once the cup is decided, the public leaderboard and the players' Board link to it.",
        ],
      },
      { kind: "h", text: "League or season" },
      {
        kind: "steps",
        items: [
          "Add the season's rounds at once with **How many?** and **Then** (weekly).",
          "**This week** shows the week's results, standings and skins.",
          "The standings under a week of strokes or points are the leaderboard's own table after that week: the total over every round played so far, in the leaderboard's places. A player who missed a cut holds no place in it, and nor, on strokes, does one with no card for a week you have closed; a total over fewer holes than the rest says “thru” beside it.",
          "Close each week once it is played. With members away a week is never “all in”, so the Dashboard asks to close it as soon as next week's draw is out and every card that was started is back — it says how many did not play. Closing moves everybody on to the new week.",
          "A **Round robin** round is a whole everyone-plays-everyone. Add several and each is its own contest unless you choose **Carry all** or **Carry part** under **Points into Round N**.",
          "**Season standings** adds tournaments up across a season; the **Honours board** keeps your champions (Birdie plan and above).",
          "To set one up: on **Season standings**, name it and press **Start a season**. Then, with each tournament that counts open, press **Add this tournament to the season** — a tournament counts once it is completed, and towards one season only.",
          "**Scoring & rules** holds the season's name, the points for each finishing place, how many of a member's rounds count (**Best of**) and how many they must play to be ranked (**Rounds to qualify**). **Save rules** keeps them.",
          "When a season is over, **Mark season finished** and **Start another season**. The finished one stays in the list beside the new one.",
          "Rained off? Change that round's **Played on** date. A tie settled by a play-off hole: [[Record the play-off hole]].",
        ],
      },
      { kind: "h", text: "A league of clubs" },
      {
        kind: "steps",
        items: [
          "Clubs that each put up pairs every week: make each club a **flight** with its members in it, and each week a round in a pairs format such as Four-Ball.",
          "On **Teams & pairs**, under **League**, choose how it is scored — a point a match, a point a hole with a bonus for the match, holes only, or a Nassau — how many pairs a club puts up, and whether the top 2, 4 or 8 play off. [[Save league settings]].",
          "Each week, on that round's tab: pick two names from a club's list and press [[Nominate pair]], in the order the pairs will play. Then [[Draw this week]]: clubs meet on a rotation, first pair against first pair. Drawing again asks first, and is refused once a card has a score.",
          "The table counts a meeting as **Played** once every four-ball in it has a result, not when it is drawn. A four-ball nobody has started shows a dash.",
          "Until every season meeting has a result, the play-offs are headed **as the table stands** and say how many meetings are still to come. Drawing the play-offs with a season week never played asks you first.",
        ],
      },
    ],
  },
  {
    id: "money",
    part: "Part 9",
    title: "Money",
    blocks: [
      { kind: "warn", text: "**TourneyHQ works the money out and writes it down. It never moves it.** Marking something settled records that a payment happened elsewhere." },
      { kind: "where", text: "Afterwards → Prizes & payouts — money setup at the foot of the page" },
      {
        kind: "list",
        items: [
          "**Costs handled outside the app** — fees and prizes happen elsewhere; skins and side games are still worked out.",
          "**Tournament kitty** — one pot: record money in and out. Nobody owes anybody, so no settle-up.",
          "**Split shared costs** — record who paid for what; the app works out who pays whom in the fewest payments, with side-game winnings folded in. Choose **Who adds a shared cost**.",
        ],
      },
      { kind: "h", text: "Prizes" },
      {
        kind: "steps",
        items: [
          "Under [[Add a prize]], start from a structure (such as flight winners) or enter Category, Detail and Amount, then [[Add]].",
          "Once results are in, pick each prize's **Winner** — the list shows finishing places to help. A prize for best gross or best net lists the field on that figure, with ties broken by countback (last nine, six, three, then the last hole) as the leaderboard breaks them.",
          "If nobody may take home two placing prizes, tick **One prize per player** above the list. The lines are then shown gross first: award the gross prizes first, and a player who wins one is skipped for the net. Each winner list puts anybody who already holds a prize last, saying which, and marks the next in line; choosing them anyway is refused beside the list. Skill prizes such as nearest the pin and longest drive don't count, so the same player can win one — each line has a **Counts** tick to say which kind it is. If somebody already holds two prizes, the tick is refused until you clear one.",
        ],
      },
      { kind: "h", text: "Skins" },
      {
        kind: "steps",
        items: [
          "Set the **Buy-in** and **Holes** (full round, front or back nine), then [[Save]].",
          "Mark who has paid in ([[Change]], then [[Save who paid in]], or [[Everyone with a card]]). Players who tapped “I'm in” appear under **Asked to join** — press [[‹Name› — take £X]] once you have their money.",
          "The pot shows its arithmetic and says **Provisional** until every hole is in. **Settling up** lists the payments.",
        ],
      },
      { kind: "h", text: "Side games and group games" },
      {
        kind: "list",
        items: [
          "**Settled by the scores**: low gross, low net, birdies, eagles, The match and Nassau — set a stake per player. The match and Nassau need a head-to-head round.",
          "**You name the winner**: closest to the pin, long drive and the like — [[Start this game]], pick entrants, then the winner (a tie splits the pot).",
          "A closest to the pin or long drive is shown on the public leaderboard under **Contests** — its winner once you name one, never the stake. If somebody sponsors it, [[Add a sponsor]] on its card: their name, and their website if they have one (https only). The board says **Sponsored by** beside the contest and thanks every sponsor at the foot. The printed standings on Reports carry the same list. Poker and other side games stay off both.",
          "**Side games** (Afterwards → Side games): a pot for one group only, separate from the field's money.",
        ],
      },
      { kind: "h", text: "When money shows" },
      {
        kind: "list",
        items: [
          "Results money appears only once the round is final — every card in, or the round closed — so nobody sees a figure that can still change.",
          "Live: each player's stake, and a Nassau front or back nine that's already decided.",
          "With Split shared costs, **The ledger** shows **Where everybody stands** and **To collect and pay out**; press [[Mark settled]] as payments happen ([[Undo]] reverses it).",
        ],
      },
    ],
  },
  {
    id: "finish",
    part: "Part 10",
    title: "Finish and export",
    blocks: [
      {
        kind: "steps",
        items: [
          "Approve the last cards. When everything is in, the Dashboard offers to close the round — or mark it over with **Is this round over?** on Rounds & formats. Any cut is made then, and the board reads Final.",
          "Award prizes and settle the money.",
          "Export from **Afterwards → Reports & export**: [[Export CSV]] for standings and flight results (or the format's own sheet), **Who turned out**, the **Bracket sheet** and **Scorecards**. The snapshot has a [[Print]] button for a PDF.",
          "On the Dashboard press [[Complete tournament]] and confirm. Boards switch to Final standings. To correct a card afterwards, press [[Reopen tournament]] — it asks first too — then complete it again.",
          "**Final report**, on Reports & export, is the whole tournament on one page to send round: the champion, the story, the format and field, the full leaderboard with gross and net, and who won the prizes. A tie for first is shown as shared — the committee settles it. A knockout's report is its draw, every result in the words a club uses (\"3&2\", \"at the 19th\", \"by walkover\"); while it is being played it says how many ties are played and how many players are still in, and it names the champion as soon as the final is played. Write **The story** yourself and [[Save the story]], or leave it and the report tells it from the results. Once the tournament is complete, the public leaderboard and the players' Board link to it.",
          "The report holds every part of the app the tournament used, and only those: flight winners, the draw, **How it was won** (who led after each round, the biggest climb, and the podium's place after each round), **Each round**'s winner, the prizes and contests, the **Highlights** read off the cards (holes-in-one and eagles first, the best round, the lowest gross, the best nine, the longest run at par or better, the most birdies), **In numbers**, the skins and side games, the entry fees and costs, the **Settle-up** and **Coming up** — the next round, the club's tournaments taking entries, and your pinned notices. Money is shown only once it is final.",
          "Opened while the tournament is still being played, it is **The results so far**: the leader is named on the figure the board ranks them on (\"net −6 through 9\", \"19 points through 9\"), the leaderboard has a **Thru** column, somebody yet to tee off reads \"Not started\", the flights show their leaders, and a round nobody has played yet is in no table. Before anybody has played, there is no leaderboard at all.",
          "Who sees the amounts: your copy on Reports, and a player in the field who is signed in (their own line comes first: \"You pay … to …\" or \"You are owed …\"). The public link names the winners and never what they won, and has no costs, no settle-up and no notices. TourneyHQ records the payments; players pay each other.",
        ],
      },
      { kind: "warn", text: "**On the free Par plan** a completed tournament stays open to view, read-only, for 15 days, and is then deleted for good. The dialog offers [[Open the final report]] — then [[Print or save as PDF]] to keep it — and [[Go to Reports]] to export first, or an upgrade to keep it. It cannot be reopened in those 15 days without an upgrade. A Par tournament is also removed 14 days after its first round if nobody completes it." },
      { kind: "warn", text: "**If a payment fails**, the club keeps its plan while Stripe tries the card again, and Club settings → Your plan (and the top of every screen, for the club's owners and admins) asks you to update it with Manage billing. **If the paid plan ends** — cancelled, or Stripe stops trying — every tournament the club had that day is kept **read-only for 12 months**: boards, results, reports, money and exports stay open, but nothing can be changed or scored, and an unfinished tournament is paused where it stands. Every screen of it says so, with the dates. Choose a plan again at any time in those 12 months and everything carries on where it stopped. Otherwise the club's owners are emailed 30 days and 7 days before those tournaments are deleted. A tournament you start after the plan ended is on the free Par plan's terms, and the kept ones don't count against Par's limits." },
    ],
  },
  {
    id: "recipes",
    part: "Part 11",
    title: "Recipes by event type",
    blocks: [
      {
        kind: "recipes",
        items: [
          { title: "Monthly medal or Stableford", for: "One day, individual, net.", steps: ["Template Stableford or Stroke Play.", "Dates and course; publish the sign-up link.", "Flights: Handicap divisions, Auto.", "Tee sheet: balanced; publish.", "Players score on phones; approve clean cards.", "Prizes per division; complete and export."] },
          { title: "Club championship with a cut", for: "Several rounds; leaders play on.", steps: ["Template Stroke Play; add rounds with How many?.", "Cut the field: Top N, and how a tie for the last place is settled (ties go through, play-off or countback).", "Leaderboard for organizers only if you want it blind.", "Mark each round over; the cut happens then.", "Draw the next tee sheet By position."] },
          { title: "Match play league", for: "Everyone plays everyone in their flight.", steps: ["Template Match Play — round robin.", "All the season's rounds at once: How many? + Then weekly.", "Flights: Balanced skills; Generate.", "Players enter and confirm matches; approve the rest.", "Follow This week and Season standings."] },
          { title: "Knockout with qualifying", for: "A medal round seeds a bracket.", steps: ["Round 1 Stroke play round; Round 2 Bracket.", "Qualification cut: Overall top 8 or 16, or per flight.", "Optional Third and fourth.", "Enter winners on Bracket."] },
          { title: "Club match play in flights", for: "A big field, each flight its own knockout.", steps: ["How is it played: a knockout; one Bracket round.", "Bracket → Arrangement: Several flights.", "By handicap, the Suggested shape, Divide the field.", "Enter winners flight by flight."] },
          { title: "Team cup", for: "Two teams, sessions, running score.", steps: ["Template … team cup.", "Flights: Manual, exactly two, named for the teams.", "Team session rounds.", "Lineups on Team cup."] },
          { title: "Charity scramble", for: "Teams of four, public board, specials.", steps: ["Template Scramble; shotgun start.", "Draw sides automatically.", "Leaderboard: Anyone with the link.", "Round codes so guests need no account.", "Prizes plus closest-to-pin and long-drive games."] },
          { title: "Society trip", for: "A few rounds away, costs split fairly.", steps: ["Money: Split shared costs.", "Players add expenses as they go.", "Skins and side games each round.", "The ledger lists the fewest payments; Mark settled."] },
          { title: "Casual round", for: "2–8 players, one round, maybe a side game.", steps: ["Choose screen: Just playing a round?", "Game, players, holes, shots given or not.", "Playing for anything? — money or “a pint”.", "Pick the course; Start the round. Deleted about a day later unless kept."] },
        ],
      },
    ],
  },
  {
    id: "faq",
    part: "Part 12",
    title: "Quick fixes",
    blocks: [
      {
        kind: "faq",
        items: [
          { q: "A button is greyed out", a: "The reason is written next to it — an empty field, locked setup, a missing course. Fix that and the button wakes up." },
          { q: "“Configuration is locked”", a: "The tournament has launched. An organizer can Unlock setup on the banner to change structure; running the day doesn't need it." },
          { q: "“This round cannot be scored as set”", a: "The format and round type don't match: match play needs a head-to-head round, stroke formats need a stroke play round." },
          { q: "A player can't find their card", a: "Check they're Confirmed (not Pending or Waitlist), the round is published, and — with a round code — that it hasn't been reissued." },
          { q: "No money is showing", a: "Result money appears only once the round is final. Approve the remaining cards or mark the round over." },
          { q: "Handicaps look wrong", a: "Check the member's index, the round's course and tees, and the round's allowance. Handicaps for this round, on the round's card, shows each player's course handicap, the figure before rounding and what they play off. The allowance is taken before rounding, so 95% of a course handicap of 7 can be 6: that is the Rule, not a mistake. And where the field plays tees of different pars, in stroke play or a match, a player on the higher par is given the difference as extra strokes after the allowance (Rule 6.2b); the list says how many. A Stableford round gives none." },
          { q: "Who decides which tees a player plays?", a: "You do. Tournament details sets the tournament's tees; Flights & groups sets a flight's; Registration moves one player. Registration shows what each player is on and why. An entrant cannot choose, and a woman starts on the course's ladies' tees where it has a set." },
          { q: "A public leaderboard link leaked", a: "Tournament details → Players & scoring → New link. The old link stops working immediately." },
          { q: "Somebody never got their 6-digit code", a: "Creating an account, or setting a first password on an address you invited, emails a 6-digit code to that address, and nobody is signed in until it is typed back. Ask them to check their spam folder, and to press Send a new code on the same screen: a code works for 15 minutes, and three can be sent in 15 minutes. Nobody else can set the password without it." },
          { q: "Why was I asked for a code when I signed in?", a: "Club staff signing in on a browser TourneyHQ has not seen before (a new laptop, a new phone, or after clearing the browser) are emailed a 6-digit code, and are signed in once it is typed back. Your password alone opens your members' details and the money records, so a new device has to show it can read your inbox too. After that, that browser is remembered for about a year. Players are not asked; they are sent an email when their account is signed in on a new browser." },
          { q: "My password was refused as found in a data leak", a: "When a password is chosen, it is checked against the passwords known from leaks at other websites, because those are the first ones anybody tries. Only the first five characters of a scrambled copy leave TourneyHQ, never the password itself. Choose a different password, ideally three or four unrelated words, and keep it to TourneyHQ alone." },
          { q: "I'm still signed in on a device I don't have", a: "Open Your account (your name, at the foot of the sidebar) and press Sign out everywhere. Every device is signed out, this one included. Your password stays the same, so sign straight back in." },
        ],
      },
    ],
  },
];
