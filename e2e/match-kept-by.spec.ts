import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * THE ORGANIZER CHOOSES HOW PLAYERS KEEP A ROUND'S MATCHES (Ajay, 2026-10-19:
 * "provide both options for organizer to decide while setting up the
 * tournament").
 *
 * A cup's four-balls were kept by tapping who won each hole, and the players
 * praised it. A stroke card gives gross and net and works the shots out. Both
 * are offered, one per round, because both on one match is a fault: a stroke
 * card rebuilds the match from strokes, over holes somebody tapped.
 *
 *   on Rounds & formats      a cup session reads "Tap who won each hole" until
 *                            the organizer chooses Stroke cards; the choice is
 *                            kept, and named on the closed Customize bar
 *   a round on stroke cards  a code holder (Edda) and a signed-in player
 *                            (Ailsa) each keep their own ball, and the app
 *                            decides the hole: Edda's 3 beats Ailsa's 4 —
 *                            hole 1 to the Whites — and 4 v 4 is halved
 *   once a match has scores  switching back is refused, said beside the choice
 *   a round kept by tapping  Score entry offers no cards: the organizer keeps
 *                            or corrects a match on the players' tap card, and
 *                            a player is sent to their own
 *
 * Gross, so every hole is decided by the strokes alone and the expected result
 * needs no handicap arithmetic. Its own club, tournament, two sessions and
 * five invented people, deleted afterwards. WHAT IT CANNOT SEE: net shots on a
 * stroke card (the shots are the match card's, pinned in
 * round-code-four-ball-side.spec), and a refusal of the wrong kind of save
 * sent by a hand-made request — no screen offers one.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const MARK = "zz-match-kept-by";
const ALPHABET = "ABCDEFGHJKMNPQRTWXYZ2346789";
const CODE = "ZZ" + Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
const ids = { org: "", event: "", cards: "", taps: "", cardsMatch: "", tapsMatch: "", users: [] as string[] };
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v: string) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
const cookies = { organizer: "", ailsa: "" };

test.beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `${MARK} society`, kind: "society" } });
  ids.org = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${MARK} Autumn Cup`,
      status: "live",
      // The organizer has opened setup again to make the choice — after launch
      // a round's setup is locked, as it should be.
      configUnlocked: true,
      shape: "single",
      format: "match",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${MARK}-${CODE}`,
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(380)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      playerAccess: "code",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
    },
  });
  ids.event = event.id;
  const session = (position: number, format: string, description: string, accessCode: string) =>
    prisma.stage.create({
      data: {
        eventId: event.id,
        position,
        type: "Team Session",
        format,
        description,
        scoringBasis: "gross",
        holes: 9,
        nine: "front",
        accessCode,
        lineupPublished: true,
      },
    });
  const cards = await session(0, "Four-Ball", "Saturday four-balls", CODE);
  const taps = await session(1, "Four-Ball", "Sunday four-balls", "");
  ids.cards = cards.id;
  ids.taps = taps.id;
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
  const matchIn = async (stageId: string, position: number) => {
    const carrier = await prisma.group.create({
      data: { eventId: event.id, name: `Four-Ball — session ${position}`, position: 2 + position, stageId, isCarrier: true },
    });
    const side = (name: string, flight: string, players: string[]) =>
      prisma.team.create({
        data: {
          eventId: event.id,
          stageId,
          name,
          clubGroupId: flight,
          members: { create: players.map((playerId, p) => ({ playerId, position: p })) },
        },
      });
    const sa = await side("Zz Ailsa & Zz Bram", blues.id, [a1.id, a2.id]);
    const sb = await side("Zz Edda & Zz Finn", whites.id, [b1.id, b2.id]);
    return (
      await prisma.match.create({
        data: {
          eventId: event.id,
          stageId,
          groupId: carrier.id,
          round: 1,
          playerAId: "",
          playerBId: "",
          teamAId: sa.id,
          teamBId: sb.id,
          holes: JSON.stringify(new Array(9).fill(null)),
        },
      })
    ).id;
  };
  ids.cardsMatch = await matchIn(cards.id, 0);
  ids.tapsMatch = await matchIn(taps.id, 1);

  // The organizer, and Ailsa with an account: both sign in, as themselves.
  const organizer = await prisma.user.create({ data: { email: `${MARK}-organizer@example.invalid`, name: "Zz Organizer", password: "x:unusable" } });
  await prisma.account.create({ data: { eventId: event.id, email: organizer.email, name: "Zz Organizer", role: "admin" } });
  const ailsa = await prisma.user.create({ data: { email: a1.email, name: "Zz Ailsa", password: "x:unusable" } });
  await prisma.account.create({ data: { eventId: event.id, email: a1.email, name: "Zz Ailsa", role: "player" } });
  ids.users = [organizer.id, ailsa.id];
  cookies.organizer = sign(signedInNow(organizer.id));
  cookies.ailsa = sign(signedInNow(ailsa.id));
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

