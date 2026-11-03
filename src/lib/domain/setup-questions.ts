import { addDays, cleanIsoDate, roundDates } from "./round-dates";
import { fieldsOfDay } from "./date-words";
import { templateFor, type TemplateRound } from "../tournament-templates";
import type { TournamentSettings } from "../tournament-settings";
import { recommendedAllowance } from "../round-allowance";
import type { GolfRegister } from "./golf-terms";

/**
 * THE SETUP QUESTIONNAIRE (Ajay, 26 Oct and 2 Nov): "a questioner or form
 * upfront … auto generate the tournament for organizers review and update",
 * covering "at least the 80-90% setups".
 *
 * Pure: the questions, their defaults, which apply after which answer, the
 * boundary check on what a browser sends, and the DRAFT the answers make.
 * Writing the draft is `createEventFromAnswers`, which goes through the same
 * writer as every other new tournament (`createTournament` in tournament.ts) —
 * this file decides nothing that is stored any other way.
 *
 * The panel's record is `TourneyHQ Documents/Setup questionnaire - panel 2 Nov.md`:
 * ten setups, seven questions, the draft for each, and the last 10% (change
 * anything, check the scorecard, confirm).
 */

export type Running = "day" | "days" | "league" | "knockout" | "cup" | "casual";
export type Sides = "own" | "pairs" | "teams";
export type Scoring = "stroke" | "stableford" | "four-ball" | "foursomes" | "greensomes" | "scramble" | "match";
export type Basis = "net" | "gross";
export type Keeper = "players" | "committee";

export interface SetupAnswers {
  running: Running;
  sides: Sides;
  scoring: Scoring;
  basis: Basis;
  /** The first day, as the CLUB counts days (`clubToday`). */
  firstDay: string;
  /** Days for an outing or a cup, weeks for a league; ignored for one day. */
  count: number;
  keeper: Keeper;
  /** "" = the organizer will pick the course later. */
  courseId: string;
  teeId: string;
  /** The organizer has looked at the card and says it matches the club's. */
  cardChecked: boolean;
  /**
   * The card is wrong or missing and the organizer will put it right on the
   * course's own card screen — the course library's editor, tee editor, paste,
   * catalogue look-up and photo reader (Ajay, 3 Nov). Those act on a
   * tournament's club, which a first tournament does not have until it is
   * made, so the draft is made first and the screen opens on that course.
   */
  fixCard: boolean;
  name: string;
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  /** One line: what it means, or why it is the default. */
  why: string;
}

export const RUNNING_CHOICES: Choice<Running>[] = [
  { value: "day", label: "One day", why: "A competition, a fundraiser or a day away — the commonest event in golf." },
  { value: "days", label: "Two or three days", why: "A championship or a trip over a weekend. The days add up to one result." },
  { value: "league", label: "A weekly league", why: "A round a week over a season, with standings that carry from week to week." },
  { value: "knockout", label: "A knockout", why: "Match play: win and play on, lose and you are out." },
  { value: "cup", label: "A team cup", why: "Two sides, three sessions — four-balls, foursomes and singles, a point a match." },
  { value: "casual", label: "A casual round with friends", why: "Two to eight players, one round, set up on one screen." },
];

const SIDES: Record<Sides, Choice<Sides>> = {
  own: { value: "own", label: "On their own", why: "Everybody plays their own ball for their own score." },
  pairs: { value: "pairs", label: "In pairs", why: "Two a side." },
  teams: { value: "teams", label: "In teams of four", why: "Four a side — the kindest format for mixed ability." },
};

const SCORING: Record<Scoring, Choice<Scoring>> = {
  stroke: { value: "stroke", label: "Stroke play (medal)", why: "Every shot counts; lowest total wins." },
  stableford: { value: "stableford", label: "Stableford", why: "Points per hole off handicap, so one bad hole cannot ruin a round." },
  "four-ball": { value: "four-ball", label: "Four-ball better ball", why: "Both play their own ball; the better score on each hole counts." },
  foursomes: { value: "foursomes", label: "Foursomes", why: "One ball, alternate shots." },
  greensomes: { value: "greensomes", label: "Greensomes", why: "Both drive, take the better drive, then alternate." },
  scramble: { value: "scramble", label: "Scramble", why: "Everybody plays from the best shot each time." },
  match: { value: "match", label: "Match play", why: "Hole by hole against an opponent." },
};

/** Which "how do they play" answers fit what is being run. Empty = not asked. */
export function sidesChoices(running: Running): Choice<Sides>[] {
  if (running === "cup" || running === "casual") return [];
  if (running === "knockout") return [SIDES.own, SIDES.pairs];
  return [SIDES.own, SIDES.pairs, SIDES.teams];
}

