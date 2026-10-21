import type { BrowserContext, Page } from "@playwright/test";

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
  // Two wordings of it: a data fetch ("Fetch API cannot load …") and the service worker's script,
  // whose registration the app already catches ("Cannot load …/sw.js …", iPhone, 2026-10-21).
  const dropped = message.includes("Fetch API cannot load") || message.includes("Cannot load ");
  return dropped && message.includes("due to access control checks") && message.includes(host);
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
  /**
   * A MISMATCH MADE ON PURPOSE IS NOT A FINDING. `hydration-recorder.spec`
   * makes one to prove this recorder records, and a round counts every line
   * marked "[hydration #418]" as a fault in the app — so the first round with
   * that spec in it read six mismatches and could never have been clean. The
   * spec says so on the page before it loads, and the line is marked for what
   * it is.
   */
  const onPurpose = await page
    .evaluate(() => (window as unknown as { __thqMismatchOnPurpose?: boolean }).__thqMismatchOnPurpose === true)
    .catch(() => false);
  const mark = onPurpose ? "[hydration mismatch made on purpose]" : "[hydration #418]";
  try {
    const url = page.url();
    const [served, shown] = await Promise.all([
      page.request.get(url, { headers: { "cache-control": "no-store" } }).then((r) => r.text()),
      page.content(),
    ]);
    // What the page looked like at the instant React replaced it — the one comparison that is of the
    // FIRST response and not of a second. See `keepWhatTheServerSent`.
    const parted = await whereTheyPart(page).catch((err) => `could not read what was kept (${String(err)})`);
    const kept = parted ?? "nothing was kept — the page was not cleared from <html> or <body>, so one section was redrawn, not the page";
    console.log(`${mark} ${who} ${url}\n  at the moment it was replaced: ${kept}`);
    const a = text(served);
    const b = text(shown);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
    const elements = elementsThatDiffer(served, shown);
    const structure = elements.length
      ? `\n  elements the two disagree about:\n    ${elements.join("\n    ")}`
      : "\n  and the same elements, by tag and class";
    // Same text: the mismatch was in markup or attributes, or has gone by now.
    if (a === b) return console.log(`${mark} ${who} ${url}\n  server and client text are identical${structure}`);
    console.log(
      `${mark} ${who} ${url}\n  server: …${a.slice(Math.max(0, i - 80), i + 160)}…\n  client: …${b.slice(Math.max(0, i - 80), i + 160)}…${structure}`,
    );
  } catch (err) {
    console.log(`${mark} ${who}: could not compare (${String(err)})`);
  }
}

/**
 * THE PAGE AS IT STOOD AT THE MOMENT THE BROWSER GAVE UP ON IT (2026-10-12).
 *
 * `explain` above compares a SECOND request for the page with the page as it
 * now stands, and the third time this fault struck with a recorder attached —
 * /me/rules, in a counted round — that comparison said what it had said
 * before: the same text, the same elements by tag and class. Of course it did.
 * By then the browser had thrown the server's HTML away and drawn the whole
 * page again itself, and a second request is a second render. Whatever
 * differed was in the FIRST response, for the moment before React replaced it,
 * and nothing was looking then.
 *
 * So something looks then. When React cannot hydrate a page it clears the
 * document and renders it afresh, and clearing the document is a
 * `removeChild` on <html> or <body>. This runs before any of the page's own
 * script and keeps the document's markup the first time a piece of real
 * content is removed from either — the server's page, exactly as the browser
 * had parsed it, with how far the document had loaded. It costs one comparison
 * per `removeChild` and keeps nothing on a page that hydrates.
 *
 * NOT kept for: a script, style, link, template or streaming holder leaving
 * (the framework moves those on every page), or anything after the first
 * fifteen seconds (a toast or a dialog leaving <body> is not a page being
 * thrown away).
 *
 * AND WHAT LED UP TO IT (later the same day). The first time this caught the
 * fault for real — /cup, in CI, 124ms into the page — it answered the question
 * it was built for and the answer was "nothing": at the instant React cleared
 * the page, the page was already, element for element and word for word, the
 * page it was redrawn as. So the difference is not IN the page the server
 * sent; it is something that was true for a moment while the browser was
 * first reading it. A snapshot cannot show a moment that has passed. So this
 * also keeps a short log of every change made to the document before then —
 * what was added or taken out, where, and when — and three facts about the
 * snapshot that the element walk leaves out on purpose: the streamed sections
 * still waiting to be moved into place, the loading boundaries still showing
 * their fallback, and when the document finished arriving.
 */
