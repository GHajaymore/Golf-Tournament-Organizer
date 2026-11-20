import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { actionShapes, type ActionShape } from "./action-shapes";
import { watchPageErrors } from "./page-errors";

/**
 * ONE SCORER PER GROUP, AND THE OTHER SIDE'S CHECK — the server half, pressed
 * from the phones of the people who would (2026-11-04, sprint 2 part B).
 *
 * Phase 1 ships the RULES; the buttons on /play ("I'll keep score", "Take
 * over", "Confirm result", "That's not right") are phase 2's, because the
 * round-code screens are being rebuilt by sprint 1 at the same time. Until
 * they exist, each action is called the way its button will call it: from a
 * page holding the code holder's own play session, through the action's own
 * endpoint (the `next-action` id the build gives it), so the coverage ledger
 * records it as reached and the server's answer is the one a screen will get.
 * Phase 2 replaces each call here with the press on the screen.
 *
 *   Ailsa keeps the card        keepGroup → the scorer, epoch 1
 *   Bram, beside her            his save is refused in words, naming her
 *   Bram takes over             keepGroup({ takeOver }) → epoch 2, logged
 *   Ailsa's phone, stale        her save with epoch 1 is refused
 *   Bram hands it back          handOverGroup(Ailsa) → epoch 3
 *   Ailsa enters the result     accepted, as the group's scorer
 *   the author cannot confirm   confirmPlayMatch from Ailsa is refused
 *   the other side disputes     disputePlayMatch from Bram → held off the board
 *   after the committee reopens confirmPlayMatch from Bram → confirmed
 *   a stroke card               disputePlayCard from the card's own player
 *
 * Its own club, tournament and invented people with @example.invalid
 * addresses, deleted afterwards. Needs the e2e build's action manifest
 * (`.next-e2e`), as the every-action sweep does.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const MARK = "zz-scoring-by-group-server";
const ALPHABET = "ABCDEFGHJKMNPQRTWXYZ2346789";
const code = () => "ZZ" + Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
const MATCH_CODE = code();
const CARD_CODE = code();
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v: string) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
const fingerprint = (v: string) => createHmac("sha256", secret).update(v).digest("base64url");
const ids = { org: "", event: "", matchStage: "", cardStage: "", match: "", ailsa: "", bram: "" };

/** A play session as `createPlaySession` signs it — the cookie a phone holds after tapping its name. */
const playCookie = (stageId: string, playerId: string, accessCode: string) =>
  sign(`${stageId}:${playerId}:${Date.now() + 12 * 60 * 60 * 1000}:${fingerprint(`round-code:${accessCode}`).slice(0, 16)}`);

test.beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `${MARK} society`, kind: "society" } });
  ids.org = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${MARK} Autumn Singles`,
      status: "live",
      shape: "single",
      format: "match",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${MARK}-${MATCH_CODE}`,
      customPars: JSON.stringify(new Array(18).fill(4)),
      playerAccess: "code",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      scoreApproval: "players",
      attestBy: "marker",
    },
  });
  ids.event = event.id;
  const round = (position: number, type: string, format: string, accessCode: string) =>
    prisma.stage.create({
      data: {
        eventId: event.id,
        position,
        type,
        format,
        description: `Zz round ${position + 1}`,
        holes: 9,
        nine: "front",
        scoringBasis: "gross",
        accessCode,
        // As a new round is made (`scoringDefaults`).
        scoreKeeping: "group",
        endCheck: "on",
      },
    });
  ids.matchStage = (await round(0, "Single Match Stage", "Match Play", MATCH_CODE)).id;
  ids.cardStage = (await round(1, "Stroke Play Round", "Individual Stroke Play", CARD_CODE)).id;
  const group = await prisma.group.create({ data: { eventId: event.id, name: "A", position: 0 } });
  const person = (name: string, i: number) =>
    prisma.player.create({
      data: { eventId: event.id, groupId: group.id, name, email: `${MARK}-${i}@example.invalid`, status: "confirmed", seed: i + 1, handicap: 0 },
    });
  ids.ailsa = (await person("Zz Ailsa", 0)).id;
  ids.bram = (await person("Zz Bram", 1)).id;
  ids.match = (
    await prisma.match.create({
      data: {
        eventId: event.id,
        stageId: ids.matchStage,
        groupId: group.id,
        round: 1,
        playerAId: ids.ailsa,
        playerBId: ids.bram,
        holes: JSON.stringify(new Array(9).fill(null)),
      },
    })
  ).id;
});

test.afterAll(async () => {
  try {
    if (ids.event) await prisma.event.deleteMany({ where: { id: ids.event } });
    if (ids.org) await prisma.organization.deleteMany({ where: { id: ids.org } });
  } finally {
    await prisma.$disconnect();
  }
});

let shapes: ActionShape[] = [];
function action(name: string): ActionShape {
  if (shapes.length === 0) shapes = actionShapes();
  const found = shapes.find((a) => a.name === name && a.file.endsWith("app/actions/play.ts"));
  if (!found) throw new Error(`${name} is not in the build's action manifest — no screen can call it either`);
  return found;
}

interface Answer {
  ok: boolean;
  error: string;
  epoch: number | null;
  status: string;
  body: string;
}

