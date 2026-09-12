import { DEFAULT_SETTINGS, type TournamentSettings } from "./tournament-settings";
import { GOLF_FORMATS } from "./formats";
import { isHeadToHead } from "./stage-types";

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

/**
 * NAMED FOR THE SHAPE, NEVER FOR THE AUDIENCE.
 *
 * These were called "Society or league round", "Charity or company day",
 * "Member-guest" — names that classify the ORGANIZER rather than describe the
 * golf. Two things went wrong with that, and both were found by walking:
 *
 * A society picking the template with its own name on it got a MATCH-PLAY
 * ROUND ROBIN, where every player is drawn against every other. A society
 * outing is almost always an individual Stableford off handicap. Meanwhile the
 * template that actually produced that — individual Stableford, one round —
 * was filed under "Charity or company day", so the commonest society event in
 * golf was reachable only by choosing a name for charities.
 *
 * And a list of audiences reads as a CLASSIFICATION. Six of them look like the
 * set of things this app runs, so an organizer whose event is not on the list
 * reasonably concludes it is not supported. It never could be a complete list:
 * stroke, match, Stableford, modified Stableford, skins and Nassau multiply by
 * singles, fourball, foursomes, greensomes, scramble and shamble, by gross and
 * net, by nine and eighteen. Any curated set is a rounding error presented as a
 * menu — the same failure `layout.spec` records for hand-written route lists,
 * where "a short list looks identical to a complete one".
 *
 * A list of SHAPES cannot make that claim. Nobody reads six shapes and
 * concludes those are the only six, and nobody reads "Individual Stableford"
 * and wonders whether their society is allowed to pick it.
 *
 * The complete paths already exist and are what an organizer should end up on:
 * the question sequence on Tournament details — match or stroke, on their own
 * or in pairs or in teams — is generative rather than a list, and copying a
 * previous tournament is complete for that club because it is their own. These
 * carry the FIRST tournament and nothing more.
 */
