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
    if (leftMidRequest(page, String(e))) return;
    const where = new URL(page.url()).pathname;
    errors.push(`${who ? `${who} ` : ""}${where}: ${String(e)}`);
  });
  explainHydration(page, who);
}

/**
 * THE FRAMEWORK'S OWN REQUEST, DROPPED BECAUSE THE PAGE WAS LEFT — on WebKit
 * only, and only this one sentence (2026-10-11).
 *
 * When a spec opens another address while Next is still fetching a screen's
 * data or prefetching a link, Chromium drops the request and says nothing.
 * WebKit reports it as an error on the page being left: "Fetch API cannot load
 * <this site's own address> due to access control checks." Nothing failed and
 * nobody saw anything; a spec walks faster than a person.
 *
 * WHAT IS DELIBERATELY NOT IGNORED: "TypeError: Load failed". That is WebKit's
 * word for the same thing happening to a request the APP made and did not
 * catch, and the first run on this engine found three of those in the app's
 * own code — a rejection Safari raises and Chromium never did.
 */
function leftMidRequest(page: Page, message: string): boolean {
  if (page.context().browser()?.browserType().name() !== "webkit") return false;
  // This site's own host, so a request to anywhere ELSE that was refused is still an error.
  const host = new URL(page.url()).host;
  return message.includes("Fetch API cannot load") && message.includes("due to access control checks") && message.includes(host);
}

const explaining = new WeakSet<Page>();

/**
 * Have this page explain a hydration mismatch if one lands — once, however
 * many callers ask. `coverage.ts` asks for every page every spec opens, so a
 * spec (or a probe) that only collects the bare error still leaves the
 * explanation in the job log: on 2026-10-11 a #418 on /entry was recorded by a
 * probe as one line, "Minified React error #418", and nothing else.
 */
export function explainHydration(page: Page, who = ""): void {
  if (explaining.has(page)) return;
  explaining.add(page);
  page.on("pageerror", (e) => {
    if (String(e).includes("#418")) void explain(page, who || new URL(page.url()).pathname);
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

/**
 * WHICH ELEMENTS, when the text is the same (2026-10-11).
 *
 * React says what kind of mismatch it was — "…the server rendered HTML didn't
 * match…" is an ELEMENT that differs, not a word — and the text comparison
 * below answers "identical" to exactly that kind, which is the answer it gave
 * the one time this had fired with a recorder attached.
 *
 * So the elements are counted on each side, by tag and class, and the ones the
 * two sides disagree about are named. A count rather than a walk in order,
 * because the server's document is streamed: its late sections arrive in
 * hidden holders at the end and are moved into place, so the ORDER of the two
 * documents differs on every page and proves nothing. The holders themselves
 * are left out of the count.
 */
function elementCounts(html: string): Map<string, number> {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const counts = new Map<string, number>();
  for (const m of body.matchAll(/<([a-z][a-z0-9-]*)((?:\s[^>]*)?)>/gi)) {
    const tag = m[1].toLowerCase();
    const attrs = m[2] ?? "";
    // The streaming holders, and the document's own frame.
    if (tag === "template" || tag === "html" || tag === "head" || tag === "body" || tag === "meta" || tag === "link") continue;
    if (/\sid="S:\d+"/.test(attrs)) continue;
    const cls = /\sclass="([^"]*)"/.exec(attrs)?.[1]?.trim().split(/\s+/).sort().join(".") ?? "";
    const role = /\srole="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const key = `${tag}${cls ? `.${cls}` : ""}${role ? `[role=${role}]` : ""}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function elementsThatDiffer(served: string, shown: string): string[] {
  const a = elementCounts(served);
  const b = elementCounts(shown);
  const out: string[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const s = a.get(key) ?? 0;
    const c = b.get(key) ?? 0;
    if (s !== c) out.push(`${key}: server ${s}, client ${c}`);
  }
  return out.sort().slice(0, 16);
}

/**
 * Say what differed between the server's HTML and the page as it now stands.
 * Exported so that EVERY page a spec opens can be given it — the probes'
 * pages, and contexts made by hand, were recording the bare error and nothing
 * else (see `coverage.ts`).
 */
export async function explain(page: Page, who: string): Promise<void> {
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
    const elements = elementsThatDiffer(served, shown);
    const structure = elements.length
      ? `\n  elements the two disagree about:\n    ${elements.join("\n    ")}`
      : "\n  and the same elements, by tag and class";
    // Same text: the mismatch was in markup or attributes, or has gone by now.
    if (a === b) return console.log(`[hydration #418] ${who} ${url}\n  server and client text are identical${structure}`);
    console.log(
      `[hydration #418] ${who} ${url}\n  server: …${a.slice(Math.max(0, i - 80), i + 160)}…\n  client: …${b.slice(Math.max(0, i - 80), i + 160)}…${structure}`,
    );
  } catch (err) {
    console.log(`[hydration #418] ${who}: could not compare (${String(err)})`);
  }
}
