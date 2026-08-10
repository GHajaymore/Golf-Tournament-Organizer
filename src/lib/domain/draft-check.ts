// Checking a drafted message before a human sends it.
//
// The rule for AI-written words in this app is that they NARRATE REAL DATA AND
// NEVER INVENT IT. That is easy to write in a roadmap and hard to enforce: no
// program can read prose and decide whether it is true.
//
// But one kind of invention is both the most likely and the most damaging, and
// it IS checkable — a name. A recap that congratulates a player who was never
// in the field is the thing that ends a club's trust in every other number the
// app produces, and it is exactly what a language model does when it is short
// of material.
//
// So this does the part that can be done honestly: it finds names in a draft
// that do not belong to anybody in the tournament, and hands them to the
// organizer to look at. It makes no claim to verify the rest. A check that
// pretended to would be worse than none, because it would be believed.

/** A word that starts a sentence or is otherwise capitalised without being a name. */
const COMMON_CAPITALISED = new Set([
  // Sentence openers and connectives a draft will inevitably contain.
  "the", "a", "an", "and", "but", "or", "so", "then", "after", "before", "with",
  "at", "in", "on", "by", "for", "from", "to", "it", "he", "she", "they", "we",
  "this", "that", "there", "here", "when", "while", "as", "if", "no", "not",
  // Golf vocabulary that is capitalised mid-sentence often enough to matter.
  "round", "rounds", "flight", "flights", "match", "matches", "hole", "holes",
  "par", "birdie", "birdies", "eagle", "eagles", "bogey", "bogeys", "skins",
  "skin", "front", "back", "nine", "out", "in", "net", "gross", "stableford",
  "cut", "final", "champion", "club", "championship", "league", "society",
  "member", "guest", "captain", "tee", "green", "course", "handicap",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
]);

/**
 * What an organizer can ask to have drafted.
 *
 * A fixed set rather than a free instruction field, for two reasons: each of
 * these is a different piece of writing with a different tone, and an open
 * "tell the assistant what to write" box is a prompt-injection surface pointed
 * at a feature that reads the club's real data.
 *
 * Lives here rather than beside the action because a "use server" module may
 * only export async functions.
 */
export const DRAFT_KINDS = {
  recap: "a short recap of the event so far, for the club newsletter or noticeboard",
  results: "a results email to the field, announcing where things stand",
  reminder: "a friendly reminder to the field about the next round",
  thanks: "a short thank-you to the field at the end of the event",
} as const;

export type DraftKind = keyof typeof DRAFT_KINDS;

/** Shown in the picker, in the order an event actually needs them. */
export const DRAFT_KIND_LABELS: Record<DraftKind, string> = {
  results: "Results announcement",
  recap: "Newsletter recap",
  reminder: "Reminder about the next round",
  thanks: "Thank-you at the end",
};

/** A starting headline for the post. Short, because it sits on a phone
 *  dashboard next to three others — the picker label is a description of the
 *  job, which is a different thing from a title members read. */
export const DRAFT_KIND_TITLES: Record<DraftKind, string> = {
  results: "Where things stand",
  recap: "Round recap",
  reminder: "Next round",
  thanks: "Thank you",
};

export interface DraftCheck {
  /** Capitalised words that look like people but match nobody in the field. */
  unknownNames: string[];
  /** True when nothing looked invented. Not a claim that the draft is true. */
  clean: boolean;
}

/**
 * Normalise for comparison: case, accents and punctuation all vary between
 * how a roster stores a name and how a sentence uses it.
 */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/**
 * Every way a known person might legitimately be referred to.
 *
 * A roster holds "Aj More" and a draft may say "More", "Aj", or "A. More" —
 * all of them that person, none of them invented. Flagging those would train
 * an organizer to ignore the warnings, which is how a safety check stops
 * working.
 */
function knownTokens(names: string[]): Set<string> {
  const out = new Set<string>();
  for (const full of names) {
    const parts = full.split(/\s+/).filter(Boolean);
    out.add(norm(full));
    for (const p of parts) {
      const n = norm(p);
      // Single letters are initials and match anything; not useful as tokens.
      if (n.length > 1) out.add(n);
    }
  }
  return out;
}

/**
 * Find names in a draft that belong to nobody in the tournament.
 *
 * Deliberately conservative. It reports only capitalised words that are not
 * sentence-openers, not golf vocabulary, and not any part of a known player's
 * name — because a check that cries wolf gets switched off, and then the one
 * genuinely invented player sails through.
 */
export function checkDraft(draft: string, knownNames: string[]): DraftCheck {
  const known = knownTokens(knownNames);
  const seen = new Set<string>();
  const unknown: string[] = [];

  // Split into sentences so the first word of each can be excused: "Ellis
  // won" and "Ellis" mid-sentence are different evidence.
  for (const sentence of draft.split(/(?<=[.!?])\s+|\n+/)) {
    const words = sentence.trim().split(/\s+/);
    words.forEach((raw, i) => {
      // Strip a possessive before trimming punctuation, or "Saturday's medal"
      // normalises to "saturdays" and misses the vocabulary list entirely.
      const word = raw.replace(/['’]s\b/gu, "").replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
      if (word.length < 2) return;
      if (!/^\p{Lu}/u.test(word)) return;
      const n = norm(word);
      if (!n || known.has(n) || COMMON_CAPITALISED.has(n)) return;
      // A capitalised word opening a sentence is usually just a sentence.
      // Only flag it if it also appears capitalised somewhere it isn't first.
      if (i === 0 && !new RegExp(`\\S\\s+${word}\\b`).test(draft)) return;
      if (seen.has(n)) return;
      seen.add(n);
      unknown.push(word);
    });
  }

  return { unknownNames: unknown, clean: unknown.length === 0 };
}

/**
 * The instruction given to the model.
 *
 * Written to remove the temptation rather than only forbid the outcome: it is
 * handed the real standings and told that these are the only people who exist,
 * because a model short of material invents a hero.
 */
export function draftPrompt(kind: string, eventName: string, facts: string, extra: string): string {
  return [
    `You are writing for the organizer of a golf event called "${eventName}".`,
    `Write: ${kind}.`,
    "",
    "These are the ONLY facts available. Every name, score, position and margin you use must come from them:",
    facts || "(no results yet)",
    extra ? `\nThe organizer adds: ${extra}` : "",
    "",
    "Rules:",
    "- Never mention a player who is not listed above. Do not invent one to make a better story.",
    "- Never invent a score, a margin or a hole. If the results are thin, write something short.",
    "- No hype about drama that the numbers do not show.",
    "- Plain, warm, factual. Write it as a club secretary would, not as a press release.",
    "- Return only the text to be sent. No preamble, no options, no formatting marks.",
  ].join("\n");
}