export interface TournamentTemplate {
  key: string;
  /** What this produces, in golf's own words. A shape, never an audience. */
  name: string;
  /** What it sets up, including the settings worth knowing before choosing. */
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
  /**
   * "Start from scratch" — the entry that applies nothing.
   *
   * A PROPERTY OF THE TEMPLATE, not a comparison against a constant. Creating
   * a tournament used to ask `template.key !== DEFAULT_TEMPLATE_KEY` to decide
   * whether to apply one, which is only correct while the default and the
   * blank one happen to be the same entry. They are, today, by naming
   * coincidence — and that is exactly the shape that produced a real bug
   * elsewhere in this codebase: `hasColours` inferred that a club had chosen
   * its colours from `themeKey !== DEFAULT_THEME`, and when the default moved
   * the whole existing customer base silently flipped to "already branded".
   * See `themeSetAt` in schema.prisma.
   *
   * Nothing is broken here today. The point is that making the default a real
   * template, or adding a second blank one, would break it silently — a
   * tournament created from a named template would quietly get none of it.
   */
  blank?: boolean;
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
    name: "Medal — stroke play",
    blurb: "Everyone plays their own ball against the course. Committee-scored and blind — standings stay hidden until you publish, and every card is signed off.",
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
    /**
     * A MEDAL ROUND, which is what a championship is — and this said Round
     * Robin, the head-to-head type, until 2026-09-10.
     *
     * `stage-types.ts` has described that failure since the medal round was
     * added: "the only way to run one was a round robin set to Stroke Play,
     * which generated a full set of pairings for a round in which nobody plays
     * anybody". The type was added; the templates that needed it were not
     * changed. See `round-shape.ts`, which now makes the pair impossible.
     */
    rounds: [{ type: "Stroke Play Round", format: "Stroke Play", scoringBasis: "gross", holes: 18 }],
  },
  {
    key: "league-round",
    name: "Match-play round robin",
    blurb: "Everyone meets everyone, head to head. One round of a season — players score themselves and the board moves live.",
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
    name: "Pairs match play",
    blurb: "Two a side, net. Public leaderboard with the clubhouse watching, and players report their own results.",
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
    /**
     * FOUR-BALL, because two a side is what this event IS — and it said
     * "Match Play", which is the SINGLES format.
     *
     * Found by the grouping: `templateGroup` reads the side size off the
     * format, filed this under "On their own", and the heading contradicted
     * the name. The old name hid it — "Member-guest" does not say a side size
     * out loud, so nothing in the picker disagreed with itself, and a club
     * choosing it got a singles draw for an event that is a member playing
     * with a guest. Its own five-match sibling had `Four-Ball` all along.
     *
     * A correction rather than a change of mind: nothing reads a template
     * after creation, and everything stays editable.
     */
    rounds: [{ type: "Round Robin", format: "Four-Ball", scoringBasis: "net", holes: 18 }],
  },
  {
    key: "member-guest-rr",
    name: "Pairs round robin — five 9-hole matches",
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
    name: "Individual Stableford",
    /**
     * The society outing, the charity day and the company day are all THIS —
     * which is why it is named for the shape. Under its old name, "Charity or
     * company day", a society looking for its ordinary monthly Stableford had
     * no reason to open it.
     */
    blurb:
      "Everyone plays their own ball, Stableford off handicap, so a bad hole can't ruin anyone's round. Public leaderboard, players score themselves, and mixed tees are fine.",
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
    /**
     * A medal round, same as the championship, and the same wrong type until
     * 2026-09-10 — with a worse consequence here, because this template turns
     * PLAYER SELF-SCORING on.
     *
     * Measured through the ordinary flow: eight players, flights generated,
     * and the app drew twelve head-to-head matches for a Stableford outing.
     * `/me/card` reads `generatesPairings`, so every one of those players
     * opened their own card and was told "Round Robin is match play, so your
     * score is recorded against your opponent rather than as your own card" —
     * on the one screen the template exists to send them to.
     */
    rounds: [{ type: "Stroke Play Round", format: "Stroke Play", scoringBasis: "stableford", holes: 18 }],
  },
  {
    key: "foursomes",
    name: "Foursomes — pairs, one ball",
    /**
     * ONE BALL, ALTERNATE SHOTS, and the format the rest of the world plays
     * far more than America does.
     *
     * Foursomes and greensomes are club staples in Britain, Ireland and
     * Australia — the Sunday mixed, the club foursomes knockout, half the
     * away-day calendar — and neither had a starting point. The templates were
     * shaped around American golf, where they are almost never played.
     */
    blurb:
      "Two a side sharing one ball, playing alternate shots. Net off the pair's combined allowance.",
    settings: {
      leaderboardVisibility: "participants",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      voiceEntry: true,
      playerAccess: "both",
      scoreApproval: "players",
      attestBy: "marker",
      attendanceMode: "everyone",
      teePolicy: "own",
    },
    rounds: [{ type: "Stroke Play Round", format: "Foursomes", scoringBasis: "net", holes: 18 }],
  },
  {
    key: "greensomes",
    name: "Greensomes — pairs",
    blurb:
      "Both drive, take the better drive, then alternate to the hole. Kinder than foursomes and the usual choice for a mixed day.",
    settings: {
      leaderboardVisibility: "participants",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      voiceEntry: true,
      playerAccess: "both",
      scoreApproval: "players",
      attestBy: "marker",
      attendanceMode: "everyone",
      teePolicy: "own",
    },
    rounds: [{ type: "Stroke Play Round", format: "Greensomes", scoringBasis: "net", holes: 18 }],
  },
  {
    key: "four-ball",
    name: "Four-ball better ball — pairs",
    /**
     * The commonest pairs event in golf, and it had no starting point.
     *
     * Two play their own ball and the better score counts. Every club runs it
     * — a member-member, a Saturday pairs sweep, half the society away days
     * that are not individual Stableford — and the only pairs templates were
     * both MATCH play, which is a different game.
     */
    blurb:
      "Two a side, each plays their own ball and the better score counts. Net, so a pair of different handicaps is still a fair pair.",
    settings: {
      leaderboardVisibility: "participants",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      voiceEntry: true,
      playerAccess: "both",
      scoreApproval: "players",
      attestBy: "marker",
      attendanceMode: "everyone",
      teePolicy: "own",
    },
    rounds: [{ type: "Stroke Play Round", format: "Four-Ball", scoringBasis: "net", holes: 18 }],
  },
  {
    key: "skins-day",
    name: "Skins",
    /**
     * Supported, scored, settled to the penny — and unreachable from the
     * picker. `Skins` is `playable: true` with its own engine and the whole
     * carry-and-pot machinery behind it, which is one of the things this app
     * is actually better at than the field.
     */
    blurb:
      "Low score on a hole wins it; a tie carries into the next. The oldest bet in golf, scored and settled hole by hole.",
    settings: {
      leaderboardVisibility: "participants",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      voiceEntry: true,
      playerAccess: "both",
      scoreApproval: "players",
      attestBy: "marker",
      attendanceMode: "everyone",
      teePolicy: "own",
    },
    rounds: [{ type: "Stroke Play Round", format: "Skins", scoringBasis: "net", holes: 18 }],
  },
  {
    key: "scramble-day",
    name: "Scramble — four a side",
    /**
     * THE FORMAT AMERICAN CHARITY GOLF ACTUALLY PLAYS, and it was missing.
     *
     * A charity or company day in the US is a four-person scramble off a
     * shotgun, near enough always: everyone tees off, the team picks the best
     * ball, everyone plays again from there. It is the format because it is
     * the kindest — a first-timer who tops one costs the team nothing, and
     * nobody is stuck holing out for an 11 while three people watch.
     *
     * The template for those days offered individual Stableford instead, and
     * the comment beside it said a scramble could not be offered "because team
     * formats are named in formats.ts with no team model behind them". That
     * was true when it was written and is not true now: `Scramble` is
     * `playable: true`, `scored: true`, `engine: "team-single"`, sideSize 4,
     * with a 25% allowance and `services/teams.ts` behind it. The note outlived
     * the gap it described.
     *
     * Net, because the whole point of the 25% allowance is to let a mixed-
     * ability team compete — which is the same reason the format is chosen.
     */
    blurb:
      "Four a side, everyone plays the best ball. The kindest format for mixed ability, so it is what most charity and company days run. Net off a team allowance, public leaderboard.",
    settings: {
      leaderboardVisibility: "public",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      voiceEntry: true,
      playerAccess: "code",
      scoreApproval: "staff",
      attestBy: "marker",
      attendanceMode: "everyone",
      // Mixed by design — that is the point of a charity day.
      teePolicy: "own",
    },
    rounds: [{ type: "Stroke Play Round", format: "Scramble", scoringBasis: "net", holes: 18 }],
  },
  {
    key: "custom",
    name: "Set it up yourself",
    blurb: "The plain defaults. Set everything yourself.",
    settings: DEFAULT_SETTINGS,
    /**
     * EMPTY, because `blank` means nothing is applied and this array was never
     * read — `createTournament` resolves `templated?.rounds ?? []` only for a
     * template that is not blank.
     *
     * It held a Round Robin, which is a scoring decision sitting in the one
     * entry whose whole promise is "set everything yourself". Dead code that
     * contradicts the thing it is attached to is worse than no code: the next
     * reader has to work out which half is true.
     */
    rounds: [],
    // The one entry that applies nothing, said here rather than inferred from
    // its key happening to match DEFAULT_TEMPLATE_KEY.
    blank: true,
  },
];

