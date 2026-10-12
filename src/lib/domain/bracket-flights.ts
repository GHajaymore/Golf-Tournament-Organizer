import { bracketSizeFor } from "./bracket";
import { flightLabel } from "./flight-label";

/**
 * A KNOCKOUT IN SEVERAL FLIGHTS: dividing a big match-play field into brackets
 * before a ball is struck.
 *
 * A club match play with a hundred entries is not one bracket of 128 with
 * twenty-eight byes. It is flighted — a Championship flight for the low
 * handicaps, then a First flight, a Second — and each flight is its own
 * straight knockout: lose and you are out (Ajay, 2026-10-11: "it should be pure
 * knockouts"). Until this module the app's only step past one bracket was
 * `split`, two flights by qualifying rank (`bracket.ts`).
 *
 * This is the arithmetic and nothing else: how a field of N can be divided,
 * who goes where by a stated criterion, and what happens when the organizer
 * moves somebody. It draws no matches — each flight's players, in seed order,
 * are handed to `buildBracket` exactly as a single bracket's are, so byes fall
 * to the top seeds by the same general numerical draw the Committee Procedures
 * set out for match play (Section 5F(1)).
 *
 * TWO THINGS IT REFUSES, because a knockout cannot contain them:
 *
 *  - a flight of ONE. One player has nobody to play; `matrix.test.ts` has held
 *    "no flight of one" since the day a two-player event was drawn into two.
 *  - a bye against a bye. A bracket's size is the next power of two above its
 *    field, so it always has more players than byes, and every first-round tie
 *    has at least one person in it.
 *
 * WHAT IT DOES NOT DO: a plate. Nobody drops from one flight into another;
 * `plate` mode in `bracket.ts` is a different arrangement and stays what it is.
 */

/** How the field is divided. */
export type FlightCriterion =
  /** Lowest handicap index first: the Championship flight is the best players. */
  | "handicap"
  /** The tournament's own flights: each one becomes a bracket, whatever its size. */
  | "flights"
  /** Dealt at random, so every bracket is a cross-section. Repeatable from its seed. */
  | "random"
  /** By a qualifying round the club has ALREADY played. Never required: this is a knockout from entry. */
  | "qualifying";

export const FLIGHT_CRITERIA: Array<{ key: FlightCriterion; label: string; blurb: string }> = [
  { key: "handicap", label: "By handicap", blurb: "Lowest handicaps in the Championship flight, then the First flight, and so on. The usual way." },
  { key: "flights", label: "By the flights you already have", blurb: "Each of the tournament's flights becomes its own bracket." },
  { key: "random", label: "Evenly, at random", blurb: "Every bracket a cross-section of the field. The same draw every time you look at it." },
  { key: "qualifying", label: "By qualifying score", blurb: "Best qualifiers in the Championship flight. Only where a qualifying round has been played." },
];

export function isFlightCriterion(v: string): v is FlightCriterion {
  return v === "handicap" || v === "flights" || v === "random" || v === "qualifying";
}

/** One entrant, with what each criterion needs. */
export interface FlightEntrant {
  id: string;
  name: string;
  /** Null when the club has not given one: such a player sorts after everybody who has. */
  handicapIndex: number | null;
  /** The tournament flight they are already in, by name; null or "" for none. */
  flight?: string | null;
  /** 1 = best. Null when no qualifying round has placed them. */
  qualifyingRank?: number | null;
}

/** One bracket of a plan. */
export interface FlightBracket {
  name: string;
  /** In seed order: the first is the top seed, and the byes are theirs first. */
  playerIds: string[];
  /** Places in the bracket: the next power of two at or above the field, at least two. */
  size: number;
  /** Places nobody fills. Always fewer than the players. */
  byes: number;
  /** Rounds to win it: a bracket of 16 is four. */
  rounds: number;
}

/** One way to divide a field, before anybody is put in it. */
export interface FlightShape {
  /** Players in each bracket, first bracket first. Adds up to the field. */
  counts: number[];
  /** Places left empty across every bracket. */
  byes: number;
  /** The shape an organizer is shown first. Exactly one per list. */
  recommended: boolean;
  /** In a club's words: "6 flights of 16 and one of 4". */
  label: string;
}

