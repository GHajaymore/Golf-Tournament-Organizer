import { test, expect, type Page } from "./coverage";
import { consoleScreens, playerScreens } from "./routes";

/**
 * WHAT A SEARCH ENGINE — AND SOMEBODY PASTING A LINK INTO A MESSAGE — IS GIVEN.
 *
 * The four pages anybody may read (the front door, the questions page, privacy
 * and terms) are the whole of what TourneyHQ offers a crawler, and nothing had
 * ever fetched them the way a crawler does: the pieces were tested where they
 * are written (`structured-data.test.ts`, `public-surface.test.ts`), and a page
 * can be given a perfect title by code that a later layout quietly overrides.
 * So this reads the SERVED pages:
 *
 *   found        each public page answers 200, says which language it is in,
 *                has one heading, a title and a description of its own, and
 *                names itself as the page to index (a canonical address that
 *                is absolute and its own)
 *   shared       the card a link unfurls into: a title, a description and a
 *                picture that is really there
 *   understood   the structured data on a page parses, and says what it is
 *   mapped       the sitemap lists exactly the public pages, by absolute
 *                address, and robots.txt answers
 *   kept out     every screen behind a sign-in, and every page reached by a
 *                private link (a live board, an entry form), tells crawlers
 *                not to index it — those carry members' names
 *   not broken   every link on a public page to another page of this site
 *                goes somewhere
 *
 * Ajay, 2026-10-13: "as well as SEO and anything you can think of."
 *
 * WHAT THIS CANNOT SEE: how the pages rank, what a crawler makes of the
 * wording, or production's own address — the canonical here is whatever origin
 * the build was told it lives at. Speed is measured by `weight.spec.ts`.
 *
 * One project for the reading; the pictures and the tap targets of these pages
 * are measured at every size by the landing specs.
 */

// /interest since 2026-10-21: the early-list form is a public page, in the sitemap and allowed to crawlers.
const PUBLIC = ["/", "/faq", "/privacy", "/terms", "/interest"];

type Head = {
  status: number;
  lang: string;
  title: string;
  description: string;
  canonical: string;
  robots: string;
  h1: number;
  og: Record<string, string>;
  twitterCard: string;
  jsonLd: string[];
  links: string[];
  imagesWithoutAlt: string[];
};

async function head(page: Page, path: string): Promise<Head> {
  const res = await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const read = await page.evaluate(() => {
    const meta = (sel: string) => document.querySelector<HTMLMetaElement>(sel)?.content?.trim() ?? "";
    const og: Record<string, string> = {};
    document.querySelectorAll<HTMLMetaElement>('meta[property^="og:"]').forEach((m) => (og[m.getAttribute("property")!.slice(3)] = m.content));
    return {
      lang: document.documentElement.lang,
      title: document.title.trim(),
      description: meta('meta[name="description"]'),
      canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? "",
      robots: meta('meta[name="robots"]'),
      h1: document.querySelectorAll("h1").length,
      og,
      twitterCard: meta('meta[name="twitter:card"]'),
      jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((s) => s.textContent ?? ""),
      links: Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).map((a) => a.getAttribute("href") ?? ""),
      // A picture with NO alt at all is one a screen reader announces by its file name. An empty alt is the
      // proper way to say "scenery", and whether a picture that is read says the right thing is a11y.spec's.
      imagesWithoutAlt: Array.from(document.images)
        .filter((i) => !i.hasAttribute("alt"))
        .map((i) => (i.currentSrc || i.src).split("/").pop() ?? ""),
    };
  });
  return { status: res?.status() ?? 0, ...read };
}

const only = (name: string) => test.skip(name !== "desktop", "one project: a crawler has no screen");