export const DEFAULT_TEMPLATE_KEY = "custom";

/**
 * WHICH STARTING POINTS FIT THE SHAPE THE ORGANIZER JUST CHOSE.
 *
 * The picker asks "How is it played?" — one round, a series, or a knockout —
 * BEFORE it offers a template, and then ignored the answer. Eleven starting
 * points in one list is a lot to read when the reader has already told you
 * which third of them could possibly apply.
 *
 * SUGGESTED BY SHAPE, NEVER BY WHO IS ASKING. Sorting by organization kind
 * would be the assumption this file was just rewritten to remove — that a
 * society plays round robins and a charity plays scrambles. A shape is a
 * decision made about THIS event a moment ago; a kind is a guess about the
 * person. The first can be used, the second cannot.
 *
 * Suggestions, not filters. Everything stays in the list underneath, because a
 * knockout organizer who wants to start from a medal and add a bracket is not
 * doing anything wrong, and a picker that hid it would be the wizard this
 * codebase decided against.
 */
export function suggestedFor(shape: string): TournamentTemplate[] {
  const head = (t: TournamentTemplate) => t.rounds[0];
  /**
   * Head to head is a property of the ROUND TYPE, not of the format string.
   *
   * This asked whether the format was literally "Match Play", which excluded
   * the four-ball knockout — one of the commonest club championships there is
   * — because its format is "Four-Ball". `isHeadToHead` is the predicate the
   * rest of the app decides this with, so reading it here means the suggestion
   * cannot come to disagree with what the round actually does.
   */
  const isVersus = (t: TournamentTemplate) => {
    const r = head(t);
    return !!r && isHeadToHead(r.type);
  };
  const isRoundRobin = (t: TournamentTemplate) => head(t)?.type === "Round Robin";

  const rules: Record<string, (t: TournamentTemplate) => boolean> = {
    // One day, one result. A single round of anything, but not the multi-round
    // sequences, and not the head-to-head draws that need a season to mean
    // something.
    single: (t) => !t.blank && t.rounds.length === 1 && !isRoundRobin(t),
    // A season. The round robin is the league round; a medal repeats weekly;
    // the five-match member-guest is a sequence by construction.
    series: (t) => !t.blank && (isRoundRobin(t) || t.rounds.length > 1),
    // Win and play on. Match play is the game a bracket is made of.
    knockout: (t) => !t.blank && isVersus(t),
  };

  const rule = rules[shape];
  return rule ? TOURNAMENT_TEMPLATES.filter(rule) : [];
}

