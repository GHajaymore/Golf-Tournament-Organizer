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
        kind: "steps",
        items: [
          "Set **Organization name**, an optional **Short name**, and a **Logo** ([[Upload an image]] or paste a link). Choose **Name beside the logo** and fill in **Where you play**. Press [[Save changes]].",
          "Under colour, pick **Appearance** (Light, Dark or Auto) and a **Colour scheme**. The pairs marked easiest to read in direct sun are the safest choice for the course. Press [[Save theme]].",
          "Pick your **Currency**. It saves as soon as you choose and shows an example amount.",
        ],
      },
      { kind: "tip", text: "Your colours apply to this console and the public leaderboard. The player app keeps the TourneyHQ scoreboard look, so it reads the same in sunlight for every club." },
      { kind: "h", text: "Members" },
      { kind: "where", text: "Club → Members" },
      {
        kind: "steps",
        items: [
          "[[Add member]]: Name, Email (how they sign in), Phone, **Handicap index**, **Handicap is for** (18 or 9 holes), plus optional Member number, GHIN, Home club and private Notes.",
          "Or bring everyone in at once with [[Import CSV]]. You'll see what was added, updated or skipped, and any columns it didn't recognise.",
          "To enter members into the open tournament, tick them and press [[Add N to ‹tournament›]].",
          "Someone who has played can't be removed — use [[Set inactive]] so their results stay intact.",
        ],
      },
      { kind: "tip", text: "A member with no handicap shows **No index yet**, never 0 — a blank handicap is not scratch." },
      { kind: "h", text: "Staff" },
      { kind: "where", text: "Set up → Access & staff (organizers only)" },
      {
        kind: "steps",
        items: [
          "[[Add account]] with Name, Email and a role: **Organizer** (full control), **Assistant** (runs the day) or **Player**.",
          "To change a role, pick the new one, then confirm with [[Yes — make ‹name› ‹role›]]. Picking alone changes nothing.",
          "Each organizer or assistant uses a staff seat on your plan. The last organizer on a tournament can't be removed or demoted — promote someone else first.",
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
          "Registration: **Entries open**, **Registration deadline** and **Field capacity** (a fixed number, or open). Press [[Save event]].",
        ],
      },
      { kind: "h", text: "Players & scoring" },
      { kind: "where", text: "Tournament details → the Players & scoring card" },
      {
        kind: "list",
        items: [
          "**Who can see the leaderboard**: Organizers only, Organizers and players, or **Anyone with the link** — which shows the **Public leaderboard link** with [[Copy]] and [[New link]] (the old link stops working at once).",
          "**Who enters scores**: Organizers and assistants only, or Players may enter their own scores.",
          "**When players may submit**: during the round, hole by hole; or after the round, as a completed card.",
          "**How players sign in**: Email and password, Access code on their scorecard, or Either email or access code (see Round codes in Part 3).",
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
          "Choose **Format** and **Holes** (18 or 9), then [[Add round]]. The line under the button says what will happen.",
        ],
      },
      { kind: "h", text: "Configure a round" },
      {
        kind: "steps",
        items: [
          "Open the round's card. Set **Played on** — if it's rained off, change the date here and only this round moves.",
          "For 9 holes, choose **Which nine**: Front nine, Back nine, or Not fixed (shotgun or mixed). Strokes fall differently on each nine, so scoring waits until this is set.",
          "If the event uses more than one course, pick the round's **Course** — handicaps and par come from it.",
          "Under [[Customize this round]]: **Result calculation** (Gross, Net or Both; Stableford is always off handicap), how scores are recorded, **Completion deadline**, **Scoring window**, the cut and tiebreakers.",
          "Each format comes with the usual handicap allowance (Stroke Play 95%, Four-Ball 90%, Foursomes 50%…). Change it per round under **Handicaps for this round**.",
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
          ["Nassau", "Front, back and overall bets", "Needs a head-to-head round."],
          ["Skins", "Each hole a prize; ties carry", "No finishing position."],
          ["Four-Ball", "Pairs, better ball", "Match on a head-to-head round, medal on a stroke round."],
          ["Best Ball, Shamble", "Sides of 2–4", "Everyone plays their own ball."],
          ["Foursomes, Alternate Shot", "Pairs, one ball", "50% combined allowance by default."],
          ["Greensomes, Chapman / Pinehurst", "Pairs, one ball after the drives", "60/40 handicap split."],
          ["Scramble, Texas Scramble", "Sides of 2–4, one ball", "Texas has a minimum-drives rule."],
          ["Other (scored by hand)", "Not scored by the app", "Field, tee sheet and messages work; the committee posts the result."],
        ],
      },
      { kind: "warn", text: "**This round cannot be scored as set** means the format and round type don't fit — for example Stroke Play on a round robin. Change one of them." },
      { kind: "h", text: "Set a cut" },
      {
        kind: "steps",
        items: [
          "On the round before the cut, under **Before the next round**, tick **Cut the field for Round N**.",
          "Choose **Top N** or **Top N%**, and **Overall** or **Per flight**. The preview reads “X of Y advance into Round N”.",
          "The cut is made when you mark that round finished. Everyone tied with the last place also goes through, so a cut to 16 can pass 17 or 18.",
        ],
      },
      { kind: "h", text: "Round codes — no accounts needed" },
      {
        kind: "steps",
        items: [
          "In Tournament details → Players & scoring, set **How players sign in** to an access-code option.",
          "Each round gets one code under **Round Codes**, with [[Copy]] and [[Reissue]].",
          "Read it out on the first tee or print it on the tee sheet. Players open tourneyhq.club/play, enter the code and pick their name.",
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
    title: "The field",
    blocks: [
      { kind: "where", text: "Set up → Registration & field" },
      { kind: "h", text: "Add players yourself" },
      {
        kind: "steps",
        items: [
          "Under **Add someone new**: Player name, Email (required or optional depending on how players sign in), Mobile if required, **Handicap source** (GHIN, Manual or None), the handicap and whether it's an 18- or 9-hole index. Press [[Add to field]].",
          "Or [[Import CSV]] with a header row: a **name** column (or First Name and Last Name), plus email and phone if this tournament needs them. A plus handicap is written “+2.4”; a blank means no handicap, not scratch.",
        ],
      },
      { kind: "tip", text: "If your list has no email addresses at all, the import switches Round Codes on so players can still get in." },
      { kind: "h", text: "Let players sign up themselves" },
      {
        kind: "steps",
        items: [
          "Open **Let players sign themselves up** and press [[Publish the link]].",
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
          "Only **Manual** lets you drag players between flights, set tees per flight, and name captains.",
        ],
      },
      { kind: "h", text: "Teams and pairs (team formats only)" },
      { kind: "where", text: "Set up → Teams & pairs" },
      {
        kind: "steps",
        items: [
          "Add each side with [[Add team]], or press [[Draw sides automatically]] to balance by handicap.",
          "Fill sides with [[Add player]]; **Not on a side yet** shows who is left.",
          "Press [[Generate matches]] once there are at least two sides.",
        ],
      },
      { kind: "h", text: "Tee sheet" },
      { kind: "where", text: "The round in play → Tee sheet" },
      {
        kind: "steps",
        items: [
          "**Who plays together**: Random, Balanced handicap, Balanced skill, Seeded, or By position (once a round has been played).",
          "Choose the order off the tee and the group size (2, 3 or 4).",
          "**Start**: One tee, **Split** (1st and 10th) or **Shotgun** (a group on every hole). Set **First tee** and **Interval**.",
          "Players' pairing requests are kept together where possible (not in a draw by position); any that couldn't fit are listed.",
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
          "Post a notice in **Tell the field → Announcements** (Title, Message, and **Pin to the top of players' Today screen** if it matters). It shows on players' Today screens; it is not pushed to phones.",
          "Message a group in **Tell the field → Messages**: under **Who is this for?** pick the club, the tournament, players, organizers, a flight, a round, a team, a group, or one person.",
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
          "Many cards at once: [[Import scores]] from a spreadsheet. Imported cards wait for approval like typed ones.",
        ],
      },
      { kind: "h", text: "Match play" },
      {
        kind: "steps",
        items: [
          "Pick the match from **Matches** (filter by Not started, Live, Awaiting approval, Final or Disputed).",
          "Enter a **Hole-by-hole result**, a **Full scorecard**, or the **Final result only** — winner and margin such as 3&2, then [[Apply result]].",
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
        ],
      },
      { kind: "h", text: "Leaderboard and the unexpected" },
      {
        kind: "list",
        items: [
          "**Live leaderboard** refreshes every 30 seconds and shows Live or Final. For the clubhouse screen or the group chat, set **Who can see the leaderboard** to **Anyone with the link** and share the public link — names and scores only.",
          "**Weather**: [[Suspend play]], add a reason, [[Suspend play now]] — every player and the public board are told. [[Resume play]] when ready.",
          "**Pace of play** on the Dashboard shows each group's Thru and Due in, and names groups running behind.",
          "**Wrong scores**: correct the card on Score entry, or [[Clear scores]] (organizers) for chosen players or the whole round. Entries, flights and tee times are untouched.",
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
          "On **Bracket**, click each match's winner and add the result (3&2, 1 up). Winners move on automatically; players can report results for you to approve.",
        ],
      },
      { kind: "h", text: "Team cup" },
      {
        kind: "steps",
        items: [
          "On Flights choose **Manual** and make exactly two flights, named for the teams.",
          "Add rounds of type **Team session** (four-ball, foursomes or singles match play).",
          "On **Team cup**, set each session's **Lineups**. A match is worth a point, a half each for a halve.",
        ],
      },
      { kind: "h", text: "League or season" },
      {
        kind: "steps",
        items: [
          "Add the season's rounds at once with **How many?** and **Then** (weekly).",
          "**This week** shows the week's results, standings and skins.",
          "**Season standings** adds tournaments up across a season; the **Honours board** keeps your champions (Birdie plan and above).",
          "Rained off? Change that round's **Played on** date. A tie settled by a play-off hole: [[Record the play-off hole]].",
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
          "**Costs handled outside the app** — fees and prizes happen elsewhere; skins and side bets are still worked out.",
          "**Tournament kitty** — one pot: record money in and out. Nobody owes anybody, so no settle-up.",
          "**Split shared costs** — record who paid for what; the app works out who pays whom in the fewest payments, with side-game winnings folded in. Choose **Who adds a shared cost**.",
        ],
      },
      { kind: "h", text: "Prizes" },
      {
        kind: "steps",
        items: [
          "Under [[Add a prize]], start from a structure (such as flight winners) or enter Category, Detail and Amount, then [[Add]].",
          "Once results are in, pick each prize's **Winner** — the list shows finishing places to help.",
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
      { kind: "h", text: "Side bets and group games" },
      {
        kind: "list",
        items: [
          "**Settled by the scores**: low gross, low net, birdies, eagles, The match and Nassau — set a stake per player. The match and Nassau need a head-to-head round.",
          "**You name the winner**: closest to the pin, long drive and the like — [[Start this bet]], pick entrants, then the winner (a tie splits the pot).",
          "**Group games** (Afterwards → Group games): a pot for one group only, separate from the field's money.",
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
          "Approve the last cards and mark the round over with **Is this round over?** on Rounds & formats — any cut is made then.",
          "Award prizes and settle the money.",
          "Export from **Afterwards → Reports & export**: [[Export CSV]] for standings and flight results (or the format's own sheet), **Who turned out**, the **Bracket sheet** and **Scorecards**. The snapshot has a [[Print]] button for a PDF.",
          "On Tournament details press [[Complete tournament]]. Boards switch to Final standings.",
        ],
      },
      { kind: "warn", text: "**On the free Par plan** completing a tournament deletes it. The dialog offers [[Go to Reports]] to export first, or an upgrade to keep it. A Par tournament is also removed 14 days after its first round." },
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
          { title: "Club championship with a cut", for: "Several rounds; leaders play on.", steps: ["Template Stroke Play; add rounds with How many?.", "Cut the field: Top N (and ties).", "Leaderboard for organizers only if you want it blind.", "Mark each round over; the cut happens then.", "Draw the next tee sheet By position."] },
          { title: "Match play league", for: "Everyone plays everyone in their flight.", steps: ["Template Match Play — round robin.", "All the season's rounds at once: How many? + Then weekly.", "Flights: Balanced skills; Generate.", "Players enter and confirm matches; approve the rest.", "Follow This week and Season standings."] },
          { title: "Knockout with qualifying", for: "A medal round seeds a bracket.", steps: ["Round 1 Stroke play round; Round 2 Bracket.", "Qualification cut: Overall top 8 or 16, or per flight.", "Optional Third and fourth.", "Enter winners on Bracket."] },
          { title: "Team cup", for: "Two teams, sessions, running score.", steps: ["Template … team cup.", "Flights: Manual, exactly two, named for the teams.", "Team session rounds.", "Lineups on Team cup."] },
          { title: "Charity scramble", for: "Teams of four, public board, specials.", steps: ["Template Scramble; shotgun start.", "Draw sides automatically.", "Leaderboard: Anyone with the link.", "Round codes so guests need no account.", "Prizes plus closest-to-pin and long-drive bets."] },
          { title: "Society trip", for: "A few rounds away, costs split fairly.", steps: ["Money: Split shared costs.", "Players add expenses as they go.", "Skins and side bets each round.", "The ledger lists the fewest payments; Mark settled."] },
          { title: "Casual round", for: "2–8 players, one round, maybe a bet.", steps: ["Choose screen: Just playing a round?", "Game, players, holes, shots given or not.", "Playing for anything? — money or “a pint”.", "Pick the course; Start the round. Deleted about a day later unless kept."] },
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
          { q: "Handicaps look wrong", a: "Check the member's index, the round's course and tees, and the allowance under Handicaps for this round." },
          { q: "A public leaderboard link leaked", a: "Tournament details → Players & scoring → New link. The old link stops working immediately." },
        ],
      },
    ],
  },
];
