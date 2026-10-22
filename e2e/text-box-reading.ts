/**
 * HOW THE TEXT-BOX CRAWL READS A SCREEN — the parts of `every-text-box.spec.ts` that decide a
 * verdict from what was measured, kept out of the browser so a unit test can hold them
 * (`src/lib/__tests__/text-box-reading.test.ts`).
 *
 * Each is here because the crawl once read a correct screen wrong, and a finding that is the
 * crawl's own is as costly as a missed one: it is chased in the app, or the crawl is not believed.
 * The first three rounds on GitHub (2026-10-21) reported eleven findings, the same eleven each time.
 * One was a fault in the app (Entries drew the home club its Add form took nowhere); ten were these
 * readings.
 */

/** Where something was on the screen, and how far the page had been scrolled when it was measured. */
export interface Placed {
  top: number;
  bottom: number;
  /** `window.scrollY` at the moment `top` and `bottom` were read. */
  scrollY: number;
}

/**
 * HOW FAR A REFUSAL IS FROM THE PRESS, ON THE PAGE — not on the screen.
 *
 * The press is measured before it is made and the refusal after it has appeared, and a refusal
 * that appears below the fold brings itself into view (`bringIntoView`), which scrolls the page.
 * Compared as two positions on the screen, a refusal printed directly under its box would read as
 * far from it as the page had moved. Both are put back on the page first. (Suspected on 2026-10-21
 * of the Prizes "223px", which turned out to be the wrong button — see `howItSaves` — and kept,
 * because the reading it replaces was wrong whenever a refusal scrolls.)
 */
export function refusalGap(press: Placed, refusal: Placed): number {
  const p = { top: press.top + press.scrollY, bottom: press.bottom + press.scrollY };
  const r = { top: refusal.top + refusal.scrollY, bottom: refusal.bottom + refusal.scrollY };
  return Math.max(0, r.top - p.bottom, p.top - r.bottom);
}

/**
 * WHAT IT MEANS THAT A BOX, JUST TYPED INTO, HOLDS SOMETHING ELSE: the box itself said no, where the
 * typing was — or, for too much, took what its limit allows.
 *
 * Emptying was left out of this, and Rounds & formats' "How many?" was reported silent: emptied, it
 * reads "1" at once (React draws the figure it holds back into the box), so there is nothing to leave
 * and nothing to send — the box has refused, beside the finger. Only the good try is never a refusal:
 * a good value the box changes is for `judge` to read after the save.
 */
export function heldInstead(t: string, typed: string, value: string): "cut" | "refused" | null {
  if (typed === value || typed === value.trim()) return null;
  if (t === "over-long") return "cut";
  if (t === "good") return null;
  return "refused";
}

/**
 * WHETHER A BOX HOLDS WHAT IT HELD, for putting it back. A figure box that held nothing and now
 * reads "0.00" holds the same thing: empty is nought, the rule `judge` already reads an emptied
 * figure by. A side game's stake held "" on a round with no game; the crawl made one, emptied the
 * box again, and the game it had made stayed on at nothing, drawn "0.00" — and was reported not put
 * back. Taking the game off is a delete, which the crawl never presses.
 */
export function holdsTheSame(kind: string, now: string, was: string): boolean {
  if (now === was) return true;
  if (kind !== "figure") return false;
  const read = (s: string) => (s.trim() === "" ? 0 : Number(s.trim().replace(",", ".")));
  const [a, b] = [read(now), read(was)];
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

/** What a screen shows: its words, and what its boxes hold (a box's value is not in `innerText`). */
export interface Shown {
  text: string;
  values: string[];
}

/**
 * WHETHER WHAT WAS TYPED INTO AN "ADD" FORM IS NOW ON THE SCREEN, AND WAS NOT BEFORE.
 *
 * Read from the words AND from what the boxes hold. Entries draws each player's address as the
 * value of that row's own box, which `innerText` does not include, so a row added with the address
 * typed was reported as added without it.
 */
export function newlyShown(typed: string, before: Shown, after: Shown): boolean {
  const probe = typed.trim().slice(0, 40);
  if (!probe) return false;
  const holds = (s: Shown) => s.text.includes(probe) || s.values.some((v) => v.includes(probe));
  return holds(after) && !holds(before);
}

/** The button the crawl matched to a box, and where the two sit. */
export interface Matched {
  /** What the button does: saves what is in its card, or adds what is in its form as a row. */
  how: "save" | "form";
  /** The button comes after the box in the page. */
  followsTheBox: boolean;
  /** The box and the button are in one `<form>`. */
  sameForm: boolean;
  /** The box and the button are in one card (`.card`, or a `section`). */
  sameCard: boolean;
  /** The box does something when it is left: React gave it an `onBlur`. */
  actsOnLeave: boolean;
}

/**
 * HOW A BOX IS SAVED, once the nearest button that saves or adds has been found for it.
 *
 * The crawl looks outward from a box for the nearest such button, the way a person would. On a long
 * screen the nearest can be another card's. Three readings of a correct screen came of taking it:
 *
 * - Side games: every stake box saves as it is left, and the nearest Add was "Add a sponsor" on a
 *   contest further down the card, which opens a form of its own. Pressed, the stake was saved by the
 *   blur and the crawl looked for a new row (two SILENT, one LOST), and its refusal was read as
 *   1,500px from "the press" (two REFUSED OUT OF VIEW).
 * - Prizes: a prize's amount saves as it is left, and the nearest Save was the skins pot's, in the
 *   card below. Pressed, the amount's refusal was said beside the amount, "223px from the press".
 * - "Add a game" above the stake boxes is the head of the card, not a form they are in.
 *
 * So: a box that acts when it is left is saved by leaving it, unless the button is its own form's
 * (one `<form>`) or, for a Save, its own card's. An Add-form's boxes do nothing when left; their
 * Add does. And an Add above a box, outside any form with it, is not the box's.
 */
export function howItSaves(m: Matched): "save" | "form" | "leave" {
  if (m.actsOnLeave && !m.sameForm && (m.how === "form" || !m.sameCard)) return "leave";
  if (m.how === "form" && !m.followsTheBox && !m.sameForm) return "leave";
  return m.how;
}

/**
 * THE "SPACES" TRY TYPES SOMETHING THE "GOOD" TRY DOES NOT.
 *
 * It was the good value with spaces round it, and a box that trims stores exactly the good value
 * — so the good try that followed typed what the box already held, nothing was sent (correctly:
 * nothing had changed), and the crawl called the box silent. `good` is what the good try will type.
 */
export function spacedValue(good: string, kind: string, maxLength: number): string {
  const room = maxLength > 0 ? Math.max(1, maxLength - 4) : 10_000;
  const other = kind === "email" ? good.replace("@", "-sp@") : `${good.replace(/\s+zz$/, "")} sp`;
  let inner = (other === good ? `${good}-sp` : other).slice(0, room);
  // A box with room for little more than the good value itself: change its last letter instead.
  if (inner === good.trim()) inner = `${inner.slice(0, -1)}${inner.endsWith("s") ? "t" : "s"}`;
  return `  ${inner}  `;
}
