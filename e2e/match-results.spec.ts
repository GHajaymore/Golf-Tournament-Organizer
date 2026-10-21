import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * A MATCH RESULT, FROM BEING TYPED TO BEING CLEARED, AS THE COMMITTEE HANDLES
 * IT (2026-10-21).
 *
 * `applyMatchResult`, `disputeMatch`, `confirmMatch`, `reopenMatch` and
 * `clearMatch` were performed by no browser test (the reach report of round
 * G209) — the five presses that decide whether a singles match is a result.
 * On Score entry, as the secretary, one match of a round robin:
 *
 *   Final result only, a winner and no margin → refused beside the box;
 *                                     Apply is not offered to be pressed
 *   Ailsa 3&2                        → stored as holes: sixteen played, Ailsa
 *                                     three up (the Rules' "3 and 2"); pending
 *   Dispute                          → disputed
 *   Confirm result                   → confirmed
 *   Clear                            → REFUSED while confirmed, said in view;
 *                                     nothing stored changes
 *   Reopen                           → pending again
 *   Clear                            → every hole empty, pending
 *
 * Each step is read back from the row, not only from the screen.
 *
 * WHAT IT CANNOT SEE: players disputing their own result (`/me/match`) and
 * players confirming under "players approve" — a tournament set that way is
 * walked by `team-cup.spec` for tapped rounds only.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const MARK = "zz-match-results";
const ids = { org: "", event: "", match: "", medal: "", ailsa: "", bram: "", users: [] as string[] };
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v: string) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
let organizerCookie = "";

test.beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `${MARK} society`, kind: "society" } });
  ids.org = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${MARK} Singles Matchplay`,
      status: "live",
      // Setup opened again: clearing scores refuses a locked tournament, which
      // `ClearScores` says rather than offers (walked elsewhere).
      configUnlocked: true,
      shape: "single",
      format: "match",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${MARK}-${Date.now()}`,
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(380)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  ids.event = event.id;
  const stage = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Round Robin", format: "Match Play", description: "Group stage", scoringBasis: "gross", holes: 18 },
  });
  ids.medal = (
    await prisma.stage.create({
      data: { eventId: event.id, position: 1, type: "Stroke Play Round", format: "Stroke Play", description: "Medal", scoringBasis: "gross", holes: 18 },
    })
  ).id;
  const flight = await prisma.group.create({ data: { eventId: event.id, name: "Group A", position: 0 } });
  const person = (name: string, i: number) =>
    prisma.player.create({
      data: { eventId: event.id, groupId: flight.id, name, email: `${MARK}-${i}@example.invalid`, status: "confirmed", seed: i + 1, handicap: 0 },
    });
  const ailsa = await person("Zz Ailsa", 0);
  const bram = await person("Zz Bram", 1);
  ids.match = (
    await prisma.match.create({
      data: {
        eventId: event.id,
        stageId: stage.id,
        groupId: flight.id,
        round: 1,
        playerAId: ailsa.id,
        playerBId: bram.id,
        teamAId: "",
        teamBId: "",
        holes: JSON.stringify(new Array(18).fill(null)),
      },
    })
  ).id;
  // Both medal cards returned and approved.
  for (const p of [ailsa, bram]) {
    await prisma.scorecard.create({
      data: { eventId: event.id, stageId: ids.medal, playerId: p.id, strokes: JSON.stringify(new Array(18).fill(4)), status: "approved" },
    });
  }
  ids.ailsa = ailsa.id;
  ids.bram = bram.id;
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

const row = async () => {
  const m = await prisma.match.findUniqueOrThrow({ where: { id: ids.match }, select: { holes: true, scoreStatus: true } });
  const holes = JSON.parse(m.holes) as (string | null)[];
  return {
    status: m.scoreStatus,
    played: holes.filter((h) => h !== null).length,
    aUp: holes.filter((h) => h === "A").length - holes.filter((h) => h === "B").length,
  };
};

