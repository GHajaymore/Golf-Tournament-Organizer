import { test, expect, type Page } from "./coverage";
import { createHmac } from "node:crypto";
import { watchPageErrors } from "./page-errors";
import { openSettingsTab } from "./settings-tabs";
import { signedInNow } from "../scripts/session-cookie.mjs";
import { prisma, makeClub, dropClub, makeEvent, signIn, saidBeside, centre, type Club } from "./rounds-fixture";

/**
 * ASKING TO JOIN A CLUB, AND THE CLUB ANSWERING — THE REFUSALS, AND WHAT THE
 * ASKER IS TOLD (2026-10-21).
 *
 * `joining-a-club.spec.ts` walks the happy path: two asks, one added, one
 * declined. This walks the three refusals the screens can actually meet, each
 * where the person meets it, and then the asker coming back to read the answer:
 *
 *   the asker presses Ask in a second tab, after asking in the first
 *                                        → "You have already asked …", beside
 *                                          the press; still one ask stored
 *   the secretary, a Par club (one staff seat, already held), adds the asker
 *   as Admin, the role the screen offers first
 *                                        → refused BY NAME beside "Add them",
 *                                          offering Member; nobody let in
 *   … as a Member                        → a member, as Member; approved
 *   Decline, pressed in a tab still showing the ask
 *                                        → "no longer waiting", beside the
 *                                          press; the approval stands
 *   the asker, back on their own screen  → the club's tournament is in their
 *                                          list, and "… added you"
 *   a second asker, declined             → "… said no", and not a member
 *
 * Every answer is read back from the rows, and every screen after a reload.
 *
 * WHAT IT CANNOT SEE: the email each ask sends the club's staff (no mail is
 * sent from a test), and the per-address rate limit — a fresh address each run.
 */

const WALKED = ["desktop", "phone"];
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v: string) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;

test.describe.configure({ timeout: 240_000 });
test.use({ actionTimeout: 15_000 });

