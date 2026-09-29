import type { ReactNode } from "react";
import { PLANS } from "@/lib/plans";
import type { LandingPrices } from "./pricing";

/**
 * HOW TOURNEYHQ COMPARES — the named comparison, as data.
 *
 * Ajay's brief (2026-09-28): show "how it is ranked against competitors which
 * are famous and close to the features what we provide along with the
 * pricing". Two sets, one tab each:
 *  - the club platforms (Golf Genius, BlueGolf TM) — his first choice
 *    (2026-09-27), and the default tab;
 *  - the league and group apps closest to TourneyHQ's features (Squabbit,
 *    Golf GameBook, LeagueGolfer).
 *
 * THE RULES THIS FILE KEEPS:
 *  - Every competitor cell is what that company says on ITS OWN website, as of
 *    COMPARED_ON. No third-party figures, no estimates, no "cheaper".
 *  - "Not listed" means their site does not say it — never that they lack it.
 *  - Their prices are theirs, in US dollars, never converted (`prices.usd`).
 *  - Every TourneyHQ cell was checked against the code by TourneyHQv2
 *    (2026-09-27), and reads its numbers from PLANS and the owner's prices.
 *  - Where they go further, the page says so ("where others go further").
 * RE-CHECK EVERY CELL AND THE DATE before changing any of it, and have a
 * lawyer look at the named comparison.
 */

export const COMPARED_ON = "28 September 2026";

export type Mark = "yes" | "no" | "part" | "na";

/** A cell's mark and its words. The mark is decoration; the words say it. */
export function mk(kind: Mark, text: ReactNode) {
  const glyph = { yes: "✓", no: "✕", part: "◐", na: "—" }[kind];
  return (
    <>
      <span className={`vs-mk ${kind}`} aria-hidden="true">{glyph}</span>
      {text}
    </>
  );
}

export interface Competitor {
  name: string;
  /** Where every one of its cells was read. */
  source: { href: string; label: string };
}

export interface CompareSet {
  key: "club" | "apps";
  tab: string;
  intro: string;
  products: Competitor[];
  /** One entry per ROW, one cell per product. */
  cells: ReactNode[][];
}

export const ROW_LABELS = [
  "Built for",
  "Price",
  "Setup fee",
  "A free plan",
  "Live scoring on players' phones",
  // Specific on purpose (Ajay, 2026-09-28: "AI assistance doesn't mean voice
  // entry"): the question is whether a PLAYER can enter a score by speaking.
  // Golf Genius's AI assistant takes staff voice commands, which is not that,
  // so it is not mentioned in this row at all.
  "Players enter scores by voice",
  "Live leaderboard",
  "Formats",
  "Leagues and seasons",
  "Handicap service link (WHS / GHIN)",
  "Entry fees and payments",
] as const;

/** TourneyHQ's own column — the same in both tables. */
export function ourCells(prices: LandingPrices): ReactNode[] {
  return [
    "Clubs, courses and resorts, plus societies, leagues and one-off outings",
    // PER YEAR, like every competitor price beside it (Ajay, 2026-09-29: monthly
    // beside their yearly "is misleading"). Like for like, Club is above TM Club,
    // so nothing here or near it may claim TourneyHQ is cheaper across the board.
    <>Free · {PLANS.society.name} <b>{prices.society.yearly} a year</b> · {PLANS.club.name} <b>{prices.club.yearly} a year</b></>,
    mk("yes", "None"),
    mk("yes", `Yes, up to ${PLANS.free.limits.playersPerEvent} players, one tournament at a time. It's not a trial.`),
    mk("yes", "On every plan, including Free"),
    mk("yes", "Yes: a player taps the mic and says the hole's score, or reads out the whole card"),
    mk("yes", "Yes, including a public board with no login, when you publish it"),
    mk("yes", "16 formats (15 scored automatically, plus ‘Other’ for a club’s own)"),
    mk("yes", `Season standings across separate tournaments (${PLANS.society.name} plan and up)`),
    mk("no", "No"),
    mk("part", "Records who has paid; never collects or holds the money"),
  ];
}

