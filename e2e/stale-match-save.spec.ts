import { createHmac } from "node:crypto";
import type { Request } from "@playwright/test";
import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * A HOLE SAVE SENT AGAIN AFTER THE COMMITTEE SIGNED OFF UNDOES NOTHING; A SAVE LOST
 * TO NO SIGNAL DOES NOT STRAND THE NEXT TAP (2026-11-09).
 *
 * Round G571-4, `match-kept-by.spec.ts` on WebKit as an iPhone 13: Score entry
 * saved hole 1 of a tapped match, the page was reloaded, the committee's 5&4
 * was signed off with "Confirm result" — and the hole-1 save was posted AGAIN,
 * byte for byte, under the reloaded page's address. It wrote the match back to
 * one hole played and "pending". WHO SENT IT (CI run 42627107451's traces, desktop
 * Chromium too): the APP. A cup session kept by tapping draws the tap card
 * (`MatchKeeper`), which keeps each change on the phone before sending it
 * (`keepMyMatchHoles(match, card)` — no starting card). The spec left the page
 * before the save's answer came back, so the copy stayed on the phone, and the
 * reloaded card took it up as unsent work and sent it, whole, after the
 * sign-off. Now the reloaded card forgets a copy the server already holds
 * (`recoveredMatchCard`), and `saveMatchHoles` refuses a save that names no
 * starting card over a signed-off result (`unanchoredMatchSave`).
 *
 *   the replay       the hole-1 save reaches the server and its answer is
 *                    dropped, so the copy stays on the phone; the 5&4 is written
 *                    and signed off on a reloaded page, which must not send the
 *                    copy; then the kept request is posted again, headers and
 *                    body as they were, to the reloaded page's address. It is
 *                    refused in words, and the sign-off and the 5&4 stand. To
 *                    correct it, the organizer presses Reopen on the same view.
 *   no signal        the next hole save is aborted once (`route.abort()`): the
 *                    card does not call it Sent, the scorer taps on, and the
 *                    next save carries both holes — the new refusal is for a
 *                    signed-off result only, and must not strand a scorer.
 *
 * WHY THE REPLAY IS POSTED BY HAND rather than a held route released after the
 * reload: a request held across a navigation is cancelled by the browser, and
 * releasing it then reaches the server on one engine and not another — a step
 * that may not have run. Posting the kept request reaches it every time.
 *
 * The service worker is blocked (routes do not see what it handles). Light: one
 * page, one tapped match. Its own club, tournament, organizer and four invented
 * players, deleted afterwards.
 */

test.describe.configure({ mode: "serial" });
test.use({ serviceWorkers: "block" });

const prisma = new PrismaClient();
const MARK = "zz-stale-match-save";
const ids = { org: "", event: "", taps: "", match: "", users: [] as string[] };
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v: string) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
let organizerCookie = "";
/** Read from the round the fixture made, never assumed. */
let roundHoles = 0;

