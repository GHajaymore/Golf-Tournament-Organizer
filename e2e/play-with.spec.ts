import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { seedOrganizer, teardownOrganizer, medalEmail, memberSession, ORGANIZER_EMAIL } from "./organizer-fixture.mjs";

/**
 * "CAN I PLAY WITH BRIAR?" — ASKED FROM A PHONE, SEEN BY THE COMMITTEE, AND
 * KEPT BY THE DRAW.
 *
 * The request a secretary takes more often than any other. A member asks from
 * Today (`setMyPlayWith`); the committee sees it on the Tee sheet, can add one
 * taken at the desk and take one off again (`setPairingRequest`); and the draw
 * keeps the two together where it can. Neither action was performed by a
 * browser test (the first measured round, 2026-10-13) — and the part a member
 * cares about, that the draw then DOES it, was checked by nothing that draws.
 *
 * A request only means something against a draw that would otherwise have
 * split the pair, so the sheet is drawn FIRST, as a draft, and the friend is
 * chosen from the other group:
 *
 *   a draft is drawn, balanced on handicap, in fours → the member's group is read
 *                                                       off it, and a friend is
 *                                                       picked from the OTHER one
 *                                                       (the control: apart)
 *   the member ticks four names                     → the fourth cannot be ticked:
 *                                                       a group only holds four
 *   the member asks for the one friend              → "Sent to the committee";
 *                                                       it is on their Today after
 *                                                       a reload
 *   the committee opens the Tee sheet               → the request is listed, and
 *                                                       it is told the saved sheet
 *                                                       splits the two
 *   the sheet is re-drawn the same way, published   → the two are in one group,
 *                                                       and the warning has gone
 *   the member opens Today                          → their group names the friend,
 *                                                       and nobody asks them who
 *                                                       they would like to play with
 *   a request is taken at the desk for two who the
 *   published sheet has apart                       → listed; the committee is told
 *                                                       the sheet splits them
 *   that request is taken off                       → asked first; then gone, and
 *                                                       the warning with it
 *
 * WHAT IT CANNOT SEE: a draw by position (the request is deliberately not
 * honoured there, and the screen says so), or a request too many for a group.
 */

type Entrant = { name: string; index: string };
const FIELD: Entrant[] = [
  { name: "Elm Marlow", index: "17" },
  { name: "Briar Marlow", index: "5" },
  { name: "Fern Marlow", index: "21" },
  { name: "Alder Marlow", index: "2" },
  { name: "Dune Marlow", index: "13" },
  { name: "Cedar Marlow", index: "9" },
  { name: "Gorse Marlow", index: "25" },
  { name: "Hazel Marlow", index: "29" },
];
const MEMBER = "Alder Marlow";
const TOURNAMENT = "Saturday Medal — Play With";
const prisma = new PrismaClient();

test.beforeAll(async () => {
  const { session } = await seedOrganizer();
  process.env.ORGANIZER_SESSION = session;
});
test.afterAll(async () => {
  await teardownOrganizer();
  await prisma.$disconnect();
});

async function open(page: Page, path: string) {
  // A screen that has just saved something is still redrawing itself, and Safari's engine calls a
  // second navigation on top of that one "interrupted" rather than waiting. The redraw is let finish
  // and the address is asked for again.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
      break;
    } catch (e) {
      if (attempt >= 2 || !/interrupted by another navigation|NS_BINDING_ABORTED/.test(String(e))) throw e;
      await page.waitForLoadState("networkidle").catch(() => {});
    }
  }
  await page.waitForLoadState("networkidle");
}

/** A member's Today, with what is folded under its "More" opened: the playing-partners card lives there. */
async function today(page: Page) {
  await open(page, "/me");
  const more = page.locator("summary", { hasText: /^More:/ });
  if (await more.count()) await more.first().click();
}

/** The field as stored: who has asked for whom, by name. */
async function asks(): Promise<Record<string, string[]>> {
  const rows = await prisma.player.findMany({
    where: { event: { name: TOURNAMENT, organization: { members: { some: { user: { email: ORGANIZER_EMAIL } } } } } },
    select: { id: true, name: true, playWith: true },
  });
  const nameOf = new Map(rows.map((r) => [r.id, r.name]));
  return Object.fromEntries(rows.map((r) => [r.name, r.playWith.map((id) => nameOf.get(id) ?? id).sort()]));
}

