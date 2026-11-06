/**
 * HELP FOR THE PLAYER, AS DATA (Ajay, 2026-10-10).
 *
 * The organizer has a written guide; a player had nothing — "a player's help
 * is the player app itself" (nav.ts), which is true until somebody is standing
 * on a tee not knowing how to sign their card. Ajay chose a plain Help page
 * over an AI help bot: no model, no running cost, and nothing that can answer
 * wrongly with confidence.
 *
 * DATA rather than a page of prose, for the same reason `player-nav.ts` is:
 * a test has to be able to read it. `player-help.test.ts` holds three rules —
 *
 *   - every player screen is the subject of at least one topic, so a screen
 *     added later cannot ship without a word of help (Ajay: "keep a step when
 *     there is any change in the app to update the help section");
 *   - every button a topic names in [[double brackets]] is a label that screen
 *     really draws, so the help cannot describe a control that has been
 *     renamed — the rule `guide-steps.test.ts` holds for the organizer's guide;
 *   - every line is short. A player reads this on a phone, often outdoors, and
 *     `e2e/player-words.spec.ts` allows no sentence of twelve words anywhere
 *     in the player app.
 *
 * WHEN THE APP CHANGES, CHANGE THIS — in the same pull request. The tests
 * catch a new screen and a renamed button; they cannot catch a flow that now
 * works differently, and that part is the author's to keep true.
 */

import { tableInClubWords, type GolfWords } from "./domain/golf-terms";

export interface PlayerHelpTopic {
  /** Stable, for the page's own anchors. */
  id: string;
  /** The question, in the player's words. */
  question: string;
  /** Short lines, in order. A [[label]] is a control the screen really draws. */
  steps: string[];
  /** The screen this is about — where the "Open …" button goes. */
  href: string;
}