async function openEntry(page: Page) {
  await page.goto(`/entry?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
}

test("the committee types a result, has it disputed, confirms it, reopens it and clears it — refused to clear it while confirmed", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "organizer");
  await page.context().addCookies([
    { name: "ng_session", value: organizerCookie, url: baseURL! },
    { name: "ng_active_event", value: sign(ids.event), url: baseURL! },
  ]);
  // The card's own status tag — the match list beside it carries one too.
  const tag = (label: string) => page.locator(".tag", { hasText: label }).last();

  await test.step("a winner with no margin is refused beside the box", async () => {
    await openEntry(page);
    await page.getByRole("button", { name: /Enter it a different way/ }).click();
    await page.getByRole("button", { name: /Final result only/ }).click();
    await page.getByRole("radio", { name: "Zz Ailsa" }).check();
    await expect(page.getByRole("button", { name: /Apply result/ })).toBeDisabled();
    expect((await row()).played, "a refused result stored holes").toBe(0);
  });

  await test.step("3&2 is stored as the holes it means, and waits for approval", async () => {
    await page.getByPlaceholder("3&2").fill("3&2");
    await page.getByRole("button", { name: /Apply result/ }).click();
    await expect.poll(async () => (await row()).played, { message: "the result was not stored" }).toBe(16);
    expect(await row()).toEqual({ status: "pending", played: 16, aUp: 3 });
    await expect(tag("Pending confirmation")).toBeVisible({ timeout: 20_000 });
  });

  await test.step("disputed", async () => {
    await page.getByRole("button", { name: "Dispute", exact: true }).click();
    await expect(tag("Disputed")).toBeVisible({ timeout: 20_000 });
    expect((await row()).status).toBe("disputed");
  });

  await test.step("confirmed", async () => {
    await page.getByRole("button", { name: "Confirm result" }).click();
    await expect(tag("Confirmed")).toBeVisible({ timeout: 20_000 });
    expect((await row()).status).toBe("confirmed");
  });

  await test.step("a confirmed result cannot be cleared, and the screen says so where the press was", async () => {
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    const refused = page.getByText("That result has been confirmed. An organizer has to reopen it before it can be cleared.");
    await expect(refused).toBeVisible({ timeout: 20_000 });
    await expect(refused, "the refusal is not on screen where Clear was pressed").toBeInViewport();
    expect(await row()).toEqual({ status: "confirmed", played: 16, aUp: 3 });
  });

  await test.step("reopened, then cleared", async () => {
    await page.getByRole("button", { name: "Reopen" }).click();
    await expect(tag("Pending confirmation")).toBeVisible({ timeout: 20_000 });
    expect((await row()).status).toBe("pending");
    // Dispute, Confirm result and Reopen together ran off a phone's right edge, Reopen cut in half
    // (2026-10-21). The page clips what overflows, so its width says nothing: the buttons are measured.
    const screen = page.viewportSize()!.width;
    for (const name of ["Dispute", "Confirm result", "Reopen"]) {
      const box = (await page.getByRole("button", { name, exact: true }).boundingBox())!;
      expect(box.x + box.width, `${name} runs off the right edge of a ${screen}px screen`).toBeLessThanOrEqual(screen);
    }
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect.poll(async () => (await row()).played, { message: "Clear did not empty the card" }).toBe(0);
    expect((await row()).status).toBe("pending");
  });

  expect(errors, errors.join("\n")).toEqual([]);
});

/**
 * AND A MEDAL ROUND'S CARDS: an approved card reopened for correction
 * (`reopenScorecard`), and one player's scores cleared without touching the
 * other's (`clearRoundScores`) — both never pressed by a test before.
 */
test("the organizer reopens an approved card and clears one player's scores, and nobody else's", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "organizer");
  await page.context().addCookies([
    { name: "ng_session", value: organizerCookie, url: baseURL! },
    { name: "ng_active_event", value: sign(ids.event), url: baseURL! },
  ]);
  const card = (playerId: string) =>
    prisma.scorecard.findFirst({ where: { stageId: ids.medal, playerId }, select: { status: true, strokes: true } });
  const scored = async (playerId: string) => ((JSON.parse((await card(playerId))?.strokes ?? "[]") as unknown[]).filter((s) => typeof s === "number")).length;

  await page.goto(`/entry?round=${ids.medal}&bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});

  await test.step("an approved card is reopened, and only that one", async () => {
    await page.getByText(/^Approved \(2\)$/).click();
    const ailsaRow = page.locator("details div", { hasText: "Zz Ailsa" }).last();
    await ailsaRow.getByRole("button", { name: "Reopen" }).click();
    await expect(page.getByText("Reopened Zz Ailsa's card.")).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await card(ids.ailsa))?.status, { message: "the card was not reopened" }).toBe("entered");
    expect((await card(ids.bram))?.status, "the other card was reopened too").toBe("approved");
  });

  await test.step("an approved card is not cleared — reopen it first, said beside the button", async () => {
    await page.getByRole("button", { name: /Clear scores/ }).click();
    await page.getByRole("checkbox", { name: "Zz Bram" }).check();
    await page.getByRole("button", { name: "Clear 1 selected" }).click();
    await page.getByRole("button", { name: "Yes — clear 1 player" }).click();
    const refused = page.getByText(/One card here has been approved by the committee\. Reopen it first/);
    await expect(refused).toBeVisible({ timeout: 20_000 });
    await expect(refused, "the refusal is not on screen where the press was").toBeInViewport();
    expect(await scored(ids.bram), "an approved card was cleared").toBe(18);
  });

  await test.step("reopened, one player's scores are cleared, and the other's are kept", async () => {
    await page.goto(`/entry?round=${ids.medal}&bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByText(/^Approved \(1\)$/).click();
    await page.locator("details div", { hasText: "Zz Bram" }).last().getByRole("button", { name: "Reopen" }).click();
    await expect.poll(async () => (await card(ids.bram))?.status, { message: "Zz Bram's card was not reopened" }).toBe("entered");
    await page.getByRole("button", { name: /Clear scores/ }).click();
    await page.getByRole("checkbox", { name: "Zz Bram" }).check();
    await page.getByRole("button", { name: "Clear 1 selected" }).click();
    await page.getByRole("button", { name: "Yes — clear 1 player" }).click();
    await expect(page.getByText("Cleared 1 card.")).toBeVisible({ timeout: 20_000 });
    expect(await scored(ids.bram), "Zz Bram's scores are still stored").toBe(0);
    expect(await scored(ids.ailsa), "clearing one player took Zz Ailsa's card too").toBe(18);
  });

  expect(errors, errors.join("\n")).toEqual([]);
});