async function signIn(page: Page, baseURL: string, session: string) {
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: "ng_session", value: session, url: baseURL },
    { name: "ng_active_event", value: sign(ids.event), url: baseURL },
  ]);
}

/** The Saturday round's card on Rounds & formats, opened, with Customize open. */
async function roundCard(page: Page, stageId: string) {
  await page.goto(`/stages?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const radio = page.locator(`input[name="match-kept-by-${stageId}"]`).first();
  const card = page
    .locator("div.card")
    .filter({ has: radio })
    .filter({ has: page.getByRole("button", { name: /^Customize this round/ }) })
    .last();
  const head = card.locator("button[aria-expanded]").first();
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  const customize = card.getByRole("button", { name: /^Customize this round/ });
  if ((await customize.getAttribute("aria-expanded")) !== "true") await customize.click();
  return { card, customize };
}

const stored = async (matchId: string) => {
  const m = await prisma.match.findUniqueOrThrow({ where: { id: matchId }, select: { holes: true } });
  return (JSON.parse(m.holes) as (string | null)[]).slice(0, 2).join(",");
};

test("the organizer chooses stroke cards, and each player keeps their own ball while the app decides the hole", async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "organizer");

  await test.step("a cup session is tapped until the organizer chooses stroke cards", async () => {
    await signIn(page, baseURL!, cookies.organizer);
    const { card } = await roundCard(page, ids.cards);
    await expect(card.getByText("How players keep their matches", { exact: false }).first()).toBeVisible();
    await expect(card.getByRole("radio", { name: "Tap who won each hole" })).toBeChecked();
    await card.getByRole("radio", { name: "Stroke cards" }).check();
    await expect
      .poll(async () => (await prisma.stage.findUniqueOrThrow({ where: { id: ids.cards }, select: { matchKeptBy: true } })).matchKeptBy, {
        timeout: 15_000,
        message: "the choice was not saved",
      })
      .toBe("cards");
    // Kept, after a reload — and named on the closed Customize bar.
    const again = await roundCard(page, ids.cards);
    await expect(again.card.getByRole("radio", { name: "Stroke cards" })).toBeChecked();
    await again.customize.click();
    await expect(again.customize).toContainText("Stroke cards");
  });

  await test.step("a code holder keeps her own ball on a stroke card", async () => {
    const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      const p = await ctx.newPage();
      watchPageErrors(p, errors, "Edda, by the code");
      await p.goto("/play");
      await p.waitForLoadState("networkidle").catch(() => {});
      await p.getByLabel("Round code").fill(CODE);
      await p.getByRole("button", { name: "Continue" }).click();
      await p.getByRole("button", { name: "Zz Edda" }).click();
      await expect(p.getByText(/Your own card, hole by hole/)).toBeVisible({ timeout: 30_000 });
      await expect(p.getByRole("group", { name: "Who won hole 1" }), "a tap card on a round kept on cards").toHaveCount(0);
      await expect(p.getByLabel("Strokes on hole 1")).toBeVisible();
      await p.getByRole("button", { name: /Birdie$/ }).click();
      await expect(p.getByLabel("Strokes on hole 2")).toBeVisible();
      await p.getByRole("button", { name: /Par$/ }).click();
      await expect(p.getByText("2/9 holes")).toBeVisible();
      await expect(p.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
    } finally {
      await ctx.close();
    }
  });

  await test.step("a signed-in player keeps hers in the player app, and the app decides each hole", async () => {
    const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      const p = await ctx.newPage();
      watchPageErrors(p, errors, "Ailsa, signed in");
      await signIn(p, baseURL!, cookies.ailsa);
      await p.goto(`/me/match?m=${encodeURIComponent(ids.cardsMatch)}&bust=${Date.now()}`);
      await expect(p.getByText(/Your own card, hole by hole/)).toBeVisible({ timeout: 30_000 });
      for (const hole of [1, 2]) {
        await expect(p.getByLabel(`Strokes on hole ${hole}`)).toBeVisible();
        await p.getByRole("button", { name: /Par$/ }).click();
      }
      await expect(p.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
      // Edda's 3 beats Ailsa's 4 on the 1st — the Whites, side B — and 4 v 4 halves the 2nd.
      await expect.poll(() => stored(ids.cardsMatch), { timeout: 15_000, message: "the match was not worked out from the two cards" }).toBe("B,H");
      // And the card says where the match stands, in golf's words.
      await p.reload();
      await expect(p.getByText(/Zz E\. & Zz F\. 1 up with 7 to play/)).toBeVisible({ timeout: 20_000 });
    } finally {
      await ctx.close();
    }
  });

  await test.step("once a match has scores, the round stays kept the way it was started", async () => {
    const { card } = await roundCard(page, ids.cards);
    // A click, not check(): the screen puts the choice back when it is refused.
    await card.getByRole("radio", { name: "Tap who won each hole" }).click();
    await expect(card.getByRole("alert")).toContainText("already have scores");
    await expect(card.getByRole("radio", { name: "Stroke cards" })).toBeChecked();
    expect((await prisma.stage.findUniqueOrThrow({ where: { id: ids.cards }, select: { matchKeptBy: true } })).matchKeptBy).toBe("cards");
  });

  await test.step("the cup board publishes each ball's gross and net under the names", async () => {
    // "Always publish gross and net" (Ajay, 2026-10-17): a match kept on cards
    // has strokes, so the board says what each ball went round in. Gross is
    // pinned by hand — Edda 3 + 4, Ailsa 4 + 4; the net arithmetic is pinned
    // in card-line.test.ts.
    await page.goto(`/cup?bust=${Date.now()}`);
    const board = page.getByRole("region", { name: "The cup" });
    await expect(board.getByText(/^7 · net -?\d+ · thru 2$/), "Edda's card is not on the board").toBeVisible({ timeout: 20_000 });
    await expect(board.getByText(/^8 · net -?\d+ · thru 2$/), "Ailsa's card is not on the board").toBeVisible();
    // And each under its own side: the Blues on the left, the Whites on the right.
    const row = board.getByRole("listitem").filter({ hasText: "Zz Ailsa & Zz Bram" }).filter({ hasText: "Zz Edda & Zz Finn" }).first();
    await expect(row.locator(":scope > span").first(), "Ailsa's figures are not under the Blues").toContainText(/8 · net/);
    await expect(row.locator(":scope > span").last(), "Edda's figures are not under the Whites").toContainText(/7 · net/);
  });

  await test.step("a round kept by tapping: Score entry offers no cards, and the organizer keeps the match on the tap card", async () => {
    await page.goto(`/entry?round=${encodeURIComponent(ids.taps)}&bust=${Date.now()}`);
    await expect(page.getByText("Kept by tapping who won each hole")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Full card" })).toHaveCount(0);
    await page.getByRole("group", { name: "Who won hole 1" }).getByRole("button", { name: /^Hole 1 to Zz Ailsa & Zz Bram/ }).click();
    await expect.poll(() => stored(ids.tapsMatch), { timeout: 15_000, message: "the organizer's tap was not stored" }).toBe("A,");
  });

  await test.step("and a player there is sent to their own match", async () => {
    const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      const p = await ctx.newPage();
      watchPageErrors(p, errors, "Ailsa on Score entry");
      await signIn(p, baseURL!, cookies.ailsa);
      await p.goto(`/entry?round=${encodeURIComponent(ids.taps)}&bust=${Date.now()}`);
      await p.getByRole("link", { name: "Score my match" }).click();
      await expect(p).toHaveURL(/\/me\/match/);
    } finally {
      await ctx.close();
    }
  });

  expect(errors).toEqual([]);
});
