import { DEFAULT_SETTINGS, type TournamentSettings } from "./tournament-settings";

/**
 * Starting points for a new tournament.
 *
 * A template is a coherent bundle of choices that go together in practice: a
 * club championship is blind *and* committee-scored *and* signed off, because
 * those three come as a set. Picking one gets an organizer most of the way in
 * a single click instead of a dozen decisions they may not know they're
 * making.
 *
 * Deliberately not a plan feature and never a lock. Every setting stays
 * editable on Event setup afterwards, and a template is only what the
 * tournament *started* as — nothing reads it later. That matters: config
 * behind a paywall is resented, and a preset that can't be overridden is
 * worse than no preset at all.
 */

export interface TemplateRound {
  type: string;
  format: string;
  scoringBasis: string;
  holes: number;
  /** Shown on the round card so the sequence explains itself. */
  description?: string;
}

export interface TournamentTemplate {
  key: string;
  name: string;
  /** Who this is for, in the organizer's own terms. */
  blurb: string;
  settings: TournamentSettings;
  /**
   * The rounds this tournament starts with, in order.
   *
   * A list rather than a single round because the shape of some events *is*
   * the sequence. A member-guest is five nine-hole matches; describing only
   * the first one leaves an organizer to build the other four by hand, which
   * is the assembly work that keeps clubs on whatever they already use.
   *
   * Rounds stay editable afterwards, and nothing reads the template later —
   * it is what the tournament started as, not a rule it must obey.
   */
  rounds: TemplateRound[];
}

const ROUND_ROBIN_GROSS = {
  type: "Round Robin",
  format: "Match Play",
  scoringBasis: "gross",
  holes: 18,
};

export const TOURNAMENT_TEMPLATES: TournamentTemplate[] = [
  {
    key: "club-championship",
    name: "Club championship",
    blurb: "Committee-run and blind. Standings stay hidden until you publish, and every card is signed off.",
    settings: {
      // Blind: the field doesn't watch itself. Cards come to the committee,
      // who enter and approve them — the three go together in practice.
      leaderboardVisibility: "staff",
      scoreEntryBy: "staff",
      scoreEntryWindow: "after",
      voiceEntry: false,
      playerAccess: "email",
      scoreApproval: "staff",
      attestBy: "marker",
      attendanceMode: "everyone",
      // A championship is played off one set. That is what makes the result
      // mean something: everybody faced the same course.
      teePolicy: "one",
    },
    rounds: [{ type: "Round Robin", format: "Stroke Play", scoringBasis: "gross", holes: 18 }],
  },
  {
    key: "league-round",
    name: "Society or league round",
    blurb: "One round of a season. Players score themselves as they play, and the board moves live.",
    settings: {
      leaderboardVisibility: "participants",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      voiceEntry: true,
      // A society roster is often names and nothing else, so a Round Code is
      // the only sign-in that actually works on the day.
      playerAccess: "both",
      scoreApproval: "players",
      // Players sign off between themselves, and a match-play league is
      // exactly where the other side is the right check.
      attestBy: "opponent",
      // A weekly league's whole premise: regulars are in unless they say.
      attendanceMode: "opt-out",
      // A society plays off whatever suits; handicaps make it fair.
      teePolicy: "own",
    },
    rounds: [ROUND_ROBIN_GROSS],
  },
  {
    key: "member-guest",
    name: "Member-guest",
    blurb: "Match play with the clubhouse watching. Public leaderboard, players report their own results.",
    settings: {
      leaderboardVisibility: "public",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      voiceEntry: true,
      playerAccess: "both",
      scoreApproval: "staff",
      attestBy: "marker",
      attendanceMode: "everyone",
      // Guests are often off different tees to their hosts.
      teePolicy: "own",
    },
    rounds: [{ type: "Round Robin", format: "Match Play", scoringBasis: "net", holes: 18 }],
  },
  {
    key: "member-guest-rr",
    name: "Member-guest — round robin",
    blurb:
      "The classic invitational: pairs in flights of six, five nine-hole matches, everyone plays everyone.",
    settings: {
      leaderboardVisibility: "public",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      voiceEntry: true,
      playerAccess: "both",
      scoreApproval: "staff",
      attestBy: "marker",
      attendanceMode: "everyone",
      // Same as the pairs version: guests play their own tees.
      teePolicy: "own",
    },
    /*
     * Five nine-hole matches, which is the shape of the event rather than a
     * detail of it: six pairs in a flight, each playing the other five once.
     *
     * Building this by hand meant five trips through the round builder, and
     * that assembly work is the main reason a club stays on whatever it
     * already uses. Four-Ball because a member and a guest each play their own
     * ball, and net because the pair are rarely of similar standard.
     *
     * The nines alternate only in the sense that a club rotates tees on the
     * day; the app records nine holes per match and the organizer sets which
     * nine per round if it matters.
     */
    rounds: Array.from({ length: 5 }, (_, i) => ({
      type: "Round Robin",
      format: "Four-Ball",
      scoringBasis: "net",
      holes: 9,
      description: `Match ${i + 1} of 5`,
    })),
  },
  {
    key: "charity-day",
    name: "Charity or company day",
    blurb:
      "A one-day outing, mostly first-timers. Public leaderboard, Stableford so a bad hole can't ruin anyone's round.",
    settings: {
      leaderboardVisibility: "public",
      scoreEntryBy: "players",
      scoreEntryWindow: "after",
      voiceEntry: true,
      playerAccess: "code",
      scoreApproval: "staff",
      attestBy: "marker",
      attendanceMode: "everyone",
      // A charity day is mixed by design - that is the point of it.
      teePolicy: "own",
    },
    // Individual Stableford, not a scramble. Two things to note:
    //
    // Stableford is a scoring *basis* here, not a format — the engine keys off
    // scoringBasis while the format stays Stroke Play. Setting it as a format
    // would produce a round the format picker doesn't even offer.
    //
    // And not a scramble because team formats are named in formats.ts with no
    // team model behind them; a template choosing one would be a promise that
    // breaks on the first tee. The scramble variant belongs with the team work.
    rounds: [{ type: "Round Robin", format: "Stroke Play", scoringBasis: "stableford", holes: 18 }],
  },
  {
    key: "custom",
    name: "Start from scratch",
    blurb: "The plain defaults. Set everything yourself.",
    settings: DEFAULT_SETTINGS,
    rounds: [ROUND_ROBIN_GROSS],
  },
];

export const DEFAULT_TEMPLATE_KEY = "custom";

/** Resolve a template key, falling back rather than throwing so an unknown
 *  value from an old link can never block creating a tournament. */
export function templateFor(key: string | null | undefined): TournamentTemplate {
  return (
    TOURNAMENT_TEMPLATES.find((t) => t.key === key) ??
    TOURNAMENT_TEMPLATES.find((t) => t.key === DEFAULT_TEMPLATE_KEY)!
  );
}