/**
 * The most brackets a shape may have and still be the one recommended. Past
 * eight a club is running more prize tables than rounds; such shapes are still
 * offered, never suggested.
 */
export const MOST_FLIGHTS_SUGGESTED = 8;

/** Bracket sizes a field is divided into. A flight of four is two rounds; of 64, six. */
const FLIGHT_SIZES = [64, 32, 16, 8] as const;

const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth", "Eleventh", "Twelfth"];

/**
 * What the brackets are called, top first, the way a club writes them on the
 * sheet: the Championship flight, then the First, the Second. One bracket has
 * no flights to tell apart and is simply the draw.
 */
export function flightNames(count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return ["Main draw"];
  const out = ["Championship flight"];
  // Past the twelfth the words run out, and a flight is numbered the way every screen numbers one.
  for (let i = 1; i < count; i += 1) out.push(i <= ORDINALS.length ? `${ORDINALS[i - 1]} flight` : flightLabel("", i));
  return out;
}

function bracketOf(name: string, playerIds: string[]): FlightBracket {
  const size = bracketSizeFor(playerIds.length);
  return { name, playerIds, size, byes: size - playerIds.length, rounds: Math.log2(size) };
}

function byesFor(counts: number[]): number {
  return counts.reduce((n, c) => n + (bracketSizeFor(c) - c), 0);
}

/**
 * Full flights of `size` from the top, and the players left over as a last,
 * smaller flight of their own.
 *
 * That is how a club does it — "six flights of sixteen and one of four" — and
 * it wastes no places: the full flights have no byes at all. A remainder of
 * ONE or TWO is the exception. One cannot be a flight, and two is a single
 * match called a flight; either is shared with the flight above, the two
 * splitting what they hold between them.
 */
export function topDownCounts(n: number, size: number): number[] {
  if (n < 2 || size < 2) return [];
  const full = Math.floor(n / size);
  const rest = n - full * size;
  if (full === 0) return [n];
  const counts: number[] = Array.from({ length: full }, () => size);
  if (rest === 0) return counts;
  if (rest >= 3) return [...counts, rest];
  const shared = size + rest;
  counts.pop();
  return [...counts, Math.ceil(shared / 2), Math.floor(shared / 2)];
}