export async function keepWhatTheServerSent(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const w = window as unknown as {
      __thqServed?: { html: string; at: number; ready: string; removed: string };
      __thqChanges?: string[];
    };
    // Every change to the document in its first seconds, as "ms what where". Capped, and stopped
    // once the page has settled: this is a record of a beginning, not a monitor.
    const changes: string[] = (w.__thqChanges = []);
    const name = (n: Node | null | undefined): string => {
      if (!n) return "nothing";
      if (n.nodeType === 3) return "text";
      if (n.nodeType === 8) return "<!--" + ((n as Comment).data ?? "").slice(0, 8) + "-->";
      if (n.nodeType !== 1) return "node";
      const el = n as Element;
      const cls = typeof el.className === "string" && el.className ? "." + el.className.trim().split(" ")[0] : "";
      return "<" + el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + cls + ">";
    };
    try {
      const watcher = new MutationObserver((records) => {
        const at = Math.round(performance.now());
        for (const r of records) {
          if (changes.length >= 600) return watcher.disconnect();
          if (r.type === "childList") {
            const added = Array.from(r.addedNodes).map(name).slice(0, 4).join(" ");
            const removed = Array.from(r.removedNodes).map(name).slice(0, 4).join(" ");
            changes.push(at + "ms in " + name(r.target) + ":" + (added ? " +" + added : "") + (removed ? " -" + removed : ""));
          } else if (r.type === "characterData") {
            changes.push(at + "ms text changed in " + name(r.target.parentNode));
          }
        }
        if (at > 15_000) watcher.disconnect();
      });
      watcher.observe(document, { childList: true, subtree: true, characterData: true });
    } catch {
      /* a recorder never breaks the page it is recording */
    }
    const original = Node.prototype.removeChild;
    Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
      try {
        if (!w.__thqServed && (this === document.body || this === document.documentElement) && child.nodeType === 1 && performance.now() < 15_000) {
          const el = child as unknown as Element;
          const tag = el.tagName;
          const plumbing =
            tag === "SCRIPT" || tag === "STYLE" || tag === "LINK" || tag === "TEMPLATE" || tag === "META" || tag === "TITLE" ||
            tag === "NEXT-ROUTE-ANNOUNCER" || (el.hasAttribute("hidden") && el.id.startsWith("S:"));
          if (!plumbing) {
            w.__thqServed = {
              html: document.documentElement.outerHTML,
              at: Math.round(performance.now()),
              ready: document.readyState,
              removed: `<${tag.toLowerCase()}${el.id ? `#${el.id}` : ""}${typeof el.className === "string" && el.className ? `.${el.className.trim().split(" ")[0]}` : ""}>`,
            };
          }
        }
      } catch {
        /* a recorder never breaks the page it is recording */
      }
      return original.call(this, child) as T;
    };
  });
}

/**
 * Where the page the server sent and the page the browser drew first part,
 * walked in order from <body>. In order is right HERE, though `elementCounts`
 * refuses it for a second request: this is one document compared with what
 * replaced it, in the same browser, after the streamed sections have been
 * moved into place or not on both sides alike.
 *
 * Left out of the walk on both sides: comments, blank text, scripts, styles,
 * the streaming holders, the route announcer, and the hidden fields a
 * server-rendered form carries for its action (the browser's own drawing has
 * none, which is not a difference anybody sees).
 */
