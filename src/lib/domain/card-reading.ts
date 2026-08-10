// Reading a paper scorecard from a photograph.
//
// This module is the boundary between a language model and the tournament.
// Everything it receives is UNTRUSTED — a vision model can return the wrong
// shape, the wrong length, prose instead of numbers, or a confident 47 on a
// par 3. None of that may reach a scorecard.
//
// So nothing here guesses. A value that is not plainly a golf score becomes
// null, which the screen shows as an empty box for a human to fill in. An
// empty box is an honest "I could not read this"; a fabricated 5 is a score
// somebody has to notice is wrong, and they will not.
//
// The engines that score a round are untouched by any of this. The model
// proposes numbers; scoring stays deterministic.

/**
 * The widest score worth accepting from a reading.
 *
 * Not a rule of golf — a player can take any number — but a photograph read
 * as 47 on one hole is a misread far more often than it is a real card, and
 * a blank asks the question rather than answering it wrongly. Anyone who
 * genuinely made 21 can type it.
 */
export const MAX_READABLE_SCORE = 20;

export interface CardReading {
  /** One entry per hole. null means "not read" — never a guess. */
  strokes: (number | null)[];
  /** Holes the reading could not produce a usable score for. 1-based. */
  unreadable: number[];
  /** True when nothing usable came back at all. */
  empty: boolean;
}

/** A single value from a model, coerced to a score or rejected. */
function readScore(v: unknown): number | null {
  // Numbers straight through, if they are plausible.
  if (typeof v === "number") {
    if (!Number.isInteger(v) || v < 1 || v > MAX_READABLE_SCORE) return null;
    return v;
  }
  // Strings only when they are exactly a number. "4" yes; "4 (unsure)" no,
  // because the moment prose creeps in the value is a guess about a guess.
  if (typeof v === "string") {
    const t = v.trim();
    if (!/^\d{1,2}$/.test(t)) return null;
    const n = Number(t);
    if (n < 1 || n > MAX_READABLE_SCORE) return null;
    return n;
  }
  return null;
}

/**
 * Turn whatever the model returned into a card of exactly `holeCount` holes.
 *
 * Length is enforced rather than trusted: a reading of 20 holes for an
 * 18-hole round is a misread, and silently taking the first 18 would put
 * every score on the wrong hole. Short readings are padded with nulls, long
 * ones truncated — and either way the holes with no usable value are listed
 * so the screen can point at them.
 */
export function parseCardReading(raw: unknown, holeCount: number): CardReading {
  const holes = Math.max(0, Math.floor(holeCount));
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : // Some models wrap the answer. Accept the common shapes rather than
      // failing the whole read, but never go looking for numbers in prose.
      Array.isArray((raw as { strokes?: unknown })?.strokes)
      ? ((raw as { strokes: unknown[] }).strokes)
      : Array.isArray((raw as { scores?: unknown })?.scores)
        ? ((raw as { scores: unknown[] }).scores)
        : [];

  const strokes: (number | null)[] = [];
  for (let i = 0; i < holes; i += 1) strokes.push(readScore(list[i]));

  const unreadable = strokes.flatMap((s, i) => (s === null ? [i + 1] : []));
  return { strokes, unreadable, empty: strokes.every((s) => s === null) };
}

/**
 * What the model is asked for.
 *
 * Kept beside the parser deliberately: the prompt and the thing that checks
 * the answer drift apart the moment they live in different files, and the
 * check is the part that matters.
 *
 * It asks for null rather than a guess, because a model told to always
 * produce a number always will.
 */
export function cardReadingPrompt(holeCount: number, playerName: string): string {
  return [
    `This is a photograph of a golf scorecard. Read the stroke count for ${playerName} on each of the ${holeCount} holes.`,
    "",
    `Reply with ONLY a JSON array of exactly ${holeCount} values, in hole order.`,
    "Each value is the whole number of strokes, or null if you cannot read that hole with confidence.",
    "",
    "Use null rather than guessing. A blank is easy for a person to fill in; a wrong number is not.",
    "Do not include any other text, explanation or formatting.",
    `Example for 3 holes: [4, null, 5]`,
  ].join("\n");
}

/**
 * Pull the JSON array out of a model's reply.
 *
 * Models wrap answers in prose or fences however firmly they are asked not
 * to, so this looks for the first bracketed list rather than requiring the
 * whole reply to parse. Anything it cannot find becomes an empty reading —
 * which shows as a blank card, not as a card of invented numbers.
 */
export function extractReadingJson(reply: string): unknown {
  const fenced = reply.replace(/```(?:json)?/gi, "");
  const start = fenced.indexOf("[");
  const end = fenced.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return [];
  }
}