test("each public page can be found: a language, one heading, a title, a description and its own address", async ({ page }, testInfo) => {
  only(testInfo.project.name);
  const faults: string[] = [];
  const titles = new Map<string, string>();
  const descriptions = new Map<string, string>();
  for (const path of PUBLIC) {
    const h = await head(page, path);
    if (h.status !== 200) faults.push(`${path}: answered ${h.status}`);
    if (!/^[a-z]{2}(-[A-Za-z]{2})?$/.test(h.lang)) faults.push(`${path}: does not say which language it is in (lang="${h.lang}")`);
    if (h.h1 !== 1) faults.push(`${path}: has ${h.h1} main headings`);
    if (h.title.length < 15 || h.title.length > 70) faults.push(`${path}: its title is ${h.title.length} characters ("${h.title}") — a result shows about 60`);
    if (h.description.length < 70 || h.description.length > 180) faults.push(`${path}: its description is ${h.description.length} characters — a result shows about 155`);
    if (titles.has(h.title)) faults.push(`${path}: has the same title as ${titles.get(h.title)}`);
    if (descriptions.has(h.description)) faults.push(`${path}: has the same description as ${descriptions.get(h.description)}`);
    titles.set(h.title, path);
    descriptions.set(h.description, path);
    // The page to index is this page, by its whole address.
    let canon: URL | null = null;
    try {
      canon = new URL(h.canonical);
    } catch {
      faults.push(`${path}: names no page to index (canonical "${h.canonical}")`);
    }
    if (canon && canon.pathname.replace(/\/$/, "") !== path.replace(/\/$/, "")) faults.push(`${path}: says the page to index is ${canon.pathname}`);
    if (canon && canon.search) faults.push(`${path}: its canonical address carries a query (${canon.search})`);
    if (/noindex/i.test(h.robots)) faults.push(`${path}: tells crawlers not to index it`);
    for (const name of h.imagesWithoutAlt) faults.push(`${path}: the picture ${name} has no words for somebody who cannot see it`);
  }
  expect(faults, faults.join("\n")).toEqual([]);
});