/** The headings the picker groups under, in the order they are offered. */
export const TEMPLATE_GROUPS = ["On their own", "In pairs", "In teams", ""] as const;
export type TemplateGroup = (typeof TEMPLATE_GROUPS)[number];

/**
 * WHICH HEADING A TEMPLATE SITS UNDER, read off the format it starts.
 *
 * Derived rather than written on each template, for the reason this codebase
 * keeps relearning: a hand-kept second list drifts from the first. `sideSize`
 * already says whether a format is played alone, in pairs or in fours — it is
 * what `TEAM_FORMAT_NAMES` is built from — so a template added later is
 * grouped correctly without anybody remembering to say where it goes.
 *
 * The blank one has no format and no heading; it sits on its own at the end,
 * because "set it up yourself" is not a kind of golf.
 */
export function templateGroup(t: TournamentTemplate): TemplateGroup {
  if (t.blank) return "";
  const first = t.rounds[0];
  const side = first ? (GOLF_FORMATS.find((f) => f.name === first.format)?.sideSize ?? 1) : 1;
  if (side >= 4) return "In teams";
  if (side === 2) return "In pairs";
  return "On their own";
}

/** Resolve a template key, falling back rather than throwing so an unknown
 *  value from an old link can never block creating a tournament. */
export function templateFor(key: string | null | undefined): TournamentTemplate {
  return (
    TOURNAMENT_TEMPLATES.find((t) => t.key === key) ??
    TOURNAMENT_TEMPLATES.find((t) => t.key === DEFAULT_TEMPLATE_KEY)!
  );
}