/** Call a round-code action from this phone's page, as its button will: the same endpoint, the same session. */
async function press(page: Page, name: string, args: unknown[]): Promise<Answer> {
  const a = action(name);
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
  return {
    ok: /"ok":true/.test(body),
    error: /"error":"((?:[^"\\]|\\.)*)"/.exec(body)?.[1] ?? "",
    epoch: Number(/"epoch":(\d+)/.exec(body)?.[1] ?? NaN) || null,
    status: /"status":"([a-z-]+)"/.exec(body)?.[1] ?? "",
    body,
  };
}

/** A phone: its own browser, holding the play session of the player whose name was tapped. */
async function phone(browser: import("@playwright/test").Browser, baseURL: string, stageId: string, playerId: string, accessCode: string, errors: string[], who: string) {
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  await ctx.addCookies([{ name: "ng_play", value: playCookie(stageId, playerId, accessCode), url: baseURL }]);
  const page = await ctx.newPage();
  watchPageErrors(page, errors, who);
  await page.goto(`/play?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  return { ctx, page };
}

const matchRow = () => prisma.match.findUniqueOrThrow({ where: { id: ids.match } });
const won = (n: number): Array<"A" | null> => Array.from({ length: 9 }, (_, i) => (i < n ? "A" : null));

test("one phone keeps the group's card, and the other side checks the result", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const ailsa = await phone(browser, baseURL!, ids.matchStage, ids.ailsa, MATCH_CODE, errors, "Ailsa");
  const bram = await phone(browser, baseURL!, ids.matchStage, ids.bram, MATCH_CODE, errors, "Bram");
  try {
    await test.step("Ailsa keeps the card", async () => {
      const r = await press(ailsa.page, "keepGroup", [{}]);
      expect(r.ok, r.error || r.body.slice(0, 200)).toBe(true);
      expect(r.epoch).toBe(1);
    });

    await test.step("Bram's save beside her is refused, naming her", async () => {
      const r = await press(bram.page, "savePlayMatchHoles", [ids.match, won(1)]);
      expect(r.ok).toBe(false);
      expect(r.error).toContain("Zz Ailsa is keeping score for your group");
      expect(JSON.parse((await matchRow()).holes)[0], "a refused save wrote a hole").toBeNull();
    });

    await test.step("Bram takes over, and Ailsa's phone — now stale — is refused", async () => {
      const r = await press(bram.page, "keepGroup", [{ takeOver: true }]);
      expect(r.ok, r.error).toBe(true);
      expect(r.epoch).toBe(2);
      const stale = await press(ailsa.page, "savePlayMatchHoles", [ids.match, won(1), { epoch: 1 }]);
      expect(stale.ok).toBe(false);
      expect(stale.error).toMatch(/moved to another phone|is keeping score/);
      const logged = await prisma.auditLog.findFirst({ where: { eventId: ids.event, action: "keeper.takeover" } });
      expect(logged?.detail, "the take-over was not logged").toContain("Zz Bram took over keeping score from Zz Ailsa");
    });

    await test.step("Bram hands the card back, and Ailsa enters the result as the scorer", async () => {
      const r = await press(bram.page, "handOverGroup", [ids.ailsa]);
      expect(r.ok, r.error).toBe(true);
      expect(r.epoch).toBe(3);
      const saved = await press(ailsa.page, "savePlayMatchHoles", [ids.match, won(5), { epoch: 3 }]);
      expect(saved.ok, saved.error).toBe(true);
      expect((await matchRow()).enteredById).toBe(ids.ailsa);
    });

    await test.step("the author cannot confirm her own result; the other side disputes it", async () => {
      const own = await press(ailsa.page, "confirmPlayMatch", [ids.match]);
      expect(own.ok).toBe(false);
      expect(own.error).toMatch(/somebody else/i);
      const disputed = await press(bram.page, "disputePlayMatch", [ids.match]);
      expect(disputed.ok, disputed.error).toBe(true);
      expect((await matchRow()).scoreStatus).toBe("disputed");
    });

    await test.step("once the committee reopens it, the other side confirms", async () => {
      // The committee's reopen is `reopenMatch` on Score entry; written here as its row.
      await prisma.match.update({ where: { id: ids.match }, data: { scoreStatus: "pending" } });
      const r = await press(bram.page, "confirmPlayMatch", [ids.match]);
      expect(r.ok, r.error).toBe(true);
      expect(r.status).toBe("confirmed");
      expect((await matchRow()).scoreStatus).toBe("confirmed");
    });
  } finally {
    await ailsa.ctx.close();
    await bram.ctx.close();
  }

  await test.step("on a stroke round, a player disputes their own card", async () => {
    await prisma.scorecard.create({
      data: { eventId: ids.event, stageId: ids.cardStage, playerId: ids.ailsa, strokes: JSON.stringify(new Array(9).fill(4)) },
    });
    const p = await phone(browser, baseURL!, ids.cardStage, ids.ailsa, CARD_CODE, errors, "Ailsa, stroke round");
    try {
      const r = await press(p.page, "disputePlayCard", []);
      expect(r.ok, r.error).toBe(true);
      const card = await prisma.scorecard.findFirstOrThrow({ where: { eventId: ids.event, stageId: ids.cardStage, playerId: ids.ailsa } });
      expect(card.status).toBe("disputed");
    } finally {
      await p.ctx.close();
    }
  });

  expect(errors).toEqual([]);
});