test("a link to a public page unfurls into a card: a title, a description and a picture that is there", async ({ page, request }, testInfo) => {
  only(testInfo.project.name);
  const faults: string[] = [];
  const pictures = new Set<string>();
  for (const path of PUBLIC) {
    const h = await head(page, path);
    for (const key of ["title", "description", "image", "type", "url"]) if (!h.og[key]) faults.push(`${path}: its share card has no ${key}`);
    if (!h.twitterCard) faults.push(`${path}: says nothing about how to draw its card on X`);
    if (h.og.image) {
      if (!/^https?:\/\//.test(h.og.image)) faults.push(`${path}: its share picture is not a whole address (${h.og.image})`);
      else pictures.add(new URL(h.og.image).pathname + new URL(h.og.image).search);
    }
    if (h.og.url && !/^https?:\/\//.test(h.og.url)) faults.push(`${path}: its share address is not a whole address (${h.og.url})`);
  }
  // The picture itself, from THIS server (the card names the production address; the picture is the same route).
  expect(pictures.size, "no page names a share picture").toBeGreaterThan(0);
  for (const pic of pictures) {
    const res = await request.get(pic);
    if (res.status() !== 200) faults.push(`the share picture ${pic} answers ${res.status()}`);
    else if (!/^image\//.test(res.headers()["content-type"] ?? "")) faults.push(`the share picture ${pic} is sent as ${res.headers()["content-type"]}`);
    else if ((await res.body()).length < 5_000) faults.push(`the share picture ${pic} is ${(await res.body()).length} bytes — an empty picture`);
  }
  expect(faults, faults.join("\n")).toEqual([]);
});

test("the structured data on a public page parses, and says what it is", async ({ page }, testInfo) => {
  only(testInfo.project.name);
  const faults: string[] = [];
  let blocks = 0;
  for (const path of PUBLIC) {
    const h = await head(page, path);
    for (const raw of h.jsonLd) {
      blocks += 1;
      try {
        const data = JSON.parse(raw);
        const things = Array.isArray(data) ? data : data["@graph"] ?? [data];
        for (const thing of things) {
          if (!thing["@type"]) faults.push(`${path}: a block of structured data does not say what it is`);
        }
        if (!String(data["@context"] ?? things[0]?.["@context"] ?? "").includes("schema.org")) faults.push(`${path}: structured data without the schema.org vocabulary`);
      } catch (e) {
        faults.push(`${path}: structured data that does not parse — ${String(e).slice(0, 80)}`);
      }
    }
  }
  // CONTROL: the front door and the questions page both carry some; a check of nothing would pass.
  expect(blocks, "no public page carries any structured data").toBeGreaterThanOrEqual(2);
  expect(faults, faults.join("\n")).toEqual([]);
});

test("the sitemap lists exactly the public pages, and robots.txt answers", async ({ request }, testInfo) => {
  only(testInfo.project.name);
  const map = await request.get("/sitemap.xml");
  expect(map.status()).toBe(200);
  const xml = await map.text();
  const listed = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(listed.length, "the sitemap lists nothing").toBeGreaterThan(0);
  for (const loc of listed) expect(loc, "a sitemap address must be whole").toMatch(/^https?:\/\//);
  const paths = listed.map((l) => new URL(l).pathname.replace(/\/$/, "") || "/").sort();
  expect(paths, "the sitemap and the public pages are not the same list").toEqual([...PUBLIC].sort());
  // Every address it lists is a page here.
  for (const p of paths) expect((await request.get(p)).status(), `${p} is in the sitemap and does not answer`).toBe(200);

  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  const text = await robots.text();
  expect(text).toMatch(/User-Agent: \*/i);
  // Whichever way this build answers (production allows the public pages; anything else keeps crawlers out
  // altogether), it must never allow what is private. `public-surface.test.ts` holds both answers at the source.
  expect(text).toMatch(/Disallow: \//i);
  for (const line of text.split("\n")) {
    if (/^Allow:/i.test(line)) expect(line.replace(/^Allow:\s*/i, "").trim(), "robots.txt allows something that is not a public page").toMatch(/^\/(privacy|faq|terms|interest)?$/);
  }
});

test("a screen behind a sign-in, or reached by a private link, tells crawlers to keep out", async ({ browser, baseURL }, testInfo) => {
  only(testInfo.project.name);
  test.setTimeout(240_000);
  const faults: string[] = [];
  const check = async (state: string | undefined, paths: string[], who: string) => {
    const context = await browser.newContext(state ? { storageState: state } : {});
    const page = await context.newPage();
    let stayed = 0;
    for (const path of paths) {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => null);
      if (!res || new URL(page.url()).pathname !== path.split("?")[0]) continue; // sent elsewhere: nothing here to index
      stayed += 1;
      const robots = await page.locator('meta[name="robots"]').first().getAttribute("content").catch(() => null);
      const header = res.headers()["x-robots-tag"] ?? "";
      if (!/noindex/i.test(robots ?? "") && !/noindex/i.test(header)) faults.push(`${who} ${path}: nothing tells a crawler not to index it`);
    }
    await context.close();
    return stayed;
  };
  const data = JSON.parse((await import("node:fs")).readFileSync(".e2e/data.json", "utf8")) as { shareToken: string };
  const asOrganizer = await check(".e2e/organizer.json", consoleScreens(), "organizer");
  const asPlayer = await check(".e2e/player.json", playerScreens(), "player");
  const byLink = await check(undefined, [`/live/${data.shareToken}`, `/live/${data.shareToken}/rules`, "/play", "/reset-password"], "by link");
  // CONTROL: the screens were really opened.
  expect(asOrganizer, "the organizer's screens did not open — not signed in?").toBeGreaterThan(15);
  expect(asPlayer, "the player's screens did not open").toBeGreaterThan(3);
  expect(byLink, "the public board did not open").toBeGreaterThan(0);
  expect(baseURL).toBeTruthy();
  expect(faults, faults.join("\n")).toEqual([]);
});

test("every link on a public page to another page of this site goes somewhere", async ({ page, request }, testInfo) => {
  only(testInfo.project.name);
  const seen = new Map<string, string>();
  for (const path of PUBLIC) {
    const h = await head(page, path);
    for (const href of h.links) {
      if (!href.startsWith("/") || href.startsWith("//")) continue;
      const clean = href.split("#")[0];
      if (clean && !seen.has(clean)) seen.set(clean, path);
    }
  }
  expect(seen.size, "the public pages link nowhere").toBeGreaterThan(4);
  const faults: string[] = [];
  for (const [href, from] of seen) {
    const res = await request.get(href, { maxRedirects: 5 });
    if (res.status() >= 400) faults.push(`${from} links to ${href}, which answers ${res.status()}`);
  }
  expect(faults, faults.join("\n")).toEqual([]);
});
