import type { ReactNode } from "react";
import { PLANS } from "@/lib/plans";
import type { LandingPrices } from "./pricing";

/**
 * HOW TOURNEYHQ COMPARES — the named comparison, as data.
 *
 * One side-by-side (Ajay, 2026-09-29: "side by side would be better", "min 4"):
 * TourneyHQ beside the club platforms Golf Genius and BlueGolf TM and the league
 * and group apps Squabbit, Golf GameBook and LeagueGolfer — one column each,
 * one row per feature, a mark and a few words per cell. It replaced two tabbed
 * tables and a tier-by-tier table that readers found hard to follow.
 *
 * THE RULES THIS FILE KEEPS:
 *  - Every competitor cell is what that company says on ITS OWN website, as of
 *    COMPARED_ON (the `source` of each rival, plus Golf Genius's Trip Manager
 *    page and help centre for skins and trip expenses). No third-party figures,
 *    no estimates, no "cheaper".
 *  - "Not listed" (`na`) means their site does not say it — never that they lack it.
 *  - Nothing is claimed as unique that is not: Golf Genius does skins, purses and
 *    (in Trip Manager, a separate product) trip expenses; BlueGolf has sign-ups
 *    and a calendar; Squabbit's free plan has fees and settling up, unlimited
 *    players and scoring with no app (checked 2026-09-29).
 *  - Their prices are theirs, in US dollars, never converted (`prices.usd`).
 *  - TourneyHQ's cells read their numbers from PLANS and the owner's prices.
 *  - The page names no rival advantage outside the table (Ajay, 2026-10-02: a
 *    "where others go further" box read as promoting other apps). The table
 *    itself stays complete and honest, marks and all.
 *  - The handicap service row reads "Coming soon" for TourneyHQ (Ajay,
 *    2026-10-02): the app already keeps each member's GHIN number and a
 *    GHIN-only handicap policy; the live link to the service is next.
 *  - No "entry fees paid online" row. TourneyHQ keeps collecting money out on
 *    purpose (Ajay, 2026-10-02): a league, a group or a club runs its money
 *    through its own organizers, pro shop POS or accounting, so TourneyHQ
 *    records who has paid and works out who owes whom, and never takes a card.
 *    It is a choice, not a gap, and is said in the reasons, not marked down here.
 * RE-CHECK EVERY CELL AND THE DATE before changing any of it, and have a
 * lawyer look at the named comparison.
 */

export const COMPARED_ON = "29 September 2026";

export type Mark = "yes" | "no" | "part" | "na";

/** One cell: a mark with a few words, or a figure (`value`) with a note. */
export interface Cell {
  mark?: Mark;
  value?: ReactNode;
  note?: ReactNode;
}

export interface Rival {
  name: string;
  /** What kind of product it is, under its name. */
  kind: string;
  /** Where every one of its cells was read. */
  source: { href: string; label: string };
}

export interface CompareRow {
  label: string;
  /** One line on what the row means, so a reader need not guess. */
  detail: string;
  ours: Cell;
  /** One per rival, in RIVALS order. */
  theirs: Cell[];
}

export const RIVALS: Rival[] = [
  { name: "Golf Genius", kind: "Club platform", source: { href: "https://golfgenius.com/products/tm", label: "golfgenius.com" } },
  { name: "BlueGolf", kind: "Club platform", source: { href: "https://tm.bluegolf.com/pricing", label: "tm.bluegolf.com" } },
  { name: "Squabbit", kind: "League app", source: { href: "https://squabbitgolf.com/pricing.html", label: "squabbitgolf.com" } },
  { name: "Golf GameBook", kind: "League app", source: { href: "https://www.golfgamebook.com/tournament-manager/golfers", label: "golfgamebook.com" } },
  { name: "LeagueGolfer", kind: "League app", source: { href: "https://www.leaguegolfer.com/pricing.php", label: "leaguegolfer.com" } },
];

const y = (note?: ReactNode): Cell => ({ mark: "yes", note });
const p = (note?: ReactNode): Cell => ({ mark: "part", note });
const x = (note?: ReactNode): Cell => ({ mark: "no", note });
const na = (note?: ReactNode): Cell => ({ mark: "na", note });
const v = (value: ReactNode, note?: ReactNode): Cell => ({ value, note });

export function compareRows(prices: LandingPrices): CompareRow[] {
  const usd = prices.usd;
  return [
    {
      label: "Price per year",
      detail: "As each company publishes it.",
      ours: v(<>Free – {prices.club.yearly}</>, <>{PLANS.society.name} {prices.society.yearly} a year</>),
      theirs: [
        v(<>{usd(1425)} – {usd(4275)}</>, "TM Club – TM Premium"),
        v(<>{usd(495)} – {usd(2495)}</>, "by tournaments scored live"),
        v(<>Free – {usd(249.99)}</>, "League Pro"),
        v(usd(480), <>or {usd(99)} a month</>),
        v(usd(10), "per regular player"),
      ],
    },
    {
      label: "A free plan",
      detail: "Free for good, not a trial.",
      ours: y(`up to ${PLANS.free.limits.playersPerEvent} players`),
      theirs: [x("none listed"), x("none listed"), y("unlimited players"), p("a free account to explore"), p("21-day trial")],
    },
    {
      label: "No setup fee",
      detail: "Nothing charged just to begin.",
      ours: y(),
      theirs: [x(<>{usd(200)} or {usd(500)}</>), x(<>{usd(99)} – {usd(499)}</>), y("none listed"), y("none listed"), y("none listed")],
    },
    {
      label: "Live scoring on players' phones",
      detail: "Players enter their own scores as they play.",
      ours: y("every plan"),
      theirs: [p("TM Premium only"), p("priced by tournaments"), y("free plan"), y("in its app"), p("optional mobile app")],
    },
    {
      label: "Scores by voice",
      detail: "A player taps the mic and says the hole's score.",
      ours: y("every plan"),
      theirs: [na(), na(), na(), na(), na()],
    },
    {
      label: "No app, no account",
      detail: "Players join with a round code in the browser.",
      ours: y(),
      theirs: [na(), na(), y(), na("scores in its app"), na("optional mobile app")],
    },
    {
      label: "Skins and side bets",
      detail: "Skins, Nassau, pots and side bets from the cards.",
      ours: y(),
      theirs: [y("skins and purses"), y("skins"), na(), y("skins format"), na()],
    },
    {
      label: "Outing costs, split and settled",
      detail: "Green fees, carts, dinner — who owes whom.",
      ours: y("every plan"),
      theirs: [p(<>Trip Manager, {usd(149)} a trip</>), na(), y("fees and settling up"), na(), p("league fees")],
    },
    {
      label: "Calendar, In or Out",
      detail: "Members say In or Out for each league week.",
      ours: y(),
      theirs: [p("event sign-up portals"), y("sign-ups and a calendar"), na(), na(), na()],
    },
    {
      label: "Leagues and standings",
      detail: "A weekly league with its running table.",
      ours: y(),
      theirs: [y(), y(), y(), y(), y()],
    },
    {
      label: "Handicap service link",
      detail: "Scores posted to GHIN or the WHS.",
      ours: v("Coming soon", "GHIN numbers kept per member today"),
      theirs: [y("GHIN"), y("WHS"), y("WHS"), na(), na()],
    },
  ];
}
