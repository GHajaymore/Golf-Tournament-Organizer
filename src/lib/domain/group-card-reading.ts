import { MAX_READABLE_SCORE, type CardReading } from "./card-reading";

/**
 * A person's name, reduced to what two spellings of it have in common.
 *
 * Its own function rather than `normalizeCourseName`, which strips "club",
 * "links" and "course" — right for a venue and wrong for a golfer called
 * Course. Initials lose their dots, accents fold, and case and spacing stop
 * mattering, because a card is written in biro at speed.
 */
function normalizeName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'`’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Reading a whole scorecard — every player on it, from one photograph.
 *
 * A physical card has four names down the left. The existing reader takes one
 * of them and discards the rest, so a fourball photographs the same piece of
 * paper four times: four uploads, four model calls, four times the cost, for
 * one card. This reads it once.
 *
 * The design rule, which is not symmetrical:
 *
 *   **Relaxed about digits.** A hole that cannot be read confidently comes
 *   back null and a person fills it in. A misread digit is bounded — one hole,
 *   one player — and the player certifying their own card is looking straight
 *   at the number.
 *
 *   **Strict about identity.** A row matched to the WRONG player is
 *   unbounded: two complete rounds swapped, both entirely plausible, nothing
 *   on any screen looking odd. Certification does not catch it, because the
 *   card in front of the player is not theirs and they have no way to know.
 *   So a row whose name cannot be matched to somebody in the group is
 *   REPORTED, never handed to whoever is left over.
 *
 * That asymmetry is the whole of this module. Everything else is the same
 * untrusted parsing `card-reading.ts` already does.
 */

/** One player's row, as read off the card. */
export interface GroupRow {
  /** The roster player this row was matched to. */
  playerId: string;
  /** The name printed on the card, for the screen to show what it matched. */
  readAs: string;
  reading: CardReading;
}

export interface GroupCardReading {
  rows: GroupRow[];
  /** Names read off the card that match nobody in this group. */
  unmatched: string[];
  /** Players in the group with no row on the card at all. */
  missing: Array<{ playerId: string; name: string }>;
  /** True when nothing usable came back. */
  empty: boolean;
}

const readScore = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_READABLE_SCORE) return v;
  // A model asked for JSON sometimes answers "4" rather than 4. Accept the
  // string form of a number and nothing else — never parse prose.
  if (typeof v === "string") {
    const n = Number(v.trim());
    if (Number.isInteger(n) && n >= 1 && n <= MAX_READABLE_SCORE) return n;
  }
  return null;
};

/**
 * What to ask for, given who the app expects to be on this card.
 *
 * The names are supplied because the app already knows them — score entry
 * knows the tee group. Telling the model who to look for turns identification
 * into verification, which is the difference between reading a card the app
 * printed and reading one somebody wrote out by hand.
 *
 * It is still asked to return the name it actually read rather than the name
 * it was given, so a card carrying somebody else entirely comes back as an
 * unmatched row instead of being quietly mapped onto an expected player.
 */
export function groupCardPrompt(holeCount: number, expected: readonly string[]): string {
  return [
    "This is a photograph of a golf scorecard with more than one player on it.",
    `Read every player's row: the name as written, and their stroke count on each of the ${holeCount} holes.`,
    "",
    expected.length > 0
      ? `The players expected on this card are: ${expected.join(", ")}. Names may be abbreviated or untidy on the card.`
      : "",
    "",
    "Reply with ONLY a JSON array, one object per row you can read:",
    `  [{"name": "as written on the card", "strokes": [4, null, 5, ...]}]`,
    `Each strokes array has exactly ${holeCount} values, in hole order.`,
    "",
    "Use null for any hole you cannot read with confidence. A blank is easy for a person",
    "to fill in; a wrong number is not.",
    "",
    "Return the name you actually READ, even if it is not in the expected list, and even",
    "if you cannot tell who it is. Do not assign a row to an expected player unless the",
    "name on that row is genuinely theirs.",
    "",
    "Do not include any other text, explanation or formatting.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Match a name read off a card to somebody in the group.
 *
 * Cards are written in biro at speed: "A. Vaughn", "Vaughn", "alex v". So a
 * normalised exact match first, then surname, then a unique first name — and
 * each step must be UNIQUE within the group. Two players called Sam means the
 * first-name step matches nobody, which is correct: a card that says "Sam" in
 * a group with two of them genuinely does not say whose row it is.
 */
function matchTo(
  readAs: string,
  group: ReadonlyArray<{ playerId: string; name: string }>,
  taken: ReadonlySet<string>,
): string | null {
  const free = group.filter((p) => !taken.has(p.playerId));
  const target = normalizeName(readAs);
  if (!target) return null;

  const uniquely = (fn: (p: { name: string }) => boolean): string | null => {
    const hits = free.filter(fn);
    return hits.length === 1 ? hits[0].playerId : null;
  };

  const exact = uniquely((p) => normalizeName(p.name) === target);
  if (exact) return exact;

  const words = target.split(" ").filter(Boolean);
  const last = words[words.length - 1] ?? "";
  const first = words[0] ?? "";

  // Surname is the strongest partial signal on a card, because that is what
  // people write when they abbreviate.
  const bySurname = uniquely((p) => {
    const parts = normalizeName(p.name).split(" ").filter(Boolean);
    return parts.length > 0 && parts[parts.length - 1] === last;
  });
  if (bySurname) return bySurname;

  const byFirst = uniquely((p) => normalizeName(p.name).split(" ")[0] === first);
  if (byFirst) return byFirst;

  // Nothing unique. Reported as unmatched rather than guessed — see the note
  // at the top of this file about why identity is the strict half.
  return null;
}

/**
 * Turn whatever came back into rows matched to real players.
 *
 * Untrusted throughout: the reply is parsed as unknown, every score is range
 * checked, and a row is only attached to a player whose name it genuinely
 * matches. A player may receive at most one row — the first that matches them
 * — so a model returning the same person twice cannot overwrite a card it
 * already produced.
 */
export function parseGroupCardReading(
  raw: unknown,
  holeCount: number,
  group: ReadonlyArray<{ playerId: string; name: string }>,
): GroupCardReading {
  const holes = Math.max(0, Math.floor(holeCount));
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { rows?: unknown })?.rows)
      ? (raw as { rows: unknown[] }).rows
      : Array.isArray((raw as { players?: unknown })?.players)
        ? (raw as { players: unknown[] }).players
        : [];

  const rows: GroupRow[] = [];
  const unmatched: string[] = [];
  const taken = new Set<string>();

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const readAs = typeof record.name === "string" ? record.name.trim() : "";
    const rawStrokes = Array.isArray(record.strokes) ? record.strokes : [];

    const strokes: (number | null)[] = [];
    for (let i = 0; i < holes; i += 1) strokes.push(readScore(rawStrokes[i]));
    // A row with nothing readable on it is not evidence of anybody, so it is
    // not worth reporting as an unmatched player either.
    if (strokes.every((s) => s === null)) continue;

    const playerId = matchTo(readAs, group, taken);
    if (!playerId) {
      if (readAs) unmatched.push(readAs);
      continue;
    }
    taken.add(playerId);
    rows.push({
      playerId,
      readAs,
      reading: {
        strokes,
        unreadable: strokes.flatMap((s, i) => (s === null ? [i + 1] : [])),
        empty: false,
      },
    });
  }

  return {
    rows,
    unmatched,
    missing: group.filter((p) => !taken.has(p.playerId)).map((p) => ({ playerId: p.playerId, name: p.name })),
    empty: rows.length === 0,
  };
}
