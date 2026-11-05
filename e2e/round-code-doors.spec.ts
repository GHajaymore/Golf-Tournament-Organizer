import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { playGroups } from "./keep-on-play";
import { seedDoorsClub, removeDoorsClub, groupLink, SIDE_A, SIDE_B, type DoorsClub } from "./doors-fixture";

/**
 * THE DOORS INTO A GROUP, PRESSED AS THE ROUND-CODE HOLDER (2026-11-05).
 *
 * Two doors, both on `/play`:
 *
 *   THE GROUP LINK  a sign's QR carries its group: `/play#ABCD-EFGH.m<match id>`
 *     opens the CONFIRMATION of that group directly, never the list — and never
 *     a session until "Yes". A fragment that is not a group's is refused whole
 *     (the code is not honoured beside a part it cannot read); a well-formed
 *     group the round does not list leaves the list on screen.
 *   THE REMEMBERED GROUP  a phone that confirmed a group in round 1 is offered
 *     it first in round 2 of the same tournament — "Last time: Match 1 — …" —
 *     when the same four are still together, with the full list behind "Not my
 *     group"; offered nothing when that group has changed (round 3: Eve for
 *     Dot) or on a phone that never confirmed one.
 *
 * Its own club (`doors-fixture.ts`), three four-ball sessions, five invented
 * players, deleted afterwards. WHAT IT CANNOT SEE: a phone camera reading the
 * printed QR (`print-kit.spec.ts` decodes the drawing and proves each QR's link).
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const MARK = "zz-doors";
let club: DoorsClub | null = null;

test.beforeAll(async () => {
  club = await seedDoorsClub(prisma, MARK, { visibility: "participants", rounds: 3 });
});
test.afterAll(async () => {
  try {
    await removeDoorsClub(prisma, club);
  } finally {
    await prisma.$disconnect();
  }
});

const round = (n: number) => club!.rounds[n];
const hasPlaySession = async (ctx: import("@playwright/test").BrowserContext) => (await ctx.cookies()).some((c) => c.name.toLowerCase().includes("play"));

test("a group link skips the list and asks the one question; a link that is not a group's is refused", async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  watchPageErrors(page, errors, "a scorer by the group link");
  try {
    // THE GROUP LINK: straight to the confirmation of that match.
    await page.goto(groupLink(round(0).code, round(0).match));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`You're keeping Match 1: ${SIDE_A} v ${SIDE_B}`, { timeout: 30_000 });
    await expect(playGroups(page), "the list was drawn before the question").toHaveCount(0);
    await expect(page.getByText("Tap your group to start scoring.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "No, go back" })).toBeVisible();
    expect(new URL(page.url()).hash, "the code was left on the address").toBe("");
    expect(await hasPlaySession(ctx), "a scanned group started a session nobody confirmed").toBe(false);

    // "No, go back" is the list (the group may not be theirs): the sign never takes the choice away.
    await page.getByRole("button", { name: "No, go back" }).click();
    await expect(playGroups(page)).toHaveCount(1);

    // Back to the question, and yes.
    await playGroups(page).first().click();
    await page.getByRole("button", { name: "Yes, that's my group" }).click();
    await expect(page.getByRole("group", { name: /^Who won hole/ }).first(), "the confirmed group did not open its card").toBeVisible({ timeout: 30_000 });

    // ASKED ONCE PER PHONE: out, and the same group's link again goes straight to the card.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByLabel("Round code")).toBeVisible({ timeout: 20_000 });
    await page.goto("about:blank");
    await page.goto(groupLink(round(0).code, round(0).match));
    await expect(page.getByRole("group", { name: /^Who won hole/ }).first(), "the group this phone confirmed asked again").toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Yes, that's my group" })).toHaveCount(0);
  } finally {
    await ctx.close();
  }

  // CONTROLS, each on a phone of its own.
  const phone = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const p = await phone.newPage();
    watchPageErrors(p, errors, "a scorer by a link that is not a group's");

    // A fragment the parser cannot read is refused whole: the code is not honoured beside it.
    for (const bad of [`${groupLink(round(0).code)}.x9`, `${groupLink(round(0).code)}.t`, `${groupLink(round(0).code)}.m../x`, `${groupLink(round(0).code)}.t1.t2`]) {
      await p.goto("about:blank");
      await p.goto(bad);
      await p.waitForLoadState("networkidle").catch(() => {});
      await expect(p.getByLabel("Round code"), `${bad}: the page left the code prompt`).toBeVisible();
      await expect(p.getByLabel("Round code"), `${bad}: the code was typed in from a fragment that is not a sign's`).toHaveValue("");
      await expect(p.getByText("Tap your group to start scoring.")).toHaveCount(0);
      await expect(p.getByRole("heading", { name: /^You're keeping / })).toHaveCount(0);
    }

    // CONTROL: the same code with a well-formed group part the round does not list opens its LIST,
    // never somebody else's match: round 2's match on round 1's code.
    await p.goto("about:blank");
    await p.goto(groupLink(round(0).code, round(1).match));
    await expect(p.getByText("Tap your group to start scoring.")).toBeVisible({ timeout: 30_000 });
    await expect(playGroups(p)).toHaveCount(1);
    await expect(p.getByRole("heading", { name: /^You're keeping / })).toHaveCount(0);

    // CONTROL: a link to the whole round still opens the list.
    await p.goto("about:blank");
    await p.goto(groupLink(round(0).code));
    await expect(p.getByText("Tap your group to start scoring.")).toBeVisible({ timeout: 30_000 });
    expect(await hasPlaySession(phone), "a link started a session").toBe(false);
  } finally {
    await phone.close();
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a phone is offered the group it kept last time, in the next round of the tournament, and nothing when that group has changed", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  watchPageErrors(page, errors, "a scorer across rounds");
  const typeCode = async (code: string) => {
    await page.goto("/play");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByLabel("Round code").fill(code);
    await page.getByRole("button", { name: "Continue" }).click();
  };
  const lastTime = page.getByRole("button", { name: `Last time: Match 1 — ${SIDE_A} v ${SIDE_B}` });
  const signOut = async () => {
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByLabel("Round code")).toBeVisible({ timeout: 20_000 });
  };
  try {
    // Round 1: nothing to remember yet — the list, and the group kept by the link.
    await typeCode(round(0).code);
    await expect(playGroups(page)).toHaveCount(1, { timeout: 20_000 });
    await expect(lastTime, "a phone that has kept nothing was offered a group").toHaveCount(0);
    await playGroups(page).first().click();
    await page.getByRole("button", { name: "Yes, that's my group" }).click();
    await expect(page.getByRole("group", { name: /^Who won hole/ }).first()).toBeVisible({ timeout: 30_000 });
    await signOut();

    // Round 2: the same four, a new match. "Last time" first; the list behind "Not my group".
    await typeCode(round(1).code);
    await expect(lastTime, "the group kept in round 1 was not offered first").toBeVisible({ timeout: 20_000 });
    await expect(playGroups(page), "the list was drawn beside the remembered group").toHaveCount(0);
    await page.getByRole("button", { name: "Not my group" }).click();
    await expect(playGroups(page)).toHaveCount(1);
    await expect(lastTime).toHaveCount(0);

    // Asked again next time: the memory is the phone's, not the screen's.
    await typeCode(round(1).code);
    await expect(lastTime).toBeVisible({ timeout: 20_000 });

    // Offered is not confirmed: tapping it asks the one question for THIS round, and "No" is the list.
    await lastTime.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`You're keeping Match 1: ${SIDE_A} v ${SIDE_B}`);
    await page.getByRole("button", { name: "No, go back" }).click();
    await expect(playGroups(page)).toHaveCount(1);
    await expect(lastTime, "'No' left the remembered group on top").toHaveCount(0);

    // Round 2 for real: offered, confirmed, scoring.
    await typeCode(round(1).code);
    await lastTime.click();
    await page.getByRole("button", { name: "Yes, that's my group" }).click();
    await expect(page.getByRole("group", { name: /^Who won hole/ }).first()).toBeVisible({ timeout: 30_000 });
    await signOut();

    // Round 3: Eve for Dot — that is not the group this phone kept, so nothing is offered and the list is what is there.
    await typeCode(round(2).code);
    await expect(playGroups(page)).toHaveCount(1, { timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^Last time:/ }), "a group that has changed was offered as the one kept").toHaveCount(0);
    await expect(page.getByRole("button", { name: "Not my group" })).toHaveCount(0);
  } finally {
    await ctx.close();
  }

  // CONTROL: another phone, which kept nothing in this tournament, is offered nothing in round 2.
  const other = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const p = await other.newPage();
    watchPageErrors(p, errors, "another phone");
    await p.goto("/play");
    await p.waitForLoadState("networkidle").catch(() => {});
    await p.getByLabel("Round code").fill(round(1).code);
    await p.getByRole("button", { name: "Continue" }).click();
    await expect(playGroups(p)).toHaveCount(1, { timeout: 20_000 });
    await expect(p.getByRole("button", { name: /^Last time:/ })).toHaveCount(0);
  } finally {
    await other.close();
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
