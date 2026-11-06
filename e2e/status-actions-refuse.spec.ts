import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { actionShapes, type ActionShape } from "./action-shapes";
import { watchPageErrors } from "./page-errors";
import { statusFixture, cardsIn, dayFromNow, prisma } from "./status-fixture";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * THE ACTIONS ASK THE STATE MACHINE (proposal 3 Nov, PR 4) — each changed
 * action pressed ONCE in the state it refuses, by the person who would press
 * it, and the refusal read where the press was.
 *
 *   the organizer   Launch, on a dashboard drawn while it could launch — the
 *                   knockout lost a player since: refused in the machine's
 *                   words ("A knockout needs at least two players"). The old
 *                   gate (`launchCheckFor`) let a knockout of one go live.
 *                   Complete, the same way — a card disputed since the page was
 *                   drawn: refused (`setEventStatus`, `refusals.complete`).
 *                   Closing a round (TD Q4): over a card not signed off, ASKED,
 *                   naming whose — Keep it open, then Close anyway; over a
 *                   disputed card, REFUSED.
 *   a player        every door into scoring on the course, on a tournament
 *                   nobody launched: the five round-code saves, keeping the
 *                   group's card and reporting a knockout tie — refused, in
 *                   the machine's words (`refusals.play`). Then a WALKOVER is
 *                   recorded, and play goes on: a forfeit is a result on the
 *                   machine's one definition (`hasResult`), where the retired
 *                   `playRefusalFor` called it "not started" (D2).
 *   the organizer   score entry in the console on the same tournament: refused.
 *
 * The phones press through each action's own endpoint (the build's action
 * manifest, `.next-e2e`), as `scoring-by-group-server.spec.ts` does: the round
 * code screens draw no button on a tournament nobody launched, and the answer a
 * screen would get is the endpoint's. Invented people, `@example.invalid`,
 * `zz-` marked, deleted in a `finally`.
 */

const NOT_LAUNCHED = "This tournament hasn’t been launched yet, so play hasn’t started.";

