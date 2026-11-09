/**
 * WHAT THIS ONE IS CALLED — chosen per tournament, not per club.
 *
 * Ajay, 2026-09-19: "any golf play is a tournament including outing, charity,
 * league, etc.", and then "can we have an option at tournament level?" A club
 * runs a championship in June, a charity scramble in July and a roll-up every
 * Tuesday, so one word for all three is wrong however carefully it is chosen —
 * and a club-wide setting would make the championship and the roll-up share a
 * name again, one level up.
 *
 * `tournament` is the default and the fallback, which is what every row that
 * has never been asked already is.
 *
 * THE MODEL DOES NOT CHANGE. All of these are one Event with rounds in it —
 * the same draw, the same cards, the same money. This is the WORD a screen
 * uses, nothing else, and no rule anywhere may branch on it: the moment
 * something scores a "charity day" differently from a "medal", a club that
 * picked the wrong word gets the wrong golf.
 *
 * WHICH WORDS A CLUB IS OFFERED FOLLOWS ITS COUNTRY'S GOLF (2026-11-09, Golf
 * Pro and UX Writer): a US club was offered "Society day", "Medal" and
 * "Roll-up", which are British and Irish words. The words come from
 * `GOLF_TERMS` (`golf-terms.ts`); `playKindsFor(register)` is the ONE list, the
 * register is a REQUIRED argument, and a screen never builds its own
 * (`play-kind-follows-the-country.test.ts`). A kind with no word in the table
 * for a register is simply not offered there; a kind ALREADY SAVED on an event
 * still displays, in its own word.
 *
 * The one thing that is not on this list is a casual round, which is not an
 * organized competition at all and is deliberately kept out of a club's
 * fixtures, its history and its seasons.
 */

import { golfTermsFor, type GolfRegister, type GolfTerm } from "@/lib/domain/golf-terms";

interface KindSpec {
  key: string;
  /** The table entry that names it, where the table has one; its word is what the club is offered. */
  term?: GolfTerm;
  /** The word where no table entry names it, and what a SAVED kind shows in a register that is not offered it. */
  word: string;
  /** Where a kind with no table entry is offered; a kind with a `term` is offered in every register. */
  only?: readonly GolfRegister[];
}

/**
 * Every kind there has ever been, in the order a list shows them. `society` is
 * never offered: in Britain and Ireland its meaning IS the table's `outing`
 * word ("society day"), so offering both would list one word twice; it stays
 * so that one already saved still reads. `rollup` has no entry in the table and
 * is offered where it is spoken, the UK register, and nowhere else.
 */
const KINDS: readonly KindSpec[] = [
  { key: "tournament", word: "Tournament" },
  { key: "competition", word: "Competition" },
  { key: "outing", term: "outing", word: "Outing" },
  { key: "charity", term: "charityDay", word: "Charity day" },
  { key: "league", word: "League" },
  { key: "championship", word: "Championship" },
  { key: "medal", term: "strokeCompetition", word: "Medal" },
  { key: "society", word: "Society day", only: [] },
  { key: "rollup", word: "Roll-up", only: ["uk"] },
];

const BY_KEY = new Map(KINDS.map((k) => [k.key, k]));

export type PlayKind =
  | "tournament"
  | "competition"
  | "outing"
  | "charity"
  | "league"
  | "championship"
  | "medal"
  | "society"
  | "rollup";

/** Every key this app has ever stored. */
export const PLAY_KIND_KEYS: readonly PlayKind[] = KINDS.map((k) => k.key as PlayKind);

function capital(w: string): string {
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function offeredIn(k: KindSpec, register: GolfRegister): boolean {
  return k.term ? true : !k.only || k.only.includes(register);
}

/** The word for a kind in a register: the table's where it has one, else its own. */
function wordFor(k: KindSpec, register: GolfRegister): string {
  return capital(k.term ? golfTermsFor(register)[k.term] : k.word);
}

export interface PlayKindOption {
  key: PlayKind;
  label: string;
  result: string;
}

/**
 * THE LIST A CLUB IS OFFERED — the one place it is built. The register is
 * required: a caller that forgets it does not compile. A word two kinds would
 * share is listed once.
 */
export function playKindsFor(register: GolfRegister, saved?: string): PlayKindOption[] {
  const out: PlayKindOption[] = [];
  for (const k of KINDS) {
    if (!offeredIn(k, register)) continue;
    const label = wordFor(k, register);
    if (out.some((o) => o.label === label)) continue;
    out.push({ key: k.key as PlayKind, label, result: `${label} result` });
  }
  // A kind already saved on the event stays on its own picker, in its own word, even where it is not offered.
  if (saved && isPlayKind(saved) && !out.some((o) => o.key === saved)) {
    const label = labelOf(saved, register);
    out.push({ key: saved, label, result: `${label} result` });
  }
  return out;
}

/** True when a stored value is one this app has ever offered. */
export function isPlayKind(v: string): v is PlayKind {
  return BY_KEY.has(v);
}

/** The label of a stored kind. A kind not offered in the register keeps its own word, so a saved one still reads. */
function labelOf(kind: string, register: GolfRegister): string {
  const k = BY_KEY.get(kind);
  if (!k) return "Tournament";
  return offeredIn(k, register) ? wordFor(k, register) : k.word;
}


/**
 * The word for a stored kind, capitalised: "Outing". Falls back to "Tournament"
 * rather than echoing an unknown value, because this goes into copy a member
 * reads. Screens do not call this: they ask `eventWords` (`event-words.ts`).
 */
export function playKindWord(kind: string, register: GolfRegister): string {
  return labelOf(kind, register);
}
