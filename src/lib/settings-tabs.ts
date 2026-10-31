/**
 * The rules of a settings screen shown one section at a time — the parts of
 * `SettingsTabs` that are decisions rather than DOM, so they can be held to a
 * test without a browser.
 *
 * Club settings was seven sections stacked, about nine phone screens tall
 * (Ajay, 2026-10-21: "go with your recommendations and change the structure
 * as needed"). It is a row of tabs now, each section on its own, and every
 * section still MOUNTED — see `SettingsTabs.tsx` for why that matters.
 */

/**
 * Which section a URL's hash asks for.
 *
 * The hash is the address of a section and always has been: `/organization#plan`
 * is what "Upgrade to keep it", Stripe's return address and the join email all
 * send people to. So it picks the tab, and a hash the page does not know — an
 * old bookmark, a typo, `#top` — is the first section, never an empty page.
 */
export function tabFromHash(hash: string, ids: readonly string[]): string {
  const want = decodeURIComponent(hash.replace(/^#/, "")).trim();
  return ids.includes(want) ? want : (ids[0] ?? "");
}

/**
 * Where an arrow key takes the focus along the tabs (the WAI-ARIA tabs
 * pattern): Left and Right step and wrap round, Home and End go to the ends.
 * Null for any other key, which the bar leaves alone.
 */
export function tabAfterKey(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
      return (index + 1) % count;
    case "ArrowLeft":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * Whether words drawn in the danger colour read as a REFUSAL, not a figure.
 *
 * The same rule `e2e/coverage.ts` watches every press with, so the app and the
 * suite agree on what a refusal looks like: a sentence — letters, more than
 * one word — of a length a message has. "-$13.34" is red and owed, not refused.
 */
export function readsAsRefusal(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length < 6 || t.length > 400) return false;
  return t.replace(/[^A-Za-z]/g, "").length >= 8 && t.includes(" ");
}