/**
 * Which formats fit. The FIRST is the default — for players on their own it is
 * the club's country's habit: an American club plays medal, a British or
 * Australian one plays Stableford. Empty or one choice = not asked.
 */
export function scoringChoices(running: Running, sides: Sides, register: GolfRegister): Choice<Scoring>[] {
  if (running === "cup" || running === "casual") return [];
  if (running === "knockout") return [SCORING.match];
  if (sides === "teams") return [SCORING.scramble];
  if (sides === "pairs") return [SCORING["four-ball"], SCORING.foursomes, SCORING.greensomes];
  return register === "us" ? [SCORING.stroke, SCORING.stableford] : [SCORING.stableford, SCORING.stroke];
}

export const BASIS_CHOICES: Choice<Basis>[] = [
  { value: "net", label: "Off handicap (net)", why: "The whole field has a chance. Allowances follow the Rules for the format." },
  { value: "gross", label: "Scratch (gross)", why: "No strokes given — a championship or a scratch trophy." },
];

/** Stableford is points off handicap by definition, and a cup is net by its template. */
export function basisAsked(a: Pick<SetupAnswers, "running" | "scoring">): boolean {
  return a.running !== "cup" && a.running !== "casual" && a.scoring !== "stableford";
}

export const KEEPER_CHOICES: Choice<Keeper>[] = [
  { value: "players", label: "Players, on their phones", why: "Scores come in as they play and the board moves live." },
  { value: "committee", label: "The committee, from cards", why: "Cards are handed in and entered by you or your helpers." },
];

/** How many days or weeks is asked, and its bounds. Null = not asked. */
export function countQuestion(running: Running): { label: string; unit: string; min: number; max: number; fallback: number } | null {
  if (running === "days") return { label: "How many days?", unit: "days", min: 2, max: 3, fallback: 2 };
  if (running === "cup") return { label: "Over how many days?", unit: "days", min: 1, max: 3, fallback: 2 };
  if (running === "league") return { label: "How many weeks?", unit: "weeks", min: 2, max: 26, fallback: 10 };
  return null;
}

/** The next Saturday after the club's today — the day most golf days are played. */
export function nextSaturday(clubToday: string): string {
  const day = fieldsOfDay(clubToday);
  if (!day) return "";
  const ahead = (6 - day.weekday + 7) % 7 || 7;
  return addDays(clubToday, ahead);
}

/** Every answer pre-chosen, so pressing Next all the way through makes a real tournament. */
export function defaultAnswers(register: GolfRegister, clubToday: string): SetupAnswers {
  return {
    running: "day",
    sides: "own",
    scoring: scoringChoices("day", "own", register)[0].value,
    basis: "net",
    firstDay: nextSaturday(clubToday),
    count: 2,
    keeper: "players",
    courseId: "",
    teeId: "",
    cardChecked: false,
    fixCard: false,
    name: "",
  };
}

/**
 * Keep the answers consistent after one changes: an answer the new choice no
 * longer offers falls back to that question's default, and every other answer
 * is KEPT (going back and changing one thing must not lose the rest).
 */
export function reconcile(a: SetupAnswers, register: GolfRegister): SetupAnswers {
  const out = { ...a };
  const sides = sidesChoices(out.running);
  if (sides.length > 0 && !sides.some((c) => c.value === out.sides)) out.sides = sides[0].value;
  const scoring = scoringChoices(out.running, out.sides, register);
  if (scoring.length > 0 && !scoring.some((c) => c.value === out.scoring)) out.scoring = scoring[0].value;
  const count = countQuestion(out.running);
  if (count && (out.count < count.min || out.count > count.max)) out.count = count.fallback;
  return out;
}

const NAME_MAX = 80;

/**
 * THE BOUNDARY. A `"use server"` export is a public endpoint and its argument
 * is whatever the caller sent — so every answer is checked against the same
 * lists the screen offers, and a combination the screen cannot produce is
 * refused in words rather than coerced into something plausible.
 */
