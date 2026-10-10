import type { Page } from "@playwright/test";

/**
 * A SCREEN THAT THREW, recorded the way every spec records it — and, for a
 * hydration mismatch, EXPLAINED (2026-10-10).
 *
 * React #418 ("the server rendered HTML didn't match the client") has struck
 * CI on at least five screens — /me, a knockout, /cup, /stages — never on the
 * same one twice and never on demand: six runs of the two specs it last hit,
 * against a dev server that prints the full diff, did not produce it once. A
 * production build says only "#418", so each occurrence has been re-run and
 * forgotten. CLAUDE.md: measure, don't guess.
 *
 * So the next occurrence reports itself. The moment a #418 lands, this fetches
 * the same URL again with the same cookies — the SERVER's HTML — and compares
 * its visible text with what the page now shows, logging where the two first
 * part. Not a perfect diff: the second fetch is a second render, and React has
 * re-rendered the tree on the client by then. But a clock, a locale or a
 * browser-only branch shows up as text that differs, which is the question.
 */
export function watchPageErrors(page: Page, errors: string[], who = ""): void {
  page.on("pageerror", (e) => {
    const where = new URL(page.url()).pathname;
    errors.push(`${who ? `${who} ` : ""}${where}: ${String(e)}`);
    if (String(e).includes("#418")) void explain(page, who || where);
  });
}

// Entities DECODED, not blanked: React writes an apostrophe as &#x27; and the
// serialised DOM writes it as is, so blanking them reported a false parting at
// the first apostrophe on the page.
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const text = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => NAMED[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();

async function explain(page: Page, who: string): Promise<void> {
  try {
    const url = page.url();
    const [served, shown] = await Promise.all([
      page.request.get(url, { headers: { "cache-control": "no-store" } }).then((r) => r.text()),
      page.content(),
    ]);
    const a = text(served);
    const b = text(shown);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
    // Same text: the mismatch was in markup or attributes, or has gone by now.
    if (a === b) return console.log(`[hydration #418] ${who} ${url}\n  server and client text are identical`);
    console.log(
      `[hydration #418] ${who} ${url}\n  server: …${a.slice(Math.max(0, i - 80), i + 160)}…\n  client: …${b.slice(Math.max(0, i - 80), i + 160)}…`,
    );
  } catch (err) {
    console.log(`[hydration #418] ${who}: could not compare (${String(err)})`);
  }
}
