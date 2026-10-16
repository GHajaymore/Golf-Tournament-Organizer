import { GOLF_FORMATS, isPlayable } from "@/lib/formats";
import { isTeamFormat } from "@/lib/side-style";
import { roundShapeMismatch } from "@/lib/domain/round-shape";
import { basisFor } from "@/lib/domain/week-basis";

/**
 * WHAT A ROUND OF A GIVEN TYPE MAY BE PLAYED AS — the one list both pickers on
 * Rounds & formats offer, and the one the server accepts (2026-10-16).
 *
 * Walked as a new organizer that day: "Stroke play round", Format "Match Play",
 * Add — and the round was created, its card said "This round cannot be scored
 * as set", and the setup strip marked Rounds & formats DONE over the
 * tournament's only round. Every format was offered for every type, with Match
 * Play first. `roundShapeMismatch` already knew which pairs cannot produce a
 * result; nothing asked it before the round existed. So the list is built from
 * it here, and `addStage` / `setStageFormat` refuse what it leaves out.
 *
 * A round ALREADY holding a format the list leaves out (stored before this, or
 * the US name below) still shows it, so the picker never claims a value the
 * round does not have — the warning on the card says what is wrong with it.
 */

export interface FormatChoice {
  /** The stored format name — what is sent to the server. */
  name: string;
  /** What the picker shows: the name, with a few words where two look alike. */
  label: string;
  /** Played on your own, or as a side. */
  group: "own" | "side";
}

/**
 * The words that tell look-alikes apart, said in the picker rather than behind
 * an ⓘ. A golfer reading "Four-Ball" and "Best Ball" side by side cannot tell
 * which the club plays; the difference is how many make up a side and what
 * share of handicap they get.
 */
const HINTS: Record<string, string> = {
  "Four-Ball": "pairs, the better ball counts",
  "Best Ball": "sides of 2 to 4, the best ball counts",
  Shamble: "best drive, then own ball",
  Foursomes: "one ball, alternate shots",
  "Chapman / Pinehurst": "both drive, swap, then alternate",
  Greensomes: "both drive, then alternate",
  Scramble: "best shot every time",
  "Texas Scramble": "a scramble with a minimum of drives each",
};

/**
 * Not offered for a new choice: the same game as another entry under another
 * name. Alternate Shot is foursomes (the catalogue says so — "Foursomes by
 * another name"), and listing both made a newcomer choose between two names
 * for one format. Kept in the catalogue, so a round set to it reads as before.
 */
const SAME_GAME_AS: Record<string, string> = { "Alternate Shot": "Foursomes" };

/** The format a round of this type is played in at most clubs, chosen for the organizer. */
export function naturalFormatFor(type: string): string {
  switch (type) {
    case "Stroke Play Round":
      return "Stroke Play";
    case "Team Session":
      return "Four-Ball";
    default:
      // A round robin, a knockout and a single match are match play at a club.
      return "Match Play";
  }
}

/** Whether a round of this type can be played in this format. */
export function formatFitsRound(type: string, format: string): boolean {
  return isPlayable(format) && roundShapeMismatch(type, format) === null;
}

/**
 * The formats to offer for a round of `type`, in the catalogue's order.
 * `current` is the round's own format, shown even where it would not be offered.
 */
export function formatChoicesFor(type: string, current = ""): FormatChoice[] {
  const out: FormatChoice[] = [];
  for (const f of GOLF_FORMATS) {
    const offered = formatFitsRound(type, f.name) && !SAME_GAME_AS[f.name];
    if (!offered && f.name !== current) continue;
    const hint = HINTS[f.name];
    out.push({ name: f.name, label: hint ? `${f.name} — ${hint}` : f.name, group: isTeamFormat(f.name) ? "side" : "own" });
  }
  if (current && !out.some((c) => c.name === current)) {
    out.unshift({ name: current, label: current, group: isTeamFormat(current) ? "side" : "own" });
  }
  return out;
}

/**
 * HOW A NEW ROUND IS DECIDED: off handicap, as most club competitions are.
 *
 * Ajay, 2026-10-16: "made it default as the usual golf clubs play". A club's
 * medal, its Stableford and its knockout are played off handicap; a scratch
 * championship is the exception and says so with one tap on Gross. The round
 * was created on gross, so every new medal was a scratch medal unless somebody
 * opened Customize and found the choice. A Stableford round is net whatever is
 * asked (`basisFor`).
 */
export function newRoundBasis(format: string): string {
  return basisFor(format, "net");
}
