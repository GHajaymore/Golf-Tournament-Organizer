import { createHmac } from "node:crypto";
import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { seed, teardown } from "../scripts/seed-club.mjs";

/**
 * A LOCKED SIDE IS REFUSED IN WORDS, NOT AN ERROR PAGE (state machine PR 5a; J10).
 *
 * Every action behind Teams & pairs, and a team round's pricing on Rounds &
 * formats, refused a locked tournament by THROWING (`assertUnlocked`), and a
 * throw inside a transition replaced the screen with "This screen didn't load".
 * The screens hid that by never offering the press while locked — but a screen
 * drawn BEFORE the lock (the Organizer pressed Lock configuration in another tab)
 * still offers it. They now ask their scope's lock (`refuseIfLocked`) and
 * RETURN the reason and the way out.
 *
 * So each changed control is pressed ONCE here, by the club's organizer, on a
 * screen drawn while setup was unlocked and locked again since:
 *
 *   Teams & pairs     Add team · Draw sides automatically · Remove team ·
 *                     Remove <player> · Add player
 *                     → "Locked because the tournament is live. Unlock it on the
 *                       dashboard to change teams.", brought into view; nothing
 *                       written; the screen catches up — the banner names the
 *                       reason and a padlock points at it
 *   Rounds & formats  the four-ball's Handicap allowance · Scores that count
 *                     → refused under that setting's Save, in the same shape
 *
 * WHAT IT CANNOT PRESS, and where each is proved instead: Generate matches (only a
 * round robin of sides has it, and the seeded club has none), a greensomes split
 * (no such round) and Describe it instead (it needs the model, and is not drawn on
 * a locked tournament) — all three in `a-locked-side-is-refused-in-words.audit.test.ts`,
 * with the other seven, against real rows.
 */

const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
const WALKED = ["desktop"];

type Club = Awaited<ReturnType<typeof seed>>;
let club: Club;
test.beforeAll(async ({}, testInfo) => {
  if (!WALKED.includes(testInfo.project.name)) return;
  club = await seed();
});
test.afterAll(async ({}, testInfo) => {
  if (WALKED.includes(testInfo.project.name)) await teardown();
  await prisma.$disconnect();
});