export function compareSets(prices: LandingPrices): CompareSet[] {
  const usd = prices.usd;
  return [
    {
      key: "club",
      tab: "Club platforms",
      intro: "The established tournament platforms golf clubs run their calendars on.",
      products: [
        { name: "Golf Genius", source: { href: "https://golfgenius.com/products/tm", label: "golfgenius.com/products/tm" } },
        { name: "BlueGolf TM", source: { href: "https://tm.bluegolf.com/pricing", label: "tm.bluegolf.com/pricing" } },
      ],
      cells: [
        ["Private clubs, public courses, resorts and associations", "Private clubs, public courses and resorts"],
        // The like-for-like a club compares on: what the season costs for live scoring
        // on players' phones — every TourneyHQ plan, TM Premium only (row 5, same source).
        [<>TM Club {usd(1425)} a year<br />TM Premium {usd(4275)} a year<span className="vs-note">Live scoring on players' phones comes with TM Premium.</span></>, <>{usd(495)} to {usd(2495)} a year</>],
        [mk("no", <>{usd(200)} or {usd(500)}, one-time</>), mk("no", <>{usd(99)} to {usd(499)}, one-time</>)],
        [mk("na", "None listed"), mk("na", "None listed")],
        [mk("part", "TM Premium only"), mk("part", "Priced by the number of tournaments scored live (1, 10, 25 or all)")],
        [mk("na", "Not listed"), mk("na", "Not listed")],
        [mk("yes", "Yes; live TV leaderboards on Premium"), mk("yes", "Yes, online and on clubhouse TVs")],
        [mk("yes", "A full library of formats"), mk("yes", "All popular formats, plus a custom builder")],
        [mk("yes", "League management and season-long competitions"), mk("yes", "Leagues with season standings")],
        [mk("yes", "Full integration with GHIN"), mk("yes", "Integrated with WHS, including score posting")],
        [mk("part", "Online registration and payment processing on TM Premium"), mk("part", "Registration with built-in payments, on every plan except the base Club plan")],
      ],
    },
    {
      key: "apps",
      tab: "League & group apps",
      intro: "The apps closest to what TourneyHQ does for leagues, societies and golf groups.",
      products: [
        { name: "Squabbit", source: { href: "https://squabbitgolf.com/pricing.html", label: "squabbitgolf.com/pricing" } },
        { name: "Golf GameBook", source: { href: "https://www.golfgamebook.com/tournament-manager/golfers", label: "golfgamebook.com/tournament-manager" } },
        { name: "LeagueGolfer", source: { href: "https://www.leaguegolfer.com/pricing.php", label: "leaguegolfer.com/pricing" } },
      ],
      cells: [
        ["Tournaments, leagues and societies, clubs and casual rounds", "Golf clubs and tournament organizers, with a scoring app for golfers", "Golf leagues"],
        [
          <>Free · Tournament Pro {usd(99.99)} a year · League Pro {usd(249.99)} a year</>,
          <>Tournament Manager {usd(99)} a month or {usd(480)} a year; golf clubs by quote</>,
          <>{usd(10)} per full-time regular per year; subs are free</>,
        ],
        [mk("na", "None listed"), mk("na", "None listed"), mk("na", "None listed")],
        [mk("yes", "Yes: unlimited players and every format"), mk("part", "A free account to explore Tournament Manager"), mk("part", "A 21-day free trial")],
        [mk("yes", "Yes, including with no app download or account"), mk("yes", "Yes, in the Golf GameBook app"), mk("yes", "In its optional mobile app")],
        [mk("na", "Not listed"), mk("na", "Not listed"), mk("na", "Not listed")],
        [mk("yes", "Yes, with push notifications"), mk("yes", "Yes, including TV leaderboards"), mk("yes", "Yes, in the mobile app")],
        [mk("yes", "30+ formats"), mk("yes", "20+ game formats"), mk("yes", "League points by hole, strokes, holes won, individual or team")],
        [mk("yes", "Season-long standings, free"), mk("yes", "Weekly competitions through to a season finale"), mk("yes", "Built for leagues")],
        // Only a LINK to a handicap service counts here. Golf GameBook's own GGB
        // Handicap and LeagueGolfer's in-app WHS-method handicaps are not one.
        [mk("yes", "WHS handicap integration"), mk("na", "Not listed"), mk("na", "Not listed")],
        [mk("yes", "Registration and fees with Stripe payments"), mk("yes", "Online registration with card payments"), mk("part", "Treasury accounting for league fees")],
      ],
    },
  ];
}

/**
 * Where the others go further — the concessions, beside the comparison.
 *
 * It had a twin list, "what sets TourneyHQ apart", until 2026-09-29; every line
 * of it restated one of the page's five reasons, so a phone reader met the same
 * claims three times. The wins live in the reasons now; this keeps the part a
 * club most needs to trust the rest: what TourneyHQ does not do.
 */
export function atAGlance(): { further: string[] } {
  return {
    further: [
      "Links to a handicap service: Golf Genius (GHIN), BlueGolf and Squabbit (WHS).",
      "Native App Store and Google Play apps — TourneyHQ installs from the browser today.",
      "Collecting entry fees online — TourneyHQ records who has paid instead.",
      `Squabbit's free plan has no player limit; TourneyHQ Free is up to ${PLANS.free.limits.playersPerEvent}.`,
    ],
  };
}
