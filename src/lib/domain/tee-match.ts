/**
 * Turning what a golfer TYPED into the set they play from.
 *
 * Registration and the CSV import both collect a preferred tee as free text —
 * "white", "the blues", "Championship tees" — and until now nothing ever
 * turned that into a `Tee.id`. The text sat on the row and the player was
 * scored off whatever the round's default was, so a field that had all told
 * you which tees they wanted was quietly ignored.
 *
 * The one rule this file exists to hold: AN AMBIGUOUS ANSWER IS NOT AN
 * ANSWER. Two sets matching means the app does not know, and a guess between
 * them is a wrong Course Handicap for the whole event — invisible, because
 * the number looks like a number. Unmatched and ambiguous both resolve to
 * null, which means "the round's tees" and is a thing an organizer can see
 * and correct on the field screen.
 */

/**
 * What a tee name means, ignoring how it was written.
 *
 * Golfers do not type the name off the card. They write "the blues" for Blue,
 * "white tees" for White, "champ" for nothing at all. Case, articles, the
 * word "tee(s)" and punctuation are all noise; a trailing plural is noise on
 * a colour and meaningful almost nowhere.
 */
function normalise(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^the\s+/, "");
  s = s.replace(/\s*\btees?\b\s*$/, "");
  s = s.replace(/[^a-z0-9]+/g, "");
  // Plural last, so a set actually named "Reds" still matches itself exactly
  // at the earlier stage before this ever runs.
  s = s.replace(/s$/, "");
  return s;
}

/**
 * Which of these tees the text means, or null when it is not certain.
 *
 * Tried in order of confidence: written exactly, then normalised. A stage
 * that produces more than one candidate stops and returns null rather than
 * taking the first — the order tees happen to be in is not evidence.
 */
export function matchTee(
  text: string | null | undefined,
  tees: ReadonlyArray<{ id: string; name: string }>,
): string | null {
  const raw = (text ?? "").trim();
  if (!raw || tees.length === 0) return null;

  const exact = tees.filter((t) => t.name.trim().toLowerCase() === raw.toLowerCase());
  if (exact.length === 1) return exact[0].id;
  // Two sets genuinely called the same thing is a card problem, not something
  // to resolve by picking one.
  if (exact.length > 1) return null;

  const wanted = normalise(raw);
  if (!wanted) return null;
  const loose = tees.filter((t) => normalise(t.name) === wanted);
  return loose.length === 1 ? loose[0].id : null;
}