test("each control behind a locked side, pressed on a screen drawn before the lock, is refused in words", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "one size: the refusal is the server's answer, the same at every width");
  test.setTimeout(300_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "organizer");

  // The fixture's facts, read from the fixture.
  const ev = club.events.find((e) => e.slug === "fourball")!;
  const event = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
  expect(event.status, "the seeded four-ball is not launched").toBe("live");
  expect(event.configUnlocked, "the seeded four-ball's setup is already unlocked").toBe(false);
  const stage = await prisma.stage.findFirstOrThrow({ where: { eventId: ev.id, position: 0 } });
  expect(stage.format, "the seeded four-ball's first round is not a four-ball").toBe("Four-Ball");
  const side = await prisma.team.findFirstOrThrow({
    where: { stageId: stage.id },
    orderBy: { seed: "asc" },
    include: { members: { orderBy: { position: "asc" }, include: { player: true } } },
  });
  const member = side.members[0].player;

  // Every seeded player is on a side, so Remove team and Add player have nothing to press:
  // a side with nobody on it and a confirmed reserve on no side, invented and marked.
  const spare = await prisma.team.create({ data: { eventId: ev.id, stageId: stage.id, name: "zz-sm5a Spare", seed: 99 } });
  const reserve = await prisma.player.create({
    data: { eventId: ev.id, name: "Zz Reserve", email: "zz-sm5a-reserve@example.invalid", seed: 999, status: "confirmed", handicap: 12 },
  });
  const setupUnlocked = (unlocked: boolean) => prisma.event.update({ where: { id: ev.id }, data: { configUnlocked: unlocked } });

  try {
    await context.addCookies([
      { name: "ng_session", value: club.organizer.session, url: baseURL! },
      { name: "ng_active_event", value: sign(ev.id), url: baseURL! },
    ]);
    const open = async (path: string) => {
      await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
      await page.waitForLoadState("networkidle").catch(() => {});
    };
    const teamsPath = `/teams?round=${stage.id}`;
    const REFUSED = "Locked because the tournament is live. Unlock it on the dashboard to change teams.";

    /**
     * Draw the screen unlocked, lock setup "in another tab", press, and read the answer:
     * said and in view, nothing written, the screen still there, and caught up.
     */
    const pressedAfterTheLock = async (label: string, press: () => Promise<void>, stored: () => Promise<unknown>) => {
      await setupUnlocked(true);
      await open(teamsPath);
      await expect(page.getByRole("region", { name: "Locked" }), `${label}: the screen was drawn locked`).toHaveCount(0);
      const before = await stored();
      await setupUnlocked(false);
      await press();
      const said = page.getByText(REFUSED);
      await expect(said, `${label}: the refusal was not said`).toBeVisible({ timeout: 20_000 });
      await expect(said, `${label}: the refusal is not in view`).toBeInViewport();
      await expect(page.getByRole("heading", { level: 1, name: "Teams & pairs" }), `${label}: the screen was replaced by an error page`).toBeVisible();
      const banner = page.getByRole("region", { name: "Locked" });
      await expect(banner, `${label}: the screen did not catch up with the lock`).toContainText("Locked because the tournament is live.", { timeout: 20_000 });
      await expect(banner.getByRole("button", { name: "Unlock setup" }), `${label}: the Organizer has no way out on the banner`).toBeVisible();
      await expect(page.getByRole("button", { name: "Locked — see above" }).first()).toBeVisible();
      expect(await stored(), `${label}: written while locked`).toEqual(before);
    };

    const spareCard = page.locator("main .card", { has: page.getByRole("textbox", { name: "Name of zz-sm5a Spare" }) });

    await pressedAfterTheLock(
      "Add team",
      async () => {
        await page.getByLabel("Add a team").fill("zz-sm5a New Side");
        await page.getByRole("button", { name: "Add team" }).click();
      },
      () => prisma.team.count({ where: { eventId: ev.id } }),
    );

    await pressedAfterTheLock(
      "Draw sides automatically",
      () => page.getByRole("button", { name: /Draw sides automatically/ }).click(),
      async () => (await prisma.team.findMany({ where: { stageId: stage.id }, select: { id: true }, orderBy: { id: "asc" } })).map((t) => t.id),
    );

    await pressedAfterTheLock(
      "Remove team",
      async () => {
        await spareCard.getByRole("button", { name: "Remove team" }).click();
        await spareCard.getByRole("button", { name: "Remove the team" }).click();
      },
      () => prisma.team.count({ where: { id: spare.id } }),
    );

    await pressedAfterTheLock(
      `Remove ${member.name}`,
      () => page.getByRole("button", { name: `Remove ${member.name}` }).click(),
      () => prisma.teamMember.count({ where: { teamId: side.id } }),
    );

    await pressedAfterTheLock(
      "Add player",
      async () => {
        await spareCard.getByRole("button", { name: "Add player" }).click();
        await page.getByRole("combobox", { name: "Add a player to zz-sm5a Spare" }).selectOption(reserve.id);
      },
      () => prisma.teamMember.count({ where: { teamId: spare.id } }),
    );

    // ── Rounds & formats: the four-ball's pricing, under each setting's Save ──
    const openRound = async () => {
      await open("/stages");
      const card = page.locator("main .card", { has: page.locator("button", { hasText: /Round 1/ }) }).first();
      await expect(card, "Rounds & formats has no card for Round 1").toBeVisible();
      const allowance = card.locator("p", { hasText: /^Handicap allowance/ });
      if (!(await allowance.isVisible().catch(() => false))) await card.locator("button", { hasText: /Round 1/ }).first().click();
      await expect(allowance, "the round's card does not say its allowance").toBeVisible();
      return card;
    };
    const changeBeside = (card: ReturnType<typeof page.locator>, words: RegExp) =>
      card.locator("div", { has: page.locator("p", { hasText: words }) }).last().getByRole("button", { name: "Change", exact: true });
    const pricing = () => prisma.stage.findUniqueOrThrow({ where: { id: stage.id }, select: { handicapAllowance: true, countBest: true } });

    for (const step of [
      {
        label: "Handicap allowance",
        words: /^Handicap allowance/,
        control: "Handicap allowance percent",
        set: async (card: ReturnType<typeof page.locator>) => card.getByLabel("Handicap allowance percent").fill("90"),
        said: "Locked because the tournament is live. Unlock it on the dashboard to change a round’s handicap allowance.",
      },
      {
        label: "Scores that count",
        words: /^Scores that count/,
        control: "How many scores count on each hole",
        set: async (card: ReturnType<typeof page.locator>) => {
          await card.getByLabel("How many scores count on each hole").selectOption({ label: "best 2 of 2" });
        },
        said: "Locked because the tournament is live. Unlock it on the dashboard to change how many scores count.",
      },
    ]) {
      await setupUnlocked(true);
      const card = await openRound();
      const before = await pricing();
      await changeBeside(card, step.words).click();
      await step.set(card);
      await setupUnlocked(false);
      // The Save beside THIS setting's box, not any Save on the card: a team round's card can hold
      // more than one editor, and a card-wide "Save" would be ambiguous (strict mode) or the wrong one.
      const editor = card.locator("div", { has: card.getByLabel(step.control) }).last();
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      const said = card.getByText(step.said);
      await expect(said, `${step.label}: the refusal was not said on the round's card`).toBeVisible({ timeout: 20_000 });
      await expect(said, `${step.label}: the refusal is not in view`).toBeInViewport();
      await expect(page.getByRole("heading", { level: 1 }), `${step.label}: the screen was replaced by an error page`).toBeVisible();
      expect(await pricing(), `${step.label}: written while locked`).toEqual(before);
    }

    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await setupUnlocked(false);
    await prisma.teamMember.deleteMany({ where: { playerId: reserve.id } });
    await prisma.team.deleteMany({ where: { id: spare.id } });
    await prisma.player.deleteMany({ where: { id: reserve.id } });
  }
});