test.beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `${MARK} society`, kind: "society" } });
  ids.org = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${MARK} Autumn Cup`,
      status: "live",
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
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
    },
  });
  ids.event = event.id;
  // A cup session kept by tapping who won each hole, as `match-kept-by.spec.ts` keeps its Sunday round.
  const taps = await prisma.stage.create({
    data: {
      eventId: event.id,
      position: 0,
      type: "Team Session",
      format: "Four-Ball",
      description: "Sunday four-balls",
      scoringBasis: "gross",
      holes: 9,
      nine: "front",
      accessCode: "",
      lineupPublished: true,
    },
  });
  ids.taps = taps.id;
  roundHoles = taps.holes;
  const [blues, whites] = await Promise.all(
    ["Blues", "Whites"].map((name, position) => prisma.group.create({ data: { eventId: event.id, name, position } })),
  );
  const person = (name: string, groupId: string, i: number) =>
    prisma.player.create({
      data: { eventId: event.id, groupId, name, email: `${MARK}-${i}@example.invalid`, status: "confirmed", seed: i + 1, handicap: 0 },
    });
  const a1 = await person("Zz Ailsa", blues.id, 0);
  const a2 = await person("Zz Bram", blues.id, 1);
  const b1 = await person("Zz Edda", whites.id, 2);
  const b2 = await person("Zz Finn", whites.id, 3);
  const carrier = await prisma.group.create({
    data: { eventId: event.id, name: "Four-Ball — session 0", position: 2, stageId: taps.id, isCarrier: true },
  });
  const side = (name: string, flight: string, players: string[]) =>
    prisma.team.create({
      data: { eventId: event.id, stageId: taps.id, name, clubGroupId: flight, members: { create: players.map((playerId, p) => ({ playerId, position: p })) } },
    });
  const sa = await side("Zz Ailsa & Zz Bram", blues.id, [a1.id, a2.id]);
  const sb = await side("Zz Edda & Zz Finn", whites.id, [b1.id, b2.id]);
  ids.match = (
    await prisma.match.create({
      data: {
        eventId: event.id,
        stageId: taps.id,
        groupId: carrier.id,
        round: 1,
        playerAId: "",
        playerBId: "",
        teamAId: sa.id,
        teamBId: sb.id,
        holes: JSON.stringify(new Array(roundHoles).fill(null)),
      },
    })
  ).id;
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

const blank = () => new Array<string | null>(roundHoles).fill(null);
const row = () => prisma.match.findUniqueOrThrow({ where: { id: ids.match }, select: { holes: true, scoreStatus: true } });
/** The first two holes as stored, e.g. "A," or "A,A". */
const firstTwo = async () => (JSON.parse((await row()).holes) as (string | null)[]).slice(0, 2).join(",");
/** This match's hole save, and nothing else: its body starts with the match's id and a card. */
const isHoleSave = (req: Request) => req.method() === "POST" && (req.postData() ?? "").startsWith(`["${ids.match}",[`);
/** The tap card's copy of this match kept on the phone (`usePendingCard`, `MatchKeeper`), or null. */
const phoneCopy = (page: Page) =>
  page.evaluate((matchId) => {
    const key = Object.keys(window.localStorage).find((k) => k.startsWith("tourneyhq:pending-card:") && k.endsWith(`:match-a:${matchId}`));
    return key ? window.localStorage.getItem(key) : null;
  }, ids.match);
const entryUrl = () => `/entry?round=${encodeURIComponent(ids.taps)}&bust=${Date.now()}`;
const tap = (page: Page, hole: number) =>
  page.getByRole("group", { name: `Who won hole ${hole}` }).getByRole("button", { name: new RegExp(`^Hole ${hole} to Zz Ailsa & Zz Bram`) }).click();

test.beforeEach(async () => {
  await prisma.match.update({
    where: { id: ids.match },
    data: { holes: JSON.stringify(blank()), scoreStatus: "pending", scoredAt: null, confirmedById: null, confirmedBy: "" },
  });
});

test("a hole save posted again after the committee signed off undoes nothing", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "organizer");
  await signIn(page, baseURL!);

  let kept: { url: string; headers: Record<string, string>; body: string } | null = null;
  await test.step("the organizer taps hole 1: the save lands, its answer is lost, and the copy stays on the phone", async () => {
    await page.goto(entryUrl());
    await expect(page.getByText("Kept by tapping who won each hole")).toBeVisible({ timeout: 30_000 });
    // Through to the server, which stores it; the answer is then dropped — the
    // page left (or the signal gone) before it came back. That is what leaves
    // the tap card's copy on the phone for the next page to find.
    // The save is claimed SYNCHRONOUSLY (a second save arriving while this one
    // is awaited must not be taken too), and the step waits for the handler to
    // finish before it lets go of the route: in round G576-2 the page moved on
    // while `route.fetch()` was still out, the browser settled the request
    // itself, and `route.abort` threw "Route is already handled!".
    let claimed = false;
    let handled: Promise<void> | null = null;
    await page.route("**/entry**", async (route) => {
      const req = route.request();
      if (!claimed && isHoleSave(req)) {
        claimed = true;
        handled = (async () => {
          kept = { url: req.url(), headers: await req.allHeaders(), body: req.postData() ?? "" };
          await route.fetch();
          // Already settled by the browser = the answer is lost all the same.
          await route.abort("internetdisconnected").catch(() => undefined);
        })();
        return handled;
      }
      return route.fallback();
    });
    await tap(page, 1);
    await expect.poll(() => kept !== null, { timeout: 20_000, message: "the hole save was never seen — this step did not run" }).toBe(true);
    await handled;
    await expect.poll(firstTwo, { timeout: 15_000, message: "the organizer's tap was not stored" }).toBe("A,");
    expect(await phoneCopy(page), "CONTROL: the tap card's copy was not left on the phone").not.toBeNull();
    await page.unroute("**/entry**");
  });

  const reloaded = entryUrl();
  await test.step("the committee's 5&4 is signed off on the reloaded page, and the phone's copy is not sent over it", async () => {
    await prisma.match.update({
      where: { id: ids.match },
      data: { holes: JSON.stringify(["A", "A", "A", "A", "A", ...blank().slice(5)]), scoreStatus: "pending", scoredAt: new Date() },
    });
    let resent = 0;
    page.on("request", (req) => {
      if (isHoleSave(req)) resent += 1;
    });
    await page.goto(reloaded);
    const signOff = page.getByRole("group", { name: "Sign off this result" });
    await expect(signOff).toContainText("Awaiting approval: 5&4", { timeout: 30_000 });
    await signOff.getByRole("button", { name: "Confirm result" }).click();
    await expect(signOff).toHaveCount(0, { timeout: 20_000 });
    await expect.poll(async () => (await row()).scoreStatus, { timeout: 15_000, message: "CONTROL: the result was not signed off" }).toBe("confirmed");
    // The reloaded card took the copy up and FORGOT it (the server already
    // holds its one hole): gone from the phone, and never sent. A copy sent
    // and answered is gone too, so the count is what tells the two apart.
    await expect.poll(() => phoneCopy(page), { timeout: 15_000, message: "the reloaded card never took the copy up" }).toBeNull();
    expect(resent, "the reloaded page sent the phone's old card over the committee's 5&4").toBe(0);
    expect((JSON.parse((await row()).holes) as (string | null)[]).slice(0, 5).join(","), "the 5&4 was overwritten before the sign-off").toBe("A,A,A,A,A");
  });

  await test.step("the kept hole-1 save, posted again to the reloaded page's address, is refused and the sign-off stands", async () => {
    expect(kept, "the hole save was never seen").not.toBeNull();
    const { url, headers, body } = kept!;
    expect(url, "CONTROL: the kept save was posted from the first page").not.toBe(new URL(reloaded, baseURL).toString());
    // As it was sent, less what the request context sets itself.
    const replay = Object.fromEntries(Object.entries(headers).filter(([k]) => !["host", "content-length", "cookie", "connection"].includes(k.toLowerCase())));
    const res = await page.request.post(new URL(reloaded, baseURL).toString(), { headers: { ...replay, referer: new URL(reloaded, baseURL).toString() }, data: body });
    expect(res.status(), "the replay did not reach the action").toBe(200);
    // Refused in words, by the tap card's own door (`keepMyMatchHoles`).
    expect(await res.text(), "the replay was not refused as a signed-off result").toContain("has been signed off");
    const after = await row();
    expect(after.scoreStatus, "the replay undid the sign-off").toBe("confirmed");
    expect((JSON.parse(after.holes) as (string | null)[]).slice(0, 5).join(","), "the replay undid the 5&4").toBe("A,A,A,A,A");
  });

  await test.step("to correct it, the organizer reopens the result on the same view", async () => {
    await page.goto(entryUrl());
    const signedOff = page.getByRole("group", { name: "Signed-off result" });
    await expect(signedOff).toContainText("Signed off: 5&4", { timeout: 30_000 });
    await signedOff.getByRole("button", { name: "Reopen" }).click();
    await expect.poll(async () => (await row()).scoreStatus, { timeout: 15_000, message: "the result was not reopened" }).toBe("pending");
    // Waiting on the committee again, with the 5&4 as it was.
    await expect(page.getByRole("group", { name: "Sign off this result" })).toContainText("Awaiting approval: 5&4", { timeout: 20_000 });
    await expect(signedOff).toHaveCount(0);
  });

  // The dropped answer is the step's own doing (see the no-signal test below).
  expect(errors.filter((e) => !/Load failed|Failed to fetch|NetworkError/.test(e))).toEqual([]);
});

test("a hole save lost to no signal: the scorer taps on, and the next save carries both holes", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "organizer");
  await signIn(page, baseURL!);
  await page.goto(entryUrl());
  await expect(page.getByText("Kept by tapping who won each hole")).toBeVisible({ timeout: 30_000 });

  let aborted = 0;
  await page.route("**/entry**", async (route) => {
    if (aborted === 0 && isHoleSave(route.request())) {
      aborted += 1;
      return route.abort("internetdisconnected");
    }
    return route.fallback();
  });

  await test.step("hole 1's save never reaches the server, and the card does not call it Sent", async () => {
    await tap(page, 1);
    await expect.poll(() => aborted, { message: "the hole save was never aborted — this step did not run" }).toBe(1);
    // The tap card's own words for it (`holeSyncs`): on the phone, not sent — never "Sent".
    await expect(page.locator("[data-sync]").first()).toHaveAttribute("data-sync", /^(phone|refused)$/, { timeout: 15_000 });
    expect(await firstTwo(), "CONTROL: nothing was stored").toBe(",");
  });

  await test.step("the scorer taps hole 2, and both holes are stored", async () => {
    await tap(page, 2);
    await expect.poll(firstTwo, { timeout: 15_000, message: "the next save was refused (or lost hole 1)" }).toBe("A,A");
    await expect(page.getByText(/changed elsewhere/)).toHaveCount(0);
  });

  await page.unroute("**/entry**");
  // The aborted request is the step's own doing: on WebKit an aborted fetch the
  // app CAUGHT may still be reported as "Load failed" by the engine. Anything
  // else is a finding.
  expect(errors.filter((e) => !/Load failed|Failed to fetch|NetworkError/.test(e))).toEqual([]);
});