function describe(counts: number[]): string {
  if (counts.length === 1) return `One bracket of ${counts[0]}`;
  // Runs of the same size, in order: [16,16,16,4] reads "3 flights of 16 and one of 4".
  const runs: Array<{ size: number; times: number }> = [];
  for (const c of counts) {
    const last = runs[runs.length - 1];
    if (last && last.size === c) last.times += 1;
    else runs.push({ size: c, times: 1 });
  }
  const parts = runs.map((r, i) => {
    const many = r.times === 1 ? "one" : String(r.times);
    return i === 0 ? `${r.times === 1 ? "One flight" : `${r.times} flights`} of ${r.size}` : `${many} of ${r.size}`;
  });
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The ways a field of `n` can be divided, for the organizer to choose between.
 *
 * Always offered: one bracket. Then, for each flight size the field is larger
 * than, full flights from the top with the remainder as a last flight. Each
 * says how many places it leaves empty, because that is what the choice costs:
 * a bye is a player with no match in the first round.
 *
 * ONE is recommended: the fewest empty places among the shapes with no more
 * than eight brackets, and of those the one with the fewest brackets — more
 * rounds of golf for everybody, fewer prize tables. A field too small to
 * divide (under sixteen) is one bracket and nothing else is suggested.
 *
 * Fewer than two players is not a knockout, and the list is empty.
 */
export function proposeShapes(n: number): FlightShape[] {
  if (!Number.isInteger(n) || n < 2) return [];
  const seen = new Set<string>();
  const shapes: Array<Omit<FlightShape, "recommended">> = [];
  const add = (counts: number[]) => {
    if (counts.length === 0 || counts.some((c) => c < 2)) return;
    const key = counts.join(",");
    if (seen.has(key)) return;
    seen.add(key);
    shapes.push({ counts, byes: byesFor(counts), label: describe(counts) });
  };
  add([n]);
  if (n >= 16) for (const size of FLIGHT_SIZES) if (n > size) add(topDownCounts(n, size));

  const eligible = shapes.filter((s) => s.counts.length <= MOST_FLIGHTS_SUGGESTED);
  const best = [...eligible].sort((a, b) => a.byes - b.byes || a.counts.length - b.counts.length)[0] ?? shapes[0];
  return shapes.map((s) => ({ ...s, recommended: s === best }));
}

/**
 * A repeatable shuffle. The draw an organizer is shown must be the draw they
 * get when they press the button, and the one a player sees an hour later, so
 * "at random" is a function of a seed the tournament keeps — never of the
 * clock or of `Math.random`.
 */
export function seededOrder<T>(items: T[], seed: string): T[] {
  // FNV-1a over the seed, then mulberry32: small, well spread, and the same in every engine.
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const byName = (a: FlightEntrant, b: FlightEntrant) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** Best first by handicap index; a player with none sorts after everybody who has one. */
function byHandicap(a: FlightEntrant, b: FlightEntrant): number {
  if (a.handicapIndex === null && b.handicapIndex === null) return byName(a, b);
  if (a.handicapIndex === null) return 1;
  if (b.handicapIndex === null) return -1;
  return a.handicapIndex - b.handicapIndex || byName(a, b);
}

function byQualifying(a: FlightEntrant, b: FlightEntrant): number {
  const ra = a.qualifyingRank ?? null;
  const rb = b.qualifyingRank ?? null;
  if (ra === null && rb === null) return byHandicap(a, b);
  if (ra === null) return 1;
  if (rb === null) return -1;
  return ra - rb || byHandicap(a, b);
}

export interface FlightPlan {
  criterion: FlightCriterion;
  brackets: FlightBracket[];
}

export type FlightPlanResult = { ok: true; plan: FlightPlan } | { ok: false; error: string };

/**
 * Put the field into brackets.
 *
 * `counts` is the shape chosen (from `proposeShapes`, or the organizer's own
 * numbers). It is ignored for `flights`, where the tournament's flights ARE the
 * shape. Inside each bracket the players stand in seed order by the same
 * criterion, so the top seed of every flight is its best player and the byes,
 * if it has any, are theirs.
 *
 * `random` deals the shuffled field round the brackets in turn, so the sizes
 * asked for are kept and no bracket gets a run of the shuffle to itself; the
 * seeding inside each is then the order dealt.
 *
 * Refused, with the reason in words an organizer can act on: a shape that does
 * not add up to the field, a bracket of one, `qualifying` when somebody has no
 * qualifying place, and `flights` when a flight holds a single player.
 */
export function planFlights(
  entrants: FlightEntrant[],
  criterion: FlightCriterion,
  counts: number[],
  seed = "",
): FlightPlanResult {
  const ids = new Set(entrants.map((e) => e.id));
  if (ids.size !== entrants.length) return { ok: false, error: "The same player is in the field twice." };
  if (entrants.length < 2) return { ok: false, error: "A knockout needs at least two players." };

  if (criterion === "flights") {
    const order: string[] = [];
    const groups = new Map<string, FlightEntrant[]>();
    for (const e of entrants) {
      const key = (e.flight ?? "").trim();
      if (!groups.has(key)) {
        groups.set(key, []);
        order.push(key);
      }
      groups.get(key)!.push(e);
    }
    if (groups.has("") && groups.size > 1) {
      return { ok: false, error: `${groups.get("")!.length} of the field are in no flight yet. Put them in one, or divide the field another way.` };
    }
    const named = order.filter((k) => k !== "");
    if (named.length === 0) return { ok: false, error: "This tournament has no flights to divide by." };
    const single = named.find((k) => groups.get(k)!.length < 2);
    if (single !== undefined) return { ok: false, error: `${single} has one player, who would have nobody to play.` };
    return {
      ok: true,
      plan: { criterion, brackets: named.map((k) => bracketOf(k, [...groups.get(k)!].sort(byHandicap).map((e) => e.id))) },
    };
  }

  if (counts.length === 0 || counts.some((c) => !Number.isInteger(c))) return { ok: false, error: "Say how many players each bracket holds." };
  if (counts.some((c) => c < 2)) return { ok: false, error: "A bracket of one has nobody to play." };
  const total = counts.reduce((a, b) => a + b, 0);
  if (total !== entrants.length) {
    return { ok: false, error: `The brackets hold ${total} and the field is ${entrants.length}.` };
  }
  if (criterion === "qualifying" && entrants.some((e) => (e.qualifyingRank ?? null) === null)) {
    return { ok: false, error: "Not everybody has a qualifying place. Divide by handicap instead, or finish the qualifying round." };
  }

  const names = flightNames(counts.length);
  if (criterion === "random") {
    const dealt: string[][] = counts.map(() => []);
    let at = 0;
    for (const e of seededOrder([...entrants].sort(byName), seed)) {
      // the next bracket that still has room, going round
      let tries = 0;
      while (dealt[at].length >= counts[at] && tries < counts.length) {
        at = (at + 1) % counts.length;
        tries += 1;
      }
      dealt[at].push(e.id);
      at = (at + 1) % counts.length;
    }
    return { ok: true, plan: { criterion, brackets: dealt.map((p, i) => bracketOf(names[i], p)) } };
  }

  const ordered = [...entrants].sort(criterion === "qualifying" ? byQualifying : byHandicap);
  const brackets: FlightBracket[] = [];
  let from = 0;
  counts.forEach((c, i) => {
    brackets.push(bracketOf(names[i], ordered.slice(from, from + c).map((e) => e.id)));
    from += c;
  });
  return { ok: true, plan: { criterion, brackets } };
}

/**
 * The organizer moves one player to another bracket.
 *
 * They go to the FOOT of the bracket they join — its last seed — because the
 * seeding above them was earned by the criterion and a hand-placed player has
 * no claim on a bye; `planReseeded` is there for the organizer who wants otherwise.
 * Both brackets are resized: a flight of sixteen that gains one is a bracket of
 * thirty-two with fifteen byes, and the plan says so rather than hiding it.
 *
 * Refused when it would leave the bracket they come from with one player.
 */
export function planWithPlayerMoved(plan: FlightPlan, playerId: string, toIndex: number): FlightPlanResult {
  const fromIndex = plan.brackets.findIndex((b) => b.playerIds.includes(playerId));
  if (fromIndex < 0) return { ok: false, error: "That player is not in this draw." };
  if (toIndex < 0 || toIndex >= plan.brackets.length) return { ok: false, error: "There is no such bracket." };
  if (toIndex === fromIndex) return { ok: true, plan };
  const from = plan.brackets[fromIndex];
  if (from.playerIds.length - 1 < 2) {
    return { ok: false, error: `${from.name} would be left with one player, who would have nobody to play.` };
  }
  const brackets = plan.brackets.map((b, i) => {
    if (i === fromIndex) return bracketOf(b.name, b.playerIds.filter((id) => id !== playerId));
    if (i === toIndex) return bracketOf(b.name, [...b.playerIds, playerId]);
    return b;
  });
  return { ok: true, plan: { ...plan, brackets } };
}

/**
 * The organizer sets a bracket's seeding by hand: the same players, in the
 * order given. Anything else — a player added, dropped or named twice — is
 * refused, so a reseed can never quietly change who is in the flight.
 */
export function planReseeded(plan: FlightPlan, bracketIndex: number, order: string[]): FlightPlanResult {
  const b = plan.brackets[bracketIndex];
  if (!b) return { ok: false, error: "There is no such bracket." };
  const want = new Set(order);
  if (want.size !== order.length || order.length !== b.playerIds.length || b.playerIds.some((id) => !want.has(id))) {
    return { ok: false, error: "A seeding has to list the same players, each once." };
  }
  const brackets = plan.brackets.map((x, i) => (i === bracketIndex ? bracketOf(x.name, [...order]) : x));
  return { ok: true, plan: { ...plan, brackets } };
}

/** Rename a bracket. A blank name is refused: a flight nobody can name cannot be put on a sheet. */
export function planRenamed(plan: FlightPlan, bracketIndex: number, name: string): FlightPlanResult {
  const clean = name.trim();
  if (!plan.brackets[bracketIndex]) return { ok: false, error: "There is no such bracket." };
  if (!clean) return { ok: false, error: "Give the bracket a name." };
  if (plan.brackets.some((b, i) => i !== bracketIndex && b.name.toLowerCase() === clean.toLowerCase())) {
    return { ok: false, error: `There is already a bracket called ${clean}.` };
  }
  return { ok: true, plan: { ...plan, brackets: plan.brackets.map((b, i) => (i === bracketIndex ? { ...b, name: clean } : b)) } };
}

/**
 * THE PLAN AS THE TOURNAMENT KEEPS IT.
 *
 * One bracket's draw is a flat list of ids, written down by the first recorded
 * result (`parseBracketDraw`). A knockout in flights cannot be kept that way:
 * who is in which flight is the organizer's own arrangement — a criterion, then
 * people moved by hand — and a flat list re-divided on every read would undo
 * every one of those moves. So the whole plan is kept, in the same column, as
 * an object marked `v: 2`; the old reader answers null for it, and this one
 * answers null for a flat list, so neither can mistake the other's value.
 *
 * It is kept from the moment the organizer divides the field, not from the
 * first result: the division IS the draw.
 */
export function serializeFlightPlan(plan: FlightPlan): string {
  return JSON.stringify({
    v: 2,
    criterion: plan.criterion,
    flights: plan.brackets.map((b) => ({ name: b.name, playerIds: b.playerIds })),
  });
}

/**
 * Null on anything it cannot read as a plan: empty, malformed, a flat list, an
 * unknown criterion, no flights, a flight with no name or fewer than two
 * players. A plan that cannot be read is no plan — the field is shown undivided
 * and the organizer divides it again — which is recoverable. A plan half-read
 * would put people in a draw nobody made.
 *
 * It does NOT tidy what it reads: a player listed twice stays twice, exactly as
 * `parseBracketDraw` leaves a flat draw alone, because removing one would move
 * everybody after them to another seed.
 */
export function parseFlightPlan(json: string | null | undefined): FlightPlan | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const o = raw as { v?: unknown; criterion?: unknown; flights?: unknown };
    if (o.v !== 2 || typeof o.criterion !== "string" || !isFlightCriterion(o.criterion)) return null;
    if (!Array.isArray(o.flights) || o.flights.length === 0) return null;
    const brackets: FlightBracket[] = [];
    for (const f of o.flights as unknown[]) {
      if (!f || typeof f !== "object") return null;
      const { name, playerIds } = f as { name?: unknown; playerIds?: unknown };
      if (typeof name !== "string" || !name.trim() || !Array.isArray(playerIds)) return null;
      const ids = playerIds.filter((v): v is string => typeof v === "string" && v.trim() !== "");
      if (ids.length < 2 || ids.length !== playerIds.length) return null;
      brackets.push(bracketOf(name.trim(), ids));
    }
    return { criterion: o.criterion, brackets };
  } catch {
    return null;
  }
}

