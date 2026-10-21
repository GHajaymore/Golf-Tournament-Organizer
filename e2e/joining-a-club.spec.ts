import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * SOMEBODY ASKS TO JOIN A CLUB THAT ALREADY EXISTS, AND THE CLUB ANSWERS
 * (2026-10-21).
 *
 * `askToJoinNamesake`, `approveJoinRequest` and `declineJoinRequest` were
 * performed by no browser test (the reach report of round G209). The whole
 * feature exists to stop one club becoming two: a second organizer who types
 * the club's name on their first tournament is told it exists and offered the
 * ask, and the club's secretary answers on Club settings.
 *
 *   a newcomer names an existing club → told it exists; asks, with a note;
 *                                       "Asked …"; a second ask is not offered
 *   a second newcomer asks too
 *   the secretary, Club settings       → both asks, with their notes
 *   "Add them" as the chosen role       → a member of the club, as that role;
 *                                       the ask leaves the list
 *   "Decline"                          → declined, and not a member
 *
 * Each answer is read back from the rows.
 *
 * WHAT IT CANNOT SEE: the email each ask sends the club (no mail is sent from a
 * test), and the seat refusal for an Admin on a full plan — this club is on no
 * plan's limits.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const MARK = "zz-join";
const CLUB = `${MARK} Oakmere Golf Club`;
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v: string) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
const ids = { org: "", event: "", owner: "", pat: "", lee: "" };
const cookies = { owner: "", pat: "", lee: "" };

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: MARK } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  // Anything a newcomer made on the way (an outfit of their own) goes with them.
  const theirs = await prisma.organizationMember.findMany({ where: { userId: { in: userIds } }, select: { organizationId: true } });
  const orgIds = [...new Set([...theirs.map((m) => m.organizationId)])];
  await prisma.event.deleteMany({ where: { OR: [{ name: { startsWith: MARK } }, { organizationId: { in: orgIds } }] } });
  await prisma.joinRequest.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.organizationMember.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { OR: [{ name: { startsWith: MARK } }, { id: { in: orgIds } }] } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

test.beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: CLUB, kind: "club" } });
  ids.org = org.id;
  // A new address each run: asking to join is rate-limited per address, and
  // the limiter's count outlives the cleanup, so a rerun as the same address
  // was refused on its fourth ask.
  const run = Date.now().toString(36);
  const user = (who: string, name: string) =>
    prisma.user.create({ data: { email: `${MARK}-${who}-${run}@example.invalid`, name, password: "x:unusable" } });
  const owner = await user("secretary", "Zz Secretary");
  const pat = await user("pat", "Zz Pat Asker");
  const lee = await user("lee", "Zz Lee Asker");
  ids.owner = owner.id;
  ids.pat = pat.id;
  ids.lee = lee.id;
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: owner.id, role: "owner" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${MARK} Club Medal`,
      status: "draft",
      shape: "single",
      format: "stroke",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${MARK}-${Date.now()}`,
    },
  });
  ids.event = event.id;
  await prisma.account.create({ data: { eventId: event.id, email: owner.email, name: "Zz Secretary", role: "admin" } });
  cookies.owner = sign(signedInNow(owner.id));
  cookies.pat = sign(signedInNow(pat.id));
  cookies.lee = sign(signedInNow(lee.id));
});

test.afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

async function signIn(page: Page, baseURL: string, session: string, eventId?: string) {
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: "ng_session", value: session, url: baseURL },
    ...(eventId ? [{ name: "ng_active_event", value: sign(eventId), url: baseURL }] : []),
  ]);
}

/** A newcomer's first tournament, run by the club's name — which already exists. */
async function askToJoin(page: Page, tournament: string, note: string) {
  await page.goto(`/choose?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByLabel("Tournament name").fill(tournament);
  await page.getByRole("button", { name: /^A single round/ }).click();
  await page.getByLabel(/Who.s running this\?/).fill(CLUB);
  await page.getByRole("button", { name: "Create tournament" }).click();
  const ask = page.getByLabel(/Ask them to add you/);
  await expect(ask, "the newcomer was not told the club exists").toBeVisible({ timeout: 20_000 });
  await ask.fill(note);
  await page.getByRole("button", { name: "Ask them to add me" }).click();
  await expect(page.getByText(`Asked ${CLUB}.`, { exact: false })).toBeVisible({ timeout: 20_000 });
  // Asked once; the ask is not offered a second time.
  await expect(page.getByRole("button", { name: "Ask them to add me" })).toHaveCount(0);
}

test("two newcomers ask to join a club that exists; the secretary adds one and declines the other", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "join");

  await test.step("a newcomer names the club, is told it exists, and asks to join", async () => {
    await signIn(page, baseURL!, cookies.pat);
    await askToJoin(page, `${MARK} Thursday draw`, "I run the Thursday draw with Dana");
    const ask = await prisma.joinRequest.findFirst({ where: { organizationId: ids.org, userId: ids.pat } });
    expect(ask?.status).toBe("pending");
    expect(ask?.note).toBe("I run the Thursday draw with Dana");
  });

  await test.step("a second newcomer asks too", async () => {
    await signIn(page, baseURL!, cookies.lee);
    await askToJoin(page, `${MARK} Ladies' Spring Cup`, "Ladies' captain");
  });

  await test.step("the secretary sees both asks on Club settings, adds one as a Member and declines the other", async () => {
    await signIn(page, baseURL!, cookies.owner, ids.event);
    await page.goto(`/organization?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByText("I run the Thursday draw with Dana", { exact: false })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Ladies' captain", { exact: false })).toBeVisible();

    await page.getByLabel("Role for Zz Pat Asker").selectOption("member");
    const patRow = page.locator("div", { has: page.getByLabel("Role for Zz Pat Asker") }).last();
    await patRow.getByRole("button", { name: "Add them" }).click();
    await expect(page.getByLabel("Role for Zz Pat Asker")).toHaveCount(0, { timeout: 20_000 });
    const pat = await prisma.organizationMember.findFirst({ where: { organizationId: ids.org, userId: ids.pat } });
    expect(pat?.role, "Zz Pat Asker was not added as the role chosen").toBe("member");
    expect((await prisma.joinRequest.findFirst({ where: { organizationId: ids.org, userId: ids.pat } }))?.status).toBe("approved");

    const leeRow = page.locator("div", { has: page.getByLabel("Role for Zz Lee Asker") }).last();
    await leeRow.getByRole("button", { name: "Decline" }).click();
    await expect(page.getByLabel("Role for Zz Lee Asker")).toHaveCount(0, { timeout: 20_000 });
    expect((await prisma.joinRequest.findFirst({ where: { organizationId: ids.org, userId: ids.lee } }))?.status).toBe("declined");
    expect(await prisma.organizationMember.count({ where: { organizationId: ids.org, userId: ids.lee } }), "a declined newcomer was let in").toBe(0);
  });

  expect(errors, errors.join("\n")).toEqual([]);
});