/** The club, and everything the askers made on their way to asking (an outfit of their own). */
async function cleanup(mark: string) {
  const users = await prisma.user.findMany({ where: { email: { startsWith: mark } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const theirs = await prisma.organizationMember.findMany({ where: { userId: { in: ids } }, select: { organizationId: true } });
  const orgIds = [...new Set(theirs.map((m) => m.organizationId))];
  await prisma.event.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.joinRequest.deleteMany({ where: { userId: { in: ids } } });
  await prisma.organizationMember.deleteMany({ where: { userId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await dropClub(mark);
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function asSomebody(page: Page, baseURL: string, userId: string) {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: "ng_session", value: sign(signedInNow(userId)), url: baseURL }]);
}

/** A newcomer's first tournament, run by the club's name — which already exists — up to the ask. */
async function upToTheAsk(page: Page, club: Club, tournament: string) {
  await page.goto(`/choose?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByLabel("Tournament name").fill(tournament);
  await page.getByRole("button", { name: /^A single round/ }).click();
  await page.getByLabel(/Who.s running this\?/).fill(`${club.mark} Golf Society`);
  await page.getByRole("button", { name: "Create tournament" }).click();
  await expect(page.getByLabel(/Ask them to add you/), "the newcomer was not told the club exists").toBeVisible({ timeout: 20_000 });
}

test("an ask twice, an Admin the plan has no seat for, an answer from a stale tab — each refused beside the press — and the askers told", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "join");
  const mark = `zz-joinref-${testInfo.project.name}`;
  await cleanup(mark);
  // A Par club held to the published terms: one staff seat, which its Commissioner holds.
  const club = await makeClub(mark, { plan: "free", planTermsApply: true });
  const CLUB = `${mark} Golf Society`;
  try {
    const { event } = await makeEvent(club, "Club Medal", { stages: [{}], players: 0 });
    const run = Date.now().toString(36);
    const person = (who: string, name: string) =>
      prisma.user.create({ data: { email: `${mark}-${who}-${run}@example.invalid`, name, password: "x:unusable" } });
    const pat = await person("pat", "Zz Pat Asker");
    const lee = await person("lee", "Zz Lee Asker");
    const ask = (userId: string) => prisma.joinRequest.findFirst({ where: { organizationId: club.orgId, userId } });

    await test.step("asked in one tab, then pressed again in another: refused beside the press, still one ask", async () => {
      await asSomebody(page, baseURL!, pat.id);
      const second = await context.newPage();
      watchPageErrors(second, errors, "join (second tab)");
      await upToTheAsk(page, club, `${mark} Thursday draw`);
      await upToTheAsk(second, club, `${mark} Thursday draw`);

      await page.getByLabel(/Ask them to add you/).fill("I run the Thursday draw with Dana");
      await page.getByRole("button", { name: "Ask them to add me" }).click();
      await expect(page.getByText(`Asked ${CLUB}.`, { exact: false })).toBeVisible({ timeout: 20_000 });

      const again = second.getByRole("button", { name: "Ask them to add me" });
      await centre(again);
      await again.click();
      const refused = second.getByText(`You have already asked ${CLUB}. They have not answered yet.`);
      await expect(refused, "the second ask was not refused in words").toBeVisible({ timeout: 20_000 });
      await saidBeside(refused, again, "a second ask");
      // A sentence that says no is an ALERT (docs/testing.md, "A sentence that says no"), so a screen
      // reader announces it. Soft, so the rest of the walk still runs when this one is wrong.
      await expect
        .soft(refused, "the refusal of a second ask is announced as a status, not an alert (CreateFirstTournament: role is \"status\" whenever the same-name question is open)")
        .toHaveAttribute("role", "alert");
      expect(await prisma.joinRequest.count({ where: { organizationId: club.orgId, userId: pat.id } }), "a second ask was stored").toBe(1);
      expect((await ask(pat.id))?.note, "the second press replaced the first ask's note").toBe("I run the Thursday draw with Dana");
      await second.close();

      // And after a reload the screen says where the ask got to, rather than offering it again.
      await page.goto(`/choose?bust=${Date.now()}`);
      await expect(page.getByText(`You asked ${CLUB} to add you`, { exact: false })).toBeVisible({ timeout: 20_000 });
    });

    await test.step("a second newcomer asks too", async () => {
      await asSomebody(page, baseURL!, lee.id);
      await upToTheAsk(page, club, `${mark} Ladies' Spring Cup`);
      await page.getByRole("button", { name: "Ask them to add me" }).click();
      await expect(page.getByText(`Asked ${CLUB}.`, { exact: false })).toBeVisible({ timeout: 20_000 });
    });

    const stale = await context.newPage();
    watchPageErrors(stale, errors, "join (stale tab)");
    await test.step("as Admin on a Par club with its one seat taken: refused by name, beside Add them; nobody let in", async () => {
      await page.context().clearCookies();
      await signIn(context, baseURL!, club, event.id);
      for (const p of [page, stale]) {
        await p.goto(`/organization?bust=${Date.now()}`);
        await p.waitForLoadState("networkidle").catch(() => {});
        await openSettingsTab(p, "Staff & access");
        await expect(p.getByLabel("Role for Zz Pat Asker"), "the ask is not on Club settings").toBeVisible({ timeout: 20_000 });
      }
      await expect(page.getByLabel("Role for Zz Pat Asker"), "the role offered first is not Admin").toHaveValue("admin");
      const patRow = page.locator("div", { has: page.getByLabel("Role for Zz Pat Asker") }).last();
      const add = patRow.getByRole("button", { name: "Add them" });
      await centre(add);
      await add.click();
      const refused = page.getByRole("alert").filter({ hasText: "Zz Pat Asker can be added as a Member without a seat" });
      await expect(refused, "an Admin past the plan's seats was not refused by name").toBeVisible({ timeout: 20_000 });
      await saidBeside(refused, add, "an Admin with no seat for them");
      expect(await prisma.organizationMember.count({ where: { organizationId: club.orgId, userId: pat.id } }), "refused, and let in anyway").toBe(0);
      expect((await ask(pat.id))?.status).toBe("pending");
    });

    await test.step("as a Member: let in, as a Member, and the ask leaves the list after a reload", async () => {
      await page.getByLabel("Role for Zz Pat Asker").selectOption("member");
      const patRow = page.locator("div", { has: page.getByLabel("Role for Zz Pat Asker") }).last();
      await patRow.getByRole("button", { name: "Add them" }).click();
      await expect(page.getByLabel("Role for Zz Pat Asker")).toHaveCount(0, { timeout: 20_000 });
      const seat = await prisma.organizationMember.findFirst({ where: { organizationId: club.orgId, userId: pat.id } });
      expect(seat?.role, "not let in as the role chosen").toBe("member");
      const row = await ask(pat.id);
      expect(row?.status).toBe("approved");
      expect(row?.decidedRole).toBe("member");
      await page.goto(`/organization?bust=${Date.now()}`);
      await openSettingsTab(page, "Staff & access");
      await expect(page.getByLabel("Role for Zz Pat Asker"), "an answered ask is still offered after a reload").toHaveCount(0);
      await expect(page.locator("td", { hasText: pat.email }).first(), "the new member is not on the roster").toBeVisible();
    });

    await test.step("Decline pressed in a tab still showing the ask: refused beside the press; the approval stands", async () => {
      const patRow = stale.locator("div", { has: stale.getByLabel("Role for Zz Pat Asker") }).last();
      const decline = patRow.getByRole("button", { name: "Decline" });
      await centre(decline);
      await decline.click();
      const refused = stale.getByRole("alert").filter({ hasText: "That request is no longer waiting for an answer." });
      await expect(refused, "an answer to an answered ask was not refused in words").toBeVisible({ timeout: 20_000 });
      await saidBeside(refused, decline, "Decline on an answered ask");
      expect((await ask(pat.id))?.status, "a stale Decline overturned the approval").toBe("approved");
      expect(await prisma.organizationMember.count({ where: { organizationId: club.orgId, userId: pat.id } })).toBe(1);
      await stale.close();
    });

    await test.step("the second asker is declined", async () => {
      await page.goto(`/organization?bust=${Date.now()}`);
      await openSettingsTab(page, "Staff & access");
      const leeRow = page.locator("div", { has: page.getByLabel("Role for Zz Lee Asker") }).last();
      await leeRow.getByRole("button", { name: "Decline" }).click();
      await expect(page.getByLabel("Role for Zz Lee Asker")).toHaveCount(0, { timeout: 20_000 });
      expect((await ask(lee.id))?.status).toBe("declined");
      expect(await prisma.organizationMember.count({ where: { organizationId: club.orgId, userId: lee.id } }), "a declined newcomer was let in").toBe(0);
    });

    await test.step("each asker, back on their own screen, is told the answer", async () => {
      await asSomebody(page, baseURL!, pat.id);
      await page.goto(`/choose?stay=1&bust=${Date.now()}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await expect(page.getByText(event.name, { exact: false }).first(), "the club's tournament is not in the new member's list").toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: /Create another tournament/ }).click();
      await expect(page.getByText(`${CLUB} added you.`, { exact: false }), "the new member is not told they were added").toBeVisible();

      await asSomebody(page, baseURL!, lee.id);
      await page.goto(`/choose?bust=${Date.now()}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await expect(page.getByText(`${CLUB} said no.`, { exact: false }), "the declined asker is not told").toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(event.name, { exact: false }), "a declined asker sees the club's tournament").toHaveCount(0);
    });
  } finally {
    await cleanup(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