/**
 * Who in the field is in no flight, and who in a flight has left the field.
 *
 * A plan is made on one day and the field moves after it: somebody enters
 * late, somebody withdraws. Neither is tidied silently. A late entrant is in no
 * flight until the organizer puts them in one — the screen says how many — and
 * a player who has withdrawn STAYS in their flight and is beaten by walkover,
 * which is what the Rules expect of a draw already made (Rule 3.2a) and what
 * the single-bracket draw has always done.
 */
export function planAgainstField(plan: FlightPlan, fieldIds: string[]): { unplaced: string[]; departed: string[] } {
  const placed = new Set(plan.brackets.flatMap((b) => b.playerIds));
  const field = new Set(fieldIds);
  return {
    unplaced: fieldIds.filter((id) => !placed.has(id)),
    departed: [...placed].filter((id) => !field.has(id)),
  };
}

/**
 * Put a player who is in no flight into one — a late entry. They join at the
 * foot, like anybody moved by hand. Refused for somebody already in the draw.
 */
export function planWithPlayerAdded(plan: FlightPlan, playerId: string, toIndex: number): FlightPlanResult {
  if (plan.brackets.some((b) => b.playerIds.includes(playerId))) return { ok: false, error: "That player is already in the draw." };
  if (toIndex < 0 || toIndex >= plan.brackets.length) return { ok: false, error: "There is no such bracket." };
  const brackets = plan.brackets.map((b, i) => (i === toIndex ? bracketOf(b.name, [...b.playerIds, playerId]) : b));
  return { ok: true, plan: { ...plan, brackets } };
}
