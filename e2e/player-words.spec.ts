import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { seedCup, teardownCup } from "./cup-fixture.mjs";

/**
 * EVERY PLAYER SCREEN READS IN SHORT LINES — as several different players.
 *
 * Ajay, 2026-10-06: "I still do see some long explanations on the player side
 * screens. please double check". #797 had made every long sentence a short line
 * with the rest behind an ⓘ — measured on ONE player, in one state: an
 * individual round, no sides, no cup. A rendered sweep of four players found
 * ten sentences of 12 to 36 words still on screen, every one in a state that
 * player could not reach: a four-ball side's card, a gross team board, the cup,
 * an empty money screen, the round-code screen.
 *
 * So this walks every player screen as each of them, and asserts what a player
 * actually sees, not what a file contains:
 *
 *   - no visible sentence of 12 words or more,
 *   - no visible block of 25 words or more.
 *
 * The full explanations are still in the page, inside a closed `<details>`,
 * which is not rendered and so not counted. Words somebody else wrote — the
 * club's local rules, an announcement, a message — carry `data-authored` and
 * are left as written.
 */

const ROUTES = ["/me", "/me/card", "/me/board", "/me/money", "/me/messages", "/me/events", "/me/calendar", "/me/rules", "/play"];
const SENTENCE = 12;
const BLOCK = 25;

// Not serial: each player is its own test so one long sentence does not hide
// another player's. `seedCup` clears its own fixture first, so a worker that
// restarts after a failure seeds again cleanly.
let f: Awaited<ReturnType<typeof seedCup>>;
test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== "phone") return;
  f = await seedCup();
});
test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name !== "phone") return;
  await teardownCup();
});
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "wording does not change with the width of the screen");
});

type Long = { text: string; words: number; longest: number };
type Small = { text: string; px: number; floor: number };

/**
 * What a reader sees, block by block: every visible TEXT NODE, grouped under
 * its nearest block-level ancestor.
 *
 * The first version took "leaf" blocks — elements with no block child — and
 * so never read a sentence that shared its element with a block-level link:
 * the tie rule on Rules ran to 22 words beside its "under Committee
 * Procedures 5A" citation and passed (2026-10-06). Grouping text nodes by
 * their block reads mixed content as a reader does.
 *
 * And the TYPE it is set in (Ajay, 2026-10-06: "appropriate font sizes for
 * good visibility and reading"): a label at 13px or more, a sentence at 14 —
 * the floor #794 set, measured here off what the browser renders rather than
 * off a list of files, so a component nobody listed is read too.
 */
