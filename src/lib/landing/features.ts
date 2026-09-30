import { PLANS, type FeatureKey, type PlanKey } from "@/lib/plans";

/**
 * Every feature the front door lists, as data.
 *
 * It was JSX inside page.tsx; the 2026-09-29 redesign shows it as a searchable
 * grid with a highlighted dozen, so it is a list both the page (rendered on the
 * server, all of it, for readers and crawlers alike) and the grid's filter can
 * read. Every line is in the product today — the rule that has always held for
 * this list, and the reason a plan-gated line names its plans from PLANS.
 */
export interface Feature {
  /** The feature, in a few words. */
  t: string;
  /** The qualifier that keeps it true, where one is needed. */
  s?: string;
  /** One of the dozen shown before "Show all". */
  top?: boolean;
  /**
   * The plan flag that gates this line, where one does. The plans that have it
   * are DERIVED from PLANS (plansWith), never listed by hand, so the line and
   * the pricing table cannot drift from what the app enforces.
   */
  plan?: FeatureKey;
}

const ORDER: PlanKey[] = ["free", "society", "club"];

/** The plans a flag is on, in page order. */
export function plansWith(flag: FeatureKey): PlanKey[] {
  return ORDER.filter((k) => PLANS[k].features[flag]);
}

/** "Season and Club plans" — the names of the plans a flag is on. */
function onPlans(flag: FeatureKey): string {
  const names = plansWith(flag).map((k) => PLANS[k].name);
  return `${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]} plan${names.length > 1 ? "s" : ""}`;
}

export interface FeatureGroup {
  key: "competition" | "day" | "player" | "money";
  title: string;
  items: Feature[];
}

export function featureGroups({ localGolf }: { localGolf: boolean }): FeatureGroup[] {
  return [
    {
      key: "competition",
      title: "The competition",
      items: [
        { t: "Sixteen formats", s: "fifteen scored automatically, one leaderboard", top: true },
        { t: "Slope-and-rating course handicaps", s: "then the format's allowance", top: true },
        { t: "Multi-round events", s: "cuts made as a round closes, carry-forward", top: true },
        { t: "Brackets, flights and a plate", s: "seeded from live standings", top: true },
        { t: "Round robin into main & consolation" },
        { t: "Countback on the last 9, 6, 3, 1" },
        { t: "A warning before a carry mixes units" },
        { t: "A different course per round" },
        { t: "Divisions off different tees" },
        { t: "Card certify, approve and dispute" },
        { t: "Prizes and the honors board" },
        { t: "Copy last year's, or a template" },
        { t: "Blind events", s: "standings hidden until you publish results" },
        { t: "Card confirmation rules", s: "a playing partner, the other side, or everyone" },
        { t: "Concessions and walkovers", s: "for individual matches" },
        { t: "A knockout draw for members and the public", s: "with each player's own line — “lost to …”, “Champion”" },
        { t: "Players report their knockout result", s: "nothing moves on the draw until the organizer approves" },
        {
          t: "Order of merit across events",
          s: `points, best-of, rounds to qualify — ${onPlans("seasonStandings")}`,
          plan: "seasonStandings",
        },
        { t: "Handicaps set per round", s: "and frozen once cards are in" },
        { t: "Scoring deadlines per round", s: "closed, closed early or extended" },
      ],
    },
    {
      key: "day",
      title: "The field & the day",
      items: [
        { t: "Registration with open and close dates" },
        { t: "Waiting list, one-tap member entry" },
        { t: "Weekly attendance, four ways", top: true },
        { t: "Tee sheet drawn from who's in", s: "by handicap, standings or sides — then editable", top: true },
        { t: "Pairing requests", s: "players ask from their phone; the draw keeps them together where it can" },
        { t: "One tee, split tees or a shotgun" },
        { t: "Tee times pushed to players' phones", s: "for players who turned notifications on" },
        { t: "Print the tee sheet and the cards" },
        { t: "Leagues and interclub leagues" },
        { t: "Courses looked up with rated tees" },
        { t: "Messages at every level" },
        { t: "Pinned announcements" },
        { t: "A public sign-up link — no account", s: "auto-confirm to capacity, or approve each entry" },
        { t: "Invite players from your phone's share sheet", s: "WhatsApp, text or a copied message" },
        { t: "The league's “This week” sheet", s: "movement, who turned out, and a purse check" },
        { t: "Interclub scoring systems", s: "match play, holes won, Nassau — pairs per club, play-offs" },
        { t: "Roster import from a spreadsheet" },
        { t: "Course card check", s: "flags a card that's unchecked, missing stroke index, or old" },
        ...(localGolf
          ? [
              {
                t: "Your club's own conventions",
                s: "cards in the course's unit, yards or metres · tee times on the club's clock · calendars that start on Monday",
              },
            ]
          : []),
      ],
    },
    {
      key: "player",
      title: "The player",
      items: [
        { t: "Say the score out loud", s: "where the phone's browser supports it", top: true },
        { t: "Round codes — no account, no install", top: true },
        { t: "A card that keeps saving without signal", top: true },
        { t: "Gross and net per hole, stroke dots" },
        { t: "Their own line first on the board" },
        { t: "A public live board, no login, once you publish it", top: true },
        { t: "Every club event, entered in a tap" },
        { t: "The club calendar", s: "every round they're in, and In or Out for league weeks" },
        { t: "The rules sheet for today's round" },
        { t: "Adds to the home screen" },
        { t: "One phone keeps the whole group's card", s: "each player still signs their own" },
        { t: "Two phones, one card", s: "it asks which to keep — never overwrites" },
        { t: "Players start their own side bets" },
        { t: "A board that says how fresh it is", s: "Live or Final" },
      ],
    },
    {
      key: "money",
      title: "Money & the club",
      items: [
        { t: "Skins, Nassau, pots and side bets", s: "skins and Nassau straight off the cards", top: true },
        { t: "Costs split four ways", s: "evenly, by shares, exact amounts or percent", top: true },
        { t: "Fewest handovers, mark settled" },
        { t: "Any currency" },
        { t: "One club roster across events" },
        { t: "Organizers, assistants and guests" },
        { t: "A record of recent changes" },
        { t: "Reports and CSV export" },
        { t: "Your colors, checked for sunlight" },
        { t: `White-label on the ${onPlans("whiteLabel")}`, plan: "whiteLabel" },
        { t: "Console controls named for screen readers" },
        { t: "The kitty and the organizer's ledger", s: "fees in, costs out — did it balance" },
        { t: "One-tap prize tables", s: "top 3, best gross & net, flights, twos, nearest the pin" },
        { t: "Score import from a spreadsheet", s: "every row checked against the field first" },
        { t: "A club handicap record", s: "from members' own cards — not an official index" },
        { t: "A tournament can override the club's currency", s: "nothing is converted" },
        { t: "Spoken questions at the scoring desk", s: "handicap, opponent, standing" },
      ],
    },
  ];
}

export function featureCount(groups: FeatureGroup[]): number {
  return groups.reduce((n, g) => n + g.items.length, 0);
}