export function parseSetupAnswers(
  raw: unknown,
  register: GolfRegister,
): { ok: true; answers: SetupAnswers } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Those answers could not be read." };
  const r = raw as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : "");
  const running = str("running") as Running;
  if (!RUNNING_CHOICES.some((c) => c.value === running)) return { ok: false, error: "Say what you are running first." };
  if (running === "casual") {
    return { ok: false, error: "A casual round is set up on its own screen — choose “A casual round with friends” to go there." };
  }
  const sidesList = sidesChoices(running);
  const sides = (sidesList.length ? str("sides") : "own") as Sides;
  if (sidesList.length && !sidesList.some((c) => c.value === sides)) return { ok: false, error: "Say how players play." };
  const scoringList = scoringChoices(running, sides, register);
  const scoring = (scoringList.length ? str("scoring") : "match") as Scoring;
  if (scoringList.length && !scoringList.some((c) => c.value === scoring)) {
    return { ok: false, error: "That format is not one of the choices for this event." };
  }
  const basis = str("basis") as Basis;
  if (!BASIS_CHOICES.some((c) => c.value === basis)) return { ok: false, error: "Say whether it is off handicap or scratch." };
  const firstDay = cleanIsoDate(str("firstDay"));
  if (!firstDay) return { ok: false, error: "Choose the first day." };
  const countQ = countQuestion(running);
  const count = Number(r.count);
  if (countQ && (!Number.isInteger(count) || count < countQ.min || count > countQ.max)) {
    return { ok: false, error: `${countQ.label} Between ${countQ.min} and ${countQ.max}.` };
  }
  const keeper = str("keeper") as Keeper;
  if (!KEEPER_CHOICES.some((c) => c.value === keeper)) return { ok: false, error: "Say who keeps the scores." };
  const courseId = str("courseId").trim();
  const teeId = str("teeId").trim();
  if (courseId.length > 64 || teeId.length > 64) return { ok: false, error: "That course could not be read." };
  const fixCard = r.fixCard === true;
  // Fixing the card after creation is the one way past the tick: the course's
  // own card screen then holds it, and its "Mark as checked" is the tick.
  if (courseId && !teeId && !fixCard) return { ok: false, error: "Choose the tees the field plays from." };
  const cardChecked = r.cardChecked === true && !fixCard;
  if (courseId && !cardChecked && !fixCard) {
    return { ok: false, error: "Check the card against the club's own and tick that it matches — or fix it once the draft is made." };
  }
  const name = str("name").trim();
  if (!name) return { ok: false, error: "Give the tournament a name." };
  if (name.length > NAME_MAX) return { ok: false, error: `A name of at most ${NAME_MAX} characters.` };
  return {
    ok: true,
    answers: {
      running, sides, scoring, basis, firstDay, count: countQ ? count : 1, keeper,
      courseId, teeId: courseId ? teeId : "", cardChecked, fixCard, name,
    },
  };
}

/** The setup a set of answers lands on — the panel's ten, less the casual hand-off. */
export type SetupKey =
  | "medal" | "stableford" | "four-ball" | "foursomes" | "greensomes" | "scramble"
  | "outing" | "league" | "knockout" | "team-cup";

export interface DraftRound extends TemplateRound {
  playedOn: string;
}

export interface SetupDraft {
  setup: SetupKey;
  name: string;
  shape: "single" | "series" | "knockout";
  /** The template whose settings the draft starts from — a starting point only. */
  templateKey: string;
  settings: TournamentSettings;
  rounds: DraftRound[];
  startOn: string;
  endOn: string;
}

const FORMAT_OF: Record<Scoring, string> = {
  stroke: "Stroke Play",
  stableford: "Stableford",
  "four-ball": "Four-Ball",
  foursomes: "Foursomes",
  greensomes: "Greensomes",
  scramble: "Scramble",
  match: "Match Play",
};

/** The template whose settings suit each format — the same bundles the picker offers. */
const TEMPLATE_OF: Record<Scoring, string> = {
  stroke: "club-championship",
  stableford: "charity-day",
  "four-ball": "four-ball",
  foursomes: "foursomes",
  greensomes: "greensomes",
  scramble: "scramble-day",
  match: "league-round",
};

/** "Who keeps the scores", laid over the template's bundle. */
function keeperSettings(base: TournamentSettings, keeper: Keeper): TournamentSettings {
  if (keeper === "committee") {
    return { ...base, scoreEntryBy: "staff", scoreEntryWindow: "after", scoreApproval: "staff" };
  }
  // A field scoring on its phones sees its own board: a blind (staff-only)
  // leaderboard is the championship bundle's, and contradicts live scoring.
  return {
    ...base,
    scoreEntryBy: "players",
    scoreEntryWindow: "during",
    leaderboardVisibility: base.leaderboardVisibility === "staff" ? "participants" : base.leaderboardVisibility,
  };
}

