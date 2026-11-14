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
 *
 * IN THE CLUB'S GOLF (2026-10-24). A golf word that differs between countries
 * is a token — `{golfGroups}`, `{organizer}`, `{Outing}` — filled in by
 * `guideInClubWords` with the reading club's words (`golf-terms.ts`), so a US
 * league reads "leagues and golf groups" where a British club reads
 * "leagues and societies". `country-words.test.ts` refuses the word itself
 * here. A word inside a [[control]] or a **label** stays as the SCREEN spells
 * it: the guide names what is drawn.
 */

import { tableInClubWords, type GolfWords } from "./domain/golf-terms";
import { LIFECYCLE_STEPPER_ON } from "./domain/lifecycle-track";

/**
 * THE LIFECYCLE STEPPER, IN THE GUIDE (B03) — said only once its switch is on, when it takes the place
 * of the setup bar and the "How a tournament runs" panel (`LIFECYCLE_STEPPER_ON`).
 */
export const STEPPER_GUIDE =
  "Under the tournament bar on every screen, the stepper shows the whole tournament as one track — **Set up**, **Tee times** (**Draw** for a knockout, **Lineups** for a team cup, **This week** for a league), **Play** and **Results** — with each step marked **Done**, **Now**, **Needs you** or **To do**, and why. Its head counts the part you are in, for example **Set up · 4 of 5 done** (optional steps such as a medal's flights are not counted). It is drawn in full on the Dashboard, and on Tournament details while you are setting up; on other screens it is one line, such as **Round 1 · 18 of 24 cards in**, with a link to where that is done. The step it marks is always the one the Dashboard's button is for: **Launch tournament** while setting up, **Publish the tee sheet** before the first tee, **Open score entry** while play is on, **Close Round 1** once every card is in, the next round's pairings between rounds, and **Complete tournament** only once play is over. When the button is refused, the reason is said beside it with a link to where it is put right. The menu at the side follows the same four stops, under **Event**, with **Home** (the Dashboard) and **Messages** above them and the club and the help below. Every screen the menu listed before is still in it, some beneath the entry they belong to: Entries, Teams & pairs and Flights beneath **Players**; Print kit, Bracket, Team cup and This week beneath **Tee times & draw**; Side games beneath **Money & payouts**; Announcements beneath **Messages**; Member history beneath **Members**; Staff & helpers beneath **Club settings**; and the rules beneath **Guide & rules**. In that menu Tournament details reads **Event details**, Tournaments reads **Events**, Reports & export reads **Results**, Prizes & payouts reads **Prizes & side games** (and **Money & payouts** under Results opens it too, for paying out), the Tee sheet reads **Tee times & draw**, Season standings reads **Seasons & honours**, and the club's course list is one press away as **Courses**.";

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
      { kind: "where", text: "Club → Club settings (or {Community} settings)" },
      {
        kind: "p",
        text: "Club settings shows one section at a time. The row at the top picks it: **Name & branding**, **Colour**, **House defaults**, **Handicaps**, **Money**, **Plan** and **Staff & access**. Anything typed and not yet saved stays as it is while you look at another section.",
      },
      {
        kind: "steps",
        items: [
          "On **Name & branding**, set **Organization name**, an optional **Short name**, and a **Logo** ([[Upload an image]] or paste a link). Choose **Name beside the logo** and fill in **Where you play**. Press [[Save changes]].",
          "Also on **Name & branding**, **What this is** says whether you are a golf club, a {community}, or one person running their own golf. It decides what the console calls you, what setup asks for, and what money does by default: a golf club leaves costs to the shop, the others split shared costs. If changing it would change the money of tournaments that never chose their own, the screen names them first. [[Keep their money as it is]] sets your club's money default to what they get today and then changes it; [[Switch anyway]] lets them follow the new default. Nothing is deleted either way.",
          "On **Colour**, pick **Appearance** (Light, Dark or Auto) and a **Colour scheme**. The pairs marked easiest to read in direct sun are the safest choice for the course. Press [[Save theme]].",
          "Also on **Name & branding**, **Which golf words the app uses** follows the club's country: US golf in the US and Canada, UK golf in Britain, Ireland and Europe, and the golf of Australia, New Zealand and South Africa there. Your club reads {cart}, {group}, {community} and {outing} today. Pick another if your members say it differently. Format names such as Foursomes and Four-Ball never change.",
          "On **Handicaps**, the **Handicap body** follows your club's country. **Where indexes come from** says they are entered here: by you, or suggested from your members' cards. A live link that fetches indexes from your body is coming; until it arrives nothing is fetched.",
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
          "[[Add member]]: Name, Email (optional; it lets them sign in, and a member without one is still entered in tournaments and scores from the {cart} QR), Phone, **Handicap index**, **Handicap is for** (18 or 9 holes), plus optional **Gender**, Member number, GHIN, Home club and private Notes. Gender is used for one thing: in a tournament a woman starts on the course's ladies' tees.",
          "Or bring everyone in at once with [[Import CSV]]. You'll see what was added, updated or skipped, and any columns it didn't recognise. A plus handicap is written “+2.4”, in the file and in the form, and is shown that way on every list.",
          "To enter members into the open tournament, tick them and press [[Add N to ‹tournament›]].",
          "Someone who has played can't be removed — use [[Set inactive]] so their results stay intact.",
          "An active member who signs in with the email on the roster sees the club's tournaments straight away — no invitation needed. An inactive member does not.",
          "Before the club's first tournament, the list of what is still to set up sits above the members, so once the first one is added **Create your first tournament** is one press away.",
          "Each member also has **My season** in the player app, reached from Events: their own tournaments, rounds, places, best scores and prizes this season. Every place is the one that tournament's board gives. A tournament whose standings you have not published shows them no place, and nobody sees another member's season.",
        ],
      },
      { kind: "tip", text: "A member with no handicap shows **No index yet**, never 0 — a blank handicap is not scratch." },
      { kind: "h", text: "Staff" },
      { kind: "where", text: "Set up → Staff & helpers ({organizers} only)" },
      {
        kind: "steps",
        items: [
          "[[Add account]] with Name, Email and a role: **{Organizer}** (full control), **Assistant** (runs the day) or **Player**.",
          "To change a role, pick the new one, then confirm with [[Yes — make ‹name› ‹role›]]. Picking alone changes nothing.",
          "Each {organizer} or assistant uses a staff seat on your plan. The last {organizer} on a tournament can't be removed or demoted — promote someone else first.",
          "Club staff are added the same way under Club settings → **Staff & access**, by email address. When somebody has asked to join, that section's name shows how many are waiting. There is nothing for them to accept: they are staff at once, and are emailed. Until they next sign in the list shows the address you typed and **Invited — not opened yet**, not their name. Under **Same name nearby** you are also told when a club in your area is set up with, or renamed to, the name of yours: it names that club, its town, the day and who runs it (a name, never an email address), and [[Dismiss]] clears it. Nobody is emailed; if it is the same club as yours, ask them to join yours instead of keeping a second.",
          "The first time somebody you added signs in, they choose a password and we email a 6-digit code to the address you typed. The password only takes effect once they type that code back, so only the person who reads that inbox can take the seat. The code works for 15 minutes; **Send a new code** sends another.",
          "A role at the club is changed the same way as one on a tournament: pick it, then confirm. It reaches further — an **Admin** is an {organizer} on every tournament the club runs, and the confirmation says so before you agree.",
          "Anyone added can leave again themselves, from Your account → Your clubs. A club's only Commissioner can't leave until somebody else is one.",
          "Only a **Commissioner** can make someone a Commissioner, change a Commissioner's role, remove one, or delete the club. An **Admin** can add, change and remove people up to Admin, and the buttons for anything more are greyed with the reason beside them. A club always keeps at least one Commissioner.",
        ],
      },
    ],
  },
  {
    id: "create",
    part: "Part 2",
    title: "Create a tournament",
    blocks: [
      { kind: "h", text: "Set up with a few questions" },
      { kind: "where", text: "Club → Tournaments → Set up with a few questions" },
      {
        kind: "p",
        text: "The quickest way in, and the one most club, {community} and group events need. Each question is already answered with the usual choice and says why, so pressing on through is enough to make a real tournament. On a phone it is one question a screen with [[Back]] and [[Next]]; on a computer it is one short form. Going back keeps every answer.",
      },
      {
        kind: "steps",
        items: [
          "**What are you running?** One day, two or three days, a weekly league, a knockout, a team cup, or a casual round with friends (that one opens the casual round's own screen).",
          "**How do players play?** On their own, in pairs, or in teams of four. **How is it scored?** follows from it: medal or Stableford on their own (medal first for a US club, Stableford first elsewhere); four-ball better ball, foursomes or greensomes in pairs; a scramble in teams.",
          "**Off handicap or scratch?** Off handicap uses the Rules of Handicapping's allowance for the format in that kind of round: 95% for medal and Stableford, 85% for four-ball stroke play, 90% for four-ball match play, 100% for singles match play, 50% of the pair for foursomes, 25% for a scramble.",
          "**When is the first day?** The next Saturday at the club is chosen for you. Two or three days asks how many (on consecutive days), a league how many weeks (one a week).",
          "**Who keeps the scores?** Players on their phones, or the committee from cards.",
          "[[See your tournament]] shows **Here is your tournament — change anything**: the name, the rounds and their days, the handicap allowance, who keeps the scores, and what is left for later. [[Change]] on any line goes back to that question.",
          "[[Check the scorecard]]: pick the course and the tees the field plays from. The card shows par, stroke index and yards for every hole, with the tees' course rating and slope. Hold it beside the club's own card and tick **This matches the club's card**, which also marks the course's card as checked. A course with no tees is refused, because no handicap could be worked out on it; tees with no slope are flagged. **I'll pick the course later** is fine too.",
          "Card wrong or missing something? [[Fix the card]] (or [[Add the course]] when it is not saved yet) makes the draft and opens the course's own card on Tournament details → Courses, the same editor as always: change any hole's par, stroke index or yards and press [[Save course]]; change a tee's Course Rating or Slope, or add tees, and press [[Save tees]]; paste the card, look the course up, or read a photo of the club's printed card where your plan includes card reading. Then mark the card as checked there.",
          "[[Confirm]], then [[Create the draft]]. The tournament is made as a draft, so nothing is published and nobody is invited, and you land on the dashboard with its setup checklist.",
        ],
      },
      {
        kind: "tip",
        text: "Left for you, on purpose: the entries, flights (divided once the field is in), the tee sheet (drawn once entries are in, first tee 08:00 unless you change it), contests and side games (off until you add them). Everything the questions set stays editable on the screens below.",
      },
      { kind: "h", text: "Or set it up yourself" },
      { kind: "where", text: "Club → Tournaments" },
      {
        kind: "steps",
        items: [
          "Type a name under **Create a new tournament**.",
          "Choose **How is it played?** — a single round, a series of rounds, or a knockout.",
          "Choose **Start from**: a template, or one of your past tournaments to copy (settings carry over, scores never do). Choosing a past tournament asks for its **First day** (and **Last day**), exactly as **Copy last event** below does, and the entry window and rounds move with it.",
          "Press [[Create tournament]], then [[Manage]] to open it.",
        ],
      },
      { kind: "h", text: "Copy last event" },
      { kind: "where", text: "Dashboard → Copy last event (the club's Commissioner and Admins)" },
      {
        kind: "steps",
        items: [
          "It starts from your most recent tournament. To start from another, pick it under **Copy from**.",
          "Check **Name of the copy**, then pick the **First day** (and the **Last day** if it runs over more than one). Press [[Create the copy]] and you are taken into the new tournament.",
          "Comes across: the format, rounds, handicap allowances, who decides the tees, flight rules, side games (with nobody entered), entry settings and who can see the leaderboard.",
          "Never comes across: players, cards, results, money, notices, the tee sheet, round codes or the public links. The copy gets a new sign-up link when you publish it, and the old tournament keeps its own.",
          "The entry window and each round keep the same distance from the first day as last time — entries closed three days before, so they do again. A day that has already gone at your club is left empty, and a first day that has already gone is refused.",
        ],
      },
      {
        kind: "tip",
        text: "**One name in play at a time.** Two of your tournaments still being set up or live cannot share a name (capitals and extra spaces do not count as a difference). Creating, copying or renaming to a name another one is using is refused with the name of the one using it and a free name you can take, such as one with the year or (2). Completed tournaments may share a name, so last year's Spring Medal and this year's can both be called Spring Medal; reopening last year's while this year's is still in play is refused until one of them is renamed or completed.",
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
      {
        kind: "tip",
        text: "The list above the form is every tournament you can reach, each with the status its dashboard shows — **Setting up**, **Live**, **Play over** or **Completed**. A tournament whose last day has gone by without being launched reads **Dates passed, not launched**. Two tournaments with the same name each show their dates (or the day they were created, where they have none), with a number such as #2 where the dates are the same too; the same dates are shown in **Start from**. The bin deletes a tournament for good, with its players, every score and its other records, and asks first; there is no undo; only an {organizer} of that tournament can delete it, and pressing the bin on any other says so.",
      },
      { kind: "h", text: "Tournament details" },
      { kind: "where", text: "Set up → Tournament details ({organizers} only)" },
      {
        kind: "steps",
        items: [
          "**Tournament name** and **Tournament dates** (the dates field takes the name of the event's kind, so an {outing} reads **{Outing} dates**) are required to launch; the name cannot be one another of your tournaments in play is using. Tick **These dates are tentative** if they may move; dates have their own [[Save dates]].",
          "**Overall result** — Match play or Stroke play — decides how season standings are worked out, not each round's format. It is asked once the tournament has a round; until then your first round decides it (a medal or Stableford round makes it stroke play), and a choice you make after that stays.",
          "**Golf course**: pick a course, **Other (enter manually)**, or **No fixed course — players choose**.",
          "Press [[Save event]]. When entries open and close, and how many places there are, are not set here: they are on **Entries**, with the switch that opens them.",
        ],
      },
      { kind: "h", text: "Players & scoring" },
      { kind: "where", text: "Tournament details → the Players & scoring card" },
      {
        kind: "list",
        items: [
          "**Who can see the leaderboard**: Organizers only, Organizers and players, or **Anyone with the link** — which shows the **Public leaderboard link** with [[Copy]] and [[New link]] (the old link stops working at once).",
          "Under it, with **Anyone with the link**, are two more links on the same board, each with **Open** and [[Copy]]: the **Event page** and the **Clubhouse screen**. [[New link]] replaces all three at once, and all three close when the board is set to Organizers only or Organizers and players.",
          "The **Event page** is the one link to send before and after the day — in the newsletter, on the noticeboard, in the group chat. It shows the tournament's name, date, course and format; while entries are open, an **Enter this tournament** button and the sign-up QR poster; on the day — from launch, or from the first result in any round — the leaderboard and the clubhouse screen; afterwards, the result and **Read the final report**. Contests with a sponsor are listed with their winners. It is a link, not an email: nothing is sent.",
          "The **Clubhouse screen** is the leaderboard for a TV in the bar: large type, no buttons, the field a page at a time when it is longer than the screen, starting again after the last page, and refreshing every 30 seconds like the board. It shows nothing the board does not.",
          "**Who enters scores**: Organizers and assistants only, or Players may enter their own scores. With Organizers and assistants only, a player's card and a round code offer no score buttons at all: the screen says the club is keeping the cards and points them to the board.",
          "**When players may submit**: during the round, hole by hole; or after the round, as a completed card. A match is complete once it is decided, so a match won 5&4 goes in without the four holes nobody played.",
          "**How players sign in**: Email and password, Access code on their scorecard, or Either email or access code (see Round codes in Part 3).",
          "**Tees**: pick the tournament's tees, then **Who may play other tees**. You decide the tees at three levels, each beating the one before: the tournament's here; a flight's, on Flights & groups; one player's, on Registration. **Everyone plays the tournament's tees** stops at the first (a seniors' championship off one set), **A flight may play its own tees** at the second (a club championship off three), and **A flight or a player may play their own tees** allows all three and is what a new tournament starts on. A player never chooses their own, and the entry form does not ask. Once a round played on cards has a card in, **Played from**, a flight's **Tees** and a player's **Tees** are shut and say why: that round's handicaps were frozen off its tees at its first card, so its scores are cleared on Score entry before the tees change.",
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
          "**Handicap** is on the face of the round: **Net** (off handicap — how a new round starts, as most club, league and {golfGroup} competitions are played), **Gross** (scratch, as a championship) or **Both** (a gross and a net order of merit from the same cards). Stableford is always off handicap. The handicap allowance sits right under it.",
          "A round players arrange among themselves — a knockout, a round robin, a league week — shows **Play by** on its face, with the sign-up deadline where there is one; a round robin also shows **Before the next round** there, where **Points into Round N** is one choice: **Start fresh**, **Carry all** or **Carry part** (then the share).",
          "The bin on a round's card deletes it for good, with its handicaps and money records; there is no undo. A round with no pairings or tee sheet goes on one press, launched or not; once its pairings or tee sheet are made it asks first (“Round 2’s tee sheet goes with it.”), and it asks when the round holds money records. A round with scores is not deleted: “Round 2 has scores. Clear them on Score entry first.” An assistant can delete a round that holds no money records; a round holding stakes or money records is deleted by the {organizer}.",
          "**Changing a round once it is under way.** Until a round has scores, its format, holes, handicap allowance, scoring basis, tees and day change as before, launched or not. Changing the format of a drawn round so it plays differently — a round robin of matches set to Stroke Play, or back — says what must be drawn again. Once a round has scores: its **format** and its **holes** are not changed (the cards would mean something else — clear its scores on Score entry first); its **allowance** and **Net or Gross** ask first — “This changes a term of the competition after play. Every net score in Round 2 (14 cards) is worked out again. Money is final-only, so nothing paid changes.” — and on [[Change it anyway]] every playing handicap is worked out again off the handicaps the round was frozen with, and Recent changes lists whose moved, old to new. Its **tees** and **course** are not changed, and nor are the tournament's, a flight's or a player's tees while they would reach it: each player's handicap was fixed off the tees at the round's first card — “Round 2’s handicaps were frozen off its tees at its first card. Clear Round 2’s scores on Score entry first.” Wherever those tees are chosen — the round's card here, **Tees** and **Played at** on Score entry, **Played from** on Tournament details, a flight's **Tees** on Flights & groups, a player's **Tees** on Registration — the box is drawn shut with that sentence under it, before you press anything. A round of matches already played keeps the strokes its matches were played off, so its allowance and basis stay as they are. Once the cut after a round has been made, that round's allowance and basis stay as they are too — the next round's field was decided on them: “The cut after Round 1 was made on these figures. Undo the cut first, then change it: untick “This round is finished” on Round 1.” A new day for a played round is taken, and players' schedules show it. Once the tournament is completed none of these change: an {organizer} reopens it first.",
          "Under [[Customize this round]] is what clubs, leagues and {golfGroups} vary — above all for a field of mixed abilities: **Ties** first, how scores are recorded, **Handicaps for this round**, and the **Play by** date of a round the field plays on one day. It shows only what this kind of round raises — a medal has no match lines, a knockout no table — and its closed bar names the ties and anything you have changed.",
          "**Ties** is first under [[Customize this round]], and its closed bar says so. Each tie question the round raises is one line, with the rule in use — the standard rules of golf until you change it. A knockout all square after 18 plays extra holes from the 1st, hole by hole, and you record the winner on Bracket. A medal or Stableford places players level by countback on the card — the last nine, six, three, then the last hole — and anybody still level shares the place. A match-play round robin raises two questions: **A match all square after 18** (it stays halved unless you choose a countback or a play-off) and **Level in the table** (head-to-head, then hole difference, and so on). With three or more level, head-to-head is their matches won less matches lost against each other only, asked again of any still level — a match not played yet counts for nothing, so while the round robin is still being played a player who has not met the others sits between those who won their meetings and those who lost them; if they beat each other in a circle it decides nothing among them and the next step is asked, and anybody the steps cannot separate shares the place — never the order they entered in. A countback on the toughest holes reads the stroke index of the course each match was played on, so a match played away is decided on the away club's hardest holes, not your home card's. Press [[Change]] beside either to choose; they apply to every round robin in the tournament. A round robin's **Points for a match** — win, halve, loss — are under Customize too, as their own line.",
          "A round with matches also asks **How players keep their matches**, under [[Customize this round]]: **Tap who won each hole** — one tap a hole on any phone, the card players praised at the first cup — or **Stroke cards**, where each player enters their own strokes and the app works out who won each hole, shots included, with gross and net published: on the cup board each ball's gross and net sit under the names. A cup session starts on tapping; any other team match on stroke cards. Match Play and Nassau ask the same question as **How scores are recorded**. Choose before anyone scores: a round is kept one way, so once a match has a score the choice stays as it is.",
          "**On the day** appears once the tournament is live or the round has a card: **Is this round over?** and the **Scoring window**. Before then there is nothing to finish.",
          "Each format comes with the usual handicap allowance (Stroke Play 95%, Foursomes 50%, a Four-Ball 85% at stroke play and 90% in a match…). On a team round you can change it: the round's card has a section named for its format, **Handicaps for Four-Ball**, with [[Change]] beside the allowance. If cards are already in you are asked first, because every one of them is re-scored, and Recent changes says whose playing handicap moved. An individual net round — a medal, a Stableford — has the same line on its card under **Handicap allowance**: the Rules of Handicapping recommend 95% for a field of thirty or more, and a committee may play a smaller field at 100%. A gross round and a match have no such line, because neither takes a share of a handicap. Whatever the figure, the rules sheet always states a team round's allowance and whose it is — the Rules' recommendation, a club convention, or the committee's — and a four-ball's board lists **Plays off** for each player, their own playing handicap, instead of a side figure nobody plays off.",
          "The allowance is taken of a player's course handicap before that is rounded, and the result rounded once, as the Rules of Handicapping say. So a course handicap of 7 that was 6.6 plays off 6 at 95%, not 7. **Handicaps for this round** shows all three figures for every player — the course handicap, what it was before rounding, and what they play off — so you can check any card by hand.",
          "To change one player's handicap, press [[Change a player's handicap]] there, then **Change** beside their name, and say what you are changing. **Their strokes in this round only** is whole strokes — 12, not 12.4 — and a plus handicap is typed “+2”; nothing else moves, and **Use in later rounds too** copies it to later rounds on the same course, tees and holes. **Their handicap index** is to one decimal — 14.2, or 14,2 — and moves every round of this tournament not yet played; a round with cards in keeps what it was scored off, and a round with its own strokes keeps those. The sentence above **Save** says exactly which rounds move.",
          "**A player with no handicap index**, in a round scored net, in Stableford or in a match with strokes, has nothing to be given strokes from, and until you give them strokes for the round they are scored as a scratch golfer (handicap index 0). Entries, the launch dialog and What’s next on the dashboard say who; **Give strokes** opens the list at the top of Rounds & formats. Type the strokes for the round, a whole number from 0 to 54, and press **Give** — or Enter, which gives it and moves to the next player. One press also covers every later round on the same course, tees and holes with no cards in yet. A figure given by mistake has **Change** on its line. Their index on Members stays blank: these are strokes for the round, not an index. A plus figure is given under **Handicaps for this round**. Once a card is in for the round its handicaps are fixed, so the list shows the player as scored as a scratch golfer there, with **Correct**: type the strokes and why — the reason is kept in the history — check the sentence that says who changes and from what, and press **Confirm**: that player's net, points and place in that round are worked out again from them, and nobody else's. It is refused while the player has a match result stored in that round (clear that match on Score entry, correct the strokes, then enter its result again), once the round is closed (untick “This round is finished” first), and once results are released (reopen the tournament first).",
          "Tick **Also make it their handicap on Members** to make the new index the member's own, for every tournament they enter from now on. Only the {organizer} of the club, league or {golfGroup} can, a reason is asked for and kept in the history, and it is not offered for a guest, for a member whose index comes from an association such as GHIN, or for a nine-hole index. Their entries in other tournaments keep the figure they entered with.",
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
          "A round robin's cut takes the same three choices, under **Before the next round**: **Ties go through** (the default — everybody level on points plays on), **Play-off** (the players level on points play off), or **Countback** — the table's own tie-breaks, in the order set under **Ties**, and if they still cannot separate them, a draw by lot. That cut is made when you draw the next round: under a play-off, or tie-breaks that run out, drawing it is refused with the players named, and the round's card gives each a tick — tick who went through, press [[Record the play-off]] (or [[Record the draw]]), then draw the round. If you record it after the round is already drawn, the card says so: redraw the round, so the draw uses the result. Until you do, the board marks them “Tied for the last place” and nobody in the tie is shown as out — with a knockout to come as well, the board shows this cut first, and the knockout's line once the cut is made.",
          "While that round is played, the rules sheet tells players what it is for: “Top 16 and ties advance to the next round” — “in each flight” for a per-flight cut, and how a tie is decided when it is a play-off or a countback. A round robin's cut is printed on the round robin's sheet, because its table decides it, even with a medal played in between: “Top 16 and ties advance to Round 3”.",
          "Until then the next round is open to everybody. A card somebody starts in it early is kept if they make the cut and taken out if they don't — its holes are listed under **Recent changes** on Reports, so you can put them back in from Score entry.",
        ],
      },
      { kind: "h", text: "Round codes — no accounts needed" },
      {
        kind: "steps",
        items: [
          "In Tournament details → Players & scoring, set **How players sign in** to an access-code option.",
          "Each round gets one code under **Round Codes**, with [[Copy]], [[Share]] and [[Reissue]]. **Share** sends a message — “Scoring for <tournament>, <round>: tap <link> — or open tourneyhq.club/play and type <code>” — to the phone's share sheet; on a computer with none the button reads **Copy message** and copies it. Send it to the players or their group chat, never a public page: anyone with the code can report a score.",
          "Under the codes, [[Print the signs]] opens the **Print kit** (Part 5) with the round's signs ticked: a **{cart} sign** for every group — who is in it, the strokes each receives, what the scorer does, the code in large letters and a QR — and a **spare sign** with no names, for walk-ins and the starter's hut. Each {cart} sign's QR carries its own group, so scanning it opens the question for that group — “You're keeping Group 3 …” — with the list skipped; the spare sign opens the round's list, as does typing the code at tourneyhq.club/play. The TourneyHQ mark sits in the centre of every QR. Either way they then tap their group, not their name: in a match round each match is a group, both sides named (“Rakesh & Snehal v Subhas & Prashant”), with its tee time and starting hole once the tee sheet is published (a round with no sheet of its own shows another round's tee time only for a match of exactly the same players — a cup's second nine, the same four); in a stroke round, the tee sheet's groups with all their names. A stroke round with no published tee sheet still lists the names.",
          "A phone that kept a group earlier in the same tournament is offered it first — “Last time: Group 3 — …” — when the same people are still together, with **Not my group** for the full list. It still asks the one question for each round.",
          "A player holding a round code sees a **Leaderboard** button on their page where the board is for **Participants** or **Public**, and none where it is kept to **Staff**. Participants' board opens behind their round code; the public link still answers only for a **Public** board.",
          "The phone then says back what it is about to keep — “You're keeping Group 3: Rakesh & Snehal v Subhas & Prashant · 12:54 off the 10th” — with **Yes, that's my group** and **No, go back**. It asks once: the same phone is not asked again for that group in that round. In a stroke round the scorer then picks whose card they keep, out of that group's names — or, on a round kept by **One scorer per group**, “Which one are you?” (in a match as well), because that phone keeps every card in the group and the next phone to confirm it follows.",
          "Before the day, scan a sign with your own phone: it should open the question for that group (the spare sign, the round's list). Stop there — answering Yes starts scoring it. Reissuing a code stops its signs and scorecards working, and the Print kit then lists every sheet carrying it — signs and scorecards — as out of date so you can print just them again after a [[Reissue]].",
          "A match is one card, the same whoever keeps it: side A as drawn on the left, and every answer names the side that won — a team cup's teams (“CVC won · Halved · CDG won”), otherwise the pair (“Rakesh & Snehal won”) or the player. Any player on either side can keep it. A player signed in to the app keeps their match on the same card: **Score this match** on Today. On a round kept by **One scorer per group** (below) only one phone keeps it; on a round where each player enters their own, ask one player per {group} to keep it, so two phones are not keeping one match. On Score entry you can open any of the round's matches and keep or correct it on the same card.",
          "Where a round is kept on **Stroke cards** instead, the {group} leads to each player's own card: the scorer picks whose, and enters that ball's strokes — a side playing one ball, its one card — and the app works out who won each hole from the cards. On a round kept by **One scorer per group**, the scorer's phone keeps every ball in the match, picked by name above the card.",
        ],
      },
      { kind: "warn", text: "Anyone with the code can report a score for that round. If it spreads beyond the field, [[Reissue]] it." },
      { kind: "h", text: "Who keeps score — one phone per group" },
      {
        kind: "steps",
        items: [
          "Each round card on Rounds & formats has a **Who keeps score** line, with **Customize** behind it. **One scorer per group** (a new round's default): one phone in each {group} keeps the {group}'s card. **Each player enters their own**: every player keeps their own card or their own side's match. **Organizer only (paper cards)**: players hand in paper cards and you enter them; their phones show nothing to press for that round.",
          "Groups come from that round's own published tee sheet — never another round's. Until it is published, each player keeps their own card — a match is its own {group} — and the round card says so. Publish the tee sheet before the first group goes out.",
          "On the course, the first phone to confirm its {group} keeps the card: it enters everyone's scores — every card in the {group}, or every match in it. Every other phone in the {group} says “Group 3 is being kept on Ann's phone”, follows the card as the scores go in, and keeps its **Leaderboard** button. Nobody is shut out.",
          "A flat battery, or the wrong person keeping it: any player in the {group} presses **Take over the card** and confirms once. The card moves to their phone, and the change is logged under both names. The phone that was keeping it is refused from its next save in words — “its last scores weren't saved” — and follows the card from then on. The scorer can also **Hand the card to someone else**, by name, within the {group}.",
          "Choose one scorer per group before anyone scores: once players have entered their own, the round stays as it is.",
        ],
      },
      { kind: "h", text: "The end-of-round check" },
      {
        kind: "steps",
        items: [
          "Beside **Who keeps score** is the **End-of-round check** (on for a new tournament round, off for a casual one). In match play, once a match is decided the side that did not enter the result checks it on their phone: **Confirm the result** or **That's not right**. In stroke play each player checks their OWN card, whoever kept it: **Confirm my card** or **Something's wrong**.",
          "A disputed result or card stays off the leaderboard until you settle it on Score entry: on a round-robin table the match counts as not played yet — never as a halve — and the head-to-head ignores it. A result both sides have agreed waits in your queue marked as agreed, where the committee approves results; where players settle them, it is confirmed when the other side confirms.",
          "A casual round has no check. Its setup asks one line instead: **Who enters scores** — **One phone for the group** (the default) or **Each player their own**, for friends who each keep a card on their own phone.",
        ],
      },
      { kind: "h", text: "What locks after launch" },
      { kind: "p", text: "Structure locks: cuts, tiebreakers, points, how many scores count, moving a player between flights, players' details and importing a list. Each screen's banner names what is locked and why — **Rounds · Locked because the tournament is live.** — and a press on a control that was drawn before the lock is refused in the same words, with nothing changed. Running the event stays open: changing a round's date, marking a round over, handicap adjustments, adding a round (refused only once the tournament is completed), drawing the next round and deadlines. A round's format, holes, allowance, scoring basis, course and tees, and deleting a round, are not locked by launch: each is judged by what it would change in that round — open until it has scores, then asked or refused, as the Rounds banner's **Under way** lines say (see Rounds & formats)." },
      { kind: "p", text: "To change something after launch an {organizer} presses [[Make a committee correction]], on the banner or on the dashboard. It opens ONE part of setup — the details, the rounds, the field, the flights, the draw, the sides or the cup's teams — for a reason of at least ten characters, which goes in Recent changes with your name and the time it ends. It closes when you press **Done**, or at midnight by your club's clock, whichever comes first; opening another part closes the first, and the record says so. A correction to the field opens the field's own changes — a late entry, an approval, a player's details, a list, and a late entrant's division — and one to the flights opens placing and moving players; the Entries banner says so while it stands. A part locked by scores or results is not opened by a correction: clear the scores or the results first, the way the banner says — a round with scores is never redrawn over them. An assistant reads “Ask the Organizer to make a committee correction” and cannot open one. Launching, completing and reopening a tournament each write their own line in Recent changes too." },
      { kind: "p", text: "A tournament unlocked the old way — all of setup at once — says so on the dashboard and offers only to lock it again; from now on one part opens at a time." },
      { kind: "p", text: "The day's changes to the field stay open too, for an {organizer} or an assistant, without a correction: [[Withdraw]] a player, [[Put back]] one withdrawn by mistake, and — in stroke play, Stableford and a league — add a late entry until Round 1's last published tee time (with no published sheet, until its first card is in; after that, a walk-in needs an {organizer} to make a committee correction to the field). A round robin takes a late entry only with a flight, and their matches are drawn against it. In match play or a team cup the draw is the field, so nobody can be added once it is launched; a knockout takes nobody once its draw is made, and a reserve waits on the Waitlist instead ([[Add as a reserve]]). A withdrawal leaves their matches to be recorded as walkovers. Where a late entry is still taken, the Entries banner says what is locked and what is open — **The field · Players’ details and imports are locked because the tournament is live. A late entry can still be added here.** — and where it is not, it says **Locked because the tournament is live.** and the way out is the committee correction." },
    ],
  },
  {
    id: "field",
    part: "Part 4",
    title: "Entries",
    blocks: [
      { kind: "where", text: "Set up → Entries" },
      { kind: "p", text: "Waiting to see how many sign up before choosing the format? Take entries first — the entry form says “Format to be confirmed” until you add a round, and Rounds & formats shows how many have entered when you come back to choose." },
      { kind: "h", text: "Open entries" },
      {
        kind: "steps",
        items: [
          "At the top of Entries, one card says whether entries are **Not open**, **Open** or **Closed** (and, before the opening day, when they open), and has one button. Set **Entries open**, **Entries close** and **Places** (a fixed number, or open) first, and press [[Save entry terms]]. The closing day itself is open, until midnight at the club. After launch the entry terms are read-only; to take entries past the closing day, use [[Reopen entries]].",
          "Press [[Open entries]] when you are ready to send the notice: it publishes the sign-up link. [[Close entries]] stops sign-ups, and [[Reopen entries]] takes them again, past the closing day if you want. They control the public sign-up only — staff can always add players by hand.",
          "Choose **When someone enters**: **Auto-confirm to capacity** or **Approve each entry**.",
        ],
      },
      { kind: "h", text: "Add players yourself" },
      {
        kind: "steps",
        items: [
          "Under **Add someone new**: Player name, then **Member** or **Guest (not a club member)**. A member belongs to the club; add their email so they can sign in, or leave it for later: they can play and score now. A guest needs no email and is never asked for a mobile. Everyone scores from the {cart} QR on the day. Then Email (optional, for a member), Mobile if this tournament requires one from members (it does only when you tick **Require a mobile number**, on any plan), **Handicap source** (GHIN, Manual or None), the handicap (a plus handicap is typed “+2.4”) and whether it's an 18- or 9-hole index, and optionally their Home club, which the list then shows under their name. Press [[Add to field]]. A handicap in the list below can be corrected in its own box, the same way; it saves when you leave the box, changes this tournament only, and works after setup has locked. Where Members still holds the old figure, the row says so and offers [[Make it … on Members]] — press it when the old figure was a mistake.",
          "Or [[Import CSV]] with a header row: a **name** column (or First Name and Last Name), plus phone if this tournament asks members for one, and email, Home club and **Handicap ID** (GHIN, WHS, CDH, Golf ID…) if you have them. [[Download template]] gives you the header. A **Member or guest** column is optional: write member or guest. With no email, a row is a guest unless it has a handicap ID or its name matches a member on your roster. A plus handicap is written “+2.4”; a blank means no handicap, not scratch.",
          "Before anything is added you see **Check the list**: every row as Member or Guest (not a club member), how many of each, and **Check** beside a row worth a second look (“No email, but has a handicap ID”, “Same name as a member on your roster”). Press [[Make guest]] or [[Make member]] on any row to change it, then **Import** (it says how many players), or [[Choose another file]]. A guest is imported without the email if the file had one.",
          "The field shows **Member** or **Guest** beside each name, and **No email yet** beside a member without one; add it in their Email box when you have it. A guest's row has no email box. Entries waiting for approval show the same.",
          "**A guest's player link** (no email, no app): on a guest's row press [[Player link]]. A panel opens under the row and says where the link stands: **Not made yet**, **Not opened yet**, or **Opened on 1 phone or browser** with the day it was last opened. The link is made the first time you press one of its buttons, and it is the same link every time after that. [[Show QR]] puts a QR code on your screen for the guest to scan at the desk, with the address and the code under it (tourneyhq.club/p and a code such as K7QM-2XRA-9DTP). [[Read it out]] shows the code large, for a phone call. [[Share…]] opens your own phone's share sheet with a message ready: pick WhatsApp, Messages or anything else and press Send there; TourneyHQ sends nothing itself. On a computer with no share sheet the button reads [[Copy message]]. [[Copy link]] copies the bare link. Send it to the guest only, never to a group: the link is theirs alone. It opens their tee time, their card (where this tournament lets players keep their own) and the board for this tournament, and it is never a sign-in. Opened on three or more phones or browsers, the panel suggests a new link. [[New link]] (it asks first) makes a new code: the old one stops working on every phone that has it. [[Turn off link]] stops it opening anywhere; the guest can still score on the day from the round code. A withdrawn or disqualified guest's link stops by itself, and every link ends 90 days after the tournament's last day of golf. A guest's match play is entered with the round code for now. Each Show, Read, Copy and Share is on the record (Recent changes) by who pressed it, never with the code. Members are not given a link: their way in is their email. **In messages** the guest reads and writes in their round, group and team threads and can message the organizers; a guest's posts are marked **Guest** beside the name. If a guest's posts are a nuisance, press [[Mute in messages]] in the same panel: their posts to the event's threads are refused (they are told so), they can still message the organizers, and their link, card and Today are untouched; [[Unmute in messages]] undoes it. Each mute is on the record. A guest who turns tee-time alerts on gets them by notification only (no email, no text); New link or Turn off link stops the old phone's alerts at once.",
        ],
      },
      { kind: "tip", text: "When you add somebody without an email to a tournament that signs players in by email only, Round Codes come on as well, so they can still score from the {cart} QR; Entries says so. Change it on Tournament details. The same happens when you enter members with no email from the club roster." },
      { kind: "h", text: "Let players sign up themselves" },
      {
        kind: "steps",
        items: [
          "Once entries are open, **Let players sign themselves up** shows the sign-up link, with [[Copy link]].",
          "For the noticeboard or the pro shop, [[Show QR code]] draws a poster — the tournament, its date and course, and a QR code to the sign-up link — and [[Print poster]] prints it on a page of its own. [[New link]] makes printed posters stop working, so print them again after one.",
          "Tick **Require a mobile number** if you want one.",
          "Whoever uses the link is emailed a 6-digit code and types it back before they are entered, so nobody can enter somebody else, or an address that is not theirs. Nothing is entered, and no place is taken, until the code is right. Somebody who is already signed in as that address is entered at once. A player you add yourself needs no code.",
          "Share it from **Invite players**: edit the message, then [[WhatsApp]], [[SMS]], [[Share…]], [[Copy message]] or [[Copy link]].",
          "Under **Pending approval**, press [[Accept]] or [[Decline]]. Beyond capacity, entries go to the **Waitlist** and are promoted automatically when a place frees up.",
        ],
      },
      {
        kind: "list",
        items: [
          "Remove someone with × (or select several and [[Delete N selected]]). A player who has already played is withdrawn instead, and their results are kept.",
        ],
      },
      { kind: "h", text: "On the day: withdrawals and late entries" },
      { kind: "where", text: "Set up → Entries, once the tournament is launched" },
      {
        kind: "steps",
        items: [
          "The banner reads **Under way** and says what is still open. An assistant can do all of this as well as the {organizer}; nothing needs unlocking.",
          "To take somebody out, press × on their row, then [[Withdraw]]. They come off the tee sheet and the board; their scores and side-game entries stay on the record. After launch nobody is deleted: they move to **Withdrawn**.",
          "The results list a player who had begun as **WD** and one who had not teed off as **DNS** (did not start): on your Leaderboard, the Reports sheet and its CSV, beneath WD and above DQ, with no place. The public board and the players' Board leave a DNS out. One case to know: somebody who withdrew before launch but whose entry was kept (they had a side-game entry or a side) is also listed DNS once the tournament is launched.",
          "Where they were drawn on a published tee sheet, the screen says what that leaves — “Group 3 goes out as a {groupOfTwo}”. Leave it, or put someone in on the Tee sheet.",
          "If somebody is waiting, the first on the **Waitlist** moves into the place by themselves and the screen names them, while late entries are still open. They have no tee time yet: put them in a group on the Tee sheet ([[Put in group]]). Moving in is a late entry, so once late entries close — or in a knockout whose draw is made, a round robin, match play or a team cup — nobody moves in by themselves: the place stays empty.",
          "Withdrawn by mistake? Press [[Put back]] beside their name under **Withdrawn**. If the place has been filled in the meantime, they go back on the Waitlist, where they first queued. If a walkover has already been recorded against them, Put back leaves it as it is: whether the match is replayed is the committee's ruling, made on Score entry or the Bracket.",
          "To take a late entry in a stroke play or Stableford competition, use **Add someone new** ([[Add late entry]]) or the roster picker. Where the field is flighted the form offers a **Flight** (optional — one division is a complete setup). Added without one, the screen says “Sam is in the field but in no flight. Put them in one.” and keeps saying it, on Entries and on Flights, until you choose one in their row (**Choose a flight**) — even when the draw is confirmed, because placing a late entrant moves nobody else. Either way it reminds you to put them in a group on the Tee sheet.",
          "In a round robin in flights a late entrant needs a flight: a player in no flight has no matches. Choose it in the form's **Flight** (required), then [[Add late entry]]. Their matches against everybody in that flight are drawn, so each of them has one more to play; nobody else's pairing changes. The roster picker and approving an entry cannot give a flight, so they are refused once launched. With the draw confirmed it needs an {organizer}'s committee correction to the field. A player already in the field with no flight is put in one the same way, with **Choose a flight** in their row.",
          "In a knockout, nobody can join once the draw is made — once launched, or once its first result is in (even before launch): a bracket has no empty place past round one. Add them as a reserve instead: type their details and press [[Add as a reserve]]. They wait on the **Waitlist** and the draw does not change. To draw again, clear the knockout's results on the Bracket (and, once launched, an {organizer} makes a committee correction to the field).",
          "Late entries close at the LAST TEE TIME of Round 1 on its published tee sheet, on the round's day, by your club's clock: a walk-in can still go into the last group while the early groups' cards come in. The **Under way** banner says the time. With no published sheet for Round 1 they close when its first card is in. There is no grace period: the time on the sheet is the time, even when the start is running late. A walk-in after that needs an {organizer} to make a committee correction to the field (an assistant cannot).",
          "In match play or a team cup the draw is the field: Add is refused once launched. A withdrawal there, and in a round robin or a knockout, leaves their matches to be recorded as walkovers (Score entry, or the Bracket for a knockout); the app does not award them by itself.",
          "Still locked after launch: importing a list, removing several at once, a player's name, email and 9- or 18-hole index, and moving a player who is already in a flight. Those need an {organizer} to [[Make a committee correction]] — to the field for the list and the details, to the flights for the move — on this screen's banner or on the dashboard; while it stands, the banner says what it opened. Before launch, a confirmed draw is changed the same way it always was: Reopen the draw on Flights.",
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
      { kind: "tip", text: "A medal or a Stableford needs no flights: one field is a complete setup, and the step reads **Optional — one field**. A round robin is played inside its flights and a team cup's flights are its two teams, so those two need them before they can launch. On a round robin with no flights the Dashboard's Matches tile says so, with the link to make them." },
      {
        kind: "steps",
        items: [
          "Pick a rule: **Balanced skills**, **Handicap divisions**, **Spread by handicap**, **By seeding**, **Random** or **Manual**.",
          "Pick **Flight size**: Auto, Set flights or Players / flight. Handicap divisions on Auto follow club convention — one division under 16 players, two under 32, three from 32.",
          "Press [[Generate flights]]. If matches have been scored, you're asked to confirm, because redrawing deletes them.",
          "Only **Manual** lets you drag players between flights and name captains.",
          "Divisions off different tees: set **Tees** on each flight here — on flights the app drew as well as Manual ones. A flight you leave alone plays the tournament's tees (and a woman in it the ladies', where the course has a set). A flight's Tees are offered unless Players & scoring says **Everyone plays the tournament's tees**; a player's own Tees on Registration are offered only under **A flight or a player may play their own tees**, and anyone you have not moved still plays their flight's. Once a round played on cards has a card in, both are shut, with the reason under them — the round's handicaps were frozen off its tees at its first card.",
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
          "Once the tournament is launched the sides lock. The banner at the top names the reason — **Sides · Locked because the tournament is live.** — and a padlock on the toolbar and on each side points to it. An {organizer} can press [[Make a committee correction]] on the banner to open the sides, for a reason, until Done or the end of the day; an assistant is told only the {organizer} can. Renaming a side stays open.",
          "If another tab launched the tournament while this screen was open, a press here is refused in words — “Locked because the tournament is live. Make a committee correction to change teams.” (an assistant reads “Ask the Organizer to make a committee correction to change teams.”) — nothing changes, and the screen redraws with the banner.",
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
          "[[Save sheet]] keeps a draft. [[Save & publish]], then confirm [[Publish the tee sheet]]. Beside the confirm, a line such as **3 players have notices off. Tell them in person.** counts the players this round's alert cannot reach: nobody in their name has turned alerts on (a guest with no email, or a member with no email, can only be told on Today or in person). It is a count, never names.",
          "**Changing the sheet after it is published**: you can, until the tournament is completed, and the screen says what changed: “Players were already sent their times. 2 players’ times changed. Those with notifications on get an alert; everyone sees it in TourneyHQ.” Only the players whose time or start hole changed get an alert, and only if they have notifications on; taking the sheet back with **Unpublish** sends none. Each change is listed on Recent changes by count of times changed, never by name. Once a round has scores, the groups that have teed off or have a card in stay exactly as they are — a re-draw must keep them — while the groups that have not started can still be moved, re-drawn or have a player replaced; the next rounds' sheets are not affected. Only a completed tournament refuses: “The tournament is completed, so its tee sheets are final.” An Organizer can reopen it on the dashboard.",
          "**Change a saved sheet without a re-draw**: under each group, a **Move [name] to…** list moves one player to another group (each choice reads like Group 3 · 8:20 AM · 3 players; a full group and a group that has begun are listed but cannot be chosen, and say why), and the arrows or **Move to position…** move a whole group earlier or later. The times and start holes stay with the slots, so the players move and the times do not: \"the third group goes first\" is two taps up. Nothing is written until you press **Save changes** (**Cancel** throws the draft away). A group that has teed off, or has a card in, cannot change, and nobody moves out of it or into it. A group left with two or three players is said under the draft. Move the last players out of a group and it is removed when you save (the draft says so); the other groups keep their own times, and on a published sheet their names too (printed signs and cards still say Group 4, so a gap such as Group 1, 2, 4 is normal), and moving a later group up into the freed slot gives it that slot's time. Players marked out for the week are not shown and do not count, so the real gaps are on screen as soon as you mark them. On a published sheet it stays published, and only the players whose time changed are told. Where partners play together, **Move [A & B] to…** moves the pair as one.",
          "**Replace a player who will not play** (a no-show, a cancellation on the morning): beside each player in a group that has not started, press **Replace…**. Choose who steps in: a member of the field who is not already playing that week (anybody already in another group or pair, marked out for the week, or who missed the cut is listed greyed with the reason, and so is a member with no handicap index in a round scored net until you have given them strokes for the round at the top of Rounds & formats; once a card is in for the round, choose somebody with a handicap, or a guest), or **A guest (not a member)…** with a name and a handicap index (in a round scored net you must type the handicap the committee gives the guest, as the Rules of Handicapping allow for a non-member; only in a gross round may you **leave blank: they play gross only**, and a guest with no index is never taken for a scratch golfer). Choose why (**No-show**, **Cancelled** or **Other**); one sentence states what will happen, then press the button. The new player takes the exact place: the same group, tee time and hole, and in a pairs round the same place in the pair, so the pair and its match are unchanged and the partner keeps their result. It works until that group has started (its tee time passed by the club's own clock, or a card in); the late-entry cutoff does not stop it. The player replaced is marked out for the week (in a league that asks each week) or, where nothing is asked each week, withdrawn from the field in the same press (their row is kept), so the field holds the new player and not both. **A guest who stands in scores no individual season points** (the season table leaves them out and scores the members among themselves, so a member behind the guest takes the place above; the pair's and week's points still count). Only a guest you create with Replace counts as a stand-in: a guest you pick from the field, or entered another way, who plays the season scores as a regular. A stake they had paid in a side game stays in its pot, exactly as when somebody withdraws (to be settled by hand), one they had not paid is marked out, and the new player enters fresh; a guest stand-in is out of later weeks unless somebody puts them in, and the record (Recent changes) reads who was replaced by whom, who pressed it, when, the group, the reason and the handicap used. Nothing is deleted. A published sheet stays published and the new player is told their time. The Organizer and an Assistant can both do it. A pair that plays every round, a match-play round whose draw is the pairing, and a team cup session are changed on their own screens.",
          "A late entry or a reserve who moved in has no group yet: **Not in a group yet** lists them over the saved sheet. Choose a group with room (fewer than four) and press [[Put in group]]. A group already out on the course is marked **teed off** and listed last; whether a late arrival may join it is the Committee's call. Nobody else moves and no time changes; on a published sheet only that player is told their time. Moving a player who is already in a group is a re-draw.",
        ],
      },
      { kind: "tip", text: "On publish each player gets “Your tee time is set” (or “has changed”) on their phone and sees their group on Today. [[Unpublish]] hides it again without losing the draw. To print the cards and signs for the round, press [[Print…]] under the sheet." },
      { kind: "h", text: "Print kit" },
      { kind: "where", text: "The round in play → Print kit (or [[Print…]] on the Tee sheet and the Team cup)" },
      {
        kind: "steps",
        items: [
          "Choose the round, and **Paper**: A4 or US Letter (it starts on your club's country). Every card is the normal scorecard size, 9.5 × 3.75 in, printed two to a sheet with lines to cut on; the sheets themselves are below the list.",
          "Tick what you want. **Scorecards** — one per player, named, with their course and playing handicap (CH and PH), par, stroke index and yards, a dot on every hole they receive a stroke (two dots for two), and lines for the marker and the player to sign; a Stableford card has a Pts column for the Committee. For an individual format choose **One card per player** or **One per group** (an {outing}'s group card). A pairs round prints one card per side: each partner's score on their own line in a four-ball, one score for the side in a foursomes, greensomes or scramble.",
          "A match needs no scorecard: **Match result slips** — one per match, the strokes each receives, and a line each side signs. A **team cup** prints **Cup match cards**, one per match. Print it from the four-ball session.",
          "**Scorecards** also carry their group's QR, bottom right, with the code typed under it; the code is part of what is printed, so a reissued code marks the cards already printed as out of date. On screen every QR is a link to its own address: tap it to see what a player's camera will open.",
          "**{Cart} signs** — **One per {cart}** (its two riders in bold, the whole group named, the strokes each receives, the code and a QR that opens that group), or **One per group (walking)** — the **Spare sign** (two: the first tee and the clubhouse), and the **Starting sheet**, a full page with an **On the tee** column to tick; print as many as you need.",
          "**Fold-outs.** Where a normal card genuinely cannot hold a card — a group of five or more, or a cup day with four-balls on one nine and singles on the other on one card — it prints twice the height, one to a sheet, and folds once to the normal card. The list names every fold-out and why. Type is never made smaller.",
          "The button says how many sheets: press **Print N sheets**. In the print dialog choose **Actual size (100%)** and turn the browser's headers and footers off. Print one sheet first and measure the 50 mm line in its margin: if it is not 50 mm, the printer is scaling. Cut on the lines; the cards come out in group order when the bottom pile goes under the top.",
          "If the groups, a tee time, the tees, a handicap or the round code change after you printed, the Print kit and the Tee sheet say how many printed sheets are out of date and name them. [[Reprint these]] prints just those, as the next version.",
          "**Reports → Exports → Print kit** opens the same page with the morning's paper ticked.",
        ],
      },
      { kind: "tip", text: "Paper never carries an email, a phone number or an amount of money. If one has been typed into a name, the Print kit says so before you print." },
      { kind: "h", text: "Money and the prize list" },
      { kind: "where", text: "Set up → Prizes & payouts — money setup at the foot of the page" },
      {
        kind: "list",
        items: [
          "Answer **how money works** before you launch, and write the prize list the players will be told about. Paying out is Part 9, afterwards. TourneyHQ works money out and writes it down; it never moves it.",
          "**Costs handled outside the app** — fees and prizes happen elsewhere; skins and side games are still worked out.",
          "**Tournament kitty** — one pot: record money in and out. Nobody owes anybody, so no settle-up.",
          "**Split shared costs** — record who paid for what; the app works out who pays whom in the fewest payments, with side-game winnings folded in. Choose **Who adds a shared cost**.",
          "Under [[Add a prize]], start from a structure (such as flight winners) or enter Category, Detail and Amount, then [[Add]]. The winners are named later, once results are in (Part 9).",
        ],
      },
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
          "Until it is launched, a tournament's status is **Setting up** — one step, however far you are. Entries are not a status: players can sign up once you publish the sign-up link on **Entries**. With results already in, it reads **Setting up · results in** and the card says which round has results; the button is still **Launch tournament**.",
          // The lifecycle stepper replaces the rail and the "How a tournament runs" panel when its switch
          // goes on, and the guide says so in the same one line (`LIFECYCLE_STEPPER_ON`).
          (LIFECYCLE_STEPPER_ON ? STEPPER_GUIDE : "Work through the setup steps on the bar across the top of each Set-up screen — it is the one count of how far you are (for example **3 of 6 done**); the **How a tournament runs** panel on Tournament details marks where you are without a second count.") +
          " The tournament needs a name and its **dates**; a venue alone is not enough, because players cannot plan around a tournament with no day. Until you launch, the Dashboard keeps the steps still to do under **Still to set up**, even once your players are in.",
          "Some steps are **Optional** and never stop you: flights for a medal or a Stableford (one field is a complete setup, and the step reads **Optional — one field**), the answer on how money works, and a day for every round of a tournament played over several rounds. Tees that cannot give a Course Handicap also leave **Tournament details** unticked and Optional, and the **Ready to launch** card says why, for example “Add tees with their Course Rating and Slope, or players get strokes off their raw Handicap Index.”: add the tees and their Course Rating and Slope on Tournament details → Courses, or launch as it is. Once nothing stops a launch the bar reads **Ready to launch** and says how many parts are done, the rest optional.",
          "Press the launch button on the status bar. **Launch “‹name›”?** first lists what setup still has open — no flights, no tee sheet, no answer on how money works, a tee with no Slope under a round that scores net or Stableford (its players are then scored on their raw Handicap Index), or a tee with a Slope but no Course Rating (scored on the Slope alone, without the Course Rating minus Par adjustment) — each with a link to the screen that fixes it and whether you can still do it after launch. Then it summarises dates, course, result, players, flights and rounds, and notes that every non-staff account becomes a Player, that players can score only once the tournament is launched, and that each round is closed on its own.",
          "Press [[Launch tournament]]. Setup locks; Part 3 lists what you can still change.",
        ],
      },
      { kind: "warn", text: "Launch is refused, with the reason under the button and a link to the screen that puts it right, when the tournament has no dates or a round could not be scored or played: a round played in sides with a player on no side (Teams & pairs), a team cup without its two teams or with a player on neither (Team cup), a round robin with no flights, a player in no flight or no pairings (Flights, then Rounds & formats), a match or a knockout with fewer than two players, or a league whose next week has no day and no deadline (Rounds & formats). Anything else still open is only listed — you can launch without it." },
    ],
  },
  {
    id: "day",
    part: "Part 7",
    title: "On the day",
    blocks: [
      { kind: "h", text: "What's next" },
      { kind: "where", text: "Dashboard → What's next" },
      {
        kind: "list",
        items: [
          "One line for each job waiting on you in the club's tournaments, the soonest first: entries waiting for approval (with the day entries close), a tournament starting within the fortnight that is not launched yet (or one with results already in that never was), a tee sheet for the next fortnight not yet published, the next round's pairings or the next week's day once it is live, a disputed result to settle, the cards in so far in a round being played (for example **Round 1 · 18 of 24 cards in**, counted in sides for a scramble), a round with every card in that nobody has closed (**Round 1 · all 24 cards in**), and results not released once play is over — every round closed, or a knockout's Final decided.",
          "The tournament's own line is the same next step its dashboard offers, so the two never disagree. When the dashboard would refuse it — a card still waiting to be signed off, nothing scored, a step of setup still open — the line says why instead, and its button goes where that is put right.",
          "Each line names its tournament and has one button that opens that tournament on the screen that does the job: [[Approve entries]], [[Launch tournament]], [[Publish the tee sheet]], **Settle it**, [[Open score entry]], **Close Round 1** (which opens that round on Rounds & formats, where **Is this round over?** asks or refuses), [[Complete tournament]], or the way out a refusal names.",
          "The buttons are for the club's Commissioner and Admins. Anyone else running a tournament sees the same lines without them.",
          "Nothing waiting says so. A completed tournament never appears.",
        ],
      },
      {
        kind: "list",
        items: [
          "Post a notice in **Tell players → Announcements** (Title, Message, and **Pin to the top of players' Today screen** if it matters). It shows on players' Today screens; it is not pushed to phones.",
          "Message a group in **Tell players → Messages**: under **Who is this for?** pick the club, the tournament, players, organizers, a flight, a round, a team, a group, or one person. It opens on this tournament; the line under it says in words who the message is going to, and a message cannot be called back. Every player, member or guest, has **Message the organizer** in their app: their message lands in Messages as a conversation under the player's name, which every organizer and assistant of the tournament reads and can answer. A guest (no email) is in the list of people too, by name, unless they have turned direct messages off.",
        ],
      },
      { kind: "h", text: "How scores come in" },
      {
        kind: "list",
        items: [
          "**Players on their phones** — hole by hole or a full card, by tap or by voice for strokes; who won a match hole is one tap, never spoken. No Save button; holes are kept on the phone with no signal. Each hole says where its score is: **On your phone** (kept, not yet with you), **Sent** (the server read it back), or **Not sent** (refused, with the reason) — so a player who reaches the scorer's table with holes still on their phone knows it, and shows you the card. One phone can hold the group's cards (**Me / Group**). Players press [[Certify my card]] when done, or [[Something on this card is wrong]] to flag it.",
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
          "A finished match can be confirmed ([[Confirm result]]) or disputed ([[Dispute]]); an {organizer} can [[Reopen]] it. Record a concession or walkover with [[‹Player› concedes]].",
        ],
      },
      { kind: "h", text: "Approve" },
      {
        kind: "steps",
        items: [
          "Press [[Approve N clean cards]]. Only approved cards are results.",
          "Work through **Needs attention** (for example “Incomplete — 14 of 18”) with [[Approve anyway]] where right. An {organizer} can [[Reopen]] an approved card.",
          "For match play, filter to Awaiting approval and press [[Approve N shown results]].",
          "A team match round or a cup session kept by tapping who won each hole — the singles too — lists its matches with **Awaiting approval** beside any finished result still to be signed off; open it and press [[Confirm result]] above the card. Once signed off, taps on a phone or here no longer change it: to correct it, an {organizer} presses [[Reopen]] above the card, corrects the holes and confirms it again.",
        ],
      },
      { kind: "h", text: "Leaderboard and the unexpected" },
      {
        kind: "list",
        items: [
          "A pairs event over more than one round shows the pairs' **Total over N rounds** above the round's own board — on the public board and on players' phones too — as long as the same pairs played every round. A team board ranks on score to par while a round is being played. Players or sides level on the round's figure are separated by countback on their card (last nine, six, three, then the last hole); only those still level share the place.",
          "**Every figure explains itself.** A figure with a dotted line under it opens one sentence of working and the Rule it follows when it is tapped or pressed — on a player's card the strokes on a hole (Appendix E), their net and how their playing handicap was reached (Rule 6.2a, Appendix C, and 6.2b for tees of a higher par), and a hole's Stableford points; on the public board and a player's Board, a place the countback decided or could not (last nine, six, three, the last hole), a net score against par, and why a row has no place (DQ, WD, a missed cut, no return). On the Leaderboard the place of a tied player opens the same sentence. The working is the same calculation as the figure, so the two cannot disagree. While the leaderboard is held from players, there is no figure to explain.",
          "**Leaderboard** refreshes every 30 seconds and shows Live or Final. For the group chat, set **Who can see the leaderboard** to **Anyone with the link** and share the public link — names and scores, and anything you post as commentary. For the TV in the clubhouse, open the **Clubhouse screen** link from Tournament details → Players & scoring on the TV's browser and leave it: it turns its own pages and refreshes itself.",
          "**Commentary**: under the Leaderboard, write a line — a run of birdies, a delay, where the cut is falling — and press [[Post]]. The latest shows above the scores on the public board and on every player's Board, with how long ago and without your name; the two before it are one tap away. Take one down with the ✕ beside it.",
          "**Weather**: [[Suspend play]], add a reason, [[Suspend play now]] — every player and the public board are told. [[Resume play]] when ready.",
          "**Pace of play** on the Dashboard shows each group's Thru and Due in, and names groups running behind.",
          "**Wrong scores**: correct the card on Score entry, or [[Clear scores]] ({organizers}) for chosen players or the whole round. Entries, flights and tee times are untouched. A card or result the committee has approved is reopened first.",
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
          "**Bracket** opens on **To play**: every tie that can be played now, round by round, each with its round's play-by date — and **Overdue** once that day has passed. Choose who won, how (**Played** with the margin, **Conceded**, **Walkover** or **Withdrawn**) and press [[Record result]] in that tie's row; the screen says back what it recorded, naming the round and both players. Winners move on automatically; players can report results for you to approve.",
          "Set each round's date under **Play-by dates** on the same tab and press [[Save dates]]. The dates show on every round heading of the draw, in To play, on each player's own tie and on the public board. A round can't be due after the round it feeds.",
          "**The draw** is the next tab: click a match's winner there and add the result (3&2, 1 up) if you prefer to work on the bracket.",
          "The rounds are named as a club names them: **Round 1**, **Round 2** and so on, then **Quarter-finals**, **Semi-finals** and the **Final**. Where a field does not fill its draw (of 4, 8, 16, 32, 64, 128 or 256), the first round is a **Preliminary round** when fewer players play in it than sit it out — 129 players is one preliminary tie, 128 v 129; 20 in a draw of 32 is four — and its winners go into Round 1 marked **through the preliminary round**. Nobody else is marked for not needing it.",
          "A place in a later round reads **Winner of** the two players of the tie that fills it, until that tie is played (**TBD** while that tie is itself still waiting on somebody). Nobody goes through a round unplayed. Where as many play in the first round as sit it out, or more, it is Round 1 and the players with nobody to play have a bye: it is not drawn as a tie, and they start in Round 2 with **bye** under their name — 100 players in a draw of 128 is 36 ties and 28 byes. In a seeded draw the byes go to the top seeds; in flights divided **Evenly, at random** they fall by lot, spread through every quarter, and no seed numbers are shown. A bye has no result to enter, and a tie can be decided only once both its players are known.",
          "A draw of more than 16 places is shown in sections, as tabs above it: **Quarter 1** to **Quarter 4** for more than 32 places, **Top half** and **Bottom half** for 17 to 32, then **Finals** (quarter-finals to the final) and **Whole draw**. Each tab says how many of its ties are still to play. A quarter-final is in both its quarter and Finals. Everything you can do on the draw works the same on every tab.",
          "For the noticeboard, [[Print the draw]] prints each quarter (or half) on its own A4 landscape sheet and the Finals on another — a draw of 16 or fewer on one — in black and white, with the date it was printed, a line to write the result under every tie still to play, and no byes. Players and the public board can print it too.",
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
          "Once any flight has a result the flights are fixed, and a banner at the top of the Bracket says so — **The draw · Locked because this knockout has results.** — with its way out: clear the results on the Bracket. A player who withdraws stays in the draw and their opponent goes through by walkover. There is no play-off for third in flights: each flight's beaten semi-finalists share third.",
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
          "A cup's champion is a team. Once it is completed, **Reports** prints both teams and their points; the **{HonoursBoard}** offers the winning team with the score — “Oakmere 6½–3½” — and a halved cup names nobody, whoever holds it. In a season, the winning team's players share first place and the other team's share the place below them; a halved cup puts everybody who played level first.",
        ],
      },
      { kind: "h", text: "League or season" },
      {
        kind: "steps",
        items: [
          "Add the season's rounds at once with **How many?** and **Then** (weekly).",
          "Only the next week to be played needs a day or a deadline before you launch; later weeks can be dated as the season goes. The launch dialog names the weeks still without one, and once the tournament is live the Dashboard's button offers to set it (for example **Set Round 4's day**) when the next week has neither. A tournament counts as a league because you made it one — called a league, a league of clubs, or a weekly sign-up — never because it has several rounds: a two-day medal still needs a day for each round.",
          "**This week** shows the week's results, standings and skins.",
          "A last-minute change to the week's groups: open the **Tee sheet** for that week, move a player (**Move [name] to…**) or a group (the arrows), and press **Save changes** once. It works up to each group's tee-off, by the club's own clock; a group that has teed off or has a card in is locked. A published week stays published and only the players whose time changed are told.",
          "A no-show or a cancellation on the morning: on the same **Tee sheet**, press **Replace…** beside the player and choose a member who is not playing that week, or a guest (a name and a handicap; a blank is taken only in a round scored gross). In a round scored net a member with no handicap index steps in only once you have given them strokes for the round, at the top of Rounds & formats. Individual weeks and pairs weeks both work (in a pairs week the new player takes the place in the pair and the pair's match is untouched), until that group has started.",
          "The standings under a week of strokes or points are the leaderboard's own table after that week: the total over every round played so far, in the leaderboard's places. A player who missed a cut holds no place in it, and nor, on strokes, does one with no card for a week you have closed; a total over fewer holes than the rest says “thru” beside it.",
          "Close each week once it is played. With members away a week is never “all in”, so the Dashboard asks to close it as soon as next week's draw is out and every card that was started is back — it says how many did not play. Closing moves everybody on to the new week.",
          "A **Round robin** round is a whole everyone-plays-everyone. Add several and each is its own contest unless you choose **Carry all** or **Carry part** under **Points into Round N**.",
          "**Season standings** adds tournaments up across a season; the **{HonoursBoard}** keeps your champions (Birdie plan and above).",
          "To set one up: on **Season standings**, name it and press **Start a season**. Then, with each tournament that counts open, press **Add this tournament to the season** — a tournament counts once it is completed, and towards one season only.",
          "**Scoring & rules** holds the season's name, the points for each finishing place, how many of a member's rounds count (**Best of**) and how many they must play to be ranked (**Rounds to qualify**). **Save rules** keeps them.",
          "When a season is over, **Mark season finished** and **Start another season**. The finished one stays in the list beside the new one.",
          "Rained off? Change that round's **Played on** date. Once the tournament is launched, moving a round's day (or clearing it) sends every player with alerts on a notification, guests included: **Round 2 has moved to 28 Nov 2026**. The confirmation counts the players it could not reach (**1 player has notices off. Tell them in person.**). Dating a round for the first time tells nobody. A tie settled by a play-off hole: [[Record the play-off hole]].",
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
      { kind: "where", text: "Set up → Prizes & payouts (the same screen you set money up on in Part 5, before launch)" },
      { kind: "tip", text: "How money works and the prize list are set up BEFORE you launch, in Part 5. This part is what you do with them once play has begun: naming winners, skins, side games and settling up." },
      { kind: "h", text: "Prizes" },
      {
        kind: "steps",
        items: [
          "Once results are in, pick each prize's **Winner** — the list shows finishing places to help. A prize for best gross or best net lists the field on that figure, with ties broken by countback (last nine, six, three, then the last hole) as the leaderboard breaks them.",
          "**How a tie on the leaderboard is decided.** Players level on a stroke round are separated on the last nine holes, then the last six, the last three and the last hole — the last six, three and one on a nine-hole round. A gross round compares gross scores and a Stableford round points. On an individual net round, each player's gross over those holes has a fraction of their playing handicap taken off — a half for the last nine, a third for the last six, a sixth for the last three, an eighteenth for the last hole (two-thirds, a third and a ninth on a nine-hole round) — which is what the Rules' committee procedures recommend; a pairs or team round compares its net hole by hole. A tie that survives every step is shared. A tournament created before 9 November 2026 keeps the hole-by-hole net countback it was played under. The rules sheet says which.",
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
          "**You name the winner**: closest to the pin, long drive, straightest drive and the like — [[Start this game]], pick entrants, then the winner (a tie splits the pot).",
          "A closest to the pin, long drive or straightest drive is shown on the public leaderboard, the event page and the clubhouse screen under **Contests** — its winner once you name one, never the stake. If somebody sponsors it, [[Add a sponsor]] on its card: their name, and their website if they have one (https only). The board says **Sponsored by** beside the contest and thanks every sponsor at the foot. The printed standings on Reports carry the same list. Poker and other side games stay off all of them.",
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
          "If a card in the round is not approved yet (or, where players sign their cards, not signed yet), closing it asks first and names whose: [[Close anyway]] closes the round with the card as it stands; it can still be approved or signed afterwards. [[Keep it open]] leaves the round as it was. A disputed card or result stops the close until you settle it on Score entry. A round a cut is made from waits for every card in it to be final, as before.",
          "Award prizes and settle the money.",
          "Export from **Afterwards → Reports & export**: [[Export CSV]] for standings and flight results (or the format's own sheet), **Who turned out**, the **Bracket sheet** and **Scorecards**. The snapshot has a [[Print]] button for a PDF.",
          "The Dashboard's status card has one button, the job in front of you: [[Launch tournament]] while you set up; [[Publish the tee sheet]] before the first tee (once it is published there is no button, only when the round tees off); [[Open score entry]] with the cards in so far while a round is played, such as **Round 1 · 18 of 24 cards in** (**Settle it** first when a result is disputed); **Close Round 1** once every card is in, which opens that round on Rounds & formats; the next round's pairings between rounds; and [[Complete tournament]] once play is over. There is no Complete button while golf remains to be played — not between rounds either, the night before the last day. To end an event early (a round rained off, say), open **More actions** on the status card and press **End this event early…**: it asks first and names any round nobody has played, which then closes as not played, and the results are decided on the rounds played. When the last round has every card in, close it (the Dashboard offers to), and [[Complete tournament]] becomes the card's button.",
          "On the Dashboard press [[Complete tournament]] and confirm. If a round has no scores it asks first: [[Complete anyway]] closes that round as not played and decides results on the rounds played, [[Keep playing]] leaves everything open. Boards switch to Final standings. To correct a card afterwards, press [[Reopen tournament]] — it asks first too — then complete it again. It is refused while another tournament in play has the same name; rename one of them first.",
          "**Open the final report**, the first button on Reports & export, is the whole tournament on one page to send round: the champion, the story, the format and field, the full leaderboard with gross and net, and who won the prizes. A tie for first is shown as shared — the committee settles it. A knockout's report is its draw, every result in the words a club uses (\"3&2\", \"at the 19th\", \"by walkover\"); while it is being played it says how many ties are played and how many players are still in, and it names the champion as soon as the final is played. Write **The story** yourself and [[Save the story]], or leave it and the report tells it from the results. Once the tournament is complete, the public leaderboard and the players' Board link to it, and the **Event page** leads with the result and **Read the final report**.",
          "It opens with the result in the format's own words — **The prize list**: the winner, second and third overall and in each flight, gross and net side by side for stroke play (\"71 gross / 66 net\"), points for a Stableford, a knockout's final in a club's words (\"at the 19th\"). A tie the board placed on countback says where it was decided (\"won on countback, back 9\" — on the net card for a net event, on points for a Stableford); a tie you settled with a play-off says who won it once you confirm the champion on the {honoursBoard}, with your note. Under it is one picture chosen for the format: the place after each round for the top eight (two rounds or more), how each hole played against par (one round, eight cards or more — picked-up holes left out), the points as bars (Stableford), the winning side's card with whose ball counted (four-ball), the champion's path (knockout), the table with a dot for each week played (league), the cup session by session with the match that clinched it. Then **Twos and contests** — the twos (\"4 twos, $3.75 each\" once final), nearest the pin and longest drive — and **Side games** with **Settle up**: the fewest payments and where everybody ends up, shown only once no side game can still change (until then one line says \"Side games settle when the last card is in\"). A casual round has a report too: one short screen with the result, the settle-up and the games. Your club's name and logo head it; \"Results by TourneyHQ\" sits small at the foot. Shared on WhatsApp or Facebook, the report's link shows its own card — your club, the event and the champion (\"Leads\" while it is being played), never an amount.",
          "The report holds every part of the app the tournament used, and only those: flight winners, the draw, **How it was won** (who led after each round, the biggest climb, and the podium's place after each round), **Each round**'s winner, the prizes and contests, the **Highlights** read off the cards (holes-in-one and eagles first, the best round, the lowest gross, the best nine, the longest run at par or better, the most birdies), **In numbers**, the skins and side games, the entry fees and costs, the **Settle-up** and **Coming up** — the next round, the club's tournaments taking entries, and your pinned notices. Money is shown only once it is final.",
          "Opened while the tournament is still being played, it is **The results so far**: the leader is named on the figure the board ranks them on (\"net −6 through 9\", \"19 points through 9\"), the leaderboard has a **Thru** column, somebody yet to tee off reads \"Not started\", the flights show their leaders, and a round nobody has played yet is in no table. Before anybody has played, there is no leaderboard at all.",
          "Who sees the amounts: your copy on Reports, and a player in the field who is signed in (their own line comes first: \"You pay … to …\" or \"You are owed …\"). The public link names the winners and never what they won, and has no costs, no settle-up and no notices. TourneyHQ records the payments; players pay each other.",
          "**The report's settings** are one line on the report screen — e.g. \"Anyone with the board link can see this report · Side-game amounts: players only\". Press Change to choose who can see it (**Anyone with the board link**, or **Players in this tournament** — it is never more public than the leaderboard, and players-only turns off the WhatsApp and Facebook share card) and who sees side-game amounts (**Only players see amounts; the public sees the winners**, **Nobody sees amounts — winners only**, or **Everyone sees amounts**, which anyone with the link can read). Your own copy always has the amounts; the share card never does. **See it as the public does** shows the copy a visitor gets. A visitor the report is not for is told it is shared with the players, and pointed to tourneyhq.club/play.",
          "A player who would rather not be named in public: tick **Don't show name on public pages** beside them on Registration. On the public leaderboard, the public report and a share card they read \"Player (name withheld)\"; the field and your staff still see the name.",
        ],
      },
      { kind: "warn", text: "**On the free Par plan** a completed tournament stays open to view, read-only, for 15 days, and is then deleted for good. The dialog offers [[Open the final report]] — then [[Print or save as PDF]] to keep it — and [[Go to Reports]] to export first, or an upgrade to keep it. It cannot be reopened in those 15 days without an upgrade. A Par tournament is also removed 14 days after its first round if nobody completes it." },
      { kind: "warn", text: "**If a payment fails**, the club keeps its plan while Stripe tries the card again, and Club settings → Your plan (and the top of every screen, for the club's owners and admins) asks you to update it with Manage billing. **If the paid plan ends** — cancelled, or Stripe stops trying — every tournament the club had that day is kept **read-only for 12 months**: boards, results, reports, money and exports stay open, but nothing can be changed or scored, and an unfinished tournament is paused where it stands. Every screen of it says so, with the dates, and its buttons and boxes are greyed out; links, exports, printing (reports, score cards and signs), the choice of round or flight and Copy last event still work, and the club's own screens — Club settings, Tournaments, the member list, seasons and this guide — stay usable. Choose a plan again at any time in those 12 months and everything carries on where it stopped. Otherwise the club's owners are emailed 30 days and 7 days before those tournaments are deleted. A tournament you start after the plan ended is on the free Par plan's terms, and the kept ones don't count against Par's limits." },
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
          { title: "Monthly medal or Stableford", for: "One day, individual, net.", steps: ["Template Stableford or Stroke Play.", "Dates and course; publish the sign-up link.", "Flights, if you want divisions: Handicap divisions, Auto. One field needs none.", "Tee sheet: balanced; publish.", "Players score on phones; approve clean cards.", "Prizes per division; complete and export."] },
          { title: "Club championship with a cut", for: "Several rounds; leaders play on.", steps: ["Template Stroke Play; add rounds with How many?.", "Cut the field: Top N, and how a tie for the last place is settled (ties go through, play-off or countback).", "Leaderboard for organizers only if you want it blind.", "Mark each round over; the cut happens then.", "Draw the next tee sheet By position."] },
          { title: "Match play league", for: "Everyone plays everyone in their flight.", steps: ["Template Match Play — round robin.", "All the season's rounds at once: How many? + Then weekly.", "Flights: Balanced skills; Generate.", "Players enter and confirm matches; approve the rest.", "Follow This week and Season standings."] },
          { title: "Knockout with qualifying", for: "A medal round seeds a bracket.", steps: ["Round 1 Stroke play round; Round 2 Bracket.", "Qualification cut: Overall top 8 or 16, or per flight.", "Optional Third and fourth.", "Enter winners on Bracket."] },
          { title: "Club match play in flights", for: "A big field, each flight its own knockout.", steps: ["How is it played: a knockout; one Bracket round.", "Bracket → Arrangement: Several flights.", "By handicap, the Suggested shape, Divide the field.", "Enter winners flight by flight."] },
          { title: "Team cup", for: "Two teams, sessions, running score.", steps: ["Template … team cup.", "Flights: Manual, exactly two, named for the teams.", "Team session rounds.", "Lineups on Team cup."] },
          { title: "Charity scramble", for: "Teams of four, public board, specials.", steps: ["Template Scramble; shotgun start.", "Draw sides automatically.", "Leaderboard: Anyone with the link.", "Round codes so guests need no account.", "Prizes plus closest-to-pin, long-drive and straightest-drive games.", "Send the Event page; open the Clubhouse screen on the bar's TV."] },
          { title: "Golf trip", for: "A few rounds away, costs split fairly.", steps: ["Money: Split shared costs.", "Players add expenses as they go.", "Skins and side games each round.", "The ledger lists the fewest payments; Mark settled."] },
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
          { q: "“Locked because the tournament is live”", a: "The tournament has launched. Every setup screen's banner names the part that is locked and why, and a press refused by the lock says the same. An {organizer} can Make a committee correction on the banner or the dashboard: one part of setup opens, for a reason that goes in Recent changes, until Done or the end of the club's day. Running the day doesn't need it — withdrawing a player, putting one back and (in stroke play, Stableford and a league, until Round 1's last published tee time) a late entry stay open on Entries." },
          { q: "I withdrew the wrong player", a: "Entries → Withdrawn → Put back. They return to the field, or to the Waitlist if their place has been filled since. Their cards were never deleted. A walkover already recorded against them stays until the committee changes it." },
          { q: "A walk-in arrived after the first card", a: "With a published tee sheet, late entries stay open until Round 1's last tee time: add them on Entries, then [[Put in group]] on the Tee sheet. Without one, or after that time, late entries are closed. An {organizer} can make a committee correction to the field to add them. An assistant cannot." },
          { q: "What do DNS and WD mean on the results?", a: "DNS: withdrew before teeing off. WD: withdrew after beginning. Both are listed under the field with no place, then DQ. A DNS shows on your Leaderboard, the Reports sheet and the CSV, not on the public board." },
          { q: "“This round cannot be scored as set”", a: "The format and round type don't match: match play needs a head-to-head round, stroke formats need a stroke play round." },
          { q: "A player can't find their card", a: "Check they're Confirmed (not Pending or Waitlist), the round is published, and — with a round code — that it hasn't been reissued." },
          { q: "No money is showing", a: "Result money appears only once the round is final. Approve the remaining cards or mark the round over." },
          { q: "Handicaps look wrong", a: "Check the member's index, the round's course and tees, and the round's allowance. Handicaps for this round, on the round's card, shows each player's course handicap, the figure before rounding and what they play off. The allowance is taken before rounding, so 95% of a course handicap of 7 can be 6: that is the Rule, not a mistake. And where the field plays tees of different pars, in stroke play or a match, a player on the higher par is given the difference as extra strokes after the allowance (Rule 6.2b); the list says how many. A Stableford round gives none." },
          { q: "Who decides which tees a player plays?", a: "You do. Tournament details sets the tournament's tees; Flights & groups sets a flight's; Registration moves one player. Registration shows what each player is on and why. An entrant cannot choose, and a woman starts on the course's ladies' tees where it has a set. Once a round played on cards has a card in, all three are shut and say why: clear that round's scores on Score entry first." },
          { q: "A public leaderboard link leaked", a: "Tournament details → Players & scoring → New link. The old link stops working immediately." },
          { q: "Somebody never got their 6-digit code", a: "Creating an account, or setting a first password on an address you invited, emails a 6-digit code to that address, and nobody is signed in until it is typed back. Ask them to check their spam folder, and to press Send a new code on the same screen: a code works for 15 minutes, and three can be sent in 15 minutes. Nobody else can set the password without it." },
          { q: "Why was I asked for a code when I signed in?", a: "Club staff signing in on a browser TourneyHQ has not seen before (a new laptop, a new phone, or after clearing the browser) are emailed a 6-digit code, and are signed in once it is typed back. Your password alone opens your members' details and the money records, so a new device has to show it can read your inbox too. After that, that browser is remembered for about a year. Platform owners are asked the same way. Players are not asked; they are sent an email when their account is signed in on a new browser." },
          { q: "Why does an invited person see \"Wrong email or password\"?", a: "Signing in answers every address the same way, so nobody can find out who belongs to which club by trying addresses. Somebody you invited, who has never set a password, presses **Invited, and never set a password?** under that message, chooses a password, and is emailed a 6-digit code. Too many wrong tries from one connection, or on one address, are asked to wait a few minutes; the person's own browser, signed in before, is not locked out." },
          { q: "My password was refused as found in a data leak", a: "When a password is chosen, it is checked against the passwords known from leaks at other websites, because those are the first ones anybody tries. Only the first five characters of a scrambled copy leave TourneyHQ, never the password itself. Choose a different password, ideally three or four unrelated words, and keep it to TourneyHQ alone." },
          { q: "I'm still signed in on a device I don't have", a: "Open Your account (your name, at the foot of the sidebar) and press Sign out everywhere. Every device is signed out, this one included. Your password stays the same, so sign straight back in." },
        ],
      },
    ],
  },
  {
    id: "owners",
    part: "Part 13",
    title: "For TourneyHQ's owners: the demo club",
    blocks: [
      {
        kind: "p",
        text: "This part is for the people who run TourneyHQ itself, not for a club. The **demo club** is an invented club with invented players that anybody can watch from the front door's **See a demo club's day**: a medal **playing now**, whose holes appear through the day by the club's own clock, and a finished championship with its event page and final report. Every page of it says **Demo club, invented players**.",
      },
      { kind: "where", text: "The owner console, /owner → Content → Demo club" },
      {
        kind: "tip",
        text: "The owner console is in four tabs, each at its own address: **Overview** (the numbers), **Plans & pricing** (prices by region, the months billed for a year, limits, a club's plan, discount codes), **Accounts & launch** (the go-live switch and who registered interest) and **Content** (the demo club and the course catalogue). A price changes what every screen and every new checkout quotes at once, with no deploy; a club already paying keeps the price it signed up at.",
      },
      {
        kind: "steps",
        items: [
          "Press [[Create the demo club]] and confirm. It takes a few seconds and builds the club, its course and both tournaments.",
          "To start it again from nothing at any time, press [[Refresh the demo club]] and confirm. The club, its two boards and their addresses stay the same; every card is written again.",
          "The card links to the demo's board, event page, clubhouse screen and finished report, and says how many holes are in today.",
        ],
      },
      {
        kind: "tip",
        text: "The medal plays itself: groups go off from eight o'clock at the club, a hole every fourteen minutes, and it starts again early each morning. A visitor who opens a player's card can tap a score; the next replay puts the club's day back.",
      },
      {
        kind: "warn",
        text: "The demo club is left out of everything about real clubs: the console's counts, the deploy freeze, plan limits and billing, the check for a club of the same name, and every email, text and notification. It never messages anybody. Only a club marked as the demo is ever rebuilt; a real club with the same name is refused and left untouched.",
      },
    ],
  },
];

/** The guide in one club's golf — what the page, its search and the PDF draw. */
export function guideInClubWords(words: GolfWords): GuideSection[] {
  return tableInClubWords(GUIDE_STEPS, words);
}