export async function whereTheyPart(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const kept = (window as unknown as { __thqServed?: { html: string; at: number; ready: string; removed: string } }).__thqServed;
    if (!kept) return null;
    const served = new DOMParser().parseFromString(kept.html, "text/html");
    const skipped = (n: Node): boolean => {
      if (n.nodeType === 8) return true;
      if (n.nodeType === 3) return !(n as Text).data.trim();
      if (n.nodeType !== 1) return true;
      const el = n as Element;
      const tag = el.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "LINK" || tag === "TEMPLATE" || tag === "META" || tag === "NEXT-ROUTE-ANNOUNCER") return true;
      if (el.hasAttribute("hidden") && el.id.startsWith("S:")) return true;
      return tag === "INPUT" && (el as HTMLInputElement).type === "hidden" && ((el as HTMLInputElement).name ?? "").startsWith("$ACTION");
    };
    const label = (n: Node | undefined): string => {
      if (!n) return "nothing";
      if (n.nodeType === 3) return `"${(n as Text).data.trim().slice(0, 50)}"`;
      const el = n as Element;
      const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
      return `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls}>`;
    };
    const found: string[] = [];
    const walk = (a: Node, b: Node, path: string): void => {
      if (found.length >= 5) return;
      const ka = Array.from(a.childNodes).filter((n) => !skipped(n));
      const kb = Array.from(b.childNodes).filter((n) => !skipped(n));
      for (let i = 0; i < Math.max(ka.length, kb.length); i += 1) {
        const x = ka[i];
        const y = kb[i];
        if (!x || !y || x.nodeType !== y.nodeType || (x.nodeType === 1 && (x as Element).tagName !== (y as Element).tagName)) {
          const around = (list: Node[]) => list.slice(Math.max(0, i - 1), i + 2).map((n) => label(n)).join(" ");
          found.push(`${path}, child ${i + 1}: the server sent ${label(x)}, the browser drew ${label(y)}\n      server there: ${around(ka) || "nothing"}\n      browser there: ${around(kb) || "nothing"}`);
          return;
        }
        if (x.nodeType === 3) {
          if ((x as Text).data.trim() !== (y as Text).data.trim()) found.push(`${path}: the server wrote ${label(x)}, the browser ${label(y)}`);
          continue;
        }
        walk(x, y, `${path} > ${label(x)}`);
        if (found.length >= 5) return;
      }
    };
    walk(served.body, document.body, "body");
    const when = `kept ${kept.at}ms into the page, document "${kept.ready}", as React removed ${kept.removed}`;
    // What the walk above leaves out on purpose, counted: sections streamed in and not yet moved
    // into place, and loading boundaries by the state their marker gives ($ shown, $? waiting, $! given up).
    const holders = Array.from(served.querySelectorAll("[hidden]")).filter((el) => el.id.startsWith("S:")).length;
    const marks = { shown: 0, waiting: 0, gaveUp: 0 };
    const seek = served.createTreeWalker(served, NodeFilter.SHOW_COMMENT);
    for (let c = seek.nextNode(); c; c = seek.nextNode()) {
      const d = (c as Comment).data;
      if (d === "$") marks.shown += 1;
      else if (d === "$?") marks.waiting += 1;
      else if (d === "$!") marks.gaveUp += 1;
    }
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const arrived = nav
      ? `the document finished arriving at ${Math.round(nav.responseEnd)}ms and was parsed by ${Math.round(nav.domInteractive)}ms`
      : "no navigation timing";
    const streaming = `${holders} streamed section(s) not yet in place; loading boundaries: ${marks.shown} shown, ${marks.waiting} waiting, ${marks.gaveUp} given up; ${arrived}`;
    // The changes made to the document before it was cleared — the last thirty, which is the half
    // second that matters. Anything here that is not the framework's own plumbing is the lead.
    const all = (window as unknown as { __thqChanges?: string[] }).__thqChanges ?? [];
    const before = all.filter((line) => Number.parseInt(line, 10) <= kept.at);
    const gap = "\n      ";
    const led = before.length
      ? `\n    the ${Math.min(30, before.length)} change(s) before it, of ${before.length}:${gap}${before.slice(-30).join(gap)}`
      : "\n    and nothing had changed the document before it";
    const tail = `\n    ${streaming}${led}`;
    return found.length
      ? `${when}\n    ${found.join("\n    ")}${tail}`
      : `${when}\n    and from <body> down the two are the same, element for element and word for word${tail}`;
  });
}
