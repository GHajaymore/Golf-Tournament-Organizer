import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * WHO KEEPS THE CARD, AND WHO CHECKS IT — chosen per round on Rounds & formats
 * (2026-11-04, sprint 2 part B; the owner approved it after the 18 Oct cup).
 *
 *   a new round reads   "One scorer per group · each player confirms their
 *                       card" — `scoringDefaults` for a tournament
 *   Customize           "Who enters scores" and "End-of-round check"; the
 *                       organizer chooses Organizer only (paper cards) and
 *                       turns the check off, and both are stored
 *   a late switch       back to one scorer per group, once two players have
 *                       entered their own cards, is refused beside the choice
 *                       and the radio goes back
 *
 * Pressed as the organizer, on the round's own card. Its own club, tournament,
 * one session and invented people with @example.invalid addresses, deleted
 * afterwards.
 *
 * WHAT IT CANNOT SEE: the round-code screens that read these settings — the
 * scorer's "I'll keep score", the take-over, the other side's confirm and
 * dispute — which are phase 2's screens; their server rules are held by
 * `a-group-has-one-scorer.audit.test.ts` and
 * `a-disputed-result-stays-off-the-board.audit.test.ts` until then.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const MARK = "zz-stages-scoring-setup";
const ids = { org: "", event: "", stage: "", users: [] as string[], players: [] as string[] };
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v: string) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
let organizerCookie = "";

test.beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `${MARK} club`, kind: "club" } });
  ids.org = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${MARK} Autumn Medal`,
      status: "draft",
      shape: "single",
      format: "stroke",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${MARK}-${Date.now()}`,
      customPars: JSON.stringify(new Array(18).fill(4)),
      scoreEntryBy: "players",
    },
  });
  ids.event = event.id;
  // As a new round is made (`scoringDefaults("single")`).
  const stage = await prisma.stage.create({
    data: {
      eventId: event.id,
      position: 0,
      type: "Stroke Play Round",
      format: "Individual Stroke Play",
      description: "Zz Saturday medal",
      holes: 18,
      scoringBasis: "gross",
      scoreKeeping: "group",
      endCheck: "on",
    },
  });
  ids.stage = stage.id;
  for (const [i, name] of ["Zz Ailsa", "Zz Bram"].entries()) {
    const p = await prisma.player.create({
      data: { eventId: event.id, name, email: `${MARK}-${i}@example.invalid`, status: "confirmed", seed: i + 1, handicap: 0 },
    });
    ids.players.push(p.id);
  }
  const organizer = await prisma.user.create({ data: { email: `${MARK}-organizer@example.invalid`, name: "Zz Organizer", password: "x:unusable" } });
  await prisma.account.create({ data: { eventId: event.id, email: organizer.email, name: "Zz Organizer", role: "admin" } });
  ids.users = [organizer.id];
  organizerCookie = sign(signedInNow(organizer.id));
});

test.afterAll(async () => {
  try {
    if (ids.event) await prisma.event.deleteMany({ where: { id: ids.event } });
    if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    if (ids.org) await prisma.organization.deleteMany({ where: { id: ids.org } });
  } finally {
    await prisma.$disconnect();
  }
});

async function signIn(page: Page, baseURL: string) {
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: "ng_session", value: organizerCookie, url: baseURL },
    { name: "ng_active_event", value: sign(ids.event), url: baseURL },
  ]);
}

/** The round's card on Rounds & formats, opened, with "Customize this round" open. */
async function roundCard(page: Page) {
  await page.goto(`/stages?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const card = page
    .locator("div.card")
    .filter({ hasText: "Zz Saturday medal" })
    .filter({ has: page.getByRole("button", { name: /^Customize this round/ }) })
    .last();
  const head = card.locator("button[aria-expanded]").first();
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  const customize = card.getByRole("button", { name: /^Customize this round/ });
  if ((await customize.getAttribute("aria-expanded")) !== "true") await customize.click();
  const scoring = card.getByTestId(`round-scoring-${ids.stage}`);
  await expect(scoring).toBeVisible({ timeout: 20_000 });
  return { card, scoring };
}

const stored = async () =>
  prisma.stage.findUniqueOrThrow({ where: { id: ids.stage }, select: { scoreKeeping: true, endCheck: true } });

test("the organizer says who keeps score on a round, and a late switch to one scorer is refused", async ({ page, baseURL }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "organizer");
  await signIn(page, baseURL!);

  await test.step("a new round reads one scorer per group, with each player confirming their card", async () => {
    const { scoring } = await roundCard(page);
    await expect(scoring).toContainText("One scorer per group · each player confirms their card");
  });

  await test.step("behind Customize: organizer only, and the check off — both stored", async () => {
    const { scoring } = await roundCard(page);
    await scoring.getByRole("button", { name: "Customize who keeps score" }).click();
    await expect(scoring.getByRole("radio", { name: "One scorer per group" })).toBeChecked();
    await scoring.getByRole("radio", { name: "Organizer only (paper cards)" }).check();
    await expect.poll(async () => (await stored()).scoreKeeping, { timeout: 15_000, message: "who enters scores was not saved" }).toBe("organizer");
    await expect(scoring.getByRole("radio", { name: "Each player confirms their own card" })).toBeChecked();
    await scoring.getByRole("radio", { name: "Off", exact: true }).check();
    await expect.poll(async () => (await stored()).endCheck, { timeout: 15_000, message: "the end-of-round check was not saved" }).toBe("off");
    // Kept after a reload, and said on the one line.
    const again = await roundCard(page);
    await expect(again.scoring).toContainText("Organizer only (paper cards) · no end-of-round check");
  });

  await test.step("once two players have entered their own cards, one scorer per group is refused", async () => {
    await prisma.stage.update({ where: { id: ids.stage }, data: { scoreKeeping: "each" } });
    for (const playerId of ids.players) {
      await prisma.scorecard.create({
        data: { eventId: ids.event, stageId: ids.stage, playerId, strokes: JSON.stringify([4, 4, ...new Array(16).fill(null)]) },
      });
    }
    const { scoring } = await roundCard(page);
    await scoring.getByRole("button", { name: "Customize who keeps score" }).click();
    // A click, not check(): the screen puts the choice back when it is refused.
    await scoring.getByRole("radio", { name: "One scorer per group" }).click();
    await expect(scoring.getByRole("alert")).toContainText("already entered their own scores");
    await expect(scoring.getByRole("radio", { name: "Each player enters their own" })).toBeChecked();
    expect((await stored()).scoreKeeping).toBe("each");
  });

  expect(errors).toEqual([]);
});
