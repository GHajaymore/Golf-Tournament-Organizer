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

/** Every visible leaf block on the page whose words run long. */
function longBlocks(page: Page): Promise<Long[]> {
  return page.evaluate(
    ({ SENTENCE, BLOCK }) => {
      const inline = new Set(["inline", "inline-block", "inline-flex", "contents"]);
      const out: Long[] = [];
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        if (!(el instanceof HTMLElement) || !el.getClientRects().length) continue;
        if (el.closest("[data-authored]")) continue;
        if (inline.has(getComputedStyle(el).display) && el.tagName !== "SUMMARY") continue;
        const blockKid = Array.from(el.children).some(
          (k) => k instanceof HTMLElement && !inline.has(getComputedStyle(k).display) && k.innerText.trim(),
        );
        if (blockKid) continue;
        const text = el.innerText.replace(/\s+/g, " ").trim();
        if (!text) continue;
        const words = text.split(" ").length;
        const longest = Math.max(...text.split(/(?<=[.!?])\s+/).map((s) => s.split(" ").filter(Boolean).length));
        if (longest >= SENTENCE || words >= BLOCK) out.push({ text, words, longest });
      }
      return out;
    },
    { SENTENCE, BLOCK },
  );
}

async function sweep(page: Page, who: string) {
  for (const route of ROUTES) {
    const res = await page.goto(`${route}?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle");
    // A screen that did not render cannot be short: assert it arrived first.
    expect(res?.status(), `${who} ${route}`).toBe(200);
    await expect(page.locator("h1").first(), `${who} ${route} has a heading`).toBeVisible();
    const long = await longBlocks(page);
    expect(long, `${who} on ${route}: ${long.map((l) => `"${l.text}"`).join(" | ")}`).toEqual([]);
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
  });
  const long = await longBlocks(page);
  expect(long.map((l) => l.text)).toEqual([
    "This sentence has been planted here to prove that the scan is able to see a long one.",
  ]);
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
});