function readTheScreen(page: Page): Promise<{ long: Long[]; small: Small[] }> {
  return page.evaluate(
    ({ SENTENCE, BLOCK }) => {
      const inline = new Set(["inline", "inline-block", "inline-flex", "contents"]);
      const blockOf = (el: Element): Element => {
        let at: Element | null = el;
        while (at && at !== document.body) {
          if (at.tagName === "SUMMARY" || !inline.has(getComputedStyle(at).display)) return at;
          at = at.parentElement;
        }
        return document.body;
      };
      const texts = new Map<Element, string[]>();
      const sized: { block: Element; parent: Element; px: number }[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const parent = n.parentElement;
        if (!parent || !n.textContent?.trim()) continue;
        // `checkVisibility`, not `getClientRects`: a closed <details> hides its
        // content with content-visibility, which still leaves layout boxes, so
        // the explanation behind every ⓘ read as on screen.
        if (!parent.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        if (parent.closest("[data-authored], [data-brand], script, style, noscript")) continue;
        const block = blockOf(parent);
        texts.set(block, [...(texts.get(block) ?? []), n.textContent]);
        sized.push({ block, parent, px: parseFloat(getComputedStyle(parent).fontSize) });
      }
      const words = (s: string) => s.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
      const textOf = (b: Element) => (texts.get(b) ?? []).join("").replace(/\s+/g, " ").trim();
      const long: Long[] = [];
      for (const b of texts.keys()) {
        const text = textOf(b);
        const all = words(text);
        const longest = Math.max(0, ...text.split(/(?<=[.!?])\s+/).map(words));
        if (longest >= SENTENCE || all >= BLOCK) long.push({ text, words: all, longest });
      }
      const small: Small[] = [];
      const seen = new Set<Element>();
      for (const s of sized) {
        if (seen.has(s.parent)) continue;
        seen.add(s.parent);
        const text = textOf(s.block);
        const sentence = words(text) >= 5 && /[.!?]$/.test(text);
        const floor = sentence ? 14 : 13;
        if (s.px < floor - 0.01) small.push({ text: `${(s.parent.textContent ?? "").trim().slice(0, 60)} (in "${text.slice(0, 60)}")`, px: s.px, floor });
      }
      return { long, small };
    },
    { SENTENCE, BLOCK },
  );
}

async function sweep(page: Page, who: string, routes = ROUTES) {
  for (const route of routes) {
    const res = await page.goto(`${route}?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle");
    // A screen that did not render cannot be short: assert it arrived first.
    expect(res?.status(), `${who} ${route}`).toBe(200);
    await expect(page.locator("h1").first(), `${who} ${route} has a heading`).toBeVisible();
    const { long, small } = await readTheScreen(page);
    expect.soft(long, `${who} on ${route}: ${long.map((l) => `"${l.text}"`).join(" | ")}`).toEqual([]);
    expect.soft(small, `${who} on ${route}, under the floor: ${small.map((s) => `${s.px}px<${s.floor} ${s.text}`).join(" | ")}`).toEqual([]);
  }
}

async function asCup(page: Page, baseURL: string, who: string) {
  const c = (f.cookies as unknown as Record<string, { session: string; event: string }>)[who];
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: "ng_session", value: c.session, url: baseURL },
    { name: "ng_active_event", value: c.event, url: baseURL },
  ]);
}

function asStored(page: Page, file: string) {
  const s = JSON.parse(readFileSync(join(process.cwd(), ".e2e", file), "utf8"));
  return page.context().clearCookies().then(() => page.context().addCookies(s.cookies));
}

test("the scan sees a long paragraph when there is one (control)", async ({ page }) => {
  await asStored(page, "player.json");
  await page.goto(`/me?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    const p = document.createElement("p");
    p.textContent = "This sentence has been planted here to prove that the scan is able to see a long one.";
    document.querySelector("main")!.appendChild(p);
    const q = document.createElement("p");
    q.setAttribute("data-authored", "");
    q.textContent = "And this one is somebody else's words, which the scan leaves exactly as they were written.";
    document.querySelector("main")!.appendChild(q);
    // A long sentence sharing its element with a block-level child — the
    // shape the first scanner could not read.
    const mixed = document.createElement("div");
    mixed.append("Countback on the last nine, then the last six, then the last three, then the final hole.");
    const cite = document.createElement("a");
    cite.style.display = "flex";
    cite.textContent = "under a rule";
    mixed.appendChild(cite);
    document.querySelector("main")!.appendChild(mixed);
    // And small type: a sentence at 11px, which the floor puts at 14.
    const tiny = document.createElement("p");
    tiny.style.fontSize = "11px";
    tiny.textContent = "Planted small.";
    document.querySelector("main")!.appendChild(tiny);
  });
  const { long, small } = await readTheScreen(page);
  expect(long.map((l) => l.text)).toEqual(
    expect.arrayContaining([
      "This sentence has been planted here to prove that the scan is able to see a long one.",
      "Countback on the last nine, then the last six, then the last three, then the final hole.",
    ]),
  );
  expect(long.map((l) => l.text).join(" ")).not.toContain("somebody else's words");
  expect(small.map((s) => s.px)).toContain(11);
});

test("an individual entrant", async ({ page }) => {
  await asStored(page, "player.json");
  await sweep(page, "an individual entrant");
});

test("a league member, whose round is played in sides", async ({ page }) => {
  await asStored(page, "league-member.json");
  await sweep(page, "a league member");
});

test("a cup player, before and after their session is announced, and one sitting it out", async ({ page, baseURL }) => {
  await asCup(page, baseURL!, "a1");
  await sweep(page, "a cup player, nothing announced");

  await asCup(page, baseURL!, "organizer");
  await page.goto(`/cup?bust=${Date.now()}`);
  const card = page.getByRole("region", { name: "Saturday four-balls lineup" });
  for (const [i, n] of ["Ailsa Blue", "Bram Blue"].entries()) {
    await card.getByLabel(`Blues player ${i + 1}, Saturday four-balls`).selectOption({ label: n });
  }
  for (const [i, n] of ["Edda White", "Finn White"].entries()) {
    await card.getByLabel(`Whites player ${i + 1}, Saturday four-balls`).selectOption({ label: n });
  }
  await card.getByRole("button", { name: "Add match" }).click();
  await expect(card.getByRole("listitem", { name: "Ailsa Blue & Bram Blue v Edda White & Finn White" })).toBeVisible({ timeout: 20_000 });
  await card.getByRole("button", { name: "Announce lineup" }).click();
  await card.getByRole("button", { name: "Announce to everyone" }).click();
  await expect(card.getByText("Announced", { exact: true })).toBeVisible({ timeout: 20_000 });

  await asCup(page, baseURL!, "a1");
  await sweep(page, "a cup player in the four-ball");
  await asCup(page, baseURL!, "b4");
  await sweep(page, "a cup player sitting the four-ball out");

  // The board a club sends its members, opened from a link with no session —
  // read on the same phones, so held to the same lines and the same type.
  await page.context().clearCookies();
  await sweep(page, "a member opening the public board", [`/live/${f.shareToken}`]);
});
