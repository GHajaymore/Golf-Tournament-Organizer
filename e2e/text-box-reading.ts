/**
 * HOW THE TEXT-BOX CRAWL READS A SCREEN — the parts of `every-text-box.spec.ts` that decide a
 * verdict from what was measured, kept out of the browser so a unit test can hold them
 * (`src/lib/__tests__/text-box-reading.test.ts`).
 *
 * Each is here because the crawl once read a correct screen wrong, and a finding that is the
 * crawl's own is as costly as a missed one: it is chased in the app, or the crawl is not believed.
 * The first three rounds on GitHub (2026-10-21) reported eleven findings; four were faults in the
 * app and seven were these readings.
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
 * Compared as two positions on the screen, a refusal printed directly under its box read as 223px
 * from it: the distance the page had moved. Both are put back on the page first.
 */
export function refusalGap(press: Placed, refusal: Placed): number {
  const p = { top: press.top + press.scrollY, bottom: press.bottom + press.scrollY };
  const r = { top: refusal.top + refusal.scrollY, bottom: refusal.bottom + refusal.scrollY };
  return Math.max(0, r.top - p.bottom, p.top - r.bottom);
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

/**
 * WHETHER AN "ADD" BUTTON IS THE BOX'S OWN FORM'S.
 *
 * A form's Add comes after the boxes it adds, or shares a `<form>` with them. An Add found ABOVE a
 * box, outside any form with it, belongs to something else: "Add a game" at the head of the side
 * games card is a disclosure for a new contest, and the stake boxes below it save as they are left.
 * Taken as their form, the crawl pressed "Add a game", read the stake's refusal as 412px from the
 * press, and looked for a new row that the stake was never going to make.
 */
export function addBelongsToBox(at: { followsTheBox: boolean; sameForm: boolean }): boolean {
  return at.followsTheBox || at.sameForm;
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