test("the organizer's presses are refused or asked in the machine's words", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const day = dayFromNow(10);

  await test.step("Launch: a knockout that lost a player after the page was drawn is refused, not launched", async () => {
    const f = await statusFixture(browser, baseURL, testInfo, {
      family: "pr4-launch",
      event: { dates: "Saturday knockout", startOn: day, endOn: day },
      rounds: [{ type: "Bracket Stage", format: "Match Play" }],
      players: 2,
    });
    try {
      const page = await f.ctx.newPage();
      watchPageErrors(page, errors);
      await page.goto(`/dashboard?bust=${Date.now()}`);
      const launch = page.getByRole("button", { name: "Launch tournament" }).first();
      await expect(launch).toBeVisible({ timeout: 20_000 });
      await expect(page.locator("main"), "the button was refused before the field changed").not.toContainText("A knockout needs at least two players");
      // A co-organizer takes one of the two out in another tab.
      await prisma.player.delete({ where: { id: f.playerIds[1] } });
      await launch.click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Launch tournament" }).click();
      await expect(dialog).toContainText("Not launched. A knockout needs at least two players, and only one is entered.", { timeout: 20_000 });
      expect(await f.status(), "a knockout of one went live").toBe("draft");
    } finally {
      await f.done();
    }
  });

  await test.step("Complete: a card disputed after the page was drawn is refused, and the tournament stays live", async () => {
    const f = await statusFixture(browser, baseURL, testInfo, {
      family: "pr4-complete",
      event: { dates: "Saturday medal", startOn: day, endOn: day, status: "live", launchedAt: new Date(), configUnlocked: false },
      rounds: [{ type: "Stroke Play Round", format: "Stroke Play" }],
      players: 2,
    });
    try {
      await cardsIn(f, f.stageIds[0]);
      await prisma.stage.update({ where: { id: f.stageIds[0] }, data: { closedAt: new Date() } });
      const page = await f.ctx.newPage();
      watchPageErrors(page, errors);
      await page.goto(`/dashboard?bust=${Date.now()}`);
      const complete = page.getByRole("button", { name: "Complete tournament" }).first();
      await expect(complete).toBeVisible({ timeout: 20_000 });
      // The other side questions a card while the secretary has the dashboard open.
      await prisma.scorecard.updateMany({ where: { stageId: f.stageIds[0], playerId: f.playerIds[1] }, data: { status: "disputed" } });
      await complete.click();
      await page.getByRole("alertdialog").getByRole("button", { name: /^(Complete tournament|Complete it)$/ }).click();
      await expect(page.locator("main")).toContainText("1 result is disputed, so the tournament can’t be finished yet.", { timeout: 20_000 });
      expect(await f.status(), "completed over a disputed card").toBe("live");
    } finally {
      await f.done();
    }
  });

  await test.step("Closing a round: asked over an unsigned card, refused over a disputed one", async () => {
    const f = await statusFixture(browser, baseURL, testInfo, {
      family: "pr4-close",
      event: { dates: "Saturday medal", startOn: day, endOn: day, status: "live", launchedAt: new Date(), configUnlocked: false },
      rounds: [{ type: "Stroke Play Round", format: "Stroke Play" }],
      players: 2,
    });
    const [stageId] = f.stageIds;
    const closedAt = async () => (await prisma.stage.findUniqueOrThrow({ where: { id: stageId } })).closedAt;
    try {
      // Wren's card is in and approved; Ostin's was typed in and nobody has signed it off.
      await prisma.scorecard.create({
        data: { eventId: f.eventId, stageId, playerId: f.playerIds[0], strokes: JSON.stringify(new Array(18).fill(4)), status: "approved", approvedBy: "zz", approvedAt: new Date() },
      });
      const ostin = await prisma.scorecard.create({
        data: { eventId: f.eventId, stageId, playerId: f.playerIds[1], strokes: JSON.stringify(new Array(18).fill(5)), status: "entered" },
      });
      const page = await f.ctx.newPage();
      watchPageErrors(page, errors);
      await page.goto(`/stages?bust=${Date.now()}`);
      const header = page.getByRole("button", { name: /^Round 1 · Stroke Play Round/ });
      const box = page.getByRole("checkbox", { name: /^This round is finished/ });
      if (!(await box.isVisible()) || (await header.getAttribute("aria-expanded")) !== "true") await header.click();
      await expect(box).toBeVisible({ timeout: 20_000 });

      // ASKED, naming whose card — and Keep it open leaves it open.
      await box.click();
      const ask = page.getByRole("group", { name: "Close the round anyway?" });
      await expect(ask).toContainText("Ostin Pell’s card is not signed off yet. Close Round 1 anyway? It counts once it is signed.", { timeout: 20_000 });
      await ask.getByRole("button", { name: "Keep it open" }).click();
      await expect(ask).toHaveCount(0);
      expect(await closedAt(), "Keep it open closed the round").toBeNull();

      // REFUSED while it is disputed: the committee owes a ruling first (Rule 20.1c(3)).
      await prisma.scorecard.update({ where: { id: ostin.id }, data: { status: "disputed" } });
      await box.click();
      await expect(page.getByText("1 result in Round 1 is disputed, so it can’t be closed yet. Settle it on Score entry, then close the round.")).toBeVisible({ timeout: 20_000 });
      await expect(ask).toHaveCount(0);
      expect(await closedAt(), "a round closed over a disputed card").toBeNull();

      // Ruled on and back to waiting for a signature: Close anyway closes it.
      await prisma.scorecard.update({ where: { id: ostin.id }, data: { status: "entered" } });
      await box.click();
      await expect(ask).toBeVisible({ timeout: 20_000 });
      await ask.getByRole("button", { name: "Close anyway" }).click();
      await expect.poll(closedAt, { timeout: 20_000, message: "Close anyway did not close the round" }).not.toBeNull();
    } finally {
      await f.done();
    }
  });
  expect(errors).toEqual([]);
});

/* ------------------------------------------------------------ the phones */