/**
 * THE DRAFT. Rounds, dates and settings; the allowance is NOT stored (nought
 * means "the Rules' figure for this format in this kind of round", which is
 * what `effectiveAllowance` reads), so a committee override later is a real
 * override and not a copy of the default.
 */
export function draftFromAnswers(a: SetupAnswers): SetupDraft {
  if (a.running === "cup") {
    const t = templateFor("team-cup");
    const days = Math.max(1, a.count);
    const rounds = t.rounds.map((r, i) => ({
      ...r,
      playedOn: addDays(a.firstDay, Math.min(i, days - 1)),
    }));
    return {
      setup: "team-cup",
      name: a.name,
      shape: "series",
      templateKey: t.key,
      settings: keeperSettings(t.settings, a.keeper),
      rounds,
      startOn: a.firstDay,
      endOn: rounds[rounds.length - 1].playedOn,
    };
  }

  const scoring: Scoring = a.running === "knockout" ? "match" : a.scoring;
  const format =
    a.running === "knockout" ? (a.sides === "pairs" ? "Four-Ball" : "Match Play") : FORMAT_OF[scoring];
  const basis = scoring === "stableford" ? "net" : a.basis;
  const templateKey = a.running === "knockout" ? "league-round" : TEMPLATE_OF[scoring];
  let settings = keeperSettings(templateFor(templateKey).settings, a.keeper);

  if (a.running === "knockout") {
    // One bracket; its matches are arranged between players over the weeks,
    // so the round carries no single day — the start date is the event's.
    settings = { ...settings, attendanceMode: "everyone" };
    return {
      setup: "knockout",
      name: a.name,
      shape: "knockout",
      templateKey,
      settings,
      rounds: [{ type: "Bracket Stage", format, scoringBasis: basis, holes: 18, playedOn: "" }],
      startOn: a.firstDay,
      endOn: "",
    };
  }

  const many = a.running === "days" || a.running === "league";
  const n = many ? a.count : 1;
  const days = roundDates(a.firstDay, n, a.running === "league" ? 7 : 1);
  const label = a.running === "league" ? "Week" : "Day";
  const rounds: DraftRound[] = days.map((playedOn, i) => ({
    type: "Stroke Play Round",
    format,
    scoringBasis: basis,
    holes: 18,
    description: many ? `${label} ${i + 1} of ${n}` : undefined,
    playedOn,
  }));
  if (a.running === "league") settings = { ...settings, attendanceMode: "opt-out" };

  const setup: SetupKey =
    a.running === "league" ? "league" : a.running === "days" ? "outing" : scoring === "stroke" ? "medal" : (scoring as SetupKey);
  return {
    setup,
    name: a.name,
    shape: many ? "series" : "single",
    templateKey,
    settings,
    rounds,
    startOn: days[0] ?? a.firstDay,
    endOn: days[days.length - 1] ?? a.firstDay,
  };
}

/** A name to start from, so the review is never blank. The organizer changes it. */
export function suggestedName(a: Pick<SetupAnswers, "running" | "scoring" | "sides" | "count">): string {
  if (a.running === "cup") return "Team Cup";
  if (a.running === "knockout") return a.sides === "pairs" ? "Four-Ball Knockout" : "Match Play Knockout";
  const fmt = a.scoring === "stroke" ? "Medal" : SCORING[a.scoring]?.label ?? "Tournament";
  if (a.running === "league") return `${fmt} League`;
  if (a.running === "days") return `${a.count === 3 ? "Three" : "Two"}-Day ${fmt}`;
  return a.scoring === "stableford" || a.scoring === "stroke" ? `Saturday ${fmt}` : fmt;
}

/** The allowance in force for each distinct round of the draft, for the review. */
export function draftAllowances(d: SetupDraft): Array<{ format: string; type: string; percent: number; net: boolean }> {
  const seen = new Set<string>();
  const out: Array<{ format: string; type: string; percent: number; net: boolean }> = [];
  for (const r of d.rounds) {
    const key = `${r.format}|${r.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ format: r.format, type: r.type, percent: recommendedAllowance(r.format, r.type), net: r.scoringBasis !== "gross" });
  }
  return out;
}

/** Words for each answer, for the review screen. */
export function choiceLabel(question: "running" | "sides" | "scoring" | "basis" | "keeper", value: string): string {
  const lists: Record<string, Choice<string>[]> = {
    running: RUNNING_CHOICES,
    sides: Object.values(SIDES),
    scoring: Object.values(SCORING),
    basis: BASIS_CHOICES,
    keeper: KEEPER_CHOICES,
  };
  return lists[question].find((c) => c.value === value)?.label ?? value;
}
