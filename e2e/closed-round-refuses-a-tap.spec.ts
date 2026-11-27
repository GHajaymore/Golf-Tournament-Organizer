import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { keepCardOf } from "./keep-on-play";

/**
 * A PLAYER'S TAP AFTER THE COMMITTEE CLOSED THE ROUND IS REFUSED IN WORDS, AND THE HOLE IS UNCHANGED (B128).
 *
 * A closed round refused a player's STROKE card (`savePlayCard`, `savePlayMatchCard`, `saveScorecard`) and took every
 * other match write: a tapped hole, a phoned-in result, the signed-in player's card, the offline replay. The close now
 * lives at the sink all of them ask, `mayWriteMatch`, so this walks the one a round-code holder presses most, the tap.
 *
 * What /play draws for a closed round, read from the source before this was written (slip 58: no Playwright here):
 *   - nothing of its own. `src/app/play/page.tsx` and `src/components/PlayClient.tsx` never read `Stage.closedAt`; the match
 *     card (`MatchKeeper`, PlayClient.tsx line 1854) is drawn exactly as for an open round, so the press itself is where the
 *     refusal is said;
 *   - the press goes `MatchKeeper` `setHole` (MatchKeeper.tsx line 143) -> `usePendingCard` queue -> `savePlayMatchHoles`; a
 *     returned `{ ok: false, error }` is thrown by the queue's `send` (MatchKeeper.tsx line 112), kept as a refusal, not
 *     retried (usePendingCard.ts line 261), and said in the status line `p[role=status]`
 *     as "Not sent: <the sentence>. Your holes are kept on this phone." (`syncStatus`, pending-card.ts line 271).
 *
 * So the step presses hole 2 after the close and reads that status line by its words, never by a page-wide alert (the
 * route announcer is one). The row is read from the database, never assumed: hole 1 as the open round stored it.
 *
 * Its own club, tournament, round, two invented players and one match, deleted afterwards. Light: one page.
 */

const prisma = new PrismaClient();
const MARK = "zz-closed-round-tap";
const ALPHABET = "ABCDEFGHJKMNPQRTWXYZ2346789";
const CODE = "ZZ" + Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
const ids = { org: "", event: "", stage: "", match: "" };

test.beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `${MARK} club`, kind: "club" } });
  ids.org = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${MARK} Spring Matchplay`,
      status: "live",
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
  const group = await prisma.group.create({ data: { eventId: event.id, name: `${MARK} flight`, position: 0 } });
  const stage = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Round Robin", format: "Match Play", scoringBasis: "gross", holes: 18, accessCode: CODE },
  });
  ids.stage = stage.id;
  const [a, b] = await Promise.all(
    ["Zz Closer", "Zz Opponent"].map((name, i) =>
      prisma.player.create({
        data: { eventId: event.id, groupId: group.id, name, email: `${MARK}-${i}@example.invalid`, status: "confirmed", seed: i + 1, handicap: 0 },
      }),
    ),
  );
  ids.match = (
    await prisma.match.create({
      data: { eventId: event.id, stageId: stage.id, groupId: group.id, round: 1, playerAId: a.id, playerBId: b.id, holes: JSON.stringify(new Array(18).fill(null)) },
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

const stored = async () => {
  const m = await prisma.match.findUniqueOrThrow({ where: { id: ids.match }, select: { holes: true } });
  return (JSON.parse(m.holes) as (string | null)[]).slice(0, 3).join(",");
};

test("a tap after the round is closed is refused in words and the hole is not written", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errors: string[] = [];
  watchPageErrors(page, errors);
  try {
    await page.goto("/play");
    await expect(page.getByLabel("Your code")).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("Your code").fill(CODE);
    await page.getByRole("button", { name: "Continue" }).click();
    await keepCardOf(page, "Zz Closer");

    const press = async (n: number) => {
      const group = page.getByRole("group", { name: `Who won hole ${n}` });
      await expect(group).toBeVisible({ timeout: 10_000 });
      await group.getByRole("button", { name: new RegExp(`^Hole ${n} to Zz Closer`) }).click();
    };

    await test.step("CONTROL: on an open round the first tap is stored", async () => {
      await press(1);
      await expect.poll(stored, { timeout: 15_000, message: "the open round did not store hole 1" }).toBe("A,,");
    });

    await test.step("the committee closes the round, and the same phone taps hole 2", async () => {
      await prisma.stage.update({ where: { id: ids.stage }, data: { closedAt: new Date() } });
      await press(2);
      const said = page.getByRole("status").filter({ hasText: "The committee has closed this round" });
      await expect(said, "the refusal was not said beside the card").toBeVisible({ timeout: 20_000 });
      await expect(said).toContainText("Not sent");
      expect(await stored(), "the closed round took the tap").toBe("A,,");
    });

    await test.step("after a reload the hole is unchanged, and still not written", async () => {
      await page.reload();
      await page.waitForLoadState("load");
      // Back to the card if the page returns to the list.
      const card = page.getByRole("group", { name: /^Who won hole \d+$/ });
      if (!(await card.first().isVisible({ timeout: 8_000 }).catch(() => false))) await keepCardOf(page, "Zz Closer");
      // The copy left on the phone (holes 1 and 2) is taken up and sent again; the closed round must refuse it AGAIN, in
      // words. Seeing that refusal is what proves the replay reached the server, so the unchanged row below means "refused".
      await expect(
        page.getByRole("status").filter({ hasText: "The committee has closed this round" }),
        "the phone's copy was not sent again after the reload, so nothing proves it was refused",
      ).toBeVisible({ timeout: 20_000 });
      // Hole 1 as it was before the refused tap; hole 2 never written.
      expect(await stored(), "a reload wrote hole 2 to a closed round").toBe("A,,");
    });

    // The reopened round's tap landing again is held by the audit test (`a-closed-round-takes-no-taps.audit.test.ts`).
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});