const MARK = "zz-status-pr4-play";
const ALPHABET = "ABCDEFGHJKMNPQRTWXYZ2346789";
const code = () => "ZZ" + Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v: string) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
const fingerprint = (v: string) => createHmac("sha256", secret).update(v).digest("base64url");
/** A play session as `createPlaySession` signs it — the cookie a phone holds after tapping its name. */
const playCookie = (stageId: string, playerId: string, accessCode: string) =>
  sign(`${stageId}:${playerId}:${Date.now() + 12 * 60 * 60 * 1000}:${fingerprint(`round-code:${accessCode}`).slice(0, 16)}`);

let shapes: ActionShape[] = [];
function action(name: string, file: string): ActionShape {
  if (shapes.length === 0) shapes = actionShapes();
  const found = shapes.find((a) => a.name === name && a.file.endsWith(`app/actions/${file}`));
  if (!found) throw new Error(`${name} is not in the build's action manifest — no screen can call it either`);
  return found;
}

/** Call an action from this page, as its button does: the same endpoint, the same session. */
async function press(page: Page, name: string, file: string, args: unknown[]): Promise<{ ok: boolean; error: string; body: string }> {
  const a = action(name, file);
  const body = await page.evaluate(
    async ({ path, id, payload }) => {
      const res = await fetch(path, {
        method: "POST",
        headers: { "next-action": id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" },
        body: payload,
      });
      return res.text();
    },
    { path: a.path, id: a.id, payload: JSON.stringify(args) },
  );
  return { ok: /"ok":true/.test(body), error: JSON.parse(`"${/"error":"((?:[^"\\]|\\.)*)"/.exec(body)?.[1] ?? ""}"`) as string, body };
}

test("every door into scoring is refused before launch, and a walkover lets play go on (D2)", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const MATCH_CODE = code();
  const CARD_CODE = code();
  await prisma.organization.deleteMany({ where: { name: `${MARK} society` } });
  await prisma.user.deleteMany({ where: { email: { in: [`${MARK}-0@example.invalid`, `${MARK}-org@example.invalid`] } } });
  const org = await prisma.organization.create({ data: { name: `${MARK} society`, kind: "society" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id, name: `${MARK} Autumn Singles`, status: "draft", shape: "single", format: "match",
      dates: "", course: "Home", city: "", address: "", regDeadline: "", shareToken: `${MARK}-${MATCH_CODE}`,
      customPars: JSON.stringify(new Array(18).fill(4)), playerAccess: "code", scoreEntryBy: "players", scoreApproval: "players",
    },
  });
  const contexts: Array<import("@playwright/test").BrowserContext> = [];
  try {
    const round = (position: number, type: string, format: string, accessCode: string) =>
      prisma.stage.create({ data: { eventId: event.id, position, type, format, description: `Zz round ${position + 1}`, holes: 9, nine: "front", scoringBasis: "gross", accessCode } });
    const matchStage = await round(0, "Single Match Stage", "Match Play", MATCH_CODE);
    const cardStage = await round(1, "Stroke Play Round", "Individual Stroke Play", CARD_CODE);
    const group = await prisma.group.create({ data: { eventId: event.id, name: "A", position: 0 } });
    const person = (name: string, i: number) =>
      prisma.player.create({ data: { eventId: event.id, groupId: group.id, name, email: `${MARK}-${i}@example.invalid`, status: "confirmed", seed: i + 1, handicap: 0 } });
    const ailsa = await person("Zz Ailsa", 0);
    const bram = await person("Zz Bram", 1);
    const match = await prisma.match.create({
      data: { eventId: event.id, stageId: matchStage.id, groupId: group.id, round: 1, playerAId: ailsa.id, playerBId: bram.id, holes: JSON.stringify(new Array(9).fill(null)) },
    });

    /** A phone holding the play session of the player whose name was tapped. */
    const phone = async (stageId: string, accessCode: string) => {
      const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, serviceWorkers: "block" });
      contexts.push(ctx);
      await ctx.addCookies([{ name: "ng_play", value: playCookie(stageId, ailsa.id, accessCode), url: baseURL! }]);
      const page = await ctx.newPage();
      watchPageErrors(page, errors);
      await page.goto(`/play?bust=${Date.now()}`);
      return page;
    };
    /** Somebody signed in to the console, on this tournament, in `role`. */
    const signedIn = async (email: string, name: string, role: string) => {
      const user = await prisma.user.create({ data: { email, name, password: "x:unusable", emailVerifiedAt: new Date() } });
      await prisma.account.create({ data: { eventId: event.id, email, name, role } });
      const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, serviceWorkers: "block" });
      contexts.push(ctx);
      await ctx.addCookies([
        { name: "ng_session", value: sign(signedInNow(user.id)), url: baseURL! },
        { name: "ng_active_event", value: sign(event.id), url: baseURL! },
      ]);
      const page = await ctx.newPage();
      watchPageErrors(page, errors);
      await page.goto(`/me?bust=${Date.now()}`);
      return page;
    };

    const onMatch = await phone(matchStage.id, MATCH_CODE);
    const onCard = await phone(cardStage.id, CARD_CODE);
    const won = Array.from({ length: 9 }, (_, i) => (i === 0 ? "A" : null));
    const strokes = [4, ...new Array(8).fill(null)];
    const presses: Array<[Page, string, unknown[]]> = [
      [onMatch, "savePlayMatchHoles", [match.id, won]],
      [onMatch, "savePlayMatchResult", [match.id, "A", "2&1"]],
      [onMatch, "savePlayMatchCard", [match.id, strokes]],
      [onMatch, "keepGroup", [{}]],
      [onCard, "savePlayCard", [strokes]],
      [onCard, "certifyPlayCard", []],
    ];
    await test.step("a player on the course: the round-code doors are refused, in the machine's words", async () => {
      for (const [page, name, args] of presses) {
        const r = await press(page, name, "play.ts", args);
        expect(r.ok, `${name} was let through on a tournament nobody launched`).toBe(false);
        expect(r.error, `${name}: ${r.body.slice(0, 200)}`).toContain(NOT_LAUNCHED);
      }
      expect(await prisma.scorecard.count({ where: { eventId: event.id } }), "a refused save wrote a card").toBe(0);
      expect(JSON.parse((await prisma.match.findUniqueOrThrow({ where: { id: match.id } })).holes)[0], "a refused save wrote a hole").toBeNull();
    });

    await test.step("a player reporting a knockout tie: refused the same way", async () => {
      const player = await signedIn(`${MARK}-0@example.invalid`, "Zz Ailsa", "player");
      const r = await press(player, "reportBracketResult", "tournament.ts", ["winners-0-0", ailsa.id, "3&2"]);
      expect(r.ok).toBe(false);
      expect(r.error).toContain(NOT_LAUNCHED);
    });

    await test.step("the organizer's score entry in the console: refused, nothing written", async () => {
      const organizer = await signedIn(`${MARK}-org@example.invalid`, "Zz Organizer", "admin");
      const r = await press(organizer, "saveScorecard", "tournament.ts", [cardStage.id, bram.id, strokes]);
      // A refused console save is thrown (`requireScoreEntry`), and production blanks a thrown
      // message: what can be held is that nothing was saved.
      expect(r.ok, `the console saved a card on a tournament nobody launched: ${r.body.slice(0, 200)}`).toBe(false);
      expect(await prisma.scorecard.count({ where: { eventId: event.id } })).toBe(0);
    });

    await test.step("D2: a walkover is a result, so the tournament is under way and play goes on", async () => {
      await prisma.match.update({ where: { id: match.id }, data: { forfeitedBy: bram.id } });
      const r = await press(onCard, "savePlayCard", "play.ts", [strokes]);
      expect(r.error, "a walkover was not a result: the old four-table rule is back").not.toContain(NOT_LAUNCHED);
    });
    expect(errors).toEqual([]);
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await prisma.event.deleteMany({ where: { id: event.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
    await prisma.user.deleteMany({ where: { email: { in: [`${MARK}-0@example.invalid`, `${MARK}-org@example.invalid`] } } });
  }
});
