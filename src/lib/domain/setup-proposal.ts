// Turning a sentence into a tournament's configuration.
//
// "Two-round member-guest, 24 pairs, four-ball 90%, cut top 8 after round 1"
// is how an organizer describes an event to another person, and assembling it
// by hand is the work that keeps clubs on whatever they already use.
//
// The same discipline as reading a scorecard: the model PROPOSES and a person
// ACCEPTS. Nothing here writes anything, and nothing it returns is trusted.
// A format it invented, a hole count that is not nine or eighteen, an
// allowance of 900% — all dropped rather than coerced into something
// plausible, because a plausible wrong setup is one somebody plays a
// tournament on before noticing.
//
// Where the sentence is genuinely ambiguous this says so instead of choosing.
// "Cut top 8" can mean eight overall or eight per flight, and those are
// different tournaments — guessing would decide who plays on.

export interface ProposedRound {
  type: string;
  format: string;
  holes: number;
  scoringBasis: string;
  description: string;
}

export interface ProposedCut {
  /** Which round the cut happens after, 1-based as an organizer counts them. */
  afterRound: number;
  mode: "count" | "percent";
  value: number;
  /** overall | perFlight, or null when the sentence did not say. */
  scope: "overall" | "perFlight" | null;
}

export interface SetupProposal {
  rounds: ProposedRound[];
  /** Handicap allowance percent, or null when not mentioned. */
  allowancePct: number | null;
  cut: ProposedCut | null;
  /** Expected field size, for the organizer to sanity-check. Never acted on. */
  fieldSize: number | null;
  /**
   * Things the description did not settle, in plain words.
   *
   * Surfaced rather than guessed. Each one is a question for the organizer,
   * and a proposal with questions attached is honest in a way a confident
   * wrong answer is not.
   */
  questions: string[];
  /** True when nothing usable came back. */
  empty: boolean;
}

const SCORING_BASES = ["gross", "net", "both", "stableford"] as const;

function asInt(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function asOneOf(v: unknown, allowed: readonly string[]): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  // Case-insensitive, because a model will happily return "four-ball" for
  // "Four-Ball"; but the value stored is always the app's own spelling.
  const hit = allowed.find((a) => a.toLowerCase() === t.toLowerCase());
  return hit ?? null;
}

/**
 * Validate a proposal against what the app can actually run.
 *
 * `playableFormats` and `stageTypes` are passed in rather than imported so
 * this stays a pure function with no opinion about where the catalogue lives —
 * and so a test can prove that an invented format is rejected.
 */
export function parseSetupProposal(
  raw: unknown,
  playableFormats: readonly string[],
  stageTypes: readonly string[],
): SetupProposal {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const questions: string[] = [];

  const rawRounds = Array.isArray(obj.rounds) ? obj.rounds : [];
  const rounds: ProposedRound[] = [];
  for (const r of rawRounds.slice(0, 12)) {
    const o = (r ?? {}) as Record<string, unknown>;
    const format = asOneOf(o.format, playableFormats);
    const type = asOneOf(o.type, stageTypes);
    // A round the app cannot run is not a round. Dropping it is better than
    // creating something an organizer briefs a field on and then discovers
    // has nowhere to enter a score.
    if (!format || !type) {
      if (typeof o.format === "string" && !format) {
        questions.push(`"${o.format}" isn't a format this app can score, so that round was left out.`);
      }
      continue;
    }
    const holes = asInt(o.holes, 1, 18) === 9 ? 9 : 18;
    rounds.push({
      type,
      format,
      holes,
      scoringBasis: asOneOf(o.scoringBasis, SCORING_BASES) ?? "gross",
      description: typeof o.description === "string" ? o.description.slice(0, 80) : "",
    });
  }

  const allowancePct = asInt(obj.allowancePct, 1, 100);

  let cut: ProposedCut | null = null;
  const rawCut = (obj.cut ?? null) as Record<string, unknown> | null;
  if (rawCut && typeof rawCut === "object") {
    const value = asInt(rawCut.value, 1, 1000);
    const mode = asOneOf(rawCut.mode, ["count", "percent"]) as "count" | "percent" | null;
    const afterRound = asInt(rawCut.afterRound, 1, Math.max(1, rounds.length));
    if (value !== null && mode && afterRound !== null) {
      const scope = asOneOf(rawCut.scope, ["overall", "perFlight"]) as
        | "overall"
        | "perFlight"
        | null;
      cut = { afterRound, mode, value, scope };
      if (!scope) {
        // The difference decides who plays on, so it is asked rather than
        // assumed. Per flight sends someone through from every flight;
        // overall can send four from one and none from another.
        questions.push(
          `Is the cut top ${value} overall, or top ${value} in each flight? They advance different players.`,
        );
      }
    }
  }

  if (rounds.length === 0) {
    questions.push("No rounds could be worked out from that. Try naming the format and how many rounds.");
  }

  return {
    rounds,
    allowancePct,
    cut,
    fieldSize: asInt(obj.fieldSize, 2, 1000),
    questions,
    empty: rounds.length === 0,
  };
}

/**
 * What the model is asked.
 *
 * The allowed vocabulary is listed in the prompt rather than left to the
 * model's imagination — it is the difference between a model choosing
 * "Fourball" and choosing from a menu. The parser still rejects anything
 * outside it, because a prompt is a request and a check is a guarantee.
 */
export function setupPrompt(
  description: string,
  playableFormats: readonly string[],
  stageTypes: readonly string[],
): string {
  return [
    "You configure golf tournaments. Turn the organizer's description into JSON.",
    "",
    `Formats you may use (exact spelling): ${playableFormats.join(", ")}`,
    `Round types you may use: ${stageTypes.join(", ")}`,
    "Scoring bases: gross, net, both, stableford",
    "",
    "Reply with ONLY this JSON shape and no other text:",
    "{",
    '  "rounds": [{ "type": "...", "format": "...", "holes": 9 or 18, "scoringBasis": "...", "description": "short label" }],',
    '  "allowancePct": number or null,',
    '  "cut": { "afterRound": number, "mode": "count" or "percent", "value": number, "scope": "overall" or "perFlight" or null } or null,',
    '  "fieldSize": number or null',
    "}",
    "",
    "Rules:",
    "- Use only the formats and types listed. Never invent one.",
    "- If the description does not say whether a cut is overall or per flight, set scope to null. Do not guess.",
    "- Omit anything the description does not mention rather than filling in a default.",
    "",
    `Description: ${description}`,
  ].join("\n");
}