test("a member asks to play with a friend, the committee sees it, and the draw keeps them together", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(420_000);
  await page.context().addCookies([{ name: "ng_session", value: process.env.ORGANIZER_SESSION!, url: baseURL! }]);
  const errors: string[] = [];
  watchPageErrors(page, errors);

  await test.step("a one-round medal with eight players, launched", async () => {
    await open(page, "/choose");
    await page.getByLabel("Tournament name").fill(TOURNAMENT);
    await page.getByRole("button", { name: /^A single round/ }).click();
    await page.getByRole("button", { name: "Create tournament" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });

    await open(page, "/event");
    const today = new Date().toISOString().slice(0, 10);
    await page.getByLabel("Tournament dates, first day").fill(today);
    await page.getByLabel("Tournament dates, last day").fill(today);
    const course = page.getByRole("combobox", { name: "Golf course" });
    await course.click();
    await course.fill("Kingsbarn Heath");
    await page.locator('#course-picker-list [role="option"]', { hasText: "Dayton" }).first().click();
    await page.locator("button.btn-primary", { hasText: /Save event|Adding the course/ }).click();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({ timeout: 20_000 });

    await open(page, "/registration");
    for (const [i, p] of FIELD.entries()) {
      await page.getByLabel("Player name", { exact: true }).fill(p.name);
      await page.getByRole("textbox", { name: /^Email · required/ }).fill(medalEmail(i));
      // A new club is on Par, which since 2026-10-21 (A7) asks no mobile unless the organizer does.
      await expect(page.getByRole("textbox", { name: /^Mobile · required/ }), "Par still demands a mobile").toHaveCount(0);
      await page.getByLabel("Handicap", { exact: true }).fill(p.index);
      await page.getByRole("button", { name: "Add to field" }).click();
      await expect(page.getByText(p.name).first()).toBeVisible({ timeout: 20_000 });
    }
    // Read back: an entry loop passes on a name still sitting in the form.
    expect(Object.keys(await asks()).sort(), "the field is not the eight entered").toEqual(FIELD.map((p) => p.name).sort());

    await open(page, "/stages");
    await page.getByRole("button", { name: /^Stroke play round/ }).click();
    await page.getByLabel("Format for every round added").selectOption("Stroke Play");
    await page.getByRole("button", { name: /^Add stroke play round/ }).click();
    await expect(page.getByRole("button", { name: /^Round 1 · Stroke Play Round/ })).toBeVisible({ timeout: 20_000 });

    await open(page, "/dashboard");
    for (const step of ["Start taking entries", "Mark ready"]) {
      await page.getByRole("button", { name: step }).click();
      await expect(page.getByRole("button", { name: step })).toHaveCount(0, { timeout: 20_000 });
    }
    await page.getByRole("button", { name: "Launch tournament" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Launch tournament" }).click();
    await expect(page.getByRole("button", { name: "Complete tournament" })).toBeVisible({ timeout: 30_000 });
  });

  /** Who is in each group on the committee's screen. */
  const group = (n: number) => page.locator(".card", { hasText: `Group ${n}` }).filter({ hasText: /Hole \d+ · / }).first();
  const sheet = async (): Promise<string[][]> => {
    const groups: string[][] = [];
    for (const n of [1, 2]) {
      await expect(group(n), `the sheet has no Group ${n}`).toBeVisible({ timeout: 20_000 });
      const text = await group(n).innerText();
      groups.push(FIELD.map((p) => p.name).filter((name) => text.includes(name)));
    }
    expect(groups.flat().sort(), "the sheet does not hold the whole field once each").toEqual(FIELD.map((p) => p.name).sort());
    return groups;
  };
  const together = (groups: string[][], a: string, b: string) => groups.some((g) => g.includes(a) && g.includes(b));
  /** Draw balanced on handicap, in fours, and keep it. */
  const draw = async (publish: boolean) => {
    await open(page, "/foursomes");
    const again = page.getByRole("button", { name: /^Re-draw this sheet/ });
    if (await again.count()) await again.click();
    await page.getByRole("button", { name: /^Balanced handicap/ }).click();
    await page.locator("label.seg-opt", { hasText: /^\s*4\s*$/ }).click();
    await page.getByLabel("First tee").fill("07:30");
    if (publish) {
      await page.getByRole("button", { name: /^Save & publish/ }).click();
      await page.getByRole("button", { name: "Publish the tee sheet" }).click();
    } else {
      await page.getByRole("button", { name: /^Save sheet/ }).click();
    }
    await expect(async () => {
      await open(page, "/foursomes");
      await expect(page.getByText(publish ? /Published to players/ : /Saved as a draft/)).toBeVisible();
    }).toPass({ timeout: 30_000 });
    return sheet();
  };
  const requests = page.locator("section", { has: page.locator("#pairing-requests") });

  const memberCtx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
  await memberCtx.addCookies([{ name: "ng_session", value: await memberSession(medalEmail(FIELD.findIndex((p) => p.name === MEMBER)), MEMBER), url: baseURL! }]);
  const member = await memberCtx.newPage();
  watchPageErrors(member, errors, "member");
  const ask = member.locator("section", { has: member.locator("#play-with") });

  try {
    let friend = "";
    await test.step("a draft is drawn with nobody asking: the friend is somebody the draw has put elsewhere", async () => {
      const groups = await draw(false);
      const others = groups.find((g) => !g.includes(MEMBER))!;
      expect(others.length, "the other group is empty").toBeGreaterThan(0);
      friend = others[0];
      expect(together(groups, MEMBER, friend), "CONTROL: the draw already has the two together").toBe(false);
      await expect(requests).toContainText("none yet");
    });

    await test.step("the member asks from their phone — and a fourth name cannot be ticked", async () => {
      await today(member);
      await expect(ask, "a member with no group is not asked who they would like to play with").toBeVisible();
      await ask.getByRole("button", { name: "Ask to play with…" }).click();
      const boxes = ask.getByRole("checkbox");
      await expect(boxes, "the rest of the field is not offered").toHaveCount(FIELD.length - 1);
      for (let i = 0; i < 3; i += 1) await boxes.nth(i).check();
      await expect(ask).toContainText("3 of 3 chosen");
      await expect(boxes.nth(3), "CONTROL: a fourth playing partner can be asked for").toBeDisabled();
      for (let i = 0; i < 3; i += 1) await boxes.nth(i).uncheck();
      await ask.getByRole("checkbox", { name: friend }).check();
      await ask.getByRole("button", { name: "Send request" }).click();
      await expect(ask.getByRole("status"), "the member is not told the request went").toHaveText("Sent to the committee.");
      expect((await asks())[MEMBER], "the request was not stored as asked").toEqual([friend]);
      await today(member);
      await expect(ask, "the request is not on the member's Today after a reload").toContainText(`You've asked for ${friend}.`);
    });

    await test.step("the committee sees it, and is told the saved sheet splits them", async () => {
      await open(page, "/foursomes");
      await expect(requests.getByRole("listitem"), "the request is not on the committee's list").toHaveCount(1);
      await expect(requests.getByRole("listitem")).toContainText(new RegExp(`${MEMBER}\\s+with\\s+${friend}`));
      await expect(requests.getByRole("alert"), "the committee is not told the saved sheet splits a request").toContainText("The saved sheet splits");
      await expect(requests.getByRole("alert")).toContainText(MEMBER);
      await expect(requests.getByRole("alert")).toContainText(friend);
    });

    let published: string[][] = [];
    await test.step("the same draw, drawn again and published, keeps them together", async () => {
      published = await draw(true);
      expect(together(published, MEMBER, friend), `the draw did not keep ${MEMBER} with ${friend}: ${JSON.stringify(published)}`).toBe(true);
      expect(published.map((g) => g.length), "the groups are not two fours").toEqual([4, 4]);
      await expect(requests.getByRole("alert"), "the committee is still told the sheet splits them").toHaveCount(0);
    });

    await test.step("the member's Today names the friend, and stops asking", async () => {
      await today(member);
      const me = await member.locator("main").innerText();
      expect(me, `the member's page does not give their group:\n${me}`).toMatch(/Group \d · 7:30 AM/);
      const withLine = me.split("\n").find((l) => /^With /.test(l.trim())) ?? "";
      expect(withLine, `the member's playing partners do not include ${friend}:\n${me}`).toContain(friend);
      await expect(ask, "a member with a tee time is still asked who they would like to play with").toHaveCount(0);
    });

    await test.step("a request taken at the desk for two the sheet has apart is listed, warned about, and taken off again", async () => {
      const a = published[0].find((n) => n !== MEMBER && n !== friend)!;
      const b = published[1].find((n) => n !== MEMBER && n !== friend)!;
      await open(page, "/foursomes");
      await requests.getByRole("button", { name: "Add a request" }).click();
      // Each picker sits inside its own label, so the label's name runs on into every option: found by its opening words.
      const who = requests.locator("label", { hasText: /^\s*Player/ }).locator("select");
      const withWhom = requests.locator("label", { hasText: /^\s*wants to play with/ }).locator("select");
      await who.selectOption({ label: a });
      await expect(withWhom.locator("option", { hasText: a }), "a player can be asked to play with themselves").toHaveCount(0);
      await withWhom.selectOption({ label: b });
      await requests.getByRole("button", { name: "Add request" }).click();
      await expect.poll(async () => (await asks())[a], { timeout: 20_000, message: "the desk request was not stored" }).toEqual([b]);
      await open(page, "/foursomes");
      await expect(requests.getByRole("listitem")).toHaveCount(2);
      await expect(requests.getByRole("alert"), "the committee is not told the published sheet splits the new request").toContainText(a);
      await expect(requests.getByRole("alert")).toContainText(b);
      await expect(requests.getByRole("alert"), "the kept request is reported as split").not.toContainText(MEMBER);

      const off = requests.getByRole("button", { name: `Remove ${a} with ${b}` });
      await off.click();
      expect((await asks())[a], "one press removed a request without asking").toEqual([b]);
      await requests.getByRole("button", { name: "Remove request" }).click();
      await expect.poll(async () => (await asks())[a], { timeout: 20_000, message: "the request was not removed" }).toEqual([]);
      await open(page, "/foursomes");
      await expect(requests.getByRole("listitem")).toHaveCount(1);
      await expect(requests.getByRole("alert")).toHaveCount(0);
      expect((await asks())[MEMBER], "removing one request removed another").toEqual([friend]);
    });

    expect(errors, "a screen threw").toEqual([]);
  } finally {
    await memberCtx.close();
  }
});
