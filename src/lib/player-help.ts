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
      "It saves as you go, even with no signal.",
      "Buttons grey? The page is still loading. Wait a moment.",
      "[[Full card]] shows every hole at once.",
      "No buttons at all? Your club is keeping the cards.",
      "Then follow the round on the board.",
    ],
  },
  {
    id: "match",
    question: "How do I keep my match?",
    href: "/me/match",
    steps: [
      "On Today, tap [[Score this match]].",
      "After each hole, tap who won it, or [[Halved]].",
      "If your organizer chose stroke cards, enter your own strokes instead. The app works out who won each hole.",
      "It saves as you go.",
      "The board shows your match as you play.",
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
      "Your organizer can show you the figures.",
    ],
  },
  {
    id: "tees",
    question: "Which tees do I play?",
    href: "/me/card",
    steps: [
      "Your organizer decides the tees.",
      "For the tournament, for your flight, or for you.",
      "Your card names the tees you are on.",
      "You cannot change them here. Ask your organizer.",
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
      "Signed already? Ask your organizer to reopen it.",
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
      "It has the highlights, how it was won and what's next.",
      "Signed in, it shows what you won and what you owe.",
      "It reads Final once the committee closes the round.",
      "Level for the last place at a cut? It says Tied.",
      "You are not out until the committee records the tie.",
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
      "The organizer confirms it, and the winner moves on.",
      "The whole draw is on Board.",
    ],
  },
  {
    id: "rules",
    question: "What are the rules for this tournament?",
    href: "/me/rules",
    steps: [
      "Open Rules from Board or My card.",
      "It shows the format, handicaps and how ties are settled.",
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
      "After entries close, tell your organizer instead.",
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
      "It needs no tournament and no organizer.",
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

/** The control labels a line names. */
export function helpLineLabels(line: string): string[] {
  return [...line.matchAll(/\[\[(.+?)\]\]/g)].map((m) => m[1]);
}