export const PLAYER_HELP_TOPICS: readonly PlayerHelpTopic[] = [
  {
    id: "enter",
    question: "How do I enter a tournament?",
    href: "/me/events",
    steps: [
      "Open Events and find the tournament.",
      "Tap [[Enter this tournament]].",
      "Full field? Tap [[Join the waiting list]] instead.",
      "You move up if somebody withdraws.",
    ],
  },
  {
    id: "tee-time",
    question: "Where is my tee time?",
    href: "/me",
    steps: [
      "Open Today.",
      "Your tee time and group are at the top.",
      "Nothing there yet? The draw isn't published.",
    ],
  },
  {
    id: "card",
    question: "How do I keep my card?",
    href: "/me/card",
    steps: [
      "Open My card.",
      "Tap a hole, then your strokes.",
      "With a round code? Scan your sign, or type the code.",
      "Tap your group, confirm it once, then pick your card.",
      "It saves as you go, even with no signal.",
      "Buttons grey? The page is still loading. Wait a moment.",
      "[[Full card]] shows every hole at once.",
      "No buttons at all? Your club is keeping the cards.",
      "Then follow the round on the board.",
    ],
  },
  {
    // THE HONEST CARD (2026-10-25): what the marks on each hole mean.
    id: "sent",
    question: "Has the club got my scores?",
    href: "/me/card",
    steps: [
      "Each hole shows where its score is.",
      "A ring means On your phone. It sends by itself.",
      "A tick means Sent. The club has it.",
      "No signal? Keep playing. Your scores stay on the phone.",
      "Three holes stuck on your phone? The card tells you.",
      "Not sent means the club refused it. The card says why.",
      "Then show your card to the committee.",
    ],
  },
  {
    id: "match",
    question: "How do I keep my match?",
    href: "/me/match",
    steps: [
      "On Today, tap [[Score this match]].",
      "After each hole, tap the side that won it, or [[Halved]].",
      "Each answer names a side: “CVC won”, or “Rakesh & Snehal won”.",
      "The card never turns round. Your side may be on the right.",
      "Keeping it with a round code? Scan the sign, or type the code.",
      "A scanned sign opens its own group. Confirm it once.",
      "Typed the code? Tap your group, then confirm it once.",
      "Used this phone before in this tournament? Your last group comes first.",
      "Not your group? Tap [[Not my group]] for the full list.",
      "If your {organizer} chose stroke cards, enter your own strokes instead. The app works out who won each hole.",
      "It saves as you go. Each hole says On your phone or Sent.",
      "The board shows your match as you play.",
      "With a round code? Tap [[Leaderboard]] at the top.",
      "No button? Your {organizer} keeps the board to the staff.",
    ],
  },
  {
    // ONE SCORER PER GROUP (2026-11-05, sprint 2 part B): who keeps the card on /play.
    id: "who-keeps",
    question: "Who keeps our group's score?",
    href: "/me/card",
    steps: [
      "Your {organizer} may ask for one scorer per group.",
      "Then one phone enters everyone's scores.",
      "The first phone to confirm the group keeps it.",
      "On every other phone it says whose phone has the card.",
      "Those phones follow the card as the scores go in.",
      "Battery flat? Tap [[Take over the card]] on your phone.",
      "Confirm it once. The other phone stops saving.",
      "Its last scores weren't saved. Its screen says so.",
      "Handing it on? Tap [[Hand the card to someone else]], then a name.",
      "No groups until the tee sheet is out. Until then, keep your own card.",
    ],
  },
  {
    // THE END-OF-ROUND CHECK (2026-11-05): the other side confirms, each player confirms their card.
    id: "end-check",
    question: "How do we check the result at the end?",
    href: "/me/match",
    steps: [
      "Your {organizer} may turn on an end-of-round check.",
      "In a match, the other side checks the result.",
      "Tap [[Confirm the result]], or [[That’s not right]].",
      "In stroke play, each player checks their own card.",
      "Tap [[Confirm my card]], or [[Something’s wrong]].",
      "A disputed result stays off the leaderboard.",
      "The committee settles it, then it goes up.",
    ],
  },
  {
    id: "strokes",
    question: "How many strokes do I get?",
    href: "/me/card",
    steps: [
      "A dot marks each hole you get a stroke on.",
      "Under Net it says your playing handicap.",
      "That is your course handicap with the round's allowance.",
      "The allowance is taken before rounding, as the Rules say.",
      "So 95% of 7 can be 6.",
      "Tap a hole's dot, or your Net, to see how.",
      "Your index is the one your club entered.",
      "A live link to your handicap body is coming.",
      "In a four-ball the board lists each player's own playing handicap.",
    ],
  },
  {
    id: "working",
    question: "How was a figure worked out?",
    href: "/me/card",
    steps: [
      "Tap a figure with a dotted line under it.",
      "One sentence opens: the sum, and the Rule it follows.",
      "On your card: a hole's strokes, your Net, your points.",
      "On [[Full card]], tap a hole's box to see its strokes.",
      "On the board: a place, a net score, a DQ.",
      "A tie says what the countback found, or that it's shared.",
      "Tap the figure again to close it.",
      "No board published yet? Then there is nothing to explain.",
    ],
  },
  {
    id: "tees",
    question: "Which tees do I play?",
    href: "/me/card",
    steps: [
      "Your {organizer} decides the tees.",
      "For the tournament, for your flight, or for you.",
      "Your card names the tees you are on.",
      "You cannot change them here. Ask your {organizer}.",
      "On a higher par than others? You get the difference as strokes.",
      "Not in Stableford, where par already counts.",
    ],
  },
  {
    id: "sign",
    question: "How do I sign my card?",
    href: "/me/card",
    steps: [
      "Finish every hole first.",
      "Tap [[Certify my card]].",
      "It then goes to your committee.",
      "Only an accepted card is a result.",
    ],
  },
  {
    id: "wrong",
    question: "Something on my card is wrong.",
    href: "/me/card",
    steps: [
      "Before signing, tap the hole and fix it.",
      "Signed already? Ask your {organizer} to reopen it.",
      "Someone else kept your card? Tap [[Something on this card is wrong]].",
      "The committee settles it before it counts.",
      "Says Read-only at the top? The club's plan has ended.",
      "You can still see your card and the board.",
      "Nothing can change until the club renews.",
    ],
  },
  {
    id: "board",
    question: "Where do I stand?",
    href: "/me/board",
    steps: [
      "Open Board.",
      "Anything the committee has posted is above the scores.",
      "Your own line is always shown.",
      "A cup on stroke cards shows gross and net under names.",
      "A cup can have other points, like a team net total.",
      "A finished tournament links its Final report.",
      "It opens with the prize list and a picture.",
      "Then the highlights, how it was won and what's next.",
      "Signed in, it shows what you won and what you owe.",
      "The settle-up shows once every side game is decided.",
      "It reads Final once the committee closes the round.",
      "Level for the last place at a cut? It says Tied.",
      "You are not out until the committee records the tie.",
      "Your club may send one link: the event page.",
      "It has the entry link, the board and the report.",
      "The TV in the clubhouse shows the same board.",
    ],
  },
  {
    id: "knockout",
    question: "Who do I play in the knockout?",
    href: "/me",
    steps: [
      "Open Today.",
      "Your tie names the round and your opponent.",
      "In a big field it names your flight too.",
      "Played it? Tap [[Report the result]].",
      "The {organizer} confirms it, and the winner moves on.",
      "Board opens on your tie, then the whole draw.",
      "It shows the strokes, the play-by date and what's next.",
      "A big draw opens on your part, marked You.",
      "Other tabs show the rest; Whole draw shows everything.",
      "Find a player shows anybody's path through the draw.",
      "A bye is marked under a name. Nobody plays it.",
      "Tap [[Print the draw]] for a sheet a quarter.",
    ],
  },
  {
    id: "rules",
    question: "What are the rules for this tournament?",
    href: "/me/rules",
    steps: [
      "Open Rules from Board or My card.",
      "It shows the format, handicaps and how ties are settled.",
      "It says the allowance you play off, and whose it is.",
      "Local rules are your club's own words.",
    ],
  },
  {
    id: "withdraw",
    question: "I can't play. How do I withdraw?",
    href: "/me/events",
    steps: [
      "Open Events and find the tournament.",
      "Tap [[Can’t make it? Withdraw]].",
      "After entries close, tell your {organizer} instead.",
    ],
  },
  {
    id: "weeks",
    question: "How do I say which league weeks I'm playing?",
    href: "/me/calendar",
    steps: [
      "Open Your calendar from Events.",
      "Every round you're in is on its day.",
      "Where your league lets you choose, set In or Out there.",
    ],
  },
  {
    id: "season",
    question: "How has my season gone?",
    href: "/me/season",
    steps: [
      "Open My season from Events.",
      "It counts your tournaments, rounds and prizes this season.",
      "Each tournament shows your place, as its board shows it.",
      "A team round shows your side's place.",
      "Results not published yet? Your club has not released them.",
      "Best scores compare rounds of the same length.",
      "It is your club's season, or the calendar year.",
      "Nobody else can see this page.",
    ],
  },
  {
    id: "switch",
    question: "I'm in more than one tournament.",
    href: "/me/events",
    steps: [
      "Open Events.",
      "Tap the button on the tournament you want.",
      "Today, Board and My card all follow it.",
    ],
  },
  {
    id: "money",
    question: "What do I owe, or what have I won?",
    href: "/me/money",
    steps: [
      "Open Money, when your tournament uses it.",
      "It shows your share of costs and any winnings.",
      "TourneyHQ records money. It never moves it.",
    ],
  },
  {
    id: "messages",
    question: "How do I hear from my club?",
    href: "/me/messages",
    steps: [
      "Tap the chat icon at the top.",
      "Announcements and replies are there.",
      "A badge shows anything unread.",
    ],
  },
  {
    id: "casual",
    question: "Can I just play a round with friends?",
    href: "/me/events",
    steps: [
      "Open Events.",
      "Tap [[Play a casual round]].",
      "Pick the game, the players and the course.",
      "Type a handicap as 12.4, or +2.4 for a plus. An empty box is not scratch: type 0.",
      "It needs no tournament and no {organizer}.",
    ],
  },
  {
    id: "email-code",
    question: "Why was I asked for a 6-digit code?",
    href: "/me",
    steps: [
      "Setting up your account? We email a 6-digit code first.",
      "Type it on the same screen. It works for 15 minutes.",
      "Nothing came? Check your spam folder, or press Send a new code.",
      "It proves the address is yours. Nobody else can use it.",
      "Playing with a round code? You need no account and no code.",
      "Password refused as leaked? It was found in a leak elsewhere. Pick another.",
      "Signed in on a new phone? We email you to say so. Not you? Reset your password.",
    ],
  },
  {
    id: "other-devices",
    question: "I'm signed in on a phone I don't have.",
    href: "/me",
    steps: [
      "Tap the sign-out button, top right.",
      "Open Your account.",
      "Tap [[Sign out everywhere]].",
      "Every device is signed out, this one too.",
      "Sign back in with the same password.",
    ],
  },
];

/** A topic's line with its [[labels]] as plain words — what the page prints. */
export function helpLineText(line: string): string {
  return line.replace(/\[\[(.+?)\]\]/g, "$1");
}

/**
 * The topics in one club's golf (2026-10-24): a golf word that differs between
 * countries is a token — `{organizer}` — and this fills it in, so a British
 * member reads "Ask your organiser". `country-words.test.ts` refuses the word
 * itself in this file.
 */
export function helpInClubWords(words: GolfWords): readonly PlayerHelpTopic[] {
  return tableInClubWords(PLAYER_HELP_TOPICS, words);
}

/** The control labels a line names. */
export function helpLineLabels(line: string): string[] {
  return [...line.matchAll(/\[\[(.+?)\]\]/g)].map((m) => m[1]);
}
